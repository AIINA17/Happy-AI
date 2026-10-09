from datetime import datetime, timezone

import numpy as np

from voiceverification.db.connection import get_supabase


def get_embedding(user_id: str) -> np.ndarray | None:
    sb = get_supabase()

    res = (
        sb.table("face_profiles")
        .select("embedding")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )

    if not res or not res.data:
        return None

    return np.array(res.data["embedding"], dtype=np.float32)


def save_embedding(user_id: str, embedding: np.ndarray) -> None:
    sb = get_supabase()

    sb.table("face_profiles").upsert(
        {
            "user_id": user_id,
            "embedding": embedding.tolist(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    ).execute()


def delete_embedding(user_id: str) -> bool:
    sb = get_supabase()

    res = (
        sb.table("face_profiles")
        .delete()
        .eq("user_id", user_id)
        .execute()
    )

    return len(res.data or []) > 0


def list_enrolled_users() -> list[str]:
    sb = get_supabase()

    res = sb.table("face_profiles").select("user_id").execute()

    return [row["user_id"] for row in (res.data or [])]
