import json
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime, timezone


class LocalFaceStorage:
    def __init__(
        self,
        embedding_path: str = "face_recognition/data/face_embeddings.json",
        log_path: str = "face_recognition/data/face_verification_logs.json"
    ):
        self.embedding_path = Path(embedding_path)
        self.log_path = Path(log_path)

        self.embedding_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)

        if not self.embedding_path.exists():
            self._save_json(self.embedding_path, {})

        if not self.log_path.exists():
            self._save_json(self.log_path, [])

    def _load_json(self, path: Path):
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)

    def _save_json(self, path: Path, data) -> None:
        with open(path, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=2)

    # =========================
    # Face embedding storage
    # =========================

    def save_embedding(self, user_id: str, embedding: List[float]) -> None:
        data = self._load_json(self.embedding_path)
        data[user_id] = embedding
        self._save_json(self.embedding_path, data)

    def get_embedding(self, user_id: str) -> Optional[List[float]]:
        data = self._load_json(self.embedding_path)
        return data.get(user_id)

    def delete_embedding(self, user_id: str) -> bool:
        data = self._load_json(self.embedding_path)

        if user_id not in data:
            return False

        del data[user_id]
        self._save_json(self.embedding_path, data)
        return True

    def list_users(self) -> List[str]:
        data = self._load_json(self.embedding_path)
        return list(data.keys())

    # =========================
    # Verification log storage
    # =========================

    def append_verification_log(self, log_item: dict) -> None:
        logs = self._load_json(self.log_path)

        log_item["timestamp"] = datetime.now(timezone.utc).isoformat()

        logs.append(log_item)

        self._save_json(self.log_path, logs)

    def get_verification_logs(self) -> List[dict]:
        return self._load_json(self.log_path)

    def clear_verification_logs(self) -> None:
        self._save_json(self.log_path, [])