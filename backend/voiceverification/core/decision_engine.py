from dataclasses import dataclass
from enum import Enum

class Decision(Enum):
    VERIFIED = "VERIFIED"
    REPEAT = "REPEAT"
    DENIED = "DENIED"

@dataclass
class DecisionConfig:
    # Speaker verification thresholds
    voice_accept: float = 0.50
    voice_repeat: float = 0.30

    # Absolute minimum speaker score    
    abs_min_speaker: float = 0.35


    # Replay attack detection thresholds
    replay_deny: float  = 0.75
    replay_warn: float = 0.60

    # Combined score thresholds
    combined_accept: float = 0.52
    combined_repeat: float = 0.40


def decide(
        speaker_score: float,
        replay_prob: float,
        config: DecisionConfig | None = None,

):
    if config is None:
        config = DecisionConfig()
    
    # ===============================
    # HARD SECURITY GUARDS
    # ===============================
    if speaker_score < config.abs_min_speaker:
        return Decision.DENIED, "Speaker score too low"

    if replay_prob >= config.replay_deny:
        return Decision.DENIED, "Replay attack detected"

    # ===============================
    # REPLAY WARNING ZONE
    # ===============================
    if replay_prob >= config.replay_warn:
        return Decision.REPEAT, "Potential replay attack detected"

    # ===============================
    # SCORE FUSION
    # ==============================

    if speaker_score >= config.voice_accept:
        return Decision.VERIFIED, "Speaker verified successfully"

    if speaker_score >= config.voice_repeat:
        return Decision.REPEAT, "Uncertain verification, please repeat"

    return Decision.DENIED, "Speaker verification failed"


# def build_decision_config(
#     user: UserProfile | None,
#     base: DecisionConfig = DecisionConfig()
# ):
#     cfg = DecisionConfig(
#         voice_accept=base.voice_accept,
#         voice_repeat=base.voice_repeat,
#         replay_deny=base.replay_deny,
#         replay_warn=base.replay_warn,
#         combined_accept=base.combined_accept,
#         combined_repeat=base.combined_repeat,
#     )

#     # ===============================
#     # GLOBAL MODE
#     # ===============================
#     if user is None or user.n_samples < 5:
#         return cfg

#     # ===============================
#     # ADAPTIVE MODE
#     # ===============================
#     cfg.voice_accept = max(
#         user.mean_score - 2 * user.std_score,
#         cfg.voice_accept
#     )

#     cfg.voice_repeat = max(
#         user.mean_score - 3 * user.std_score,
#         cfg.voice_repeat
#     )

#     # Replay (dibatasi)
#     cfg.replay_warn = max(
#         0.45,
#         min(cfg.replay_warn, user.mean_replay + 0.1)
#     )

#     return cfg

