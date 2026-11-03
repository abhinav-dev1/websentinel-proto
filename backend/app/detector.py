"""
WebSentinel — Threat Detection Engine

Simple rule-based detection for:
- Port scans: N distinct ports from same source within M seconds
- Brute force: N failed auth attempts from same source within M seconds
- Data exfiltration: Single large outbound transfer exceeding threshold
"""

import time
from collections import defaultdict


class ThreatDetector:
    """Rule-based network threat detection engine."""

    # ── Thresholds ───────────────────────────────────────────────────────
    PORT_SCAN_THRESHOLD = 10       # distinct ports
    PORT_SCAN_WINDOW = 5.0         # seconds
    BRUTE_FORCE_THRESHOLD = 5     # failed attempts
    BRUTE_FORCE_WINDOW = 10.0     # seconds
    EXFIL_SIZE_THRESHOLD = 50000  # KB (~50 MB)

    def __init__(self):
        # Track connection attempts per source IP: {ip: [(timestamp, port), ...]}
        self._port_history = defaultdict(list)
        # Track failed auth per source IP: {ip: [timestamp, ...]}
        self._auth_failures = defaultdict(list)

    def analyze(self, event: dict) -> dict | None:
        """
        Analyze an incoming event. Returns a threat dict if detected, else None.

        Returned threat dict:
        {
            "threat_type": "port_scan" | "brute_force" | "data_exfil",
            "severity": "medium" | "critical",
            "source_node": str,
            "target_node": str,
            "message": str,
            "details": str,  # Human-readable explanation for judges
        }
        """
        now = time.time()
        event_type = event.get("event_type", "")
        source_ip = event.get("source_ip", "")

        # ── Port Scan Detection ──────────────────────────────────────────
        if event_type == "connection" or event_type == "port_scan_probe":
            port = event.get("port", 0)
            self._port_history[source_ip].append((now, port))

            # Prune old entries outside the window
            self._port_history[source_ip] = [
                (t, p) for t, p in self._port_history[source_ip]
                if now - t <= self.PORT_SCAN_WINDOW
            ]

            # Count distinct ports in window
            distinct_ports = set(
                p for _, p in self._port_history[source_ip]
            )

            if len(distinct_ports) >= self.PORT_SCAN_THRESHOLD:
                # Clear history to avoid re-firing on every subsequent event
                self._port_history[source_ip].clear()
                return {
                    "threat_type": "port_scan",
                    "severity": "critical",
                    "source_node": event.get("source_node", ""),
                    "target_node": event.get("target_node", ""),
                    "message": (
                        f"PORT SCAN DETECTED — {source_ip} probed "
                        f"{len(distinct_ports)} distinct ports in "
                        f"{self.PORT_SCAN_WINDOW}s"
                    ),
                    "details": (
                        f"Rule: ≥{self.PORT_SCAN_THRESHOLD} distinct port "
                        f"connections from a single source within "
                        f"{self.PORT_SCAN_WINDOW}s window. "
                        f"Ports hit: {sorted(distinct_ports)}"
                    ),
                }

        # ── Brute Force Detection ────────────────────────────────────────
        if event_type == "auth_failure":
            self._auth_failures[source_ip].append(now)

            # Prune old entries
            self._auth_failures[source_ip] = [
                t for t in self._auth_failures[source_ip]
                if now - t <= self.BRUTE_FORCE_WINDOW
            ]

            if len(self._auth_failures[source_ip]) >= self.BRUTE_FORCE_THRESHOLD:
                count = len(self._auth_failures[source_ip])
                self._auth_failures[source_ip].clear()
                return {
                    "threat_type": "brute_force",
                    "severity": "critical",
                    "source_node": event.get("source_node", ""),
                    "target_node": event.get("target_node", ""),
                    "message": (
                        f"BRUTE FORCE DETECTED — {source_ip} made "
                        f"{count} failed auth attempts in "
                        f"{self.BRUTE_FORCE_WINDOW}s"
                    ),
                    "details": (
                        f"Rule: ≥{self.BRUTE_FORCE_THRESHOLD} failed "
                        f"authentication attempts from a single source "
                        f"within {self.BRUTE_FORCE_WINDOW}s window."
                    ),
                }

        # ── Data Exfiltration Detection ──────────────────────────────────
        if event_type == "data_transfer":
            size_kb = event.get("size_kb", 0)
            if size_kb >= self.EXFIL_SIZE_THRESHOLD:
                return {
                    "threat_type": "data_exfil",
                    "severity": "medium",
                    "source_node": event.get("source_node", ""),
                    "target_node": event.get("target_node", ""),
                    "message": (
                        f"ANOMALOUS DATA TRANSFER — {source_ip} sent "
                        f"{size_kb / 1000:.1f}MB outbound"
                    ),
                    "details": (
                        f"Rule: Single outbound transfer exceeding "
                        f"{self.EXFIL_SIZE_THRESHOLD / 1000:.0f}MB threshold."
                    ),
                }

        return None
