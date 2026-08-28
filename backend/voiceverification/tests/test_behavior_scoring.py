from core.behavior_profile import BehaviorProfile
from core.behavior_scoring import compute_behavior_score, zscore


def test_zscore_at_mean_is_zero():
    assert zscore(10.0, mean=10.0, std=2.0) == 0.0


def test_zscore_floors_std_to_avoid_division_by_zero():
    # std=0 would otherwise raise ZeroDivisionError.
    assert zscore(10.0, mean=5.0, std=0.0) == 5.0 / 1e-6


def test_behavior_score_is_high_when_live_sample_matches_profile():
    profile = BehaviorProfile()
    profile.update(pitch=150.0, rate=1.5, ts=1.0)
    profile.update(pitch=152.0, rate=1.52, ts=2.0)
    profile.update(pitch=148.0, rate=1.48, ts=3.0)

    score, z_pitch, z_rate, _, _ = compute_behavior_score(150.0, 1.5, profile)
    assert score > 0.8
    assert abs(z_pitch) < 1
    assert abs(z_rate) < 1


def test_behavior_score_is_low_when_live_sample_is_far_from_profile():
    profile = BehaviorProfile()
    profile.update(pitch=150.0, rate=1.5, ts=1.0)
    profile.update(pitch=152.0, rate=1.52, ts=2.0)
    profile.update(pitch=148.0, rate=1.48, ts=3.0)

    score, z_pitch, z_rate, _, _ = compute_behavior_score(400.0, 5.0, profile)
    assert score < 0.2
    assert abs(z_pitch) > 3
    assert abs(z_rate) > 3


def test_behavior_score_is_bounded_between_zero_and_one():
    profile = BehaviorProfile()
    profile.update(pitch=150.0, rate=1.5, ts=1.0)
    profile.update(pitch=150.0, rate=1.5, ts=2.0)

    score, _, _, _, _ = compute_behavior_score(10000.0, 10000.0, profile)
    assert 0.0 <= score <= 1.0
