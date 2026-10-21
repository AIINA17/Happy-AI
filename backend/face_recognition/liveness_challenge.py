import secrets
import time
from dataclasses import dataclass

# Challenge types mirror FaceLivenessCapture.tsx's CHALLENGES — the server
# picks which one the client must perform (instead of the client picking
# its own), so an attacker scripting a replay can't just always be ready
# with one pre-recorded gesture.
CHALLENGE_TYPES = ("blink", "mouth", "turn")

# Must comfortably cover FaceLivenessCapture.tsx's LIVENESS_TIMEOUT_MS
# (15s) plus the capture/upload round trip.
CHALLENGE_TTL_SECONDS = 25


@dataclass
class _Challenge:
    user_id: str
    challenge_type: str
    expires_at: float


# Single-process, in-memory store. Fine for the current deployment (one
# backend container, see docker-compose.yml) — if this app is ever scaled
# to multiple workers/instances, this needs to move to something shared
# (e.g. Supabase or Redis) instead.
_challenges: dict[str, _Challenge] = {}


def _prune_expired() -> None:
    now = time.time()
    expired = [token for token, c in _challenges.items() if c.expires_at < now]
    for token in expired:
        _challenges.pop(token, None)


def issue_challenge(user_id: str) -> tuple[str, str]:
    """Creates a single-use, short-lived liveness challenge for user_id.

    Returns (liveness_token, challenge_type). The token must accompany the
    capture sent to /verify-face within CHALLENGE_TTL_SECONDS, for the same
    user_id, or it is rejected.
    """
    _prune_expired()
    token = secrets.token_urlsafe(24)
    challenge_type = secrets.choice(CHALLENGE_TYPES)
    _challenges[token] = _Challenge(
        user_id=user_id,
        challenge_type=challenge_type,
        expires_at=time.time() + CHALLENGE_TTL_SECONDS,
    )
    return token, challenge_type


def consume_challenge(token: str, user_id: str) -> str | None:
    """Validates and consumes a liveness challenge token.

    Returns the challenge_type on success, or None if the token is missing,
    expired, or was issued to a different user. Always removes the token
    (even on failure) so the same token can never be retried twice.
    """
    challenge = _challenges.pop(token, None)
    if challenge is None:
        return None
    if challenge.expires_at < time.time():
        return None
    if challenge.user_id != user_id:
        return None
    return challenge.challenge_type
