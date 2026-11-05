"""Shared face-pipeline trace extraction — real per-stage output from
insightface's buffalo_l FaceAnalysis, used by both the offline capture
script (analysis/capture_face_traces.py) and the live
POST /face/verify-face/explain endpoint (main.py), so the two can never
drift into producing a different shape.
"""

from __future__ import annotations

import base64

import cv2
import numpy as np
from insightface.utils import face_align

from face_recognition.arcface_model import ArcFaceModel, select_primary_face


def decode_image(image_bytes: bytes) -> np.ndarray:
    data = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Gambar tidak valid atau tidak dapat dibaca.")
    return img


def b64_jpeg(img: np.ndarray, *, max_width: int | None = None, quality: int = 80) -> str:
    if max_width and img.shape[1] > max_width:
        scale = max_width / img.shape[1]
        img = cv2.resize(img, (max_width, int(img.shape[0] * scale)))
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()


def extract_face_trace(model: ArcFaceModel, img: np.ndarray, *, source_file: str | None) -> dict:
    """Runs the real buffalo_l pipeline on one already-decoded image and
    returns every stage's real output — bbox/score from detection, 5-pt
    keypoints from landmark localization, the actual 112x112 aligned crop
    (via insightface's own face_align.norm_crop, the same call the
    recognition model makes internally), and the normalized embedding.

    Returns the raw embedding ndarray under "_embedding" (not JSON-safe —
    see json_safe() below) so callers can run similarity math on it
    before stripping it for serialization.
    """
    faces = model.app.get(img)
    if len(faces) == 0:
        raise ValueError("Tidak ada wajah terdeteksi pada gambar.")
    face = select_primary_face(faces) if len(faces) > 1 else faces[0]

    aligned = face_align.norm_crop(img, landmark=face.kps, image_size=112, mode="arcface")
    embedding = face.embedding.astype(np.float32)
    embedding = embedding / np.linalg.norm(embedding)

    return {
        "source_file": source_file,
        "image_shape": list(img.shape),
        "image_preview": b64_jpeg(img, max_width=240),
        "detection": {
            "bbox": [round(float(v), 1) for v in face.bbox],
            "det_score": round(float(face.det_score), 4),
        },
        "landmark": {
            "kps": [[round(float(x), 1), round(float(y), 1)] for x, y in face.kps],
            "landmark_2d_106_count": int(face.landmark_2d_106.shape[0]),
        },
        "alignment": {
            "aligned_preview": b64_jpeg(aligned, quality=85),
            "size": [112, 112],
        },
        "embedding_dim": int(embedding.shape[0]),
        "_embedding": embedding,
    }


def json_safe(trace: dict) -> dict:
    """Strips the raw ndarray and replaces it with a small preview — the
    shape frontend/components/pipeline-flow/faceTypes.ts's FaceStageData
    expects."""
    embedding = trace["_embedding"]
    return {k: v for k, v in trace.items() if k != "_embedding"} | {
        "embedding_preview": embedding[:16].tolist(),
    }
