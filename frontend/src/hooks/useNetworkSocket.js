import { useState, useEffect, useRef, useCallback } from 'react';

function buildWsUrl() {
  // Prefer an explicit WS URL override
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;

  // Derive from the backend base URL (https → wss, http → ws)
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/$/, '') + '/ws';
  }

  // Local dev fallback — Vite proxy handles the /ws path
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
}

const WS_URL = buildWsUrl();
const RECONNECT_BASE_DELAY = 1000;
const MAX_RECONNECT_DELAY = 10000;
const MAX_BUFFERED_EVENTS = 50_000;
const DROP_CHUNK_SIZE = 5_000;

/**
 * Assigns 3D positions to nodes in the spherical cluster layout.
 * Radius = 9.5 provides breathing room and preserves the exact node size and spacing
 * shown in the original visualization.
 */
function assignPositions(nodes) {
  const count = nodes.length;
  const radius = 9.5;

  return nodes.map((node, i) => {
    // Use golden angle distribution for even spacing
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = (radius * 0.48) * Math.cos(phi); // Flattened vertically
    const z = radius * Math.sin(phi) * Math.sin(theta);

    return {
      ...node,
      position: [x, y, z],
      threatState: 'none', // 'none' | 'medium' | 'critical'
      threatTimestamp: null,
    };
  });
}

const ATTACKER_POSITION = [14.5, 2.5, 4.5];

function getExternalNodePosition(nodeId, existingNodes) {
  let externalCount = 0;
  for (const node of existingNodes.values()) {
    if (node.type === 'external' && node.id !== nodeId) {
      externalCount += 1;
    }
  }
  if (externalCount === 0) return [...ATTACKER_POSITION];

  return [
    ATTACKER_POSITION[0] + (externalCount % 3) * 2,
    ATTACKER_POSITION[1] + Math.floor(externalCount / 3) * 2.5,
    ATTACKER_POSITION[2] + (externalCount % 2 === 1 ? -3 : 3) * Math.ceil(externalCount / 2),
  ];
}

