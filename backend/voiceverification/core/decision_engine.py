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

