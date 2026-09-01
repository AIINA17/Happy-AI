import cv2
import numpy as np
from insightface.app import FaceAnalysis


class ArcFaceModel:
    def __init__(self):
        self.app = FaceAnalysis(
            name="buffalo_l",
            providers=["CPUExecutionProvider"]
        )

        # ctx_id=0 tetap aman untuk CPUExecutionProvider.
        # det_size menentukan ukuran input untuk deteksi wajah.
        self.app.prepare(ctx_id=0, det_size=(640, 640))

    def extract_embedding(self, image_bytes: bytes) -> np.ndarray:
        image_array = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Gambar tidak valid atau tidak dapat dibaca.")

        faces = self.app.get(image)

        if len(faces) == 0:
            raise ValueError("Tidak ada wajah terdeteksi pada gambar.")

        if len(faces) > 1:
            raise ValueError("Terdeteksi lebih dari satu wajah. Gunakan gambar dengan satu wajah saja.")

        embedding = faces[0].embedding.astype(np.float32)

        # Normalisasi agar cosine similarity cukup dihitung dengan dot product.
        embedding = embedding / np.linalg.norm(embedding)

        return embedding