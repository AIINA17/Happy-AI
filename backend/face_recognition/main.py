from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import numpy as np

from face_recognition.arcface_model import ArcFaceModel
from face_recognition.face_service import FaceRecognitionService
from face_recognition.face_storage import LocalFaceStorage


app = FastAPI(
    title="Standalone ArcFace Face Recognition",
    description="Modul face recognition terpisah dari sistem utama HAPPY.",
    version="0.1.0"
)

arcface_model = ArcFaceModel()
face_service = FaceRecognitionService(threshold=0.45)
face_storage = LocalFaceStorage()


@app.get("/")
def root():
    return {
        "message": "Standalone ArcFace Face Recognition API",
        "status": "running"
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "module": "face_recognition",
        "model": "insightface-buffalo_l",
        "embedding_storage": "face_recognition/data/face_embeddings.json",
        "log_storage": "face_recognition/data/face_verification_logs.json"
    }


@app.post("/enroll-face")
async def enroll_face(
    user_id: str = Form(...),
    image: UploadFile = File(...)
):
    try:
        image_bytes = await image.read()
        embedding = arcface_model.extract_embedding(image_bytes)

        face_storage.save_embedding(
            user_id=user_id,
            embedding=embedding.tolist()
        )

        return {
            "status": "ENROLLMENT_SUCCESS",
            "user_id": user_id,
            "embedding_dim": len(embedding),
            "storage": "face_recognition/data/face_embeddings.json",
            "message": "Face embedding berhasil dibuat dan disimpan ke file lokal."
        }

    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan server: {str(error)}")


@app.post("/verify-face")
async def verify_face(
    user_id: str = Form(...),
    image: UploadFile = File(...)
):
    image_filename = image.filename

    try:
        reference_embedding_list = face_storage.get_embedding(user_id)

        if reference_embedding_list is None:
            result = {
                "verified": False,
                "status": "NO_FACE_ENROLLMENT",
                "user_id": user_id,
                "message": "User belum memiliki face embedding."
            }

            face_storage.append_verification_log({
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

        reference_embedding = np.array(reference_embedding_list, dtype=np.float32)

        result = face_service.verify(
            test_embedding=test_embedding,
            reference_embedding=reference_embedding
        )

        result["user_id"] = user_id
        result["storage"] = "local_json_file"

        face_storage.append_verification_log({
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
        face_storage.append_verification_log({
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
        face_storage.append_verification_log({
            "user_id": user_id,
            "image_filename": image_filename,
            "verified": False,
            "status": "SERVER_ERROR",
            "similarity": None,
            "threshold": face_service.threshold,
            "error_message": str(error)
        })

        raise HTTPException(status_code=500, detail=f"Terjadi kesalahan server: {str(error)}")


@app.get("/enrolled-users")
def get_enrolled_users():
    users = face_storage.list_users()

    return {
        "total": len(users),
        "users": users
    }


@app.delete("/enroll-face/{user_id}")
def delete_face_enrollment(user_id: str):
    deleted = face_storage.delete_embedding(user_id)

    if not deleted:
        return {
            "status": "NOT_FOUND",
            "message": "User tidak memiliki face enrollment."
        }

    return {
        "status": "DELETED",
        "user_id": user_id,
        "message": "Face enrollment berhasil dihapus dari file lokal."
    }


@app.get("/verification-logs")
def get_verification_logs():
    logs = face_storage.get_verification_logs()

    return {
        "total": len(logs),
        "logs": logs
    }


@app.delete("/verification-logs")
def clear_verification_logs():
    face_storage.clear_verification_logs()

    return {
        "status": "CLEARED",
        "message": "Seluruh log verifikasi wajah berhasil dihapus."
    }