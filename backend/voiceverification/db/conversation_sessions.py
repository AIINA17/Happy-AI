from uuid import UUID

from voiceverification.db.connection import get_supabase

def create_conversation_session(
        user_id: str,
        label: str
) -> UUID:
    """
    Create a new conversation session in the database.
    """
    supabase = get_supabase()
    response = (
        supabase
        .table("conversation_sessions")
        .insert({
            "user_id": user_id,
            "label": label,
        })
        .execute()
    )

    # Supabase return inserted row
    session = response.data[0]
    return UUID(session["id"])

def update_conversation_session_label(session_id, new_label):
    sb = get_supabase()
    res = (
        sb.table("conversation_sessions")
        .update({"label": new_label})
        .eq("id", session_id)
        .execute()
    )

    if not res.data:
        raise Exception("Session not found or update failed")

    return res.data