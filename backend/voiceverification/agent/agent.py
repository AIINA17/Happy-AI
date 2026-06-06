import asyncio
import json
import os
import time

from dotenv import load_dotenv

# ================= PATH FIX =================
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
VOICEVERIFICATION_DIR = os.path.dirname(AGENT_DIR)
BACKEND_DIR = os.path.dirname(VOICEVERIFICATION_DIR)
ENV_PATH = os.path.join(BACKEND_DIR, ".env")
load_dotenv(ENV_PATH)

from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, cli, room_io
from livekit.plugins import google, noise_cancellation

from voiceverification.agent.prompts import AGENT_INSTRUCTION, SESSION_INSTRUCTION
from voiceverification.agent.tools import (
    add_to_cart,
    auth_state,
    check_login_status,
    check_voice_status,
    get_weather,
    login,
    logout,
    pay_order,
    register,
    remove_from_cart,
    search_product,
    send_product_cards,
    get_shopkupay_balance,
    get_product_detail,
    get_product_from_search_index,
    get_cart,
    checkout,
    get_order_history,
    get_order_detail,
    web_search,
)

from voiceverification.db.conversation_logs import insert_conversation_log
from voiceverification.db.conversation_sessions import create_conversation_session

# ================= CONFIG =================
SAMPLE_RATE = 16000
MAX_VERIFY_ATTEMPTS = 3

# ================= AGENT =================
class ShoppingAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=AGENT_INSTRUCTION,
            tools=[
                get_weather,
                web_search,
                login,
                register,
                logout,
                check_login_status,
                check_voice_status,
                get_shopkupay_balance,
                search_product,
                get_product_detail,
                get_product_from_search_index,
                send_product_cards,
                add_to_cart,
                get_cart,
                remove_from_cart,
                checkout,
                pay_order,
                get_order_history,
                get_order_detail,
            ],
        )

# ================= SERVER =================
server = AgentServer()

_active_rooms: set[str] = set()
_active_rooms_lock = asyncio.Lock()

@server.rtc_session()
async def connect(ctx: agents.JobContext):
    room = ctx.room
    room_name = room.name

    if not room_name.startswith("user-"):
        return

    # ✅ Cek duplikat agent secara atomic
    async with _active_rooms_lock:
        if room_name in _active_rooms:
            print(f"⚠️ Agent sudah ada di room: {room_name}, skip")
            return
        _active_rooms.add(room_name)

    print(f"🤖 Agent CONNECT ke room: {room_name}")

    # ================= ROOM STATE =================
    room_state = {
        "conversation_session_id": None,
        "user_id": None,
        "is_voice_verified": False,
        "is_verifying": False,
        "verify_attempts": 0,
        "session_lock": asyncio.Lock(),
        "voice_status": "UNVERIFIED",
        "last_verified_at": None,
    }

    auth_state["agent_state"] = room_state
    auth_state["room_ref"] = room

    session = AgentSession(
        llm=google.beta.realtime.RealtimeModel(
            model="models/gemini-2.5-flash-native-audio-latest",
            voice="Kore",
        )
    )

    # ================= DISCONNECT EVENT =================
    disconnected_event = asyncio.Event()

    @room.on("disconnected")
    def on_room_disconnected():
        print(f"🔌 Room disconnected: {room_name}")
        _active_rooms.discard(room_name)
        print(f"🧹 Room released: {room_name}")
        disconnected_event.set()

    # ================= VOICE RESULT =================
    @room.on("data_received")
    def on_data(packet):
        if packet.topic != "VOICE_RESULT":
            return

        try:
            decoded = json.loads(packet.data.decode())
            decision = decoded.get("decision") or decoded.get("status")

            print("📦 Voice result:", decision)

            room_state["is_verifying"] = False

            if decision == "VERIFIED":
                room_state["is_voice_verified"] = True
                room_state["voice_status"] = "VERIFIED"
                room_state["verify_attempts"] = 0
                room_state["last_verified_at"] = time.time()

            elif decision == "DENIED":
                room_state["voice_status"] = "DENIED"
                room_state["verify_attempts"] += 1

            elif decision == "REPEAT":
                room_state["voice_status"] = "REPEAT"
                room_state["verify_attempts"] += 1

        except Exception as e:
            print("❌ Voice result error:", e)

    # ================= CONVERSATION =================
    @session.on("conversation_item_added")
    def on_conversation_item(event):
        asyncio.create_task(handle_conversation(event))

    async def handle_conversation(event):
        role = event.item.role
        text = event.item.text_content

        if not text or role not in ("user", "assistant"):
            return

        await ensure_conversation_session()

        # ================= USER =================
        if role == "user":
            insert_conversation_log(
                session_id=room_state["conversation_session_id"],
                role=role,
                content=text
            )

            await room.local_participant.publish_data(
                json.dumps({
                    "type": "USER_MESSAGE",
                    "text": text,
                    "ts": time.time()
                }).encode(),
                reliable=True,
                topic="chat"
            )

            # ================= VOICE CHECK =================
            if not room_state["is_voice_verified"]:
                if room_state["verify_attempts"] >= MAX_VERIFY_ATTEMPTS:
                    await session.generate_reply(
                        instructions=(
                            "Maaf, verifikasi suara gagal. "
                            "Aksi sensitif tidak bisa dilakukan."
                        )
                    )
                else:
                    await start_verification()

        # ================= ASSISTANT =================
        elif role == "assistant":
            if room_state["conversation_session_id"]:
                insert_conversation_log(
                    session_id=room_state["conversation_session_id"],
                    role=role,
                    content=text
                )

            await room.local_participant.publish_data(
                json.dumps({
                    "type": "AGENT_MESSAGE",
                    "text": text,
                    "ts": time.time()
                }).encode(),
                reliable=True,
                topic="chat"
            )

    # ================= VERIFICATION =================
    async def start_verification():
        if room_state["is_voice_verified"]:
            return
        if room_state["is_verifying"]:
            return

        room_state["is_verifying"] = True

        await room.local_participant.publish_data(
            json.dumps({"type": "VOICE_CMD", "action": "START_RECORD"}).encode(),
            reliable=True,
            topic="VOICE_CMD"
        )

    # ================= SESSION =================
    async def ensure_conversation_session():
        async with room_state["session_lock"]:
            if room_state["conversation_session_id"]:
                return

            session_id = create_conversation_session(
                user_id=room_state["user_id"],
                label="New session"
            )

            room_state["conversation_session_id"] = session_id
            print("📝 Session created:", session_id)

    # ================= START SESSION =================
    await session.start(
        room=room,
        agent=ShoppingAgent(),
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=noise_cancellation.BVC()
            ),
            audio_output=room_io.AudioOutputOptions(
                sample_rate=SAMPLE_RATE
            ),
        ),
    )

    participants = list(room.remote_participants.values())
    if participants:
        room_state["user_id"] = room_name.replace("user-", "")
    else:
        room_state["user_id"] = None

    # GREETING
    await session.generate_reply(
        instructions=SESSION_INSTRUCTION
    )

    print("✅ Greeting sent")

    await start_verification()

    # ✅ Tahan coroutine agar connect() tidak exit — room tetap aktif
    await disconnected_event.wait()

# ================= ENTRYPOINT =================
if __name__ == "__main__":
    cli.run_app(server)