#!/usr/bin/env python3
"""
backend/send_test_email.py

Sends one sample Port Scan email and one sample Brute Force email using
the real notifier formatting — useful for verifying SMTP settings before
going live.

Usage (from the repo root):
    cd backend
    python send_test_email.py

Or with a local debug SMTP server:
    ALERT_SMTP_HOST=localhost ALERT_SMTP_PORT=1025 ALERT_SMTP_SSL=false \\
        python send_test_email.py

The real password is read from backend/.env — it is NEVER printed.
"""

import smtplib
import ssl
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make sure the app package is importable when run from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.notifier import (
    ENABLED,
    EMAIL_FROM,
    EMAIL_PASSWORD,
    EMAIL_TO,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SSL,
    build_email,
    register_topology,
)

# Register a small synthetic topology so target-IP lookup works in the email
register_topology([
    {"hostname": "web-srv-01",  "ip": "192.168.1.10"},
    {"hostname": "api-gateway", "ip": "192.168.1.12"},
])

_SAMPLES = [
    {
        "threat_type":       "port_scan",
        "timestamp":         datetime.now(timezone.utc).isoformat(),
        "source_ip":         "10.0.0.66",
        "source_hostname":   "unknown-external",
        "target_hostname":   "web-srv-01",
        "target_ip":         "192.168.1.10",
        "message": (
            "PORT SCAN DETECTED — 10.0.0.66 probed 10 distinct ports in 5.0s"
        ),
        "_seq": 9001,
    },
    {
        "threat_type":       "brute_force",
        "timestamp":         datetime.now(timezone.utc).isoformat(),
        "source_ip":         "10.0.0.66",
        "source_hostname":   "unknown-external",
        "target_hostname":   "api-gateway",
        "target_ip":         "192.168.1.12",
        "message": (
            "BRUTE FORCE DETECTED — 10.0.0.66 made 5 failed auth attempts in 10.0s"
        ),
        "_seq": 9002,
    },
]


def _send_one(subject: str, plain_text: str, html_text: str) -> None:
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = EMAIL_FROM
    msg["To"]      = ", ".join(EMAIL_TO)
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html_text,  "html",  "utf-8"))

    if SMTP_SSL:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=10) as smtp:
            smtp.login(EMAIL_FROM, EMAIL_PASSWORD)
            smtp.sendmail(EMAIL_FROM, EMAIL_TO, msg.as_bytes())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            smtp.sendmail(EMAIL_FROM, EMAIL_TO, msg.as_bytes())


def main() -> None:
    if not ENABLED:
        print(
            "email alerts disabled: ALERT_EMAIL_FROM, ALERT_EMAIL_PASSWORD and "
            "ALERT_EMAIL_TO must all be set in backend/.env"
        )
        sys.exit(1)

    for sample in _SAMPLES:
        label = sample["threat_type"].replace("_", " ").title()
        try:
            subject, plain_text, html_text = build_email(sample)
            _send_one(subject, plain_text, html_text)
            print(f"sent  [{label}]  ->  {', '.join(EMAIL_TO)}")
        except Exception as exc:
            # Never print the password
            reason = str(exc).replace(EMAIL_PASSWORD, "***") if EMAIL_PASSWORD else str(exc)
            print(f"error [{label}]: {reason}")


if __name__ == "__main__":
    main()

