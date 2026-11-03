"""
WebSentinel — Backend Server

FastAPI application with WebSocket endpoint for real-time network event streaming.
Broadcasts simulated normal traffic and accepts injected attack events.
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .simulator import (
    generate_normal_event,
    get_base_connections,
    get_topology,
    ATTACKER_NODE,
)
from .detector import ThreatDetector

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("websentinel")

# ── State ────────────────────────────────────────────────────────────────────
connected_clients: list[WebSocket] = []
event_queue: asyncio.Queue = asyncio.Queue()
detector = ThreatDetector()
active_threats: list[dict] = []


# ── Broadcast helper ─────────────────────────────────────────────────────────
async def broadcast(message: dict):
    """Send a JSON message to all connected WebSocket clients."""
    data = json.dumps(message)
    disconnected = []
    for ws in connected_clients:
        try:
            await ws.send_text(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in connected_clients:
            connected_clients.remove(ws)


# ── Background tasks ─────────────────────────────────────────────────────────
async def normal_traffic_loop():
    """Emit normal network events at steady intervals."""
    while True:
        event = generate_normal_event()

        # Run through detector (normal events shouldn't trigger, but just in case)
        threat = detector.analyze(event)
        if threat:
            event["threat"] = True
            event["severity"] = threat["severity"]
            event["message"] = threat["message"]
            event["threat_type"] = threat["threat_type"]
            event["details"] = threat["details"]

        await broadcast(event)
        # Random interval: 1–3 seconds for natural feel
        await asyncio.sleep(1.0 + (hash(event["timestamp"]) % 2000) / 1000)


async def injected_event_consumer():
    """Consume events from the injection queue and broadcast them.

    R2: The attacker node (node-99) is created only when a LIVE event involves it.
    For every such event, we always broadcast a topology_update so the frontend can
    add the node/link if it does not already have them (frontend is idempotent).
    """
    while True:
        event = await event_queue.get()

        # For every event that involves the attacker, broadcast topology_update first.
        # The frontend deduplicates nodes and connections, so repeats are harmless.
        source_id = event.get("source_node")
        target_id = event.get("target_node")
        if source_id == ATTACKER_NODE["id"] or target_id == ATTACKER_NODE["id"]:
            await broadcast({
                "type": "topology_update",
                "action": "add_node",
                "node": ATTACKER_NODE,
                "connection": {
                    "source": source_id,
                    "target": target_id,
                },
            })
            # Small delay so frontend can process the new node before the event
            await asyncio.sleep(0.05)

        # Run through detector
        threat = detector.analyze(event)
        if threat:
            event["threat"] = True
            event["severity"] = threat["severity"]
            event["message"] = threat["message"]
            event["threat_type"] = threat["threat_type"]
            event["details"] = threat["details"]
            active_threats.append(event)

        await broadcast(event)
        event_queue.task_done()


# ── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background tasks on startup."""
    traffic_task = asyncio.create_task(normal_traffic_loop())
    consumer_task = asyncio.create_task(injected_event_consumer())
    logger.info("WebSentinel backend started — streaming network events")
    yield
    traffic_task.cancel()
    consumer_task.cancel()


# ── FastAPI App ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="WebSentinel",
    description="Real-time network threat visualization backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── WebSocket Endpoint ───────────────────────────────────────────────────────
# R1: A fresh page load always shows exactly the 12 normal nodes.
# R3: The backend NEVER includes the attacker node in the initial topology message.
#     The attacker (node-99) is introduced only via live topology_update messages
#     when an attack event is actually processed (R2). This prevents the ghost
#     attacker appearing on page reload or in a new tab after a previous attack.
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    logger.info(f"Client connected — {len(connected_clients)} active")

    # Send only the 12 base nodes — never include the attacker here (R3).
    topology = {
        "type": "topology",
        "nodes": get_topology(),
        "connections": get_base_connections(),
    }
    await ws.send_text(json.dumps(topology))

    try:
        while True:
            # Keep connection alive; client doesn't send data normally
            data = await ws.receive_text()
            # Could handle client commands here in the future
    except WebSocketDisconnect:
        if ws in connected_clients:
            connected_clients.remove(ws)
        logger.info(f"Client disconnected — {len(connected_clients)} active")


# ── REST Injection Endpoint ──────────────────────────────────────────────────
class InjectedEvent(BaseModel):
    type: str = "network_event"
    timestamp: str = ""
    source_node: str = ""
    source_ip: str = ""
    source_hostname: str = ""
    target_node: str = ""
    target_ip: str = ""
    target_hostname: str = ""
    event_type: str = ""
    port: int = 0
    threat: bool = False
    severity: str = "none"
    message: str = ""


@app.post("/inject")
async def inject_event(event: InjectedEvent):
    """Inject an event into the broadcast stream (used by simulate_attack.py)."""
    event_dict = event.model_dump()
    if not event_dict["timestamp"]:
        event_dict["timestamp"] = datetime.now(timezone.utc).isoformat()
    await event_queue.put(event_dict)
    return {"status": "queued", "event_type": event_dict["event_type"]}


@app.post("/inject/batch")
async def inject_batch(events: list[InjectedEvent]):
    """Inject multiple events at once."""
    for event in events:
        event_dict = event.model_dump()
        if not event_dict["timestamp"]:
            event_dict["timestamp"] = datetime.now(timezone.utc).isoformat()
        await event_queue.put(event_dict)
    return {"status": "queued", "count": len(events)}


# ── Health Check ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "clients": len(connected_clients),
        "active_threats": len(active_threats),
    }
