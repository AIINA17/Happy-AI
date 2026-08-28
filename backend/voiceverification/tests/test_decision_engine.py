from core.decision_engine import Decision, DecisionConfig, decide


def test_verified_when_scores_are_high_and_clean():
    decision, _ = decide(speaker_score=0.9, replay_prob=0.01)
    assert decision == Decision.VERIFIED


def test_denied_when_speaker_score_below_absolute_minimum():
    decision, reason = decide(speaker_score=0.1, replay_prob=0.0)
    assert decision == Decision.DENIED
    assert "Speaker score too low" in reason


def test_denied_when_replay_prob_at_deny_threshold():
    config = DecisionConfig()
    decision, reason = decide(speaker_score=0.9, replay_prob=config.replay_deny)
    assert decision == Decision.DENIED
    assert "Replay" in reason


def test_replay_deny_overrides_high_speaker_score():
    # A confident-sounding spoof must still be denied, not verified —
    # the anti-spoof guard has to win even against a near-perfect
    # speaker-similarity score.
    config = DecisionConfig()
    decision, _ = decide(speaker_score=0.99, replay_prob=config.replay_deny)
    assert decision == Decision.DENIED


def test_repeat_in_replay_warn_zone():
    config = DecisionConfig()
    mid_warn = (config.replay_warn + config.replay_deny) / 2
    decision, reason = decide(speaker_score=0.9, replay_prob=mid_warn)
    assert decision == Decision.REPEAT
    assert "replay" in reason.lower()


def test_repeat_when_speaker_score_is_in_the_uncertain_band():
    # Isolate the voice_repeat branch by neutralizing abs_min_speaker,
    # since with the *default* config it's unreachable (see the
    # regression test below) — this tests the branch's own logic in
    # isolation, independent of that interaction.
    config = DecisionConfig(abs_min_speaker=0.0)
    mid_speaker = (config.voice_repeat + config.voice_accept) / 2
    decision, _ = decide(speaker_score=mid_speaker, replay_prob=0.0, config=config)
    assert decision == Decision.REPEAT


def test_denied_when_speaker_score_below_repeat_band():
    config = DecisionConfig(abs_min_speaker=0.0)
    decision, reason = decide(
        speaker_score=config.voice_repeat - 0.01, replay_prob=0.0, config=config
    )
    assert decision == Decision.DENIED
    assert "Speaker verification failed" in reason


def test_custom_config_is_respected():
    config = DecisionConfig(abs_min_speaker=0.5)
    decision, _ = decide(speaker_score=0.4, replay_prob=0.0, config=config)
    assert decision == Decision.DENIED


def test_REGRESSION_voice_repeat_is_unreachable_with_default_config():
    """
    Documents current (unintended-looking) behavior: abs_min_speaker
    (0.35) is higher than voice_repeat (0.30), and abs_min_speaker is
    checked first as a hard guard. So with the *default* config, any
    speaker_score low enough to hit the voice_repeat branch has already
    been denied by the hard guard first — "Uncertain verification,
    please repeat" can never actually be returned as-configured.

    This test isn't asserting that's correct, only pinning down today's
    actual behavior so a future config change is a deliberate, visible
    diff here rather than a silent shift in what users experience.
    """
    config = DecisionConfig()
    assert config.abs_min_speaker > config.voice_repeat

    just_above_voice_repeat = config.voice_repeat + 0.01
    assert just_above_voice_repeat < config.abs_min_speaker

    decision, reason = decide(speaker_score=just_above_voice_repeat, replay_prob=0.0)
    assert decision == Decision.DENIED
    assert "Speaker score too low" in reason
