from voiceverification.db.connection import get_supabase


def append_verification_log(log_item: dict) -> None:
    sb = get_supabase()

    sb.table("voice_verification_logs").insert(log_item).execute()


def get_verification_logs(user_id: str, limit: int = 200) -> list[dict]:
    sb = get_supabase()

    res = (
        sb.table("voice_verification_logs")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    return res.data or []
