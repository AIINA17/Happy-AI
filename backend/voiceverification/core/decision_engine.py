from dataclasses import dataclass
from enum import Enum

class Decision(Enum):
    VERIFIED = "VERIFIED"
    REPEAT = "REPEAT"
    DENIED = "DENIED"

@dataclass
class DecisionConfig:
    # Speaker verification thresholds.
    # Raised from (0.45 / 0.30) to (0.70 / 0.55) to align with the stricter
    # dashboard display threshold the user asked for. The silence-trim +
    # enrollment-duration guard added in audio.py + server.py pushes
    # legitimate same-speaker scores from the old 0.42-0.50 range up into
    # 0.70-0.85, so these higher thresholds are reachable in practice while
    # noticeably tightening the impostor gate.
    voice_accept: float = 0.70
    voice_repeat: float = 0.55

    # Absolute minimum speaker score — raised with the main threshold so
    # a weak-but-present match still gets REPEAT (ask again) rather than
    # a hard DENIED when it's just a quiet / short clip.
    abs_min_speaker: float = 0.50


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
    #
    # That n=37 gap does NOT hold over the real browser/LiveKit capture
    # channel (webm/opus + WebRTC AEC/NS/AGC, vs. the clean local
    # recordings these were calibrated on): production voice_verification_logs
    # (2026-10 investigation) show genuinely-matching speakers landing at
    # fake_prob >= 0.95 — indistinguishable from the n=37 spoof cluster —
    # on a large fraction of real attempts, with no usable gap to re-draw a
    # cutoff in. Since the model gives no reliable separation on this
    # channel, replay_deny no longer hard-denies on its own (see decide()) —
    # it only escalates to REPEAT, same as replay_warn. The two tiers are
    # kept apart (and reasons stay distinct) for logging/analytics, but
    # both now give the speaker another take rather than punishing a
    # probable channel artifact as if it were a confirmed attack.
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
        trace: bool = False,

):
    if config is None:
        config = DecisionConfig()

    # Step-by-step cascade log for the /pipeline explainer page. Strictly
    # opt-in: with trace=False (every existing caller, incl. the ~15
    # call sites in tests/test_decision_engine.py that unpack a 2-tuple),
    # behavior and return arity are byte-identical to before this param
    # existed.
    steps: list[dict] = []

    def _mark(check: str, passed: bool, detail: str) -> None:
        if trace:
            steps.append({"check": check, "passed": passed, "detail": detail})

    def _return(decision: Decision, reason: str):
        return (decision, reason, steps) if trace else (decision, reason)

    # ===============================
    # HARD SECURITY GUARDS
    # ===============================
    passed = speaker_score >= config.abs_min_speaker
    _mark(
        "abs_min_speaker", passed,
        f"speaker_score={speaker_score:.3f} >= abs_min_speaker={config.abs_min_speaker}",
    )
    if not passed:
        return _return(Decision.DENIED, "Speaker score too low")

    # Was a hard DENIED here — demoted to REPEAT (see DecisionConfig.replay_deny's
    # comment): on the real capture channel this fires on genuine speakers too
    # often to treat as a confirmed attack on a single take. A sustained pattern
    # of this across retries still ends in the caller's own 3-strikes fallback
    # (agent.py's MAX_VERIFY_ATTEMPTS), so repeat offenders still get stopped —
    # just not on one noisy reading.
    passed = replay_prob < config.replay_deny
    _mark(
        "replay_deny", passed,
        f"replay_prob={replay_prob:.5f} < replay_deny={config.replay_deny}",
    )
    if not passed:
        return _return(Decision.REPEAT, "Replay attack detected, please repeat")

    # ===============================
    # REPLAY WARNING ZONE
    # ===============================
    passed = replay_prob < config.replay_warn
    _mark(
        "replay_warn", passed,
        f"replay_prob={replay_prob:.5f} < replay_warn={config.replay_warn}",
    )
    if not passed:
        return _return(Decision.REPEAT, "Potential replay attack detected")

    # ===============================
    # SCORE FUSION
    # ==============================

    passed = speaker_score >= config.voice_accept
    _mark(
        "voice_accept", passed,
        f"speaker_score={speaker_score:.3f} >= voice_accept={config.voice_accept}",
    )
    if passed:
        # Behavior anomaly only ever *downgrades* an otherwise-VERIFIED
        # voiceprint match to REPEAT — it never denies on its own, and it's
        # skipped entirely (behavior_score is None, or the profile is too
        # new) rather than treated as a failure. Pitch/speech-rate drift
        # with mood, illness, or environment, so this is a soft "ask again"
        # safety net, not a second identity check.
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

