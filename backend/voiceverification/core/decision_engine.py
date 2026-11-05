from dataclasses import dataclass
from enum import Enum

class Decision(Enum):
    VERIFIED = "VERIFIED"
    REPEAT = "REPEAT"
    DENIED = "DENIED"

@dataclass
class DecisionConfig:
    voice_accept: float = 0.70
    voice_repeat: float = 0.55

    # Absolute minimum speaker score — raised with the main threshold so
    # a weak-but-present match still gets REPEAT rather than hard DENIED.
    abs_min_speaker: float = 0.50

    replay_deny: float  = 0.85
    replay_warn: float = 0.50

    # Combined score thresholds
    combined_accept: float = 0.52
    combined_repeat: float = 0.40
    behavior_repeat: float = 0.15

    behavior_min_samples: int = 5


def decide(
        speaker_score: float,
        replay_prob: float,
        behavior_score: float | None = None,
        behavior_n_samples: int = 0,
        config: DecisionConfig | None = None,
        trace: bool = False,

):
    if config is None:
        config = DecisionConfig()

    steps: list[dict] = []

    def _mark(check: str, passed: bool, detail: str) -> None:
        if trace:
            steps.append({"check": check, "passed": passed, "detail": detail})

    def _return(decision: Decision, reason: str):
        return (decision, reason, steps) if trace else (decision, reason)

    passed = speaker_score >= config.abs_min_speaker
    _mark(
        "abs_min_speaker", passed,
        f"speaker_score={speaker_score:.3f} >= abs_min_speaker={config.abs_min_speaker}",
    )
    if not passed:
        return _return(Decision.DENIED, "Speaker score too low")
    passed = replay_prob < config.replay_deny
    _mark(
        "replay_deny", passed,
        f"replay_prob={replay_prob:.5f} < replay_deny={config.replay_deny}",
    )
    if not passed:
        return _return(Decision.REPEAT, "Replay attack detected, please repeat")

    passed = replay_prob < config.replay_warn
    _mark(
        "replay_warn", passed,
        f"replay_prob={replay_prob:.5f} < replay_warn={config.replay_warn}",
    )
    if not passed:
        return _return(Decision.REPEAT, "Potential replay attack detected")


    passed = speaker_score >= config.voice_accept
    _mark(
        "voice_accept", passed,
        f"speaker_score={speaker_score:.3f} >= voice_accept={config.voice_accept}",
    )
    if passed:
        behavior_checked = (
            behavior_score is not None
            and behavior_n_samples >= config.behavior_min_samples
        )
        behavior_passed = not (
            behavior_checked and behavior_score < config.behavior_repeat
        )
        _mark(
            "behavior_gate", behavior_passed,
            (
                f"behavior_score={behavior_score:.3f} >= behavior_repeat={config.behavior_repeat}"
                if behavior_checked
                else "skipped (no behavior profile or not enough history yet)"
            ),
        )
        if not behavior_passed:
            return (
                _return(
                    Decision.REPEAT,
                    "Voice matched but behavior pattern is unusual, please repeat",
                )
            )
        return _return(Decision.VERIFIED, "Speaker verified successfully")

    passed = speaker_score >= config.voice_repeat
    _mark(
        "voice_repeat", passed,
        f"speaker_score={speaker_score:.3f} >= voice_repeat={config.voice_repeat}",
    )
    if passed:
        return _return(Decision.REPEAT, "Uncertain verification, please repeat")

    return _return(Decision.DENIED, "Speaker verification failed")

