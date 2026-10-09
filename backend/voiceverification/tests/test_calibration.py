import numpy as np

from core.calibration import find_eer_threshold


def test_perfectly_separated_scores_give_zero_eer():
    genuine = np.array([0.9, 0.95, 0.99])
    impostor = np.array([0.1, 0.05, 0.01])

    threshold, eer = find_eer_threshold(genuine, impostor)

    assert eer == 0.0
    assert 0.1 < threshold <= 0.9


def test_fully_overlapping_scores_give_high_eer():
    genuine = np.array([0.5, 0.5, 0.5, 0.5])
    impostor = np.array([0.5, 0.5, 0.5, 0.5])

    _, eer = find_eer_threshold(genuine, impostor)

    assert eer >= 0.5


def test_eer_is_between_zero_and_one():
    rng = np.random.default_rng(42)
    genuine = rng.normal(loc=0.7, scale=0.15, size=50)
    impostor = rng.normal(loc=0.3, scale=0.15, size=50)

    _, eer = find_eer_threshold(genuine, impostor)

    assert 0.0 <= eer <= 1.0
