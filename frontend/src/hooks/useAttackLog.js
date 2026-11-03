import { useState, useEffect, useRef } from 'react';

/**
 * Format timestamp string to HH:MM:SS in local time.
 */
function toHHMMSS(isoString) {
  try {
    const d = new Date(isoString);
    if (isNaN(d)) throw new Error();
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}

/**
 * Parse attempts text for Port Scan.
 * If window is available: "N ports scanned in W s"
 * If window is not available: "N ports scanned"
 */
function parsePortScanAttempts(message) {
  const mPorts = String(message).match(/probed\s+(\d+)\s+distinct\s+ports?/i);
  const ports = mPorts ? parseInt(mPorts[1], 10) : 10;
  const mWindow = String(message).match(/in\s+([\d.]+)\s*s/i);
  if (mWindow) {
    const windowSec = Math.round(parseFloat(mWindow[1]));
    return {
      count: ports,
      window: windowSec,
      text: `${ports} ports scanned in ${windowSec} s`,
      shortText: `${ports} ports scanned`,
    };
  }
  return {
    count: ports,
    window: null,
    text: `${ports} ports scanned`,
    shortText: `${ports} ports scanned`,
  };
}

/**
 * Parse attempts text for Brute Force.
 * If window is available: "N failed logins in W s"
 * If window is not available: "N failed logins"
 */
function parseBruteForceAttempts(message) {
  const mLogins = String(message).match(/made\s+(\d+)\s+failed/i);
  const logins = mLogins ? parseInt(mLogins[1], 10) : 5;
  const mWindow = String(message).match(/in\s+([\d.]+)\s*s/i);
  if (mWindow) {
    const windowSec = Math.round(parseFloat(mWindow[1]));
    return {
      count: logins,
      window: windowSec,
      text: `${logins} failed logins in ${windowSec} s`,
      shortText: `${logins} failed logins`,
    };
  }
  return {
    count: logins,
    window: null,
    text: `${logins} failed logins`,
    shortText: `${logins} failed logins`,
  };
}

/**
 * Look up a hostname in the node map to find its IP.
 */
function findIpByHostname(nodes, hostname) {
  if (!hostname || !nodes) return '-';
  for (const node of nodes.values()) {
    if (node.hostname === hostname) return node.ip || '-';
  }
  return '-';
}

const MAX_RECORDS = 200;
const DEDUP_WINDOW_MS = 30_000; // 30 seconds for repeat merging
const TOGETHER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes for combination

/**
 * useAttackLog
 *
 * Watches new events by _seq.
 * Shows ONLY Port Scan and Brute Force (Data Exfil is completely ignored).
 * Combines Port Scan + Brute Force with the same attacker IP and target host
 * within 5 minutes of each other into ONE combined card.
 *
 * @param {Array} events - from useNetworkSocket
 * @param {Map}   nodes  - from useNetworkSocket
 * @returns {{ records: Array, clear: Function }}
 */
export function useAttackLog(events, nodes) {
  const [records, setRecords] = useState([]);
  const lastSeqRef = useRef(0);
  const nodesRef = useRef(nodes);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    if (!events || events.length === 0) return;

    const newEvents = events.filter((e) => (e._seq ?? 0) > lastSeqRef.current);
    if (newEvents.length === 0) return;

    lastSeqRef.current = newEvents[newEvents.length - 1]._seq;

    // The Attack Log shows ONLY Port Scan and Brute Force.
    // Data Exfil must NOT create a record in the Attack Log.
    const alertEvents = newEvents.filter(
      (e) =>
        e.threat === true &&
        (e.threat_type === 'port_scan' || e.threat_type === 'brute_force')
    );
    if (alertEvents.length === 0) return;

    setRecords((prev) => {
      let next = [...prev];

      for (const event of alertEvents) {
        const threatType = event.threat_type;
        const attackerIp = event.source_ip || '-';
        const source = event.source_hostname || 'unknown-external';
        const targetHost = event.target_hostname || '-';
        const targetIp =
          findIpByHostname(nodesRef.current, targetHost) || event.target_ip || '-';
        const time = toHHMMSS(event.timestamp);
        const now = Date.now();
        const eventMs = event.timestamp ? new Date(event.timestamp).getTime() : now;
        const validEventMs = isNaN(eventMs) ? now : eventMs;

        // 1. Check if an existing COMBINED record matches same attacker IP and target host
        // within repeat window (30s)
        const combinedIdx = next.findIndex(
          (r) =>
            r.threatType === 'both' &&
            r.attackerIp === attackerIp &&
            r.targetHost === targetHost &&
            now - r._lastMs < DEDUP_WINDOW_MS
        );

        if (combinedIdx !== -1) {
          const existing = next[combinedIdx];
          const newPs =
            threatType === 'port_scan'
              ? parsePortScanAttempts(event.message)
              : existing._psInfo;
          const newBf =
            threatType === 'brute_force'
              ? parseBruteForceAttempts(event.message)
              : existing._bfInfo;
          const updated = {
            ...existing,
            count: existing.count + 1,
            time,
            attempts: `${newPs?.shortText || '10 ports scanned'} · ${newBf?.shortText || '5 failed logins'}`,
            _psInfo: newPs,
            _bfInfo: newBf,
            _lastMs: now,
          };
          next.splice(combinedIdx, 1);
          next.unshift(updated);
          continue;
        }

        // 2. Check if an existing OPPOSITE single attack matches same attacker IP and target host
        // within 5 minutes of each other (in any order)
        const oppType = threatType === 'port_scan' ? 'brute_force' : 'port_scan';
        const oppIdx = next.findIndex(
          (r) =>
            r.threatType === oppType &&
            r.attackerIp === attackerIp &&
            r.targetHost === targetHost &&
            (Math.abs(validEventMs - (r._eventMs || 0)) <= TOGETHER_WINDOW_MS ||
              Math.abs(now - r._lastMs) <= TOGETHER_WINDOW_MS)
        );

        if (oppIdx !== -1) {
          const existing = next[oppIdx];
          const psInfo =
            threatType === 'port_scan'
              ? parsePortScanAttempts(event.message)
              : existing._psInfo;
          const bfInfo =
            threatType === 'brute_force'
              ? parseBruteForceAttempts(event.message)
              : existing._bfInfo;

          const combinedRecord = {
            id: `comb-${existing.id}-${event._seq}`,
            attackName: 'Port Scan + Brute Force',
            threatType: 'both',
            severity: 'HIGH',
            color: '#C4122F',
            badgeText: 'HIGH',
            time, // latest time of the two
            attackerIp,
            source,
            targetHost,
            targetIp,
            attempts: `${psInfo?.shortText || '10 ports scanned'} · ${bfInfo?.shortText || '5 failed logins'}`,
            summary: `${existing.summary} | ${event.message || ''}`,
            count: 1,
            _psInfo: psInfo,
            _bfInfo: bfInfo,
            _lastMs: now,
            _eventMs: Math.max(validEventMs, existing._eventMs || 0),
            _seq: event._seq,
          };
          next.splice(oppIdx, 1);
          next.unshift(combinedRecord);
          continue;
        }

        // 3. Check for repeat merging of the SAME single attack (within 30s)
        const sameIdx = next.findIndex(
          (r) =>
            r.threatType === threatType &&
            r.attackerIp === attackerIp &&
            r.targetHost === targetHost &&
            now - r._lastMs < DEDUP_WINDOW_MS
        );

        if (sameIdx !== -1) {
          const existing = next[sameIdx];
          const info =
            threatType === 'port_scan'
              ? parsePortScanAttempts(event.message)
              : parseBruteForceAttempts(event.message);
          const updated = {
            ...existing,
            count: existing.count + 1,
            time,
            attempts: info.text,
            _psInfo: threatType === 'port_scan' ? info : existing._psInfo,
            _bfInfo: threatType === 'brute_force' ? info : existing._bfInfo,
            _lastMs: now,
          };
          next.splice(sameIdx, 1);
          next.unshift(updated);
          continue;
        }

        // 4. Create new single attack card
        const isPortScan = threatType === 'port_scan';
        const info = isPortScan
          ? parsePortScanAttempts(event.message)
          : parseBruteForceAttempts(event.message);

        const record = {
          id: `${event._seq}-${now}`,
          attackName: isPortScan ? 'Port Scan' : 'Brute Force',
          threatType,
          severity: isPortScan ? 'MEDIUM' : 'HIGH',
          color: isPortScan ? '#FF8A1F' : '#C4122F',
          badgeText: isPortScan ? 'MEDIUM' : 'HIGH',
          time,
          attackerIp,
          source,
          targetHost,
          targetIp,
          attempts: info.text,
          summary: event.message || '',
          count: 1,
          _psInfo: isPortScan ? info : null,
          _bfInfo: !isPortScan ? info : null,
          _lastMs: now,
          _eventMs: validEventMs,
          _seq: event._seq,
        };

        next.unshift(record);
      }

      if (next.length > MAX_RECORDS) {
        next = next.slice(0, MAX_RECORDS);
      }

      return next;
    });
  }, [events]);

  // Detect reset: events cleared
  const prevLengthRef = useRef(0);
  useEffect(() => {
    const len = events ? events.length : 0;
    if (prevLengthRef.current > 0 && len === 0) {
      lastSeqRef.current = 0;
      setRecords([]);
    }
    prevLengthRef.current = len;
  }, [events]);

  const clear = () => {
    setRecords([]);
  };

  return { records, clear };
}

