from dataclasses import dataclass
from enum import Enum

class Decision(Enum):
    VERIFIED = "VERIFIED"
    REPEAT = "REPEAT"
    DENIED = "DENIED"

@dataclass
class DecisionConfig:
    # Speaker verification thresholds
    voice_accept: float = 0.45
    voice_repeat: float = 0.30

    # Absolute minimum speaker score    
    abs_min_speaker: float = 0.35


    # Replay attack detection thresholds.
    # Recalibrated for the pretrained wav2vec2 anti-spoof model in
    # core/asvspoof.py (MelodyMachine/Deepfake-audio-detection-V2), which
    # replaced the old 3-feature classifier. Measured on
    # dataset/{genuine,impostor,spoof} (n=37): live samples cluster at
    # ~0.00002 fake_prob, spoof samples cluster at ~0.9999 — a wide gap with
    # almost nothing in between, so these thresholds sit safely in the
    # middle of that gap rather than at the exact EER crossover (which was
    # ~0). The old values (0.60/0.75) were tuned for a differently-scaled
    # score and don't carry over to this model.
    replay_deny: float  = 0.85
    replay_warn: float = 0.50

    # Combined score thresholds
    combined_accept: float = 0.52
    combined_repeat: float = 0.40

    # Behavior-score gate on an otherwise-VERIFIED decision (see
    # core/behavior_scoring.py). compute_behavior_score combines two
    # independent Gaussian-kernel terms (0.5 * (score_pitch + score_rate)),
    # each exp(-0.5 * z**2) — so this threshold is deliberately loose: at
    # z=2 (TrustedUpdatePolicy's own max_zscore for *allowing* an adaptive
    # update) a single term is already down to ~0.135, meaning both pitch
    # AND rate have to be simultaneously ~2 std devs off from this user's
    # history (not just an off day on one of them) before this fires.
    behavior_repeat: float = 0.15

    # Below this many historical samples, the profile's own mean/std are
    # too thin to trust as a baseline — mirrors TrustedUpdatePolicy's
    # min_samples, which gates adaptive updates for the same reason.
    behavior_min_samples: int = 5


def decide(
        speaker_score: float,
        replay_prob: float,
        behavior_score: float | None = None,
        behavior_n_samples: int = 0,
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
        # Behavior anomaly only ever *downgrades* an otherwise-VERIFIED
        # voiceprint match to REPEAT — it never denies on its own, and it's
        # skipped entirely (behavior_score is None, or the profile is too
        # new) rather than treated as a failure. Pitch/speech-rate drift
        # with mood, illness, or environment, so this is a soft "ask again"
        # safety net, not a second identity check.
        if (
            behavior_score is not None
            and behavior_n_samples >= config.behavior_min_samples
            and behavior_score < config.behavior_repeat
        ):
            return (
                Decision.REPEAT,
                "Voice matched but behavior pattern is unusual, please repeat",
            )
        return Decision.VERIFIED, "Speaker verified successfully"

    if speaker_score >= config.voice_repeat:
        return Decision.REPEAT, "Uncertain verification, please repeat"

    return Decision.DENIED, "Speaker verification failed"

