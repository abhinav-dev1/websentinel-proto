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
    return `${ports} ports scanned in ${windowSec} s`;
  }
  return `${ports} ports scanned`;
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
    return `${logins} failed logins in ${windowSec} s`;
  }
  return `${logins} failed logins`;
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

const MAX_RECORDS = 500;

/**
 * useAttackLog
 *
 * Watches new events by _seq.
 * Shows ONLY Port Scan and Brute Force (Data Exfil is completely ignored).
 * Every detector alert event creates exactly ONE new record at the FRONT of
 * the list — no merging, no combining, no repeat-deduplication by time window.
 * The same alert event is never added twice (de-duped by _seq).
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
        const isPortScan = threatType === 'port_scan';
        const attackerIp = event.source_ip || '-';
        const source = event.source_hostname || 'unknown-external';
        const targetHost = event.target_hostname || '-';
        const targetIp =
          findIpByHostname(nodesRef.current, targetHost) || event.target_ip || '-';
        const time = toHHMMSS(event.timestamp);
        const attempts = isPortScan
          ? parsePortScanAttempts(event.message)
          : parseBruteForceAttempts(event.message);

        // Each alert event → one new card, prepended (newest first).
        const record = {
          id: `${event._seq}`,
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
          attempts,
          summary: event.message || '',
          _seq: event._seq,
        };

        next.unshift(record);
      }

      // Keep at most MAX_RECORDS; drop oldest (tail).
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
