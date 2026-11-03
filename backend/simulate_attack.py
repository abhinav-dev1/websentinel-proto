#!/usr/bin/env python3
"""
WebSentinel — Attack Simulator

Injects fake attack event sequences into the backend WebSocket stream
via the /inject REST endpoint. Use this to demo threat detection live.

Usage:
    python simulate_attack.py                    # Default: port scan
    python simulate_attack.py --type brute_force  # Brute-force attack
    python simulate_attack.py --type both         # Both attacks sequentially
    python simulate_attack.py --host 10.0.0.1     # Custom backend host
"""

import argparse
import asyncio
import sys
import time
from datetime import datetime, timezone

import httpx

# ── Configuration ────────────────────────────────────────────────────────────
DEFAULT_BACKEND = "http://localhost:8000"

ATTACKER = {
    "id": "node-99",
    "ip": "10.0.0.66",
    "hostname": "unknown-external",
}

# Target the web server for maximum visual impact
TARGET = {
    "id": "node-2",
    "ip": "192.168.1.10",
    "hostname": "web-srv-01",
}

# Ports to "scan" during a port scan attack
SCAN_PORTS = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 995, 3306, 3389, 5432, 8080, 8443]


# ── Helpers ──────────────────────────────────────────────────────────────────
def timestamp():
    return datetime.now(timezone.utc).isoformat()


def make_event(event_type: str, port: int = 0, message: str = "") -> dict:
    return {
        "type": "network_event",
        "timestamp": timestamp(),
        "source_node": ATTACKER["id"],
        "source_ip": ATTACKER["ip"],
        "source_hostname": ATTACKER["hostname"],
        "target_node": TARGET["id"],
        "target_ip": TARGET["ip"],
        "target_hostname": TARGET["hostname"],
        "event_type": event_type,
        "port": port,
        "threat": False,  # Let the detector decide
        "severity": "none",
        "message": message,
    }


# ── Attack Sequences ────────────────────────────────────────────────────────
async def port_scan_attack(client: httpx.AsyncClient, backend: str):
    """Simulate a port scan: rapid connection attempts to many distinct ports."""
    print("\n\033[91m╔══════════════════════════════════════════════════╗\033[0m")
    print("\033[91m║  ⚠  LAUNCHING PORT SCAN ATTACK                  ║\033[0m")
    print(f"\033[91m║  Source: {ATTACKER['ip']:>15}  (external)          ║\033[0m")
    print(f"\033[91m║  Target: {TARGET['ip']:>15}  ({TARGET['hostname']})     ║\033[0m")
    print(f"\033[91m║  Ports:  {len(SCAN_PORTS)} sequential probes               ║\033[0m")
    print("\033[91m╚══════════════════════════════════════════════════╝\033[0m\n")

    for i, port in enumerate(SCAN_PORTS):
        event = make_event(
            event_type="port_scan_probe",
            port=port,
            message=f"SYN probe to port {port} — no response",
        )
        resp = await client.post(f"{backend}/inject", json=event)
        status = "✓" if resp.status_code == 200 else "✗"
        print(f"  [{status}] Probe {i+1:>2}/{len(SCAN_PORTS)} → port {port}")
        await asyncio.sleep(0.12)  # Fast but not instant — feels realistic

    print("\n\033[91m  ◆ Port scan sequence complete — check dashboard\033[0m\n")


async def brute_force_attack(client: httpx.AsyncClient, backend: str):
    """Simulate a brute-force login attack: rapid failed auth attempts."""
    print("\n\033[91m╔══════════════════════════════════════════════════╗\033[0m")
    print("\033[91m║  ⚠  LAUNCHING BRUTE FORCE ATTACK                ║\033[0m")
    print(f"\033[91m║  Source: {ATTACKER['ip']:>15}  (external)          ║\033[0m")
    print(f"\033[91m║  Target: {TARGET['ip']:>15}  ({TARGET['hostname']})     ║\033[0m")
    print("\033[91m║  Method: SSH auth (port 22)                      ║\033[0m")
    print("\033[91m╚══════════════════════════════════════════════════╝\033[0m\n")

    attempts = 8
    usernames = ["root", "admin", "deploy", "ubuntu", "postgres", "www-data", "git", "backup"]

    for i in range(attempts):
        event = make_event(
            event_type="auth_failure",
            port=22,
            message=f"SSH auth failed — user '{usernames[i]}' — attempt {i+1}",
        )
        resp = await client.post(f"{backend}/inject", json=event)
        status = "✓" if resp.status_code == 200 else "✗"
        print(f"  [{status}] Auth attempt {i+1:>2}/{attempts} — user '{usernames[i]}' — DENIED")
        await asyncio.sleep(0.3)  # Slightly slower than port scan

    print("\n\033[91m  ◆ Brute force sequence complete — check dashboard\033[0m\n")


# ── Main ─────────────────────────────────────────────────────────────────────
async def main():
    parser = argparse.ArgumentParser(
        description="WebSentinel Attack Simulator — inject fake attacks for demo",
    )
    parser.add_argument(
        "--type",
        choices=["port_scan", "brute_force", "both"],
        default="port_scan",
        help="Type of attack to simulate (default: port_scan)",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_BACKEND,
        help=f"Backend URL (default: {DEFAULT_BACKEND})",
    )
    args = parser.parse_args()

    print("by Abhinav")
    print("  _   _ _____ _____ ____  _____ _   _ _____ ___ _   _ _____ _     ")
    print(" | \\ | | ____|_   _/ ___|| ____| \\ | |_   _|_ _| \\ | | ____| |    ")
    print(" |  \\| |  _|   | | \\___ \\|  _| |  \\| | | |  | ||  \\| |  _| | |    ")
    print(" | |\\  | |___  | |  ___) | |___| |\\  | | |  | || |\\  | |___| |___ ")
    print(" |_| \\_|_____| |_| |____/|_____|_| \\_| |_| |___|_| \\_|_____|_____|")
    print("by Abhinav")
    print(f"  Attack Simulator — connecting to {args.host}")

    # Verify backend is reachable
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            health = await client.get(f"{args.host}/health")
            data = health.json()
            print(f"  Backend status: \033[92m{data['status']}\033[0m — {data['clients']} client(s) connected\n")
        except Exception as e:
            print(f"\n  \033[91m✗ Cannot reach backend at {args.host}\033[0m")
            print(f"    Error: {e}")
            print(f"    Make sure the backend is running: uvicorn app.main:app --port 8000\n")
            sys.exit(1)

        if args.type == "port_scan":
            await port_scan_attack(client, args.host)
        elif args.type == "brute_force":
            await brute_force_attack(client, args.host)
        elif args.type == "both":
            await port_scan_attack(client, args.host)
            print("  Waiting 3 seconds before next attack...\n")
            await asyncio.sleep(3)
            await brute_force_attack(client, args.host)

    print("  \033[92m✓ Simulation complete\033[0m\n")


if __name__ == "__main__":
    asyncio.run(main())
