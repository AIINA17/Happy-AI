import math
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class BehaviorProfile:
    n_samples: int = 0
    mean_pitch: float = 0.0
    var_pitch: float = 0.0
    mean_rate: float = 0.0
    var_rate: float = 0.0
    last_update_ts: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    @property
    def std_pitch(self):
        # Calculate actual variance (M2 / n) before sqrt
        actual_var = self.var_pitch / self.n_samples if self.n_samples > 0 else 0
        return math.sqrt(actual_var) if actual_var > 1e-9 else 1e-6
    
    @property
    def std_rate(self):
        actual_var = self.var_rate / self.n_samples if self.n_samples > 0 else 0
        return math.sqrt(actual_var) if actual_var > 1e-9 else 1e-6
    
    def update(self, pitch: float, rate: float, ts: datetime):
        if isinstance(ts, (int, float)):
            ts = datetime.fromtimestamp(ts, tz=timezone.utc)
        self.n_samples += 1
        
        # Update pitch stats
        dp = pitch - self.mean_pitch
        self.mean_pitch += dp / self.n_samples
        self.var_pitch += dp * (pitch - self.mean_pitch)

        # Update rate stats
        dr = rate - self.mean_rate
        self.mean_rate += dr / self.n_samples
        self.var_rate += dr * (rate - self.mean_rate)

        self.last_update_ts = ts