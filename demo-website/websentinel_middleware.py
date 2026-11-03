"""
WebSentinel Middleware for demo-website Student Portal.

Sends one small telemetry event per request to WebSentinel /inject.
Security: metadata only — IP, path, method, status, size.
NEVER sends passwords, request bodies, cookies, or other headers.
"""
import os
import threading
from datetime import datetime, timezone

import httpx
from starlette.middleware.base import BaseHTTPMiddleware

WEBSENTINEL_URL = os.environ.get("WEBSENTINEL_URL", "http://localhost:8000")
WEBSENTINEL_API_KEY = os.environ.get("WEBSENTINEL_API_KEY", "")
WEBSENTINEL_SITE_IP = os.environ.get("WEBSENTINEL_SITE_IP", "192.168.1.50")


def _send_event(event: dict) -> None:
    """Fire-and-forget: send in a thread, swallow every error."""
    try:
        headers = {"Content-Type": "application/json"}
        if WEBSENTINEL_API_KEY:
            headers["X-API-Key"] = WEBSENTINEL_API_KEY
        httpx.post(
            f"{WEBSENTINEL_URL}/inject",
            json=event,
            headers=headers,
            timeout=3.0,
        )
    except Exception:
        pass  # WebSentinel down must NEVER slow down or break the site


class WebSentinelMiddleware(BaseHTTPMiddleware):
    """Attach to the FastAPI app to report traffic to WebSentinel."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)

        path = request.url.path
        method = request.method
        status = response.status_code

        # Client IP — only X-Forwarded-For header used (for IP, not auth)
        xff = request.headers.get("X-Forwarded-For", "")
        client_ip = xff.split(",")[0].strip() if xff else (
            request.client.host if request.client else "unknown"
        )

        # Size from Content-Length header
        try:
            size_kb = int(response.headers.get("content-length", "0")) / 1024
        except (ValueError, TypeError):
            size_kb = 0.0

        # Classify event type and choose source perspective
        if method == "POST" and path == "/login" and status == 401:
            # Brute force attempt — appears as external threat
            event_type = "auth_failure"
            source_node = "node-99"
            source_ip = client_ip
            source_hostname = "unknown-external"
            target_node = "demo-website"
            target_ip = WEBSENTINEL_SITE_IP
            target_hostname = "demo-website"
            message = f"Failed login attempt from {client_ip}"

        elif size_kb >= 1024:
            # Large data transfer — external client downloading
            event_type = "data_transfer"
            source_node = "node-99"
            source_ip = client_ip
            source_hostname = "unknown-external"
            target_node = "demo-website"
            target_ip = WEBSENTINEL_SITE_IP
            target_hostname = "demo-website"
            message = f"Large transfer: {size_kb:.0f} KB from demo-website"

        elif status in (404, 403):
            # Path probing — suspicious enumeration
            event_type = "path_probe"
            source_node = "node-99"
            source_ip = client_ip
            source_hostname = "unknown-external"
            target_node = "demo-website"
            target_ip = WEBSENTINEL_SITE_IP
            target_hostname = "demo-website"
            message = f"{method} {path} -> {status}"

        else:
            # Normal traffic — shown as internal node activity (no attacker node)
            event_type = "connection"
            source_node = "demo-website"
            source_ip = WEBSENTINEL_SITE_IP
            source_hostname = "demo-website"
            target_node = "node-1"  # gw-router
            target_ip = "192.168.1.1"
            target_hostname = "gw-router"
            message = f"{method} {path} -> {status}"

        event = {
            "type": "network_event",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source_node": source_node,
            "source_ip": source_ip,
            "source_hostname": source_hostname,
            "target_node": target_node,
            "target_ip": target_ip,
            "target_hostname": target_hostname,
            "port": 443,
            "size_kb": size_kb,
            "threat": False,
            "severity": "none",
            "message": message,
            "event_type": event_type,
        }

        threading.Thread(target=_send_event, args=(event,), daemon=True).start()
        return response

