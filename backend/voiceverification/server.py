"""FastAPI server for voice verification, enrollment, and conversation logs.

Integrates LiveKit for real-time audio rooms and uses biometric
verification services for speaker enrollment and spoof detection.
"""

import asyncio
import json
import os
import time
from datetime import datetime, timezone
import traceback

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
    DeleteAgentDispatchRequest,
    LiveKitAPI,
    VideoGrants,
)
from livekit.api.twirp_client import TwirpError
from pydantic import BaseModel

from face_recognition.main import router as face_router
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
from ecommerce_sources import DEFAULT_SOURCE, ECOMMERCE_SOURCES
from voiceverification.db.spectrogram_repo import (
    delete_spectrogram,
    get_spectrogram_url,
    save_spectrogram,
)
from voiceverification.db.speaker_repo import count_enrollments, load_all_embeddings, save_embedding
from voiceverification.db.voice_verification_logs import (
    append_verification_log,
    get_verification_logs,
)
from voiceverification.core.decision_engine import DecisionConfig
from voiceverification.services.biometric_service import BiometricService
from voiceverification.utils.audio import normalize_audio, save_audio
from voiceverification.utils.antispoof_worked_example import (
    build_worked_example as build_antispoof_worked_example,
)
from voiceverification.utils.ecapa_worked_example import build_worked_example
from voiceverification.utils.pipeline_trace import (
    build_spectrogram_data,
    build_trace_record,
    build_waveform_preview,
)
from voiceverification.utils.room_notify import publish_room_result
from voiceverification.utils.spectrogram import render_spectrogram_png


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
load_dotenv(ENV_PATH)



LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")

AGENT_NAME = "happy-shopping-assistant"

if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
    raise RuntimeError("LIVEKIT credentials not set")


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Face recognition (enroll-face, verify-face, ...) lives under /face — see
# face_recognition/main.py. Merged in here so voice + face verification run
# as one FastAPI process/container instead of two separately launched apps.
app.include_router(face_router)


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
    user_city: str | None = None
    try:
        body = await request.json()
        raw_city = body.get("user_city")
        if isinstance(raw_city, str) and raw_city.strip():
            user_city = raw_city.strip()
    except Exception:
        pass

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

    async with LiveKitAPI(
        url=os.getenv("LIVEKIT_URL"),
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET,
    ) as lk:

        # Clean up any stale dispatches for this room/agent first. Previous
        # sessions can leave zombie dispatches on the LiveKit server even
        # after the local agent process exits — if we skip creation because
        # one of those exists, no actual agent ever joins the new session.
        try:
            existing = await lk.agent_dispatch.list_dispatch(room_name)
        except TwirpError as e:
            if e.code != "not_found":
                raise
            existing = []

        for d in existing:
            if d.agent_name != AGENT_NAME:
                continue
            try:
                await lk.agent_dispatch.delete_dispatch(
                    DeleteAgentDispatchRequest(
                        dispatch_id=d.id,
                        room=room_name,
                    )
                )
            except Exception as del_err:
                # Non-fatal — if we can't delete, the create below might fail
                # loudly, but it's better than silently refusing to start.
                print(f"⚠️ delete_dispatch failed (continuing): {del_err}")

        # Always create a fresh dispatch. Agent-side `_active_rooms` guard
        # (see agent.py) still protects against duplicate agents joining
        # the same room from a true double-click.
        metadata_payload = json.dumps({"user_city": user_city})
        await lk.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(
                room=room_name,
                agent_name=AGENT_NAME,
                metadata=metadata_payload,
            )
        )

    return {
        "status": "OK",
        "token": token.to_jwt(),
        "room": room_name,
    }


