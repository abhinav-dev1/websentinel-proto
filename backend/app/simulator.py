"""
WebSentinel — Network Traffic Simulator

Generates realistic fake network traffic events for the demo.
Provides a pool of devices and produces steady-state "normal" events.
"""

import random
import time
from datetime import datetime, timezone

# ── Device Pool ──────────────────────────────────────────────────────────────
DEVICES = [
    {"id": "node-1",  "ip": "192.168.1.1",   "hostname": "gw-router",       "type": "router",     "role": "Gateway Router"},
    {"id": "node-2",  "ip": "192.168.1.10",  "hostname": "web-srv-01",      "type": "server",     "role": "Web Server"},
    {"id": "node-3",  "ip": "192.168.1.11",  "hostname": "db-primary",      "type": "server",     "role": "Database Primary"},
    {"id": "node-4",  "ip": "192.168.1.12",  "hostname": "api-gateway",     "type": "server",     "role": "API Gateway"},
    {"id": "node-5",  "ip": "192.168.1.20",  "hostname": "dev-laptop-mk",   "type": "workstation","role": "Developer Workstation"},
    {"id": "node-6",  "ip": "192.168.1.21",  "hostname": "dev-laptop-sr",   "type": "workstation","role": "Developer Workstation"},
    {"id": "node-7",  "ip": "192.168.1.30",  "hostname": "nas-backup",      "type": "storage",    "role": "NAS Backup"},
    {"id": "node-8",  "ip": "192.168.1.40",  "hostname": "print-srv",       "type": "iot",        "role": "Print Server"},
    {"id": "node-9",  "ip": "192.168.1.41",  "hostname": "redis-cache",     "type": "server",     "role": "Redis Cache"},
    {"id": "node-10", "ip": "192.168.1.50",  "hostname": "vpn-endpoint",    "type": "server",     "role": "VPN Endpoint"},
    {"id": "node-11", "ip": "192.168.1.51",  "hostname": "mail-srv",        "type": "server",     "role": "Mail Server"},
    {"id": "node-12", "ip": "192.168.1.60",  "hostname": "monitoring-agent","type": "server",     "role": "Monitoring Agent"},
]

# The attacker node — only appears when simulate_attack injects events
ATTACKER_NODE = {
    "id": "node-99",
    "ip": "10.0.0.66",
    "hostname": "unknown-external",
    "type": "external",
    "role": "Unknown External Host",
}

COMMON_PORTS = [22, 53, 80, 443, 993, 3306, 5432, 8080, 8443]

NORMAL_EVENT_TYPES = [
    "heartbeat",
    "connection",
    "data_transfer",
    "dns_lookup",
    "auth_success",
]

NORMAL_MESSAGES = {
    "heartbeat": [
        "Heartbeat OK — latency {latency}ms",
        "Keep-alive acknowledged — {latency}ms RTT",
        "Health check passed",
    ],
    "connection": [
        "TCP connection established on port {port}",
        "TLS handshake completed on port {port}",
        "Session opened on port {port}",
    ],
    "data_transfer": [
        "Transferred {size}KB outbound on port {port}",
        "Received {size}KB inbound on port {port}",
        "Streaming {size}KB via port {port}",
    ],
    "dns_lookup": [
        "DNS resolved {domain}",
        "DNS query for {domain} — cached",
        "Reverse DNS lookup completed",
    ],
    "auth_success": [
        "SSH authentication successful",
        "Login session established",
        "API key validated",
    ],
}

SAMPLE_DOMAINS = [
    "api.internal.local",
    "cdn.assets.net",
    "updates.vendor.io",
    "telemetry.monitoring.local",
    "ntp.pool.org",
]


def get_topology():
    """Return the initial network topology for the frontend."""
    return [
        {
            "id": d["id"],
            "ip": d["ip"],
            "hostname": d["hostname"],
            "type": d["type"],
            "role": d["role"],
        }
        for d in DEVICES
    ]


def get_base_connections():
    """Return a set of default connections between devices."""
    return [
        {"source": "node-1", "target": "node-2"},   # router → web server
        {"source": "node-1", "target": "node-4"},   # router → api gateway
        {"source": "node-1", "target": "node-10"},  # router → vpn
        {"source": "node-2", "target": "node-3"},   # web → db
        {"source": "node-4", "target": "node-3"},   # api → db
        {"source": "node-4", "target": "node-2"},   # api → web
        {"source": "node-5", "target": "node-1"},   # dev laptop → router
        {"source": "node-6", "target": "node-1"},   # dev laptop → router
        {"source": "node-5", "target": "node-2"},   # dev → web server
        {"source": "node-6", "target": "node-4"},   # dev → api gateway
        {"source": "node-7", "target": "node-3"},   # nas → db
        {"source": "node-7", "target": "node-1"},   # nas → router
        {"source": "node-8", "target": "node-1"},   # print → router
        {"source": "node-9", "target": "node-1"},   # redis-cache → router
        {"source": "node-11", "target": "node-1"},  # mail → router
        {"source": "node-12", "target": "node-2"},  # monitoring → web
        {"source": "node-12", "target": "node-3"},  # monitoring → db
        {"source": "node-12", "target": "node-4"},  # monitoring → api
    ]


def generate_normal_event():
    """Generate a single normal network event."""
    event_type = random.choice(NORMAL_EVENT_TYPES)
    source = random.choice(DEVICES)
    # Pick a target that isn't the source
    target = random.choice([d for d in DEVICES if d["id"] != source["id"]])
    port = random.choice(COMMON_PORTS)

    # Build message
    msg_template = random.choice(NORMAL_MESSAGES[event_type])
    message = msg_template.format(
        latency=random.randint(1, 45),
        port=port,
        size=random.randint(1, 2048),
        domain=random.choice(SAMPLE_DOMAINS),
    )

    return {
        "type": "network_event",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source_node": source["id"],
        "source_ip": source["ip"],
        "source_hostname": source["hostname"],
        "target_node": target["id"],
        "target_ip": target["ip"],
        "target_hostname": target["hostname"],
        "event_type": event_type,
        "port": port,
        "threat": False,
        "severity": "none",
        "message": message,
    }
