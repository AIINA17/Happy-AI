import time

from core.trusted_update import TrustedUpdatePolicy


def _valid_kwargs(**overrides):
    kwargs = dict(
        decision="VERIFIED",
        speaker_score=0.9,
        spoof_prob=0.05,
        behavior_score=0.9,
        n_samples=10,
        z_pitch=0.1,
        z_rate=0.1,
        last_update_time=None,
        is_retry=False,
    )
    kwargs.update(overrides)
    return kwargs


def test_updates_when_every_condition_is_met():
    policy = TrustedUpdatePolicy()
    assert policy.should_update(**_valid_kwargs()) is True


def test_skips_when_behavior_score_is_none():
    policy = TrustedUpdatePolicy()
    assert policy.should_update(**_valid_kwargs(behavior_score=None)) is False


def test_skips_when_decision_is_not_verified():
    policy = TrustedUpdatePolicy()
    for decision in ["REPEAT", "DENIED", "UNKNOWN"]:
        assert policy.should_update(**_valid_kwargs(decision=decision)) is False


def test_skips_when_speaker_score_below_policy_minimum():
    policy = TrustedUpdatePolicy()
    too_low = policy.min_speaker_score - 0.01
    assert policy.should_update(**_valid_kwargs(speaker_score=too_low)) is False


def test_skips_when_spoof_prob_above_policy_maximum():
    policy = TrustedUpdatePolicy()
    too_high = policy.max_spoof_prob + 0.01
    assert policy.should_update(**_valid_kwargs(spoof_prob=too_high)) is False


def test_skips_when_behavior_score_below_policy_minimum():
    policy = TrustedUpdatePolicy()
    too_low = policy.min_behavior_score - 0.01
    assert policy.should_update(**_valid_kwargs(behavior_score=too_low)) is False


def test_skips_when_not_enough_samples():
    policy = TrustedUpdatePolicy()
    assert policy.should_update(**_valid_kwargs(n_samples=policy.min_samples - 1)) is False


def test_zero_samples_bypasses_the_min_samples_check():
    # n_samples == 0 is treated as "brand new profile" and explicitly
    # exempted from the min_samples gate (see `n_samples != 0` in the
    # implementation) — worth pinning down since it reads like it could
    # be an off-by-one at a glance.
    policy = TrustedUpdatePolicy()
    assert policy.should_update(**_valid_kwargs(n_samples=0)) is True


def test_skips_on_retry():
    policy = TrustedUpdatePolicy()
    assert policy.should_update(**_valid_kwargs(is_retry=True)) is False


def test_skips_when_last_update_was_recent():
    policy = TrustedUpdatePolicy()
    recent = time.time() - 1
    assert policy.should_update(**_valid_kwargs(last_update_time=recent)) is False


def test_allows_when_last_update_was_long_ago():
    policy = TrustedUpdatePolicy()
    long_ago = time.time() - policy.min_update_interval - 1
    assert policy.should_update(**_valid_kwargs(last_update_time=long_ago)) is True


def test_skips_when_pitch_or_rate_zscore_is_an_outlier():
    policy = TrustedUpdatePolicy()
    outlier = policy.max_zscore + 0.1
    assert policy.should_update(**_valid_kwargs(z_pitch=outlier)) is False
    assert policy.should_update(**_valid_kwargs(z_rate=outlier)) is False
    assert policy.should_update(**_valid_kwargs(z_pitch=-outlier)) is False
