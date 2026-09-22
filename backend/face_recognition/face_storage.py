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

    def save_embedding(self, user_id: str, label: str, embedding: List[float]) -> None:
        """Simpan embedding wajah beserta label dan timestamp."""
        data = self._load_json(self.embedding_path)
        data[user_id] = {
            "label": label,
            "embedding": embedding,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self._save_json(self.embedding_path, data)

    def get_embedding(self, user_id: str) -> Optional[List[float]]:
        """Ambil embedding wajah user. Support format lama (list) untuk backward compat."""
        data = self._load_json(self.embedding_path)
        entry = data.get(user_id)

        if entry is None:
            return None

        # Format lama: entry berupa list angka langsung
        if isinstance(entry, list):
            return entry

        # Format baru: entry berupa dict dengan key 'embedding'
        return entry.get("embedding")

    def get_face_info(self, user_id: str) -> Optional[dict]:
        """Ambil metadata wajah (label + created_at) untuk user tertentu."""
        data = self._load_json(self.embedding_path)
        entry = data.get(user_id)

        if entry is None:
            return None

        # Format lama: kasih default label
        if isinstance(entry, list):
            return {"label": "Wajah utama", "created_at": None}

        return {
            "label": entry.get("label", "Wajah utama"),
            "created_at": entry.get("created_at"),
        }

    def update_label(self, user_id: str, new_label: str) -> bool:
        """Ganti label wajah user. Return False kalau user belum enroll."""
        data = self._load_json(self.embedding_path)
        entry = data.get(user_id)

        if entry is None:
            return False

        # Migrasi otomatis kalau format lama
        if isinstance(entry, list):
            data[user_id] = {
                "label": new_label,
                "embedding": entry,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            entry["label"] = new_label

        self._save_json(self.embedding_path, data)
        return True

    def delete_embedding(self, user_id: str) -> bool:
        data = self._load_json(self.embedding_path)

        if user_id not in data:
            return False

        del data[user_id]
        self._save_json(self.embedding_path, data)
        return True

    def list_users(self) -> List[dict]:
        """Return daftar user beserta info wajah mereka."""
        data = self._load_json(self.embedding_path)
        result = []

        for user_id, entry in data.items():
            if isinstance(entry, list):
                result.append({
                    "user_id": user_id,
                    "label": "Wajah utama",
                    "created_at": None,
                })
            else:
                result.append({
                    "user_id": user_id,
                    "label": entry.get("label", "Wajah utama"),
                    "created_at": entry.get("created_at"),
                })

        return result

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