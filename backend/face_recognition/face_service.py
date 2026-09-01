import numpy as np


class FaceRecognitionService:
    def __init__(self, threshold: float = 0.45):
        self.threshold = threshold

    def cosine_similarity(self, embedding_a: np.ndarray, embedding_b: np.ndarray) -> float:
        embedding_a = embedding_a / np.linalg.norm(embedding_a)
        embedding_b = embedding_b / np.linalg.norm(embedding_b)

        return float(np.dot(embedding_a, embedding_b))

    def verify(self, test_embedding: np.ndarray, reference_embedding: np.ndarray) -> dict:
        similarity = self.cosine_similarity(test_embedding, reference_embedding)

        if similarity >= self.threshold:
            return {
                "verified": True,
                "status": "VERIFIED",
                "similarity": similarity,
                "threshold": self.threshold
            }

        return {
            "verified": False,
            "status": "DENIED",
            "similarity": similarity,
            "threshold": self.threshold
        }