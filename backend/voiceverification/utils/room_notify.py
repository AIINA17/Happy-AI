import json
import logging
import os

from livekit.api import LiveKitAPI, SendDataRequest
from livekit.protocol.models import DataPacket

logger = logging.getLogger(__name__)


async def publish_room_result(room_name: str, topic: str, payload: dict) -> None:
    """Pushes a verification result into a LiveKit room from the server side.

    This exists so the agent (agent.py) never has to trust a client's own
    report of its VOICE_RESULT/FACE_RESULT — any room participant can forge
    a `localParticipant.publishData(...)` call from devtools and fake a
    VERIFIED decision. A server-sent data packet (via the admin API, not a
    participant token) arrives at the agent with `packet.participant is
    None` (see rtc.DataPacket's docstring: "None when sent by a server
    SDK") — a signal client code cannot produce, which the agent checks
    before accepting a decision.

    Best-effort: a failure here (room not joined yet, LiveKit unreachable)
    must not break the HTTP response to the caller — the agent's own
    verification watchdog times out and lets the user retry regardless.
    """
    url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")

    if not url or not api_key or not api_secret:
        logger.error(
            "Cannot publish %s to room %s: LiveKit credentials not set",
            topic, room_name,
        )
        return

    try:
        async with LiveKitAPI(url=url, api_key=api_key, api_secret=api_secret) as lk:
            await lk.room.send_data(
                SendDataRequest(
                    room=room_name,
                    data=json.dumps(payload).encode("utf-8"),
                    kind=DataPacket.RELIABLE,
                    topic=topic,
                )
            )
    except Exception:
        logger.exception("Failed to publish %s to room %s", topic, room_name)
