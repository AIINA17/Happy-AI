import asyncio
import json
import os
import math
import statistics
import sys
import time

import numpy as np
from dotenv import load_dotenv

# ================= PATH FIX =================
# agent/ lives alongside voiceverification/ under backend/ (not nested
# inside it), but its db.* imports below are unqualified — voiceverification/
# needs to be on sys.path for those to resolve, same as when server.py runs
# with voiceverification/ as its own cwd.
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(AGENT_DIR)
VOICEVERIFICATION_DIR = os.path.join(BACKEND_DIR, "voiceverification")
ENV_PATH = os.path.join(BACKEND_DIR, ".env")
load_dotenv(ENV_PATH)

if VOICEVERIFICATION_DIR not in sys.path:
    sys.path.insert(0, VOICEVERIFICATION_DIR)

from livekit import agents, rtc
from livekit.agents import Agent, AgentServer, AgentSession, cli, room_io
from livekit.agents.metrics import RealtimeModelMetrics
from google.genai import types as genai_types
from livekit.plugins import google, noise_cancellation

from agent.prompts import AGENT_INSTRUCTION, SESSION_INSTRUCTION
from agent.tools import (
    add_to_cart,
    auth_state,
    check_login_status,
    check_voice_status,
    get_weather,
    login,
    login_with_stored_credentials,
    logout,
    pay_order,
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
# Gemini native audio emits 24 kHz (livekit-plugins-google's
# OUTPUT_AUDIO_SAMPLE_RATE). Forcing 16 kHz here down-samples every reply and
# makes the voice sound like a phone call.
SAMPLE_RATE = 24000

# Silence Gemini waits for before it treats the user's turn as over. Shared by
# the model config below and the turn-latency log so the two can't drift.
VAD_SILENCE_MS = 500

# Transport time the turn log adds on top of what the agent can observe: the
# user's last word reaching the agent, plus the reply reaching the user.
# Measured 2026-10 over a real LiveKit room with hard-cut tone bursts: 217-284 ms
# (median 275 ms) one way, i.e. propagation (~115 ms RTT per link) plus codec
# and jitter-buffer time that no region change removes. Outbound is assumed to
# match; it is an estimate. Re-measure and set the env var after moving region.
NETWORK_ESTIMATE_SEC = float(os.getenv("LATENCY_NETWORK_ESTIMATE_SEC", "0.5"))
MAX_VERIFY_ATTEMPTS = 3
VERIFY_TIMEOUT_SEC = 20
# Longer than VERIFY_TIMEOUT_SEC: the client now runs a liveness challenge
# (blink/mouth/turn, up to 15s — see FaceLivenessCapture.tsx's
# LIVENESS_TIMEOUT_MS) before it even captures a photo, on top of camera +
# ML model load time.
FACE_VERIFY_TIMEOUT_SEC = 35
LOCKOUT_COOLDOWN_SEC = 60

# An unnamed/default agent gets LiveKit's automatic dispatch to every new
# room *in addition to* our own explicit create_dispatch() call in
# server.py's /join-token — that's two independent agents joining the same
# room per user click (visible as duplicated greetings/audio, doubled
# Gemini Realtime sessions, and racing voice-verification attempts). Naming
# the agent opts it out of automatic dispatch; server.py's dispatch call
# must target this exact name too.
AGENT_NAME = "happy-shopping-assistant"

class UserSpeechTracker:
    """Remembers when the user last made sound, from the audio the agent receives.

    Gemini's server VAD never tells the agent where the user's speech ended:
    the Google plugin reports "speech stopped" only once the *reply* has
    finished, and "speech started" only on an interruption. So the one way to
    know is to listen to the incoming audio ourselves.
    """

    THRESHOLD_DBFS = -45.0

    def __init__(self):
        self.last_speech_at: float | None = None

    def feed(self, samples: np.ndarray, now: float) -> None:
        if samples.size == 0:
            return
        rms = math.sqrt(float(np.mean(samples.astype(np.float32) ** 2)))
        dbfs = 20 * math.log10(max(rms, 1.0) / 32768.0)
        if dbfs > self.THRESHOLD_DBFS:
            self.last_speech_at = now


def install_turn_latency_logging(session) -> UserSpeechTracker:
    """Log, per user turn, how long the agent took to start answering.

    Measured at the agent: last user speech heard -> first reply audio frame
    out (this already contains Gemini's VAD wait). The felt total adds the
    network legs the agent cannot see, as an estimate.
    """
    tracker = UserSpeechTracker()
    state = {"thinking_at": None, "tools": False, "samples": []}

    @session.on("function_tools_executed")
    def on_tools_executed(_ev):
        state["tools"] = True

    @session.on("agent_state_changed")
    def on_agent_state_changed(ev):
        if ev.new_state == "thinking":
            state["thinking_at"] = ev.created_at
            return
        if ev.new_state != "speaking":
            return

        heard_at = tracker.last_speech_at
        tracker.last_speech_at = None  # consumed: one reply per user turn
        thinking_at, state["thinking_at"] = state["thinking_at"], None
        used_tools, state["tools"] = state["tools"], False

        if heard_at is None:  # greeting / proactive reply: no user turn to time
            return
        gap = ev.created_at - heard_at
        if not 0 <= gap <= 30:  # stale: the user went quiet long ago
            return

        samples = state["samples"]
        samples.append(gap)
        think = f"{ev.created_at - thinking_at:.2f}s" if thinking_at else "n/a"
        print(
            f"⏱ TURN #{len(samples)} | last-speech->first-audio={gap:.2f}s "
            f"({'with tools' if used_tools else 'no tools'}) "
            f"| est. felt={gap + NETWORK_ESTIMATE_SEC:.2f}s "
            f"(+{NETWORK_ESTIMATE_SEC:.2f}s network) "
            f"| think->speak={think} "
            f"| median={statistics.median(samples):.2f}s"
        )

    @session.on("metrics_collected")
    def on_metrics_collected(ev):
        m = ev.metrics
        if isinstance(m, RealtimeModelMetrics) and not m.cancelled:
            print(f"⏱ Gemini ttft={m.ttft:.2f}s total={m.duration:.2f}s")

    return tracker


def tap_user_audio(room, tracker: UserSpeechTracker):
    """Feed the user's incoming audio to `tracker`.

    Returns scan(): call it once the room is connected to pick up tracks that
    were subscribed before this handler existed.
    """
    seen: set[str] = set()
    tasks: set[asyncio.Task] = set()

    async def consume(track):
        stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
        try:
            async for ev in stream:
                tracker.feed(np.frombuffer(ev.frame.data, dtype=np.int16), time.time())
        except Exception as e:
            print(f"⚠️ user-audio tap stopped: {e}")
        finally:
            await stream.aclose()

    def start(track):
        if track.kind != rtc.TrackKind.KIND_AUDIO or track.sid in seen:
            return
        seen.add(track.sid)
        task = asyncio.create_task(consume(track))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    @room.on("track_subscribed")
    def on_track_subscribed(track, _publication, _participant):
        start(track)

    def scan():
        for participant in room.remote_participants.values():
            for publication in participant.track_publications.values():
                if publication.track is not None:
                    start(publication.track)

    return scan


# ================= AGENT =================
class ShoppingAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=AGENT_INSTRUCTION,
            tools=[
                get_weather,
                web_search,
                login,
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

@server.rtc_session(agent_name=AGENT_NAME)
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
        "is_face_verifying": False,
        "verify_attempts": 0,
        "session_lock": asyncio.Lock(),
        "voice_status": "UNVERIFIED",
        "last_verified_at": None,
        "lockout_until": None,
    }

    auth_state["agent_state"] = room_state
    auth_state["room_ref"] = room

    session = AgentSession(
        llm=google.beta.realtime.RealtimeModel(
            model="models/gemini-2.5-flash-native-audio-latest",
            voice="Kore",
            # Gemini decides when the user's turn ended; AgentSession's own
            # endpointing settings are ignored for a RealtimeModel. Left
            # unset, Gemini waits ~800 ms of silence before replying. 500 ms
            # is the low end of Google's recommended range — raise it if the
            # agent starts cutting in while the user pauses mid-sentence.
            realtime_input_config=genai_types.RealtimeInputConfig(
                automatic_activity_detection=genai_types.AutomaticActivityDetection(
                    silence_duration_ms=VAD_SILENCE_MS,
                ),
            ),
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

    # ================= VOICE / FACE RESULT =================
    @room.on("data_received")
    def on_data(packet):
        if packet.topic == "VOICE_RESULT":
            _handle_voice_result(packet)
        elif packet.topic == "FACE_RESULT":
            _handle_face_result(packet)

    def _handle_voice_result(packet):
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
                asyncio.create_task(auto_login_after_verification())

            elif decision == "DENIED":
                room_state["voice_status"] = "DENIED"
                room_state["verify_attempts"] += 1

            elif decision == "REPEAT":
                room_state["voice_status"] = "REPEAT"
                room_state["verify_attempts"] += 1

            # 3 gagal berturut-turut → coba jalur wajah sebagai fallback,
            # bukan langsung lockout. Lockout baru dipasang kalau verifikasi
            # wajah ini juga gagal (lihat _handle_face_result).
            if room_state["verify_attempts"] >= MAX_VERIFY_ATTEMPTS:
                asyncio.create_task(start_face_verification())

        except Exception as e:
            print("❌ Voice result error:", e)

    def _handle_face_result(packet):
        try:
            decoded = json.loads(packet.data.decode())
            decision = decoded.get("decision")

            print("📦 Face result:", decision)

            room_state["is_face_verifying"] = False

            if decision == "VERIFIED":
                # Fallback yang berhasil membuka gate yang sama dengan voice
                # verification — require_voice_verification() (agent/tools.py)
                # hanya mengecek is_voice_verified/voice_status/last_verified_at,
                # tidak peduli metode mana yang memverifikasinya.
                room_state["is_voice_verified"] = True
                room_state["voice_status"] = "VERIFIED"
                room_state["verify_attempts"] = 0
                room_state["lockout_until"] = None
                room_state["last_verified_at"] = time.time()
                asyncio.create_task(auto_login_after_verification())
            else:
                # Wajah juga gagal (termasuk belum enroll wajah / error kamera)
                # — jatuh ke cooldown yang sama seperti voice lockout biasa.
                room_state["lockout_until"] = time.time() + LOCKOUT_COOLDOWN_SEC
                asyncio.create_task(session.generate_reply(
                    instructions=(
                        "Verifikasi wajah kamu juga belum berhasil. Beri tahu "
                        "user dengan sopan kalau mereka bisa coba lagi sebentar "
                        "lagi."
                    )
                ))

        except Exception as e:
            print("❌ Face result error:", e)

    # ================= CONVERSATION =================
    @session.on("conversation_item_added")
    def on_conversation_item(event):
        asyncio.create_task(handle_conversation(event))

    # The DB insert now runs in a worker thread, so it yields to the loop. Two
    # items arriving back to back (user turn, then the assistant reply) could
    # otherwise be stored and published in the opposite order. Held only around
    # persist + publish: the voice check below awaits speech and must not.
    conversation_lock = asyncio.Lock()

    async def handle_conversation(event):
        role = event.item.role
        text = event.item.text_content

        if not text or role not in ("user", "assistant"):
            return

        await ensure_conversation_session()

        # ================= USER =================
        if role == "user":
            async with conversation_lock:
                await asyncio.to_thread(
                    insert_conversation_log,
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
                if room_state["is_face_verifying"]:
                    # A face verification attempt (triggered after 3 failed
                    # voice attempts) is already in flight for this user —
                    # don't also kick off a competing voice recording prompt.
                    return

                lockout_until = room_state["lockout_until"]
                if lockout_until and time.time() >= lockout_until:
                    # Cooldown elapsed — give the user a fresh set of attempts
                    # instead of leaving them locked out for the rest of the
                    # session with no way back in short of reconnecting.
                    room_state["verify_attempts"] = 0
                    room_state["lockout_until"] = None
                    lockout_until = None

                if lockout_until:
                    remaining = int(lockout_until - time.time())
                    await session.generate_reply(
                        instructions=(
                            f"Maaf, verifikasi suara gagal beberapa kali. "
                            f"Coba lagi sekitar {max(remaining, 1)} detik lagi."
                        )
                    )
                else:
                    await start_verification()

        # ================= ASSISTANT =================
        elif role == "assistant":
            async with conversation_lock:
                if room_state["conversation_session_id"]:
                    await asyncio.to_thread(
                        insert_conversation_log,
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

    turn_tracker = install_turn_latency_logging(session)
    scan_user_audio = tap_user_audio(room, turn_tracker)

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

        asyncio.create_task(_verification_watchdog())

    # ================= VERIFICATION WATCHDOG =================
    async def _verification_watchdog():
        # Safety net: the client always reports back a VOICE_RESULT once it
        # gets a result (see useLiveKit.ts's try/finally), but if that never
        # arrives for some other reason (tab backgrounded, mic permission
        # denied, client crash mid-recording), is_verifying would otherwise
        # stay stuck True forever and start_verification() would silently
        # no-op on every future turn.
        await asyncio.sleep(VERIFY_TIMEOUT_SEC)
        if room_state["is_verifying"]:
            print(f"⏱️ Verification timed out in room: {room_name}, resetting")
            room_state["is_verifying"] = False

    # ================= FACE VERIFICATION (fallback after 3x voice fail) ====
    async def start_face_verification():
        if room_state["is_voice_verified"]:
            return
        if room_state["is_face_verifying"]:
            return

        room_state["is_face_verifying"] = True

        speech_handle = await session.generate_reply(
            instructions=(
                "Verifikasi suara gagal 3 kali. Beri tahu user dengan "
                "sopan bahwa kamu akan coba verifikasi lewat wajah sebagai "
                "gantinya, minta mereka arahkan wajah ke kamera."
            )
        )

        await speech_handle.wait_for_playout()

        await room.local_participant.publish_data(
            json.dumps({"type": "FACE_CMD", "action": "START_FACE_CAPTURE"}).encode(),
            reliable=True,
            topic="FACE_CMD"
        )

        asyncio.create_task(_face_verification_watchdog())

    # ================= FACE VERIFICATION WATCHDOG =================
    async def _face_verification_watchdog():
        # Same reasoning as _verification_watchdog() — if the client never
        # reports back a FACE_RESULT (camera permission denied, tab
        # backgrounded, client crash mid-capture), is_face_verifying would
        # otherwise stay stuck True forever and lock the user out of ever
        # retrying (voice re-prompt is suppressed while this flag is set).
        await asyncio.sleep(FACE_VERIFY_TIMEOUT_SEC)
        if room_state["is_face_verifying"]:
            print(f"⏱️ Face verification timed out in room: {room_name}, resetting")
            room_state["is_face_verifying"] = False
            room_state["lockout_until"] = time.time() + LOCKOUT_COOLDOWN_SEC

    # ================= AUTO-LOGIN =================
    async def auto_login_after_verification():
        # Runs once voice verification succeeds — logs the user into their
        # own linked e-commerce account (never a shared hardcoded one) so
        # they don't have to separately ask Happy to log in.
        if auth_state.get("is_logged_in"):
            return
        result = await login_with_stored_credentials()
        print(f"🔐 Auto-login after verification: {result}")

    # ================= SESSION =================
    async def ensure_conversation_session():
        async with room_state["session_lock"]:
            if room_state["conversation_session_id"]:
                return

            session_id = await asyncio.to_thread(
                create_conversation_session,
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

    scan_user_audio()

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