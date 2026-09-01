"""FastAPI server for voice verification, enrollment, and conversation logs.

Integrates LiveKit for real-time audio rooms and uses biometric
verification services for speaker enrollment and spoof detection.
"""

import asyncio
import os
import time
from datetime import datetime, timezone

import librosa
import numpy as np
import requests
import torch
from dotenv import load_dotenv
from fastapi import File, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from livekit.api import (
    AccessToken,
    CreateAgentDispatchRequest,
    LiveKitAPI,
    VideoGrants,
)
from pydantic import BaseModel

from voiceverification.auth.auth_utils import get_user_id_from_request
from voiceverification.core.behavior_profile import BehaviorProfile
from voiceverification.db.behavior_repo import load_behavior_profile, save_behavior_profile
from voiceverification.db.connection import get_supabase
from voiceverification.db.conversation_sessions import update_conversation_session_label
from voiceverification.db.ecommerce_repo import (
    delete_ecommerce_account,
    has_ecommerce_account,
    save_ecommerce_account,
)
from voiceverification.db.speaker_repo import count_enrollments, load_all_embeddings, save_embedding
from voiceverification.services.biometric_service import BiometricService
from voiceverification.utils.audio import normalize_audio, save_audio

# Same dummy e-commerce backend the shopping agent talks to (agent/tools.py
# BASE_URL) — kept in sync manually since the two live in separate services.
ECOMMERCE_BASE_URL = "https://dummy-ecommerce-tau.vercel.app"

# Environment setup
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
load_dotenv(ENV_PATH)



LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

# Must match agent/agent.py's AGENT_NAME — an unnamed dispatch would target
# LiveKit's automatic-dispatch agent instead of (or in addition to) this
# named one.
AGENT_NAME = "happy-shopping-assistant"

if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
    raise RuntimeError("LIVEKIT credentials not set")


# FastAPI application
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ⚠️ restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


biometric: BiometricService | None = None


def get_biometric() -> BiometricService:
    """Lazily initialize and return the singleton BiometricService instance."""
    global biometric
    if biometric is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        biometric = BiometricService(device=device)
        print(f"BiometricService initialized on device: {device}")
    return biometric



@app.on_event("startup")
async def startup_event():
    get_biometric()
    print("Server startup complete.")


# JOIN TOKEN (NO VERIFICATION)
@app.post("/join-token")
async def join_token(request: Request):
    user_id = get_user_id_from_request(request)
    room_name = f"user-{user_id}"

    grant = VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
    )

    token = AccessToken(
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
    )

    token.with_identity(user_id)
    token.with_grants(grant)

    # Dispatch agent to room — guard against a double click / duplicate
    # request creating two dispatches (and so two agents talking over each
    # other in the same room).
    async with LiveKitAPI(
        url=os.getenv("LIVEKIT_URL"),
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET,
    ) as lk:

        existing = await lk.agent_dispatch.list_dispatch(room_name)
        if not any(d.agent_name == AGENT_NAME for d in existing):
            await lk.agent_dispatch.create_dispatch(
                CreateAgentDispatchRequest(room=room_name, agent_name=AGENT_NAME)
            )


    return {
        "status": "OK",
        "token": token.to_jwt(),
        "room": room_name,
    }


# VOICE VERIFICATION ONLY
@app.post("/verify-voice")
async def verify_voice(request: Request, audio: UploadFile = File(...)):
    user_id = get_user_id_from_request(request)

    enroll_embeddings = load_all_embeddings(user_id)
    if not enroll_embeddings:
        return {
            "status": "ERROR",
            "reason": "No enrollment profile found for user."
        }
    
    wav_path = save_audio(audio)
    normalize_audio(wav_path)

    try:
        bio = get_biometric()

        behavior_profiles: dict[str, BehaviorProfile] = {}
        for profile_meta in enroll_embeddings:
            lbl = profile_meta["label"]
            bp = load_behavior_profile(user_id, lbl)
            if bp is not None:
                behavior_profiles[lbl] = bp

        start = time.time()

        result = await asyncio.to_thread(
            bio.verify_against_multiple_embeddings,
            live_wav=wav_path,
            enroll_embeddings=enroll_embeddings,
            user_id=user_id,
            behavior_profiles=behavior_profiles,
        )

        print("Verify took:", time.time() - start)

        matched_label: str | None = result.get("best_label")
        updated_profile: BehaviorProfile | None = result.get("updated_behavior_profile")

        if matched_label and updated_profile:
            save_behavior_profile(user_id, matched_label, updated_profile)

        return {
            "verified": result["verified"],
            "status": result["decision"],
            "reason": result["reason"],
            "score": result["score"],
            "spoof_prob": result["spoof_prob"],
            "best_index": result["best_index"],
            "all_scores": result["all_scores"],
            "matched_label": matched_label,
        }

    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)