async def _load_user_context(user_id: str) -> tuple[list[dict], dict[str, BehaviorProfile]]:
    """Enrollment embeddings + per-label behavior profiles for a user.
    Shared by /verify-voice and /verify-voice/explain so the two can never
    load context differently."""
    enroll_embeddings = await asyncio.to_thread(load_all_embeddings, user_id)

    behavior_profiles: dict[str, BehaviorProfile] = {}
    for profile_meta in enroll_embeddings:
        lbl = profile_meta["label"]
        bp = await asyncio.to_thread(load_behavior_profile, user_id, lbl)
        if bp is not None:
            behavior_profiles[lbl] = bp

    return enroll_embeddings, behavior_profiles


@app.post("/verify-voice")
async def verify_voice(request: Request, audio: UploadFile = File(...)):
    user_id = get_user_id_from_request(request)

    enroll_embeddings, behavior_profiles = await _load_user_context(user_id)
    if not enroll_embeddings:
        return {
            "status": "ERROR",
            "reason": "No enrollment profile found for user."
        }

    try:
        wav_path = save_audio(audio)
        normalize_audio(wav_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid/unsupported audio upload: {e}")

    try:
        bio = get_biometric()

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
            await asyncio.to_thread(save_behavior_profile, user_id, matched_label, updated_profile)

        # Project the live embedding to the SAME 2-D PCA space the
        # dashboard uses, so each verification shows up as a live dot on
        # the embedding scatter plot. Needs ≥2 enrollments to fit PCA;
        # otherwise store None and the dashboard just skips the dot.
        # We also stash the first 8 raw dimensions of the live embedding
        # so the transparency panel can line it up next to enrolled
        # vectors — "here are the actual numbers for this verification".
        pca_x, pca_y = None, None
        preview_dims = None
        try:
            if len(enroll_embeddings) >= 2:
                live_emb = bio.speaker.extract_embedding(wav_path)
                enroll_matrix = np.array(
                    [p["embedding"] for p in enroll_embeddings]
                )
                from sklearn.decomposition import PCA
                pca = PCA(n_components=2)
                pca.fit(enroll_matrix)
                live_2d = pca.transform(live_emb.reshape(1, -1))[0]
                pca_x, pca_y = float(live_2d[0]), float(live_2d[1])
                preview_dims = [float(v) for v in live_emb[:8]]
        except Exception:
            # PCA projection is a nice-to-have; verification result must
            # not be blocked by a visualization error.
            traceback.print_exc()

        # Build per-enrollment similarity breakdown so the dashboard can
        # show how close the live voice was to each enrolled profile —
        # not just the best match. all_scores from the verifier is a
        # plain list in enrollment order, so we zip it with labels.
        all_scores_labeled = []
        try:
            raw_scores = result.get("all_scores") or []
            for i, s in enumerate(raw_scores):
                if i < len(enroll_embeddings):
                    all_scores_labeled.append(
                        {
                            "label": enroll_embeddings[i]["label"],
                            "score": float(s),
                        }
                    )
        except Exception:
            traceback.print_exc()

        try:
            await asyncio.to_thread(append_verification_log, {
                "user_id": user_id,
                "label": matched_label,
                "decision": result["decision"],
                "reason": result["reason"],
                "speaker_score": result["score"],
                "spoof_prob": result["spoof_prob"],
                "behavior_score": result.get("behavior_score"),
                "pca_x": pca_x,
                "pca_y": pca_y,
                "all_scores": all_scores_labeled,
                "preview_dims": preview_dims,
            })
        except Exception:
            # Metrics logging must never break a verification response.
            traceback.print_exc()

        # Server-authoritative push to the agent — see room_notify.py's
        # docstring for why this can't just be left to the client to
        # report over the room's data channel (topic="VOICE_RESULT").
        await publish_room_result(
            room_name=f"user-{user_id}",
            topic="VOICE_RESULT",
            payload={
                "decision": result["decision"],
                "score": result["score"],
                "ts": time.time(),
            },
        )

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

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"verify-voice failed: {type(e).__name__}: {e}",
        )

    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)


