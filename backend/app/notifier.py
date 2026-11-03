"""
WebSentinel — Email Alert Notifier

Sends one email per Port Scan or Brute Force alert (never for Data Exfil).
Runs the SMTP send in a background thread so the event loop is never blocked.
All failures are caught and logged as a single short line — the password is
never logged or printed anywhere.

Settings are loaded from backend/.env (empty values → feature disabled).
A real environment variable always wins over the .env file (override=False).
"""

import asyncio
import logging
import smtplib
import ssl
import time
from collections import deque
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv
import os

# ── Load .env (real env vars win; never override them) ───────────────────────
_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_ENV_PATH, override=False)

logger = logging.getLogger("websentinel.notifier")


# ── Settings ─────────────────────────────────────────────────────────────────

def _get(key: str, default: str = "") -> str:
    """Read and clean an env var: strip outer whitespace and straight quotes."""
    raw = os.environ.get(key, default)
    return raw.strip().strip("'\"")


EMAIL_FROM     = _get("ALERT_EMAIL_FROM")
EMAIL_PASSWORD = _get("ALERT_EMAIL_PASSWORD")  # never logged
EMAIL_TO_RAW   = _get("ALERT_EMAIL_TO")
SMTP_HOST      = _get("ALERT_SMTP_HOST", "smtp.gmail.com")
SMTP_SSL       = _get("ALERT_SMTP_SSL", "true").lower() not in ("false", "0", "no")
ALERT_DASHBOARD_URL = _get("ALERT_DASHBOARD_URL")

try:
    SMTP_PORT = int(_get("ALERT_SMTP_PORT", "465"))
except ValueError:
    SMTP_PORT = 465

try:
    MAX_PER_MINUTE = int(_get("ALERT_MAX_PER_MINUTE", "10"))
except ValueError:
    MAX_PER_MINUTE = 10

_TZ_NAME = _get("ALERT_TIMEZONE", "Asia/Kolkata")
try:
    _TZ = ZoneInfo(_TZ_NAME)
except (ZoneInfoNotFoundError, KeyError):
    logger.warning("email notifier: unknown timezone %r, falling back to UTC", _TZ_NAME)
    _TZ = ZoneInfo("UTC")
    _TZ_NAME = "UTC"

# Parse comma-separated recipient list
EMAIL_TO: list[str] = [a.strip() for a in EMAIL_TO_RAW.split(",") if a.strip()]

# Feature is enabled only when FROM, PASSWORD and at least one TO are all present
ENABLED = bool(EMAIL_FROM and EMAIL_PASSWORD and EMAIL_TO)

if not ENABLED:
    logger.info("email alerts disabled: ALERT_EMAIL_* not set")

# ── Rate-limit state ─────────────────────────────────────────────────────────
# Timestamps (monotonic) of the last MAX_PER_MINUTE sends in the rolling 60 s window
_send_times: deque[float] = deque()
_rate_lock = asyncio.Lock()

# Guard: set of alert _seq values already submitted for sending
_sent_seqs: set[int] = set()
_seq_lock = asyncio.Lock()


# ── Device IP lookup (populated from topology at startup) ────────────────────
_hostname_to_ip: dict[str, str] = {}

def register_topology(devices: list[dict]) -> None:
    """Call once at startup with the DEVICES list from simulator.py."""
    for d in devices:
        _hostname_to_ip[d.get("hostname", "")] = d.get("ip", "-")


def _lookup_ip(hostname: str) -> str:
    return _hostname_to_ip.get(hostname, "-") if hostname else "-"


# ── Attempt text parsers (mirror the frontend logic) ─────────────────────────