# HEALTH CHECK
@app.get("/health")
async def health_check():
    bio_service = get_biometric()
    return {
        "status": "OK",
        "biometric_service": biometric is not None
    }

# VOICE ENROLLMENT
@app.post("/enroll-voice")
async def enroll_voice(
    request: Request, 
    audio: UploadFile = File(...), 
    label: str = Form(...)
):
    user_id = get_user_id_from_request(request)

    if count_enrollments(user_id) >= 3:
        raise HTTPException(
            status_code=400,
            detail="Maximum enrollment reached (3)."
        )

    wav_path = save_audio(audio)
    normalize_audio(wav_path)

    try:
        embedding = get_biometric().speaker.extract_embedding(wav_path)

        existing_label = (
            get_supabase()
            .table("speaker_profiles")
            .select("label")
            .eq("user_id", user_id)
            .eq("label", label)
            .execute()
        )
        if existing_label.data:
            raise HTTPException(
                status_code=400,
                detail=f"Enrollment with label '{label}' already exists."
            )
        
        save_embedding(user_id, embedding, label)

        behavior_profile = load_behavior_profile(user_id, label)

        if behavior_profile is None:
            y, sr = librosa.load(wav_path, sr=16000)

            pitch = float(np.nanmean(
                librosa.yin(y, fmin=50, fmax=300, sr=sr)
            ))
            rate = float(len(y) / sr)

            behavior_profile = BehaviorProfile(
                n_samples=1,
                mean_pitch=pitch,
                var_pitch=0.0,
                mean_rate=rate,
                var_rate=0.0,
                last_update_ts=datetime.now(timezone.utc)
            )

            save_behavior_profile(user_id, label, behavior_profile)

        return {
            "status": "OK",
            "message": "Voice enrollment successful",
            "label": label
        }

    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

