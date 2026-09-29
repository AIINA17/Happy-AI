"""Supabase Storage access for per-enrollment spectrogram images."""

from .connection import get_supabase

BUCKET = "spectrograms"
SIGNED_URL_TTL = 3600


def _object_path(user_id: str, profile_id: str) -> str:
    return f"{user_id}/{profile_id}.png"


def _ensure_bucket():
    sb = get_supabase()

    if any(bucket.id == BUCKET for bucket in sb.storage.list_buckets()):
        return

    sb.storage.create_bucket(BUCKET, options={"public": False})


def save_spectrogram(user_id: str, profile_id: str, png: bytes):
    _ensure_bucket()

    get_supabase().storage.from_(BUCKET).upload(
        _object_path(user_id, profile_id),
        png,
        {"content-type": "image/png", "upsert": "true"},
    )


def get_spectrogram_url(user_id: str, profile_id: str) -> str | None:
    """Signed URL for an enrollment's spectrogram, or None if it has none.

    Enrollments created before this feature existed have no stored image.
    """
    try:
        res = (
            get_supabase()
            .storage.from_(BUCKET)
            .create_signed_url(_object_path(user_id, profile_id), SIGNED_URL_TTL)
        )
    except Exception:
        return None

    return res.get("signedURL") or res.get("signedUrl")


def delete_spectrogram(user_id: str, profile_id: str):
    get_supabase().storage.from_(BUCKET).remove([_object_path(user_id, profile_id)])