def _parse_port_scan_attempts(message: str) -> str:
    import re
    is_paths = "distinct paths" in message.lower()
    pattern = r"probed\s+(\d+)\s+distinct\s+(?:ports?|paths?)"
    m_count = re.search(pattern, message, re.I)
    count = int(m_count.group(1)) if m_count else 10
    m_win = re.search(r"in\s+([\d.]+)\s*s", message, re.I)
    if m_win:
        w = round(float(m_win.group(1)))
        unit = "paths" if is_paths else "ports"
        return f"{count} {unit} scanned in {w} s"
    unit = "paths" if is_paths else "ports"
    return f"{count} {unit} scanned"


def _parse_brute_force_attempts(message: str) -> str:
    import re
    m_fail = re.search(r"made\s+(\d+)\s+failed", message, re.I)
    logins = int(m_fail.group(1)) if m_fail else 5
    m_win = re.search(r"in\s+([\d.]+)\s*s", message, re.I)
    if m_win:
        w = round(float(m_win.group(1)))
        return f"{logins} failed logins in {w} s"
    return f"{logins} failed logins"


def _human_sentence(threat_type: str, attacker_ip: str, target_host: str,
                    message: str) -> str:
    """One plain sentence explaining the alert to a non-technical reader."""
    import re
    if threat_type == "port_scan":
        is_paths = "distinct paths" in message.lower()
        pattern = r"probed\s+(\d+)\s+distinct\s+(?:ports?|paths?)"
        m_count = re.search(pattern, message, re.I)
        count = m_count.group(1) if m_count else "multiple"
        m_win = re.search(r"in\s+([\d.]+)\s*s", message, re.I)
        win = f" within {round(float(m_win.group(1)))} seconds" if m_win else ""
        unit = "paths" if is_paths else "ports"
        return (
            f"{attacker_ip} tried {count} different {unit} on {target_host}"
            f"{win}. This is usually someone looking for a way in."
        )
    else:  # brute_force
        m_fail = re.search(r"made\s+(\d+)\s+failed", message, re.I)
        logins = m_fail.group(1) if m_fail else "multiple"
        m_win = re.search(r"in\s+([\d.]+)\s*s", message, re.I)
        win = f" within {round(float(m_win.group(1)))} seconds" if m_win else ""
        return (
            f"{attacker_ip} failed to log in {logins} times on {target_host}"
            f"{win}. Someone may be guessing passwords."
        )


# ── Email builders ────────────────────────────────────────────────────────────

_ATTACK_META = {
    "port_scan":   {"name": "Port Scan",   "severity": "MEDIUM", "color": "#FF8A1F"},
    "brute_force": {"name": "Brute Force", "severity": "HIGH",   "color": "#C4122F"},
}

_BADGE_BG = {
    "MEDIUM": "#D97706",
    "HIGH":   "#991B1B",
}