# EXPLAIN-MODE VERIFICATION FOR THE /pipeline EXPLAINER PAGE'S LIVE TOGGLE
#
# Same pipeline as /verify-voice, but:
#   - requests explain=True for embedding/spoof-breakdown/z-score/cascade
#     data the normal response doesn't carry
#   - does NOT persist anything: no behavior-profile update, no
#     voice_verification_logs row, no LiveKit room publish — booth Q&A
#     attempts must never pollute the presenter's real account history or
#     fire a shopping-agent event.
# Auth is still required: this reads the caller's real enrolled embeddings.
@app.post("/verify-voice/explain")
async def verify_voice_explain(request: Request, audio: UploadFile = File(...)):
    user_id = get_user_id_from_request(request)

    enroll_embeddings, behavior_profiles = await _load_user_context(user_id)
    if not enroll_embeddings:
        raise HTTPException(status_code=400, detail="No enrollment profile found for user.")

    try:
        wav_path = save_audio(audio)
        normalize_audio(wav_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid/unsupported audio upload: {e}")

    try:
        bio = get_biometric()
        result = await asyncio.to_thread(
            bio.verify_against_multiple_embeddings,
            live_wav=wav_path,
            enroll_embeddings=enroll_embeddings,
            user_id=user_id,
            behavior_profiles=behavior_profiles,
            explain=True,
        )

        preview = await asyncio.to_thread(build_waveform_preview, wav_path)
        spectrogram = await asyncio.to_thread(build_spectrogram_data, wav_path)
        worked_example = await asyncio.to_thread(build_worked_example, wav_path)
        antispoof_worked_example = await asyncio.to_thread(
            build_antispoof_worked_example, wav_path
        )

        return build_trace_record(
            scenario_id="live",
            title="Percobaan live",
            scenario_type="live_capture",
            source_file=None,
            enrolled_label=result.get("best_label"),
            result=result,
            preview=preview,
            worked_example=worked_example,
            antispoof_worked_example=antispoof_worked_example,
            spectrogram=spectrogram,
            # No raw enrolled audio is kept after enrollment (only its
            # embedding + a pre-rendered PNG in Supabase Storage) — honest
            # None rather than faking a comparison spectrogram here.
            enrolled_spectrogram=None,
        )

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"verify-voice/explain failed: {type(e).__name__}: {e}",
        )

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

    if await asyncio.to_thread(count_enrollments, user_id) >= 3:
        raise HTTPException(
            status_code=400,
            detail="Maximum enrollment reached (3)."
        )

    try:
        wav_path = save_audio(audio)
        normalize_audio(wav_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid/unsupported audio upload: {e}")

    # Reject enrollments that are too short to produce a stable embedding.
    # Below ~3 s of trimmed speech, ECAPA-TDNN embeddings are noisy enough
    # that same-speaker scores land in the 0.3-0.5 range (impostor-ish),
    # which is exactly the "voice gak pernah bener" symptom the user hit.
    # Match the live-side MIN_SPEECH_SEC in biometric_service.py; raise
    # it a bit higher for enrollment because enrollment embeddings get
    # re-used across many verifications — more worth getting right.
    try:
        y_check, sr_check = librosa.load(wav_path, sr=16000, mono=True)
        y_trim, _ = librosa.effects.trim(y_check, top_db=25)
        speech_dur = len(y_trim) / sr_check
        print(f"🎙 Enroll '{label}': {speech_dur:.2f}s of speech after trim")
        if speech_dur < 3.0:
            os.remove(wav_path)
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Audio terlalu pendek ({speech_dur:.1f}s). Minimal "
                    f"3 detik bicara. Coba ulangi dengan kalimat lebih "
                    f"panjang, misalnya 'Halo, nama saya [...] saya "
                    f"sedang mendaftarkan suara'."
                ),
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"⚠️ Speech duration check failed: {e}")

    try:
        embedding = await asyncio.to_thread(
            get_biometric().speaker.extract_embedding, wav_path
        )

        existing_label_query = (
            get_supabase()
            .table("speaker_profiles")
            .select("label")
            .eq("user_id", user_id)
            .eq("label", label)
        )
        existing_label = await asyncio.to_thread(existing_label_query.execute)
        if existing_label.data:
            raise HTTPException(
                status_code=400,
                detail=f"Enrollment with label '{label}' already exists."
            )

        # Wrap the DB write in asyncio.to_thread so the FastAPI event loop
        # isn't blocked while Supabase round-trips. Credit to the pipeline
        # branch for this fix.
        profile_id = await asyncio.to_thread(save_embedding, user_id, embedding, label)

        # The WAV is deleted below, so the spectrogram has to be rendered now.
        # A storage failure must not fail an enrollment that is already saved.
        try:
            png_bytes = await asyncio.to_thread(render_spectrogram_png, wav_path, label)
            await asyncio.to_thread(save_spectrogram, user_id, profile_id, png_bytes)
        except Exception:
            print(f"WARNING: spectrogram upload failed for profile {profile_id}")
            traceback.print_exc()

        behavior_profile = await asyncio.to_thread(load_behavior_profile, user_id, label)

        if behavior_profile is None:
            def _compute_pitch_profile():
                y, sr = librosa.load(wav_path, sr=16000)
                pitch = float(np.nanmean(librosa.yin(y, fmin=50, fmax=300, sr=sr)))
                rate = float(len(y) / sr)
                return pitch, rate

            pitch, rate = await asyncio.to_thread(_compute_pitch_profile)

            behavior_profile = BehaviorProfile(
                n_samples=1,
                mean_pitch=pitch,
                var_pitch=0.0,
                mean_rate=rate,
                var_rate=0.0,
                last_update_ts=datetime.now(timezone.utc)
            )

            await asyncio.to_thread(save_behavior_profile, user_id, label, behavior_profile)

        return {
            "status": "OK",
            "message": "Voice enrollment successful",
            "label": label
        }

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"enroll-voice failed: {type(e).__name__}: {e}",
        )

    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

