import os

from fastapi import HTTPException, Request
from supabase import create_client


_supabase_auth_client = None


def _get_supabase_auth_client():
    """Client for verifying Supabase JWTs (uses publishable/anon key).

    Keep this separate from the service-role client used for DB access.
    """

    global _supabase_auth_client
    if _supabase_auth_client is not None:
        return _supabase_auth_client

    supabase_url = os.getenv("SUPABASE_URL")
    # In this repo, frontend uses NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable).
    # Backend `.env` provides SUPABASE_KEY.
    supabase_key = os.getenv("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        raise RuntimeError("Supabase auth env vars not loaded")

    _supabase_auth_client = create_client(supabase_url, supabase_key)
    return _supabase_auth_client


def get_user_id_from_request(request: Request) -> str:
    """
    Extract & verify Supabase JWT from Authorization header.
    Return auth.users.id (UUID).
    """
    auth_header = request.headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = auth_header.replace("Bearer ", "")

    try:
        supabase_auth = _get_supabase_auth_client()
        res = supabase_auth.auth.get_user(token)
        user = res.user

        if user is None:
            raise HTTPException(status_code=401, detail="Invalid token")

        return user.id

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")
