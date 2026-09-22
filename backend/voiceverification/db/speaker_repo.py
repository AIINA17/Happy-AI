import numpy as np

from voiceverification.db.connection import get_supabase

def load_embedding(user_id: str) -> np.ndarray | None:
    sb = get_supabase()

    res = (
        sb.table("speaker_profiles")
        .select("embedding")
        .eq("user_id", user_id)
        .single()
        .execute()
    )

    if not res.data:
        return None

    return np.array(res.data["embedding"], dtype=np.float32)


def save_embedding(user_id: str, emb: np.ndarray, label: str):
    sb = get_supabase()

    sb.table("speaker_profiles").insert(
        {
            "user_id": user_id,
            "embedding": emb.tolist(),
            "label": label,
        },
    ).execute()

def load_all_embeddings(user_id: str) -> list[np.ndarray]:
    sb = get_supabase()

    res = (
        sb.table("speaker_profiles")
        .select("id, embedding, label, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )

    profiles = []
    for row in res.data:
        profiles.append({
            "embedding": np.array(row["embedding"], dtype=np.float32),
            "label": row["label"]
        })

    return profiles


def count_enrollments(user_id: str) -> int:
    sb = get_supabase()
    res = (
        sb.table("speaker_profiles")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    return res.count or 0
