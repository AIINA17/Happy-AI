from __future__ import annotations

from datetime import datetime, timezone

from voiceverification.core.behavior_profile import BehaviorProfile
from voiceverification.db.connection import get_supabase


def _parse_ts(value) -> datetime | None:
    """
    Supabase mengembalikan kolom timestamp sebagai string ISO 8601
    (misal '2026-10-18T08:33:33.000+00:00'). Parse ke datetime object
    dengan tz-aware (UTC). Return None kalau nilainya kosong.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        # 'Z' bukan format yang dikenali fromisoformat sampai Python 3.11
        if isinstance(value, str) and value.endswith("Z"):
            value = value[:-1] + "+00:00"
        dt = datetime.fromisoformat(value)
        # Kalau naive, anggap UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def load_behavior_profile(user_id: str, label:str) -> BehaviorProfile:
    sb = get_supabase()

    res = (
        sb.table("behavior_profiles")
        .select("*")
        .eq("user_id", user_id)
        .eq("label", label)
        .execute()
    )

    if not res.data:
        return None

    row = res.data[0]

    last_ts = _parse_ts(row.get("last_update_ts"))

    return BehaviorProfile(
        n_samples=row["n_samples"],
        mean_pitch=row["mean_pitch"],
        var_pitch=row["var_pitch"],
        mean_rate=row["mean_rate"],
        var_rate=row["var_rate"],
        last_update_ts=last_ts,
    )


def save_behavior_profile(user_id: str, label: str, profile: BehaviorProfile):
    sb = get_supabase()

    sb.table("behavior_profiles").upsert(
        {
            "user_id": user_id,
            "label": label,
            "n_samples": profile.n_samples,
            "mean_pitch": profile.mean_pitch,
            "var_pitch": profile.var_pitch,
            "mean_rate": profile.mean_rate,
            "var_rate": profile.var_rate,
            "last_update_ts": profile.last_update_ts.isoformat(),

        },
    ).execute()
