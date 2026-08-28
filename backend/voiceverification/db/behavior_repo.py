from datetime import datetime, timezone

from core.behavior_profile import BehaviorProfile
from db.connection import get_supabase

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

    last_ts = row["last_update_ts"]
    if isinstance(last_ts, str):
        last_ts = datetime.fromisoformat(last_ts)
    elif isinstance(last_ts, (int, float)):
        last_ts = datetime.fromtimestamp(last_ts, tz=timezone.utc)
    elif last_ts is None:
        last_ts = datetime.now(timezone.utc)

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
