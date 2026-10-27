from datetime import datetime, timezone
import librosa
import numpy as np

from typing import List, Optional

from voiceverification.core.behavior_profile import BehaviorProfile
from voiceverification.models.speaker_verifier import SpeakerVerifier
from voiceverification.core.asvspoof import compute_score, warm_up as warm_up_asvspoof
from voiceverification.core.decision_engine import decide, Decision, DecisionConfig
from voiceverification.core.trusted_update import TrustedUpdatePolicy
from voiceverification.core.behavior_scoring import compute_behavior_score


# Below this much *speech* (silence trimmed), a speaker embedding is too
# unstable to judge — see the REPEAT branch in verify_against_multiple_embeddings.
MIN_SPEECH_SEC = 2.0


def _speech_duration(wav_path: str) -> float:
    y, sr = librosa.load(wav_path, sr=16000, mono=True)
    if len(y) == 0:
        return 0.0
    trimmed, _ = librosa.effects.trim(y, top_db=25)
    return len(trimmed) / sr


class BiometricService:
    def __init__(self, device="cpu"):
        self.speaker = SpeakerVerifier(device)
        self.policy = TrustedUpdatePolicy()
        warm_up_asvspoof()
        print("Biometric ready.")

    def verify_against_multiple_embeddings(
        self,
        *,
        live_wav: str,
        enroll_embeddings: List[np.ndarray],
        user_id: Optional[str] = None,
        behavior_profiles: Optional[dict[str, BehaviorProfile]] = None,
        is_retry: bool = False,
        explain: bool = False,
    ) -> dict:
        behavior_profiles = behavior_profiles or {}
        config = DecisionConfig()

        # 1. Extract live embedding
        live_emb = self.speaker.extract_embedding(live_wav)

        scores = []
        for prof in enroll_embeddings:
            score = self.speaker.compare_embeddings(
                live_emb,
                prof["embedding"]
            )
            scores.append(score)

        best_idx = int(np.argmax(scores))
        best_score = float(scores[best_idx])
        best_label = enroll_embeddings[best_idx]["label"]

        # 2. Spoof Score
        spoof_prob, spoof_breakdown = compute_score(live_wav)

        # 3. Decision
        # Too little speech makes the embedding unreliable rather than wrong:
        # on identical audio the score falls to ~0.17 at 0.5s and ~0.39 at
        # 1.4s, well inside impostor territory. Denying that punishes the
        # speaker for answering briefly, so ask for another take instead.
        speech_sec = _speech_duration(live_wav)

        behavior_score = None
        pitch, rate = None, None
        z_pitch = z_rate = None
        behavior_profile = behavior_profiles.get(best_label)
        # Captured now, before step 4 below can reassign/mutate
        # behavior_profile — this is the n_samples decide() actually saw,
        # not whatever the profile looks like after a post-decision update.
        behavior_n_samples_at_decision = behavior_profile.n_samples if behavior_profile else 0
        updated_behavior_profile: BehaviorProfile | None = None
        decision_steps: list[dict] | None = [
            {
                "check": "min_speech_sec",
                "passed": speech_sec >= MIN_SPEECH_SEC,
                "detail": f"speech_sec={speech_sec:.2f} >= min_speech_sec={MIN_SPEECH_SEC}",
            }
        ] if explain else None

        if speech_sec < MIN_SPEECH_SEC:
            decision = Decision.REPEAT
            reason = "Suaranya terlalu singkat, coba ucapkan satu kalimat penuh"
        else:
            # Pitch/rate (and, if there's enough history, behavior_score)
            # are computed up front for every attempt now — decide() needs
            # them to decide whether to downgrade a voiceprint match that
            # looks unusual against this user's own history, not just to
            # log them after the fact.
            y, sr = librosa.load(live_wav, sr=16000)
            pitch = float(np.nanmean(librosa.yin(y, fmin=50, fmax=300, sr=sr)))
            rate = float(len(y) / sr)

            if behavior_profile is not None and behavior_profile.n_samples > 0:
                behavior_score, z_pitch, z_rate, _, _ = compute_behavior_score(
                    pitch,
                    rate,
                    behavior_profile
                )

            decide_result = decide(
                speaker_score=best_score,
                replay_prob=spoof_prob,
                behavior_score=behavior_score,
                behavior_n_samples=behavior_n_samples_at_decision,
                config=config,
                trace=explain,
            )
            if explain:
                decision, reason, cascade_steps = decide_result
                decision_steps.extend(cascade_steps)
            else:
                decision, reason = decide_result

        # 4. Trusted adaptive update — only for a genuinely VERIFIED result
        # (a behavior-triggered downgrade to REPEAT above means `decision`
        # is no longer VERIFIED here, so should_update's own decision check
        # already skips it; no separate handling needed).
        if decision == Decision.VERIFIED:
            if behavior_profile is None:
                behavior_profile = BehaviorProfile()
                behavior_profile.update(pitch, rate, datetime.now(timezone.utc))
                updated_behavior_profile = behavior_profile
            elif self.policy.should_update(
                decision=decision.value,
                speaker_score=best_score,
                spoof_prob=spoof_prob,
                behavior_score=behavior_score,
                n_samples=behavior_profile.n_samples,
                z_pitch=z_pitch,
                z_rate=z_rate,
                last_update_time=behavior_profile.last_update_ts,
                is_retry=is_retry,
            ):
                behavior_profile.update(pitch, rate, datetime.now(timezone.utc))
                updated_behavior_profile = behavior_profile

        # 5. Log
        print(
            f"🎯 VERIFY | label='{best_label}' "
            f"| score={best_score:.3f} "
            f"| spoof={spoof_prob:.3f} "
            f"| decision={decision.value}"
        )


        result = {
            "verified": decision == Decision.VERIFIED,
            "decision": decision.value,
            "reason": reason,

            "score": best_score,
            "spoof_prob": spoof_prob,

            "best_index": best_idx,
            "best_label": best_label,
            "all_scores": scores,

            "pitch": pitch,
            "rate": rate,
            "behavior_score": behavior_score,

            "updated_behavior_profile": updated_behavior_profile,
        }

        if explain:
            result.update({
                "live_embedding": live_emb,
                "matched_enroll_embedding": enroll_embeddings[best_idx]["embedding"],
                "spoof_breakdown": spoof_breakdown,
                "speech_sec": speech_sec,
                "z_pitch": z_pitch,
                "z_rate": z_rate,
                "behavior_n_samples": behavior_n_samples_at_decision,
                "decision_config": config,
                "decision_steps": decision_steps,
            })

        return result