def _format_timestamp(iso_str: str) -> str:
    """Return '03 Nov 2026, 09:06:18 IST' (or the configured timezone)."""
    try:
        dt = datetime.fromisoformat(iso_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        local = dt.astimezone(_TZ)
        tz_abbr = local.strftime("%Z") or _TZ_NAME
        return local.strftime(f"%d %b %Y, %H:%M:%S {tz_abbr}")
    except Exception:
        return iso_str


def build_email(event: dict) -> tuple[str, str, str]:
    """
    Return (subject, plain_text, html_text) for the given alert event.
    Only call for port_scan or brute_force events.
    """
    threat_type  = event.get("threat_type", "port_scan")
    meta         = _ATTACK_META.get(threat_type, _ATTACK_META["port_scan"])
    attack_name  = meta["name"]
    severity     = meta["severity"]
    color        = meta["color"]
    badge_bg     = _BADGE_BG[severity]

    attacker_ip  = event.get("source_ip", "-") or "-"
    source_host  = event.get("source_hostname", "unknown-external") or "unknown-external"
    target_host  = event.get("target_hostname", "-") or "-"
    target_ip    = _lookup_ip(target_host) or event.get("target_ip", "-") or "-"
    ts_str       = event.get("timestamp", "")
    message      = event.get("message", "")

    attempts = (
        _parse_port_scan_attempts(message)
        if threat_type == "port_scan"
        else _parse_brute_force_attempts(message)
    )
    sentence = _human_sentence(threat_type, attacker_ip, target_host, message)
    ts_fmt   = _format_timestamp(ts_str)

    # ── Subject ───────────────────────────────────────────────────────────────
    subject = f"⚠ Suspicious Activity: {attack_name} on {target_host} [{severity}]"

    # ── Plain text ────────────────────────────────────────────────────────────
    plain_lines = [
        "SUSPICIOUS ACTIVITY DETECTED",
        f"Severity: {severity}",
        "",
        sentence,
        "",
        "Attack details:",
        f"  Date and time : {ts_fmt}",
        f"  Activity      : {attack_name}",
        f"  Severity      : {severity}",
        f"  Attacker IP   : {attacker_ip}",
        f"  Source        : {source_host}",
        f"  Target server : {target_host}",
        f"  Target IP     : {target_ip}",
        f"  Attempts      : {attempts}",
        f"  Detector msg  : {message}",
        "",
        "What to do now:",
        "  1. Check the logs of the target server for unusual activity.",
        "  2. Consider blocking the attacker IP on your firewall.",
    ]
    if threat_type == "brute_force":
        plain_lines.append("  3. Change passwords on the affected server immediately.")
    else:
        plain_lines.append("  3. Verify that no unauthorised service was accessed.")
    if ALERT_DASHBOARD_URL:
        plain_lines += ["", f"Open dashboard: {ALERT_DASHBOARD_URL}"]
    plain_lines += ["", "Sent automatically by WebSentinel."]
    plain_text = "\n".join(plain_lines)

    # ── HTML ──────────────────────────────────────────────────────────────────
    def e(v: str) -> str:
        return escape(str(v))

    rows = [
        ("Date and time", e(ts_fmt)),
        ("Activity",      e(attack_name)),
        ("Severity",      e(severity)),
        ("Attacker IP",   e(attacker_ip)),
        ("Source",        e(source_host)),
        ("Target server", e(target_host)),
        ("Target IP",     e(target_ip)),
        ("Attempts",      e(attempts)),
        ("Detector message", e(message)),
    ]
    table_rows = "".join(
        f"""<tr>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;
                         font-weight:600;color:#374151;white-space:nowrap;
                         vertical-align:top">{label}</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;
                         color:#111827;word-break:break-word">{value}</td>
            </tr>"""
        for label, value in rows
    )

    todo_item3 = (
        "Change passwords on the affected server immediately."
        if threat_type == "brute_force"
        else "Verify that no unauthorised service was accessed."
    )

    dashboard_block = ""
    if ALERT_DASHBOARD_URL:
        dashboard_block = f"""
        <p style="margin:24px 0 0">
          <a href="{e(ALERT_DASHBOARD_URL)}"
             style="background:{color};color:#fff;padding:10px 20px;
                    border-radius:4px;text-decoration:none;font-weight:600;
                    font-size:14px">
            Open Dashboard &rarr;
          </a>
        </p>"""

    html_text = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"
         style="background:#f9fafb;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#fff;
                    border-radius:8px;overflow:hidden;
                    box-shadow:0 1px 3px rgba(0,0,0,.1)">

        <!-- Header bar -->
        <tr>
          <td style="background:{color};padding:24px 28px">
            <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:2px;
                      color:rgba(255,255,255,.8);text-transform:uppercase">
              WebSentinel Alert
            </p>
            <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff">
              SUSPICIOUS ACTIVITY DETECTED
            </h1>
            <span style="display:inline-block;margin-top:10px;
                         background:{badge_bg};color:#fff;
                         font-size:11px;font-weight:700;letter-spacing:1px;
                         padding:3px 10px;border-radius:3px;text-transform:uppercase">
              {e(severity)}
            </span>
          </td>
        </tr>

        <!-- Sentence -->
        <tr>
          <td style="padding:24px 28px 8px;font-size:15px;color:#111827;
                     line-height:1.6;border-bottom:2px solid {color}">
            {e(sentence)}
          </td>
        </tr>

        <!-- Details table -->
        <tr>
          <td style="padding:20px 28px">
            <p style="margin:0 0 12px;font-size:12px;font-weight:700;
                      color:#6b7280;letter-spacing:1px;text-transform:uppercase">
              Attack Details
            </p>
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="border-collapse:collapse;font-size:14px;
                          border:1px solid #e5e7eb;border-radius:4px;overflow:hidden">
              {table_rows}
            </table>
          </td>
        </tr>

        <!-- What to do -->
        <tr>
          <td style="padding:0 28px 24px">
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;
                      color:#6b7280;letter-spacing:1px;text-transform:uppercase">
              What To Do Now
            </p>
            <ol style="margin:0;padding-left:20px;font-size:14px;
                       color:#374151;line-height:1.8">
              <li>Check the logs of the target server for unusual activity.</li>
              <li>Consider blocking the attacker IP on your firewall.</li>
              <li>{e(todo_item3)}</li>
            </ol>
            {dashboard_block}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;background:#f3f4f6;
                     font-size:12px;color:#9ca3af;text-align:center">
            Sent automatically by WebSentinel
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""

    return subject, plain_text, html_text


# ── SMTP sender (runs in a thread) ───────────────────────────────────────────

def _smtp_send(subject: str, plain_text: str, html_text: str) -> None:
    """Blocking SMTP send — called via asyncio.to_thread."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = EMAIL_FROM
    msg["To"]      = ", ".join(EMAIL_TO)
    msg.attach(MIMEText(plain_text, "plain", "utf-8"))
    msg.attach(MIMEText(html_text,  "html",  "utf-8"))

    if SMTP_SSL:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx,
                               timeout=10) as smtp:
            smtp.login(EMAIL_FROM, EMAIL_PASSWORD)
            smtp.sendmail(EMAIL_FROM, EMAIL_TO, msg.as_bytes())
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
            smtp.sendmail(EMAIL_FROM, EMAIL_TO, msg.as_bytes())


# ── Public API ────────────────────────────────────────────────────────────────

async def notify_alert(event: dict) -> None:
    """
    Fire-and-forget: build and send an alert email for a Port Scan or
    Brute Force event.  Data Exfil and normal events are silently ignored.
    This coroutine returns immediately; sending happens in a background task.
    """
    if not ENABLED:
        return

    threat_type = event.get("threat_type", "")
    if threat_type not in ("port_scan", "brute_force"):
        return

    # De-duplicate by _seq (each alert event sent exactly once)
    seq = event.get("_seq") or id(event)
    async with _seq_lock:
        if seq in _sent_seqs:
            return
        _sent_seqs.add(seq)

    asyncio.create_task(_send_task(event))


async def _send_task(event: dict) -> None:
    """Rate-limit check + background thread send."""
    # Rate limit: at most MAX_PER_MINUTE in a rolling 60 s window
    async with _rate_lock:
        now = time.monotonic()
        # Drop timestamps older than 60 s
        while _send_times and now - _send_times[0] > 60:
            _send_times.popleft()
        if len(_send_times) >= MAX_PER_MINUTE:
            logger.info("email skipped: rate limit")
            return
        _send_times.append(now)

    try:
        subject, plain_text, html_text = build_email(event)
        await asyncio.wait_for(
            asyncio.to_thread(_smtp_send, subject, plain_text, html_text),
            timeout=10,
        )
        logger.info("email sent: %s", subject)
    except asyncio.TimeoutError:
        logger.info("email failed: SMTP timeout after 10 s")
    except Exception as exc:
        # Strip any accidental password echo from the message
        reason = str(exc).replace(EMAIL_PASSWORD, "***") if EMAIL_PASSWORD else str(exc)
        logger.info("email failed: %s", reason)

