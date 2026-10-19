from voiceverification.db.connection import get_supabase
from voiceverification.utils.crypto import decrypt, encrypt


def save_ecommerce_account(user_id: str, username: str, password: str, source: str) -> None:
    sb = get_supabase()
    sb.table("ecommerce_accounts").upsert({
        "user_id": user_id,
        "source": source,
        "username": username,
        "encrypted_password": encrypt(password),
    }, on_conflict="user_id,source").execute()


def load_ecommerce_account(user_id: str, source: str) -> dict | None:
    """Returns {"username": str, "password": str} (decrypted) or None."""
    sb = get_supabase()
    res = (
        sb.table("ecommerce_accounts")
        .select("username, encrypted_password")
        .eq("user_id", user_id)
        .eq("source", source)
        .execute()
    )

    if not res.data:
        return None

    row = res.data[0]
    return {
        "username": row["username"],
        "password": decrypt(row["encrypted_password"]),
    }


def has_ecommerce_account(user_id: str, source: str) -> dict | None:
    """Returns {"username": str} (no password) or None — safe for API responses."""
    sb = get_supabase()
    res = (
        sb.table("ecommerce_accounts")
        .select("username")
        .eq("user_id", user_id)
        .eq("source", source)
        .execute()
    )
    return res.data[0] if res.data else None


def delete_ecommerce_account(user_id: str, source: str) -> None:
    sb = get_supabase()
    (
        sb.table("ecommerce_accounts")
        .delete()
        .eq("user_id", user_id)
        .eq("source", source)
        .execute()
    )
