from dataclasses import dataclass
from time import time

@dataclass
class TrustedUpdatePolicy:
    min_speaker_score: float = 0.65
    max_spoof_prob: float = 0.20
    min_behavior_score: float = 0.60

    min_samples: int = 5

    min_update_interval: int = 60 * 60  # seconds

    max_zscore: float = 2.0

    def should_update(
            self,
            *,
            decision: str,
            speaker_score: float,
            spoof_prob: float,
            behavior_score: float,
            n_samples: int,
            z_pitch: float,
            z_rate: float,
            last_update_time: float | None,
            is_retry: bool,
    ) -> bool:
        
        if behavior_score is None:
            return False  # skip update
        # 1. Check if the decision is VERIFIED
        if decision != "VERIFIED":
            return False
        
        # 2. Strong identity & low spoof
        if speaker_score < self.min_speaker_score:
            return False
        if spoof_prob > self.max_spoof_prob:
            return False
        
        # 3. Behavior konsisten
        if behavior_score < self.min_behavior_score:
            return False
        
        # 4. Sufficient samples
        if n_samples < self.min_samples and n_samples != 0:
            return False
        
        # 5. Retry checks
        if is_retry:
            return False
        
        # 6. Time since last update
        now = time()
        if last_update_time is not None and (now - last_update_time) < self.min_update_interval:
            return False
        
        # 7. Z-score checks
        if abs(z_pitch) > self.max_zscore or abs(z_rate) > self.max_zscore:
            return False
        
        return True