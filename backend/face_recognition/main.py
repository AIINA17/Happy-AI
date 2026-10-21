from fastapi import APIRouter, Request, UploadFile, File, Form, HTTPException
import numpy as np

from face_recognition.arcface_model import ArcFaceModel
from face_recognition.face_service import FaceRecognitionService
from face_recognition.liveness_challenge import (
    CHALLENGE_TTL_SECONDS,
    consume_challenge,
    issue_challenge,
)
from voiceverification.auth.auth_utils import get_user_id_from_request
from voiceverification.db import face_repo, face_verification_logs

# Mounted into voiceverification/server.py under this prefix (see
# app.include_router there) so face recognition shares the same FastAPI
# process/container as voice verification instead of running as its own
# standalone app.
router = APIRouter(prefix="/face", tags=["face-recognition"])

arcface_model = ArcFaceModel()
face_service = FaceRecognitionService(threshold=0.45)


@router.get("/health")
def health_check():
    return {
        "status": "ok",
        "module": "face_recognition",
        "model": "insightface-buffalo_l",
        "embedding_storage": "supabase.face_profiles",
        "log_storage": "supabase.face_verification_logs"
    }


@router.post("/enroll-face")
async def enroll_face(
    user_id: str = Form(...),
    image: UploadFile = File(...)
):
    try:
        image_bytes = await image.read()
        embedding = arcface_model.extract_embedding(image_bytes)

        face_repo.save_embedding(
            user_id=user_id,
            embedding=embedding
        )

        return {
            "status": "ENROLLMENT_SUCCESS",
            "user_id": user_id,
            "embedding_dim": len(embedding),
            "storage": "supabase.face_profiles",
            "message": "Face embedding berhasil dibuat dan disimpan."
        }

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan server: {str(error)}")


@router.post("/liveness-challenge")
async def create_liveness_challenge(user_id: str = Form(...)):
    """Issues a single-use, server-picked liveness challenge for user_id.

    Called by FaceLivenessCapture.tsx (the agent-triggered production
    flow) before it starts the camera, so the challenge *type* comes from
    the server instead of the client picking its own — and the resulting
    token must be presented back to /verify-face below for that capture to
    be accepted at all. The manual test flow (FaceVerification.tsx) never
    calls this and omits liveness_token entirely, which /verify-face treats
    as a plain recognition-only test.
    """
    token, challenge_type = issue_challenge(user_id)
    return {
        "liveness_token": token,
        "challenge_type": challenge_type,
        "expires_in": CHALLENGE_TTL_SECONDS,
    }


@router.post("/verify-face")
async def verify_face(
    user_id: str = Form(...),
    image: UploadFile = File(...),
    liveness_token: str | None = Form(None),
):
    image_filename = image.filename

    # Only gated when a liveness_token is actually presented — the manual
    # test button intentionally skips this so it stays a quick
    # recognition-only check (see docstring on /liveness-challenge above).
    if liveness_token is not None:
        challenge_type = consume_challenge(liveness_token, user_id)
        if challenge_type is None:
            result = {
                "verified": False,
                "status": "LIVENESS_FAILED",
                "user_id": user_id,
                "message": "Sesi liveness tidak valid atau sudah kedaluwarsa. Coba lagi.",
            }

            face_verification_logs.append_verification_log({
                "user_id": user_id,
                "image_filename": image_filename,
                "verified": False,
                "status": "LIVENESS_FAILED",
                "similarity": None,
                "threshold": face_service.threshold,
                "error_message": "invalid, expired, or already-used liveness_token"
            })

            return result

    try:
        reference_embedding = face_repo.get_embedding(user_id)

        if reference_embedding is None:
            result = {
                "verified": False,
                "status": "NO_FACE_ENROLLMENT",
                "user_id": user_id,
                "message": "User belum memiliki face embedding."
            }

            face_verification_logs.append_verification_log({
                "user_id": user_id,
                "image_filename": image_filename,
                "verified": False,
                "status": "NO_FACE_ENROLLMENT",
                "similarity": None,
                "threshold": face_service.threshold,
                "error_message": "User belum memiliki face embedding."
            })

            return result

        image_bytes = await image.read()
        test_embedding = arcface_model.extract_embedding(image_bytes)

        result = face_service.verify(
            test_embedding=test_embedding,
            reference_embedding=reference_embedding
        )

        result["user_id"] = user_id
        result["storage"] = "supabase.face_profiles"

        face_verification_logs.append_verification_log({
            "user_id": user_id,
            "image_filename": image_filename,
            "verified": result["verified"],
            "status": result["status"],
            "similarity": result["similarity"],
            "threshold": result["threshold"],
            "error_message": None
        })

        return result

    except ValueError as error:
        face_verification_logs.append_verification_log({
            "user_id": user_id,
            "image_filename": image_filename,
            "verified": False,
            "status": "ERROR",
            "similarity": None,
            "threshold": face_service.threshold,
            "error_message": str(error)
        })

        raise HTTPException(status_code=400, detail=str(error))

    except Exception as error:
        face_verification_logs.append_verification_log({
            "user_id": user_id,
            "image_filename": image_filename,
            "verified": False,
            "status": "SERVER_ERROR",
            "similarity": None,
            "threshold": face_service.threshold,
            "error_message": str(error)
        })

        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan server: {str(error)}")


@router.get("/enroll-face/{user_id}")
def get_enrollment_status(user_id: str):
    embedding = face_repo.get_embedding(user_id)

    return {
        "user_id": user_id,
        "enrolled": embedding is not None
    }


@router.get("/enrolled-users")
def get_enrolled_users():
    users = face_repo.list_enrolled_users()

    return {
        "total": len(users),
        "users": users
    }


@router.delete("/enroll-face/{user_id}")
def delete_face_enrollment(user_id: str):
    deleted = face_repo.delete_embedding(user_id)

    if not deleted:
        return {
            "status": "NOT_FOUND",
            "message": "User tidak memiliki face enrollment."
        }

    return {
        "status": "DELETED",
        "user_id": user_id,
        "message": "Face enrollment berhasil dihapus."
    }


@router.get("/verification-metrics")
def get_verification_metrics(request: Request):
    """Per-user face verification metrics for the Analysis dashboard.

    Unlike /verification-logs (global, operator/debug), this is scoped to
    the caller's own user_id via their Supabase JWT, matching
    /verification-metrics on the voice side.
    """
    user_id = get_user_id_from_request(request)
    logs = face_verification_logs.get_verification_logs_for_user(user_id)

    return {
        "status": "OK",
        "total": len(logs),
        "logs": logs,
        "threshold": face_service.threshold,
    }


@router.get("/verification-logs")
def get_verification_logs():
    logs = face_verification_logs.get_verification_logs()

    return {
        "total": len(logs),
        "logs": logs
    }


@router.delete("/verification-logs")
def clear_verification_logs():
    face_verification_logs.clear_verification_logs()

    return {
        "status": "CLEARED",
        "message": "Seluruh log verifikasi wajah berhasil dihapus."
    }
