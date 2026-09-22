from datetime import datetime
from uuid import UUID

from voiceverification.db.connection import get_supabase

def insert_conversation_log(
        session_id: UUID,
        role: str,
        content: str,
):
    """
    Insert a conversation log into the database.
    """
    supabase = get_supabase()
    try:
        supabase.table("conversation_logs").insert({
            "session_id": str(session_id),
            "role": role,
            "content": content,
        }).execute()
    except Exception as e:
        print(f"Error inserting conversation log: {e}")
        raise
