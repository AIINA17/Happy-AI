import time

from core.behavior_profile import BehaviorProfile


def test_REGRESSION_default_timestamp_is_per_instance_not_shared():
    """
    dataclass defaults are evaluated once at class-definition time unless
    wrapped in field(default_factory=...). BehaviorProfile.last_update_ts
    used to be a bare `datetime.now(...)` default, so every profile
    created without an explicit timestamp silently shared the exact same
    "created at import time" value instead of its own creation time.
    """
    a = BehaviorProfile()
    time.sleep(0.05)
    b = BehaviorProfile()
    assert a.last_update_ts != b.last_update_ts
    assert b.last_update_ts > a.last_update_ts


def test_update_tracks_running_mean_of_pitch_and_rate():
    p = BehaviorProfile()
    p.update(pitch=100.0, rate=1.0, ts=time.time())
    p.update(pitch=200.0, rate=2.0, ts=time.time())

    assert p.n_samples == 2
    assert p.mean_pitch == 150.0
    assert p.mean_rate == 1.5


def test_std_is_nonzero_after_variation_and_near_zero_for_identical_samples():
    varied = BehaviorProfile()
    varied.update(pitch=100.0, rate=1.0, ts=time.time())
    varied.update(pitch=200.0, rate=2.0, ts=time.time())
    assert varied.std_pitch > 0
    assert varied.std_rate > 0

    identical = BehaviorProfile()
    identical.update(pitch=150.0, rate=1.5, ts=time.time())
    identical.update(pitch=150.0, rate=1.5, ts=time.time())
    # Implementation floors std at 1e-6 rather than letting it hit exactly
    # zero (zscore() downstream divides by std).
    assert identical.std_pitch == 1e-6
    assert identical.std_rate == 1e-6


def test_std_on_fresh_profile_does_not_raise_divide_by_zero():
    fresh = BehaviorProfile()
    assert fresh.std_pitch == 1e-6
    assert fresh.std_rate == 1e-6


def test_update_accepts_epoch_timestamp_as_well_as_datetime():
    p = BehaviorProfile()
    p.update(pitch=100.0, rate=1.0, ts=time.time())
    assert p.n_samples == 1
