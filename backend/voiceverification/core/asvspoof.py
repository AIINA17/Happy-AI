import warnings

import librosa
import numpy as np

warnings.filterwarnings("ignore", category=RuntimeWarning)

# Pretrained wav2vec2-based deepfake/replay detector (Apache-2.0), used in
# place of the old hand-rolled 3-feature logistic regression.
#
# The old model (spectral flatness + temporal energy variance + highband
# ratio, trained on ~37 local samples) had an EER of ~54% on this project's
# own dataset/{genuine,impostor,spoof} — essentially no better than a coin
# flip. This pretrained model, evaluated on the exact same local dataset
# with zero fine-tuning, gets ~15% EER. Still not production-grade
# (real ASVspoof systems reach 1-5% EER), but a large, measured improvement.
MODEL_ID = "MelodyMachine/Deepfake-audio-detection-V2"

_pipeline = None


def _get_pipeline():
    global _pipeline
    if _pipeline is None:
        from transformers import pipeline
        _pipeline = pipeline("audio-classification", model=MODEL_ID)
    return _pipeline


def warm_up():
    """Force the pretrained model to load now instead of on first request."""
    _get_pipeline()


def _load_audio(path, sr=16000):
    try:
        y, _ = librosa.load(path, sr=sr, mono=True)
        if len(y) == 0:
            return np.zeros(1024, dtype=np.float32)

        y, _ = librosa.effects.trim(y, top_db=25)
        return y if len(y) > 512 else np.zeros(1024, dtype=np.float32)

    except Exception:
        return np.zeros(1024, dtype=np.float32)


def compute_score(input_data, sr=16000):
    """
    Anti-spoofing score: probability that the audio is a replay/fake rather
    than live genuine speech (0 = genuine, 1 = spoof). Whose voice it is
    plays no part here — that's speaker verification's job, not this one.
    """
    if isinstance(input_data, str):
        y = _load_audio(input_data, sr)
    else:
        y = np.asarray(input_data, dtype=np.float32)

    if np.max(np.abs(y)) < 1e-6:
        return 0.0, {}

    pipe = _get_pipeline()
    target_sr = pipe.feature_extractor.sampling_rate
    if sr != target_sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)

    results = pipe(y.astype(np.float32))
    probs = {r["label"]: r["score"] for r in results}
    score = float(probs.get("fake", 0.0))

    print(f"ASVspoof score: {score:.4f} (model={MODEL_ID})")
    return score, {
        "fake_prob": score,
        "real_prob": float(probs.get("real", 0.0)),
    }
