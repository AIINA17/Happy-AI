from __future__ import annotations

from datetime import datetime, timezone
import re

from voiceverification.core.behavior_profile import BehaviorProfile
from .connection import get_supabase


_TZ_RE = re.compile(r"([+-]\d\d:\d\d)$")


def _parse_ts(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, (int, float)):
        dt = datetime.fromtimestamp(value, tz=timezone.utc)
    elif value is None:
        dt = datetime.now(timezone.utc)
    elif isinstance(value, str):
        s = value.strip()
        # Supabase/PostgREST sometimes returns 'Z'
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"

        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            # Pad fractional seconds to 6 digits if needed.
            # Example failing input: 2026-05-14T07:40:30.77031+00:00
            t_pos = s.find("T")
            plus = s.rfind("+")
            minus = s.rfind("-")
            offset_pos = max(plus, minus)
            if offset_pos > t_pos:
                main, offset = s[:offset_pos], s[offset_pos:]
            else:
                main, offset = s, ""

            if "." in main:
                head, frac = main.split(".", 1)
                frac_digits = "".join(ch for ch in frac if ch.isdigit())
                frac_digits = (frac_digits + "000000")[:6]
                main = f"{head}.{frac_digits}"

            dt = datetime.fromisoformat(main + offset)
    else:
        dt = datetime.now(timezone.utc)

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt

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