# CONVERSATION LOGS & SESSIONS
@app.get("/logs/sessions")
async def get_conversation_sessions(request: Request):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    res = (
        sb.table("conversation_sessions")
        .select("id, label, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )

    return {
        "status": "OK",
        "sessions": res.data or []
    }

# GET LOGS BY SESSION ID
@app.get("/logs/sessions/{session_id}")
async def get_conversation_logs(
    session_id: str,
    request: Request
):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    session_check = (
        sb.table("conversation_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not session_check.data:
        raise HTTPException(status_code=404, detail="Session not found")

    logs = (
        sb.table("conversation_logs")
        .select("role, content, created_at")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )

    product_cards = (
        sb.table("product_cards")
        .select("id, products, created_at")
        .eq("session_id", session_id)
        .order("created_at")
        .execute()
    )

    return {
        "status": "OK",
        "session_id": session_id,
        "logs": logs.data or [],
        "product_cards": product_cards.data or []
    }

# UPDATE SESSION LABEL
class UpdateSessionLabelPayload(BaseModel):
    label: str

@app.patch("/conversation-sessions/{session_id}/label")
async def update_session_label(
    session_id: str,
    payload: UpdateSessionLabelPayload,
    request: Request
):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()
    
    new_label = payload.label.strip()
    if not payload.label.strip():
        raise HTTPException(400, "Label cannot be empty")

    session_check = (
        sb.table("conversation_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not session_check.data:
        raise HTTPException(404, "Session not found")

    update_conversation_session_label(
        session_id=session_id,
        new_label=new_label
    )

    return {
        "status": "OK",
        "session_id": session_id,
        "label": new_label
    }

# DELETE SESSION (AND LOGS)
@app.delete("/conversation-sessions/{session_id}")
async def delete_conversation_session(
    session_id: str,
    request: Request
):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    # (opsional) validasi ownership session di sini
    session_check = (
        sb.table("conversation_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not session_check.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # delete logs
    sb.table("conversation_logs")\
        .delete()\
        .eq("session_id", session_id)\
        .execute()  
    
    # delete session row
    sb.table("conversation_sessions")\
        .delete()\
        .eq("id", session_id)\
        .execute()

    return {
        "status": "OK",
        "session_id": session_id
    }

# GET ALL ENROLLMENTS
@app.get("/enrollments")
async def get_enrollments(request: Request):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    res = (
        sb.table("speaker_profiles")
        .select("id, label, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )

    return {
        "status": "OK",
        "total": len(res.data or []),
        "enrollments": res.data or []
    }

# DELETE ENROLLMENT BY ID
@app.delete("/enrollments/{enrollment_id}")
async def delete_enrollment(
    enrollment_id: str,
    request: Request
):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    # (opsional) validasi ownership enrollment di sini
    enrollment_check = (
        sb.table("speaker_profiles")
        .select("id, label")
        .eq("id", enrollment_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not enrollment_check.data:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    label = enrollment_check.data[0]["label"]

    # Hapus enrollment
    sb.table("speaker_profiles")\
        .delete()\
        .eq("id", enrollment_id)\
        .execute()
    
    # Hapus behavior profile terkait
    sb.table("behavior_profiles")\
        .delete()\
        .eq("user_id", user_id)\
        .eq("label", label)\
        .execute()
    
    return {
        "status": "OK",
        "message": "Enrollment deleted",
        "enrollment_id": enrollment_id,
        "label": label
    }

class RenameSpeakerPayload(BaseModel):
    label: str

# RENAME SPEAKER LABEL
@app.patch("/speakers/{speaker_id}/label")
async def rename_speaker_label(
    speaker_id: str,
    payload: RenameSpeakerPayload,
    request: Request
):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    new_label = payload.label.strip()

    if not new_label:
        raise HTTPException(status_code=400, detail="Label cannot be empty")

    # 1️⃣ Cek speaker milik user
    speaker_check = (
        sb.table("speaker_profiles")
        .select("id, label")
        .eq("id", speaker_id)
        .eq("user_id", user_id)
        .execute()
    )

    if not speaker_check.data:
        raise HTTPException(status_code=404, detail="Speaker not found")

    old_label = speaker_check.data[0]["label"]

    # 2️⃣ Cek duplicate label
    duplicate_check = (
        sb.table("speaker_profiles")
        .select("id")
        .eq("user_id", user_id)
        .eq("label", new_label)
        .execute()
    )

    if duplicate_check.data:
        raise HTTPException(
            status_code=400,
            detail="Label already exists for this user."
        )

    # 3️⃣ Update speaker_profiles
    sb.table("speaker_profiles")\
        .update({"label": new_label})\
        .eq("id", speaker_id)\
        .execute()

    # 4️⃣ Update behavior_profiles
    sb.table("behavior_profiles")\
        .update({"label": new_label})\
        .eq("user_id", user_id)\
        .eq("label", old_label)\
        .execute()

    return {
        "status": "OK",
        "message": "Label renamed successfully",
        "speaker_id": speaker_id,
        "old_label": old_label,
        "new_label": new_label
    }

# ECOMMERCE ACCOUNT LINKING
# Lets each Supabase user attach their own dummy-ecommerce credentials so
# the shopping agent logs in as them instead of one shared hardcoded
# account. Deliberately a typed HTTP form, not something spoken to the
# voice agent — voice input gets transcribed into conversation_logs in
# plain text, which is not where a password should ever end up.
class EcommerceAccountPayload(BaseModel):
    username: str
    password: str

@app.post("/ecommerce-account")
async def link_ecommerce_account(payload: EcommerceAccountPayload, request: Request):
    user_id = get_user_id_from_request(request)
    username = payload.username.strip()
    password = payload.password

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    try:
        register_resp = requests.post(
            f"{ECOMMERCE_BASE_URL}/api/auth/register",
            json={"username": username, "password": password},
            timeout=10,
        )

        if register_resp.status_code not in (200, 201):
            # Account may already exist — validate these are real, working
            # credentials for it before we store them.
            login_resp = requests.post(
                f"{ECOMMERCE_BASE_URL}/api/auth/token",
                json={"username": username, "password": password},
                timeout=10,
            )
            if login_resp.status_code != 200 or not login_resp.json().get("success"):
                raise HTTPException(
                    status_code=400,
                    detail="Registrasi gagal dan kredensial ini juga tidak valid untuk login ke akun yang sudah ada.",
                )
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Gagal menghubungi layanan e-commerce.")

    save_ecommerce_account(user_id, username, password)

    return {"status": "OK", "username": username}

@app.get("/ecommerce-account")
async def get_ecommerce_account(request: Request):
    user_id = get_user_id_from_request(request)
    account = has_ecommerce_account(user_id)

    return {
        "status": "OK",
        "linked": account is not None,
        "username": account["username"] if account else None,
    }

@app.delete("/ecommerce-account")
async def unlink_ecommerce_account(request: Request):
    user_id = get_user_id_from_request(request)
    delete_ecommerce_account(user_id)

    return {"status": "OK"}
