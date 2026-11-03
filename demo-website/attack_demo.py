#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
attack_demo.py — WebSentinel demo attack script.
Simulates brute force, web scan, and data exfiltration against the Student Portal.

Usage:
  python attack_demo.py --type brute|scan|exfil|all [--host http://localhost:8080]

Use only on your own demo website.
"""
import argparse
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

DEFAULT_HOST = "http://localhost:8080"

BANNER = """
╔══════════════════════════════════════════════════════╗
║   WebSentinel — Demo Attack Script                  ║
║   Use only on your own demo website.                ║
╚══════════════════════════════════════════════════════╝
"""

SCAN_PATHS = [
    "/.env", "/admin", "/wp-login.php", "/phpmyadmin",
    "/.git/config", "/backup.zip", "/config.php",
    "/server-status", "/api/keys", "/db.sql", "/old", "/test",
]

WRONG_CREDS = [
    ("admin", "wrong1"), ("root",  "password"), ("admin", "123456"),
    ("user",  "admin"),  ("admin", "letmein"),  ("guest", "guest"),
]


def _get(url: str) -> int:
    """Simple GET; returns HTTP status code."""
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def _post_form(url: str, data: dict) -> int:
    """Simple form POST; returns HTTP status code."""
    try:
        encoded = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(url, data=encoded, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def attack_brute(host: str):
    print("\n[BRUTE FORCE] Attempting wrong logins on /login ...")
    for user, pw in WRONG_CREDS:
        status = _post_form(f"{host}/login", {"username": user, "password": pw})
        print(f"  POST /login  user={user!r}  pw=***  -> HTTP {status}")
        time.sleep(0.3)
    print("[BRUTE FORCE] Done.\n")


def attack_scan(host: str):
    print("\n[WEB SCAN] Probing suspicious paths ...")
    for path in SCAN_PATHS:
        status = _get(f"{host}{path}")
        print(f"  GET {path:<25} -> HTTP {status}")
        time.sleep(0.2)
    print("[WEB SCAN] Done.\n")


def attack_exfil(host: str):
    print("\n[EXFIL] Downloading /download/report.csv?mb=55 ...")
    # Stream download without saving to disk
    try:
        url = f"{host}/download/report.csv?mb=55"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=120) as r:
            total = 0
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                total += len(chunk)
        print(f"  Downloaded {total / (1024 * 1024):.1f} MB  -> HTTP 200")
    except Exception as e:
        print(f"  Error: {e}")
    print("[EXFIL] Done.\n")


def main():
    parser = argparse.ArgumentParser(description="WebSentinel Demo Attack Script")
    parser.add_argument("--type", choices=["brute", "scan", "exfil", "all"], required=True)
    parser.add_argument("--host", default=DEFAULT_HOST)
    args = parser.parse_args()

    print(BANNER)
    print(f"Target: {args.host}")
    print(f"Attack: {args.type}\n")

    if args.type == "brute":
        attack_brute(args.host)
    elif args.type == "scan":
        attack_scan(args.host)
    elif args.type == "exfil":
        attack_exfil(args.host)
    elif args.type == "all":
        attack_brute(args.host)
        print("Waiting 3 s before next attack...")
        time.sleep(3)
        attack_scan(args.host)
        print("Waiting 3 s before next attack...")
        time.sleep(3)
        attack_exfil(args.host)

    print("done - check the WebSentinel dashboard")


if __name__ == "__main__":
    main()