export function useNetworkSocket() {
  const [nodes, setNodes] = useState(new Map());
  const [connections, setConnections] = useState([]);
  const [events, setEvents] = useState([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [threatCount, setThreatCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef(null);

  // Buffer and batching state
  const eventsRef = useRef([]);
  const totalEventsRef = useRef(0);
  const seqRef = useRef(0);
  const rafIdRef = useRef(null);
  const nodesRef = useRef(new Map());
  const connectionsRef = useRef([]);
  const threatCountRef = useRef(0);
  const hasPendingEventsRef = useRef(false);
  const hasPendingThreatsRef = useRef(false);

  const flushUpdates = useCallback(() => {
    rafIdRef.current = null;

    if (hasPendingEventsRef.current) {
      hasPendingEventsRef.current = false;
      setEvents([...eventsRef.current]);
      setTotalEvents(totalEventsRef.current);
    }

    if (hasPendingThreatsRef.current) {
      hasPendingThreatsRef.current = false;
      setNodes(new Map(nodesRef.current));
      setConnections([...connectionsRef.current]);
      setThreatCount(threatCountRef.current);
    }
  }, []);

  const handleMessage = useCallback((data) => {
    // ── Reset command ─────────────────────────────────────────────
    if (data.type === 'reset') {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      eventsRef.current = [];
      totalEventsRef.current = 0;
      seqRef.current = 0;
      threatCountRef.current = 0;
      hasPendingEventsRef.current = false;
      hasPendingThreatsRef.current = false;

      // Keep only internal nodes, drop any external/attacker nodes
      const baseNodes = new Map();
      nodesRef.current.forEach((node, id) => {
        if (node.type !== 'external' && id !== 'node-99') {
          baseNodes.set(id, {
            ...node,
            threatState: 'none',
            threatTimestamp: null,
          });
        }
      });
      nodesRef.current = baseNodes;

      // Reset threat states on base connections, drop attacker connections
      const internalIds = new Set(baseNodes.keys());
      const baseConns = connectionsRef.current
        .filter((c) => internalIds.has(c.source) && internalIds.has(c.target))
        .map((c) => ({ ...c, threat: false, severity: 'none' }));

      connectionsRef.current = baseConns;

      setEvents([]);
      setTotalEvents(0);
      setThreatCount(0);
      setNodes(baseNodes);
      setConnections(baseConns);
      return;
    }

    // ── Initial topology ──────────────────────────────────────────
    if (data.type === 'topology') {
      // Drop any attacker / external node — they must never appear on fresh load
      const internalNodes = data.nodes.filter(
        (n) => n.type !== 'external' && n.id !== 'node-99'
      );

      const positioned = assignPositions(internalNodes);
      const nodeMap = new Map();
      positioned.forEach((n) => nodeMap.set(n.id, n));

      // Use the base connections from the backend (exactly the connections forming initially)
      const internalIds = new Set(internalNodes.map((n) => n.id));
      const baseConns = (data.connections || []).filter(
        (c) => internalIds.has(c.source) && internalIds.has(c.target)
      );

      nodesRef.current = nodeMap;
      connectionsRef.current = baseConns;
      setNodes(nodeMap);
      setConnections(baseConns);
      return;
    }

    // ── Topology update (new node added, e.g. attacker) ───────────
    if (data.type === 'topology_update') {
      if (data.action === 'add_node') {
        const nextNodes = new Map(nodesRef.current);
        if (!nextNodes.has(data.node.id)) {
          const pos = data.node.position || getExternalNodePosition(data.node.id, nextNodes);
          const node = {
            ...data.node,
            position: pos,
            threatState: data.node.threatState || 'critical',
            threatTimestamp: Date.now(),
          };
          nextNodes.set(data.node.id, node);
          nodesRef.current = nextNodes;
          setNodes(nextNodes);
        }
        if (data.connection) {
          const hasConn = connectionsRef.current.some(
            (c) =>
              (c.source === data.connection.source && c.target === data.connection.target) ||
              (c.source === data.connection.target && c.target === data.connection.source)
          );
          if (!hasConn) {
            const nextConns = [
              ...connectionsRef.current,
              { ...data.connection, threat: true, severity: 'critical' },
            ];
            connectionsRef.current = nextConns;
            setConnections(nextConns);
          }
        }
      }
      return;
    }

    // ── Network event ─────────────────────────────────────────────
    if (data.type === 'network_event') {
      seqRef.current += 1;
      totalEventsRef.current += 1;

      const eventWithSeq = {
        ...data,
        _seq: seqRef.current,
        _receivedAt: Date.now(),
      };

      eventsRef.current.push(eventWithSeq);

      // When full, drop the oldest events in chunks of 5,000
      if (eventsRef.current.length > MAX_BUFFERED_EVENTS) {
        const excess = eventsRef.current.length - MAX_BUFFERED_EVENTS;
        const dropCount = Math.max(DROP_CHUNK_SIZE, excess);
        eventsRef.current.splice(0, dropCount);
      }

      hasPendingEventsRef.current = true;

      const sourceId = data.source_node;
      const targetId = data.target_node;

      // Only create new node and connection if this event involves an attacker / external node
      const sourceIsAttacker = sourceId === 'node-99';
      const targetIsAttacker = targetId === 'node-99';
      const isAttackerEvent = sourceIsAttacker || targetIsAttacker;

      if (isAttackerEvent) {
        let currentNodes = nodesRef.current;
        let nodesChanged = false;

        const ensureExternalNode = (id, ip, hostname) => {
          if (!id || currentNodes.has(id)) return;
          if (!nodesChanged) {
            currentNodes = new Map(currentNodes);
            nodesChanged = true;
          }
          const pos = getExternalNodePosition(id, currentNodes);
          currentNodes.set(id, {
            id,
            ip: ip || 'unknown',
            hostname: hostname || id,
            type: 'external',
            role: 'Unknown External Host',
            position: pos,
            threatState: 'critical',
            threatTimestamp: Date.now(),
          });
        };

        ensureExternalNode(sourceId, data.source_ip, data.source_hostname);
        ensureExternalNode(targetId, data.target_ip, data.target_hostname);

        if (nodesChanged) {
          nodesRef.current = currentNodes;
          hasPendingThreatsRef.current = true;
        }

        // Add connection between attacker and target if not yet present
        if (sourceId && targetId) {
          const hasConn = connectionsRef.current.some(
            (c) =>
              (c.source === sourceId && c.target === targetId) ||
              (c.source === targetId && c.target === sourceId)
          );
          if (!hasConn) {
            connectionsRef.current = [
              ...connectionsRef.current,
              {
                source: sourceId,
                target: targetId,
                threat: true,
                severity: data.severity || 'critical',
              },
            ];
            hasPendingThreatsRef.current = true;
          }
        }
      }

      // CRITICAL: Normal-to-normal events NEVER create new connections!
      // This ensures the lines between nodes stay fixed at the base connections.

      // If threat detected, update node and connection states
      if (data.threat) {
        threatCountRef.current += 1;
        const severity = data.severity || 'critical';
        let threatNodesChanged = false;
        let threatNodes = nodesRef.current;

        if (threatNodes.has(sourceId)) {
          if (!threatNodesChanged) {
            threatNodes = new Map(threatNodes);
            threatNodesChanged = true;
          }
          threatNodes.set(sourceId, {
            ...threatNodes.get(sourceId),
            threatState: severity,
            threatTimestamp: Date.now(),
          });
        }
        if (threatNodes.has(targetId)) {
          if (!threatNodesChanged) {
            threatNodes = new Map(threatNodes);
            threatNodesChanged = true;
          }
          threatNodes.set(targetId, {
            ...threatNodes.get(targetId),
            threatState: severity,
            threatTimestamp: Date.now(),
          });
        }
        if (threatNodesChanged) {
          nodesRef.current = threatNodes;
        }

        // Update threat-active connection
        connectionsRef.current = connectionsRef.current.map((conn) => {
          if (
            (conn.source === sourceId && conn.target === targetId) ||
            (conn.source === targetId && conn.target === sourceId)
          ) {
            return { ...conn, threat: true, severity };
          }
          return conn;
        });

        hasPendingThreatsRef.current = true;
      }

      // Schedule batched re-render at most once per animation frame
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(flushUpdates);
      }
    }
  }, [flushUpdates]);

  const handleMessageRef = useRef(handleMessage);
  handleMessageRef.current = handleMessage;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttempts.current = 0;
      console.log('[WebSentinel] WebSocket connected');
    };

    ws.onclose = () => {
      setIsConnected(false);
      console.log('[WebSentinel] WebSocket disconnected');

      // Exponential backoff reconnect
      const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts.current),
        MAX_RECONNECT_DELAY
      );
      reconnectAttempts.current += 1;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error('[WebSentinel] WebSocket error', err);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessageRef.current(data);
      } catch (err) {
        console.error('[WebSentinel] Failed to parse message', err);
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return {
    nodes,
    connections,
    events,
    totalEvents,
    threatCount,
    isConnected,
    nodeCount: nodes.size,
  };
}
