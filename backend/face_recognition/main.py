from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import numpy as np

from face_recognition.arcface_model import ArcFaceModel
from face_recognition.face_service import FaceRecognitionService
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


@router.post("/verify-face")
async def verify_face(
    user_id: str = Form(...),
    image: UploadFile = File(...)
):
    image_filename = image.filename

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
