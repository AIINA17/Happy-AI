import json
import logging
import os

from livekit.api import LiveKitAPI, ListRoomsRequest, SendDataRequest
from livekit.protocol.models import DataPacket

logger = logging.getLogger(__name__)


async def resolve_active_user_room(user_id: str) -> str | None:
    """Find the user's currently-active LiveKit room.

    Since /join-token now hands out per-session room names
    (`user-{user_id}-{suffix}`), a caller that only knows the user_id
    can't just push to `f"user-{user_id}"` anymore. This helper queries
    LiveKit for all rooms whose name starts with `user-{user_id}-` and
    returns the first one (there should be at most one active session
    per user in normal flow).

    Returns None if no active room exists — caller should treat that as
    "best-effort failed" and keep going.
    """
    url = os.getenv("LIVEKIT_URL")
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    if not url or not api_key or not api_secret:
        return None

    prefix = f"user-{user_id}-"
    try:
        async with LiveKitAPI(url=url, api_key=api_key, api_secret=api_secret) as lk:
            rooms = await lk.room.list_rooms(ListRoomsRequest())
            for r in rooms.rooms:
                if r.name.startswith(prefix):
                    return r.name
    except Exception:
        logger.exception("resolve_active_user_room failed for %s", user_id)

    return None


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
