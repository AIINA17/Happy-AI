from voiceverification.db.connection import get_supabase


def append_verification_log(log_item: dict) -> None:
    sb = get_supabase()

    sb.table("face_verification_logs").insert(log_item).execute()


def get_verification_logs() -> list[dict]:
    sb = get_supabase()

    res = (
        sb.table("face_verification_logs")
        .select("*")
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []


def get_verification_logs_for_user(user_id: str, limit: int = 200) -> list[dict]:
    """Scoped variant for the per-user Analysis dashboard.

    get_verification_logs() stays global/unscoped for the existing
    operator-facing /face/verification-logs endpoint.
    """
    sb = get_supabase()

    res = (
        sb.table("face_verification_logs")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )

    return res.data or []


def clear_verification_logs() -> None:
    sb = get_supabase()

    # No WHERE clause needed conceptually ("delete all rows"), but
    # PostgREST requires an explicit filter — id is never null, so this
    # matches every row, mirroring the old LocalFaceStorage behavior of
    # wiping the whole log file.
    sb.table("face_verification_logs").delete().neq(
        "id", "00000000-0000-0000-0000-000000000000"
    ).execute()