# CONVERSATION LOGS & SESSIONS
@app.get("/logs/sessions")
async def get_conversation_sessions(request: Request):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    query = (
        sb.table("conversation_sessions")
        .select("id, label, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    res = await asyncio.to_thread(query.execute)

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

    session_check_query = (
        sb.table("conversation_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
    )
    session_check = await asyncio.to_thread(session_check_query.execute)

    if not session_check.data:
        raise HTTPException(status_code=404, detail="Session not found")

    logs_query = (
        sb.table("conversation_logs")
        .select("role, content, created_at")
        .eq("session_id", session_id)
        .order("created_at")
    )
    logs = await asyncio.to_thread(logs_query.execute)

    product_cards_query = (
        sb.table("product_cards")
        .select("id, products, created_at")
        .eq("session_id", session_id)
        .order("created_at")
    )
    product_cards = await asyncio.to_thread(product_cards_query.execute)

    review_cards_query = (
        sb.table("review_cards")
        .select("id, product_name, reviews, created_at")
        .eq("session_id", session_id)
        .order("created_at")
    )
    review_cards = await asyncio.to_thread(review_cards_query.execute)

    return {
        "status": "OK",
        "session_id": session_id,
        "logs": logs.data or [],
        "product_cards": product_cards.data or [],
        "review_cards": review_cards.data or []
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

    session_check_query = (
        sb.table("conversation_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
    )
    session_check = await asyncio.to_thread(session_check_query.execute)

    if not session_check.data:
        raise HTTPException(404, "Session not found")

    await asyncio.to_thread(
        update_conversation_session_label,
        session_id=session_id,
        new_label=new_label,
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
    session_check_query = (
        sb.table("conversation_sessions")
        .select("id")
        .eq("id", session_id)
        .eq("user_id", user_id)
    )
    session_check = await asyncio.to_thread(session_check_query.execute)

    if not session_check.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # delete logs
    delete_logs_query = (
        sb.table("conversation_logs")
        .delete()
        .eq("session_id", session_id)
    )
    await asyncio.to_thread(delete_logs_query.execute)

    # delete session row
    delete_session_query = (
        sb.table("conversation_sessions")
        .delete()
        .eq("id", session_id)
    )
    await asyncio.to_thread(delete_session_query.execute)

    return {
        "status": "OK",
        "session_id": session_id
    }

# GET ALL ENROLLMENTS
@app.get("/enrollments")
async def get_enrollments(request: Request):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    query = (
        sb.table("speaker_profiles")
        .select("id, label, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    res = await asyncio.to_thread(query.execute)

    return {
        "status": "OK",
        "total": len(res.data or []),
        "enrollments": res.data or []
    }

# EMBEDDING VISUALIZATION — reduce the 256-D speaker vectors down to 2-D
# via PCA so the frontend can plot them on a scatter chart. The classic
# "see your speakers cluster in embedding space" demo moment.
@app.get("/embeddings/visualize")
async def visualize_embeddings(request: Request):
    user_id = get_user_id_from_request(request)
    profiles = load_all_embeddings(user_id)

    if not profiles:
        return {"status": "OK", "points": [], "pca_components": None}

    embeddings = np.array([p["embedding"] for p in profiles])
    labels = [p["label"] for p in profiles]

    # PCA to 2D. Need at least 2 samples to fit PCA. If user only has 1
    # enrollment, fallback to projecting that single point at origin so
    # the chart still renders.
    if len(embeddings) < 2:
        points = [{"x": 0.0, "y": 0.0, "label": labels[0]}]
        return {
            "status": "OK",
            "points": points,
            "pca_components": None,  # can't fit PCA with 1 sample
            "pca_mean": embeddings[0].tolist(),
        }

    from sklearn.decomposition import PCA
    pca = PCA(n_components=2)
    coords = pca.fit_transform(embeddings)

    # Also expose the first 8 raw dimensions of each embedding so the
    # dashboard can show a transparency panel: "here are the actual
    # numbers coming out of ECAPA-TDNN — no manipulation". 8 is enough
    # to visually prove embeddings differ between labels without
    # overwhelming the UI with all 256.
    PREVIEW_DIMS = 8
    points = [
        {
            "x": float(coords[i][0]),
            "y": float(coords[i][1]),
            "label": labels[i],
            "preview_dims": [float(v) for v in embeddings[i][:PREVIEW_DIMS]],
        }
        for i in range(len(labels))
    ]

    # explained_variance_ratio_ tells us what fraction of the original
    # 256-D variance each principal component captures. If PC1+PC2 ≥ 60%
    # the 2-D view is a faithful representation; below that, hint to the
    # viewer that the real cluster separation may be sharper than what
    # they see here. Standard PCA diagnostics every ML audience expects.
    ev_ratio = pca.explained_variance_ratio_.tolist()

    return {
        "status": "OK",
        "points": points,
        "pca_components": pca.components_.tolist(),  # shape (2, D)
        "pca_mean": pca.mean_.tolist(),              # shape (D,)
        "explained_variance_ratio": ev_ratio,        # [pc1_ratio, pc2_ratio]
    }


# Projects a fresh voice sample into the SAME PCA space the enrollments
# were fit in. Used by the embeddings page to drop a "test voice" dot
# onto the chart next to the enrolled cluster.
@app.post("/embeddings/project")
async def project_embedding(request: Request, audio: UploadFile = File(...)):
    user_id = get_user_id_from_request(request)

    # 1. Reuse the same embedding extractor the verifier uses
    enroll_embeddings = load_all_embeddings(user_id)
    if len(enroll_embeddings) < 2:
        raise HTTPException(
            status_code=400,
            detail="Need at least 2 enrolled voices to project a test sample.",
        )

    try:
        wav_path = save_audio(audio)
        normalize_audio(wav_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid audio: {e}")

    bio = get_biometric()
    live_emb = bio.speaker.extract_embedding(wav_path)

    # 2. Refit PCA on enrolled, then project the live embedding
    enroll_matrix = np.array([p["embedding"] for p in enroll_embeddings])
    from sklearn.decomposition import PCA
    pca = PCA(n_components=2)
    pca.fit(enroll_matrix)
    live_2d = pca.transform(live_emb.reshape(1, -1))[0]

    # 3. Compute cosine similarity to every enrolled embedding — used by
    # the UI to color the test dot (max_sim > threshold = ACCEPTED).
    def cosine(a, b):
        a = a.flatten()
        b = b.flatten()
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

    similarities = [
        {
            "label": p["label"],
            "similarity": cosine(live_emb, p["embedding"]),
        }
        for p in enroll_embeddings
    ]
    best = max(similarities, key=lambda s: s["similarity"])

    return {
        "status": "OK",
        "live": {"x": float(live_2d[0]), "y": float(live_2d[1])},
        "similarities": similarities,
        "best_match": best["label"],
        "best_score": best["similarity"],
    }


# SPECTROGRAMS FOR THE ANALYSIS DASHBOARD
@app.get("/spectrograms")
async def get_spectrograms(request: Request):
    user_id = get_user_id_from_request(request)
    sb = get_supabase()

    query = (
        sb.table("speaker_profiles")
        .select("id, label, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
    )
    res = await asyncio.to_thread(query.execute)

    profiles = []
    for row in (res.data or []):
        url = await asyncio.to_thread(get_spectrogram_url, user_id, row["id"])
        profiles.append({**row, "spectrogram_url": url})

    return {
        "status": "OK",
        "total": len(profiles),
        "profiles": profiles,
    }

# VERIFICATION METRICS FOR THE ANALYSIS DASHBOARD
#
# speaker_score/spoof_prob per attempt, plus the current DecisionConfig
# thresholds, so the dashboard can plot them against each other and the
# thresholds can be re-evaluated against production data (see ROADMAP.md
# "Metric & monitoring untuk skor verifikasi") instead of only the n=37
# calibration set referenced in decision_engine.py's comments.
@app.get("/verification-metrics")
async def get_verification_metrics(request: Request):
    user_id = get_user_id_from_request(request)

    logs = await asyncio.to_thread(get_verification_logs, user_id)
    config = DecisionConfig()

    return {
        "status": "OK",
        "total": len(logs),
        "logs": logs,
        "thresholds": {
            "voice_accept": config.voice_accept,
            "voice_repeat": config.voice_repeat,
            "abs_min_speaker": config.abs_min_speaker,
            "replay_deny": config.replay_deny,
            "replay_warn": config.replay_warn,
        },
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
    enrollment_check_query = (
        sb.table("speaker_profiles")
        .select("id, label")
        .eq("id", enrollment_id)
        .eq("user_id", user_id)
    )
    enrollment_check = await asyncio.to_thread(enrollment_check_query.execute)

    if not enrollment_check.data:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    label = enrollment_check.data[0]["label"]

    # Hapus enrollment
    delete_speaker_query = (
        sb.table("speaker_profiles")
        .delete()
        .eq("id", enrollment_id)
    )
    await asyncio.to_thread(delete_speaker_query.execute)

    # Hapus behavior profile terkait
    delete_behavior_query = (
        sb.table("behavior_profiles")
        .delete()
        .eq("user_id", user_id)
        .eq("label", label)
    )
    await asyncio.to_thread(delete_behavior_query.execute)

    await asyncio.to_thread(delete_spectrogram, user_id, enrollment_id)

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
    speaker_check_query = (
        sb.table("speaker_profiles")
        .select("id, label")
        .eq("id", speaker_id)
        .eq("user_id", user_id)
    )
    speaker_check = await asyncio.to_thread(speaker_check_query.execute)

    if not speaker_check.data:
        raise HTTPException(status_code=404, detail="Speaker not found")

    old_label = speaker_check.data[0]["label"]

    # 2️⃣ Cek duplicate label
    duplicate_check_query = (
        sb.table("speaker_profiles")
        .select("id")
        .eq("user_id", user_id)
        .eq("label", new_label)
    )
    duplicate_check = await asyncio.to_thread(duplicate_check_query.execute)

    if duplicate_check.data:
        raise HTTPException(
            status_code=400,
            detail="Label already exists for this user."
        )

    # 3️⃣ Update speaker_profiles
    update_speaker_query = (
        sb.table("speaker_profiles")
        .update({"label": new_label})
        .eq("id", speaker_id)
    )
    await asyncio.to_thread(update_speaker_query.execute)

    # 4️⃣ Update behavior_profiles
    update_behavior_query = (
        sb.table("behavior_profiles")
        .update({"label": new_label})
        .eq("user_id", user_id)
        .eq("label", old_label)
    )
    await asyncio.to_thread(update_behavior_query.execute)

    return {
        "status": "OK",
        "message": "Label renamed successfully",
        "speaker_id": speaker_id,
        "old_label": old_label,
        "new_label": new_label
    }

# ECOMMERCE ACCOUNT LINKING
# Lets each Supabase user attach their own dummy-ecommerce credentials, per
# store (see backend/ecommerce_sources.py), so the shopping agent logs in as
# them instead of one shared hardcoded account. Deliberately a typed HTTP
# form, not something spoken to the voice agent — voice input gets
# transcribed into conversation_logs in plain text, which is not where a
# password should ever end up.
class EcommerceAccountPayload(BaseModel):
    username: str
    password: str
    source: str = DEFAULT_SOURCE

def _resolve_source_or_400(source: str) -> str:
    if source not in ECOMMERCE_SOURCES:
        valid = ", ".join(ECOMMERCE_SOURCES.keys())
        raise HTTPException(status_code=400, detail=f"Source tidak dikenal. Pilihan: {valid}")
    return source

@app.post("/ecommerce-account")
async def link_ecommerce_account(payload: EcommerceAccountPayload, request: Request):
    user_id = get_user_id_from_request(request)
    username = payload.username.strip()
    password = payload.password
    source = _resolve_source_or_400(payload.source)
    base_url = ECOMMERCE_SOURCES[source]["base_url"]

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    try:
        register_resp = await asyncio.to_thread(
            requests.post,
            f"{base_url}/api/auth/register",
            json={"username": username, "password": password},
            timeout=10,
        )

        if register_resp.status_code not in (200, 201):
            # Account may already exist — validate these are real, working
            # credentials for it before we store them.
            login_resp = await asyncio.to_thread(
                requests.post,
                f"{base_url}/api/auth/token",
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

    await asyncio.to_thread(save_ecommerce_account, user_id, username, password, source)

    return {"status": "OK", "username": username, "source": source}

@app.get("/ecommerce-account")
async def get_ecommerce_account(request: Request):
    user_id = get_user_id_from_request(request)

    accounts = {}
    for source, cfg in ECOMMERCE_SOURCES.items():
        account = await asyncio.to_thread(has_ecommerce_account, user_id, source)
        accounts[source] = {
            "label": cfg["label"],
            "linked": account is not None,
            "username": account["username"] if account else None,
        }

    return {"status": "OK", "accounts": accounts}

@app.delete("/ecommerce-account")
async def unlink_ecommerce_account(request: Request, source: str = DEFAULT_SOURCE):
    user_id = get_user_id_from_request(request)
    source = _resolve_source_or_400(source)
    await asyncio.to_thread(delete_ecommerce_account, user_id, source)

    return {"status": "OK"}
