import warnings

import librosa
import numpy as np

from voiceverification.utils.torch_trace import tensor_summary

warnings.filterwarnings("ignore", category=RuntimeWarning)

# Named sub-modules of the wav2vec2 classifier worth capturing for the
# /pipeline explainer page: a few of the 7 raw-waveform conv layers (full
# stack, 512ch each — CNN front end, operates directly on samples, unlike
# ECAPA's hand-crafted mel features), the projection into the transformer's
# hidden size, a few of the 12 self-attention encoder layers (not all 12 —
# same shape throughout, so a spread of early/mid/late is representative),
# and the final pooling projection + classification head. Hooking these
# forward passes doesn't change the model's behavior — it only reads the
# tensors it already produces.
_ANTISPOOF_TRACE_MODULES = (
    "wav2vec2.feature_extractor.conv_layers.0",
    "wav2vec2.feature_extractor.conv_layers.3",
    "wav2vec2.feature_extractor.conv_layers.6",
    "wav2vec2.feature_projection",
    "wav2vec2.encoder.layers.0",
    "wav2vec2.encoder.layers.5",
    "wav2vec2.encoder.layers.11",
    "projector",
    "classifier",
)

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


def compute_score(input_data, sr=16000, capture_trace: bool = False):
    """
    Anti-spoofing score: probability that the audio is a replay/fake rather
    than live genuine speech (0 = genuine, 1 = spoof). Whose voice it is
    plays no part here — that's speaker verification's job, not this one.

    With capture_trace=True, also return a list of per-block tensor
    summaries captured via forward hooks on the real wav2vec2 forward pass
    (see _ANTISPOOF_TRACE_MODULES) — for the /pipeline explainer page, not
    used by the decision logic.
    """
    if isinstance(input_data, str):
        y = _load_audio(input_data, sr)
    else:
        y = np.asarray(input_data, dtype=np.float32)

    if np.max(np.abs(y)) < 1e-6:
        empty = (0.0, {})
        return (*empty, []) if capture_trace else empty

    pipe = _get_pipeline()
    target_sr = pipe.feature_extractor.sampling_rate
    if sr != target_sr:
        y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)

    block_traces: list[dict] = []
    hooks = []
    if capture_trace:
        def _capture(name):
            def _hook(_module, _inputs, output):
                tensor = output[0] if isinstance(output, tuple) else output
                summary = tensor_summary(name, tensor)
                if summary is not None:
                    block_traces.append(summary)
            return _hook

        for name, module in pipe.model.named_modules():
            if name in _ANTISPOOF_TRACE_MODULES:
                hooks.append(module.register_forward_hook(_capture(name)))

    try:
        results = pipe(y.astype(np.float32))
    finally:
        for hook in hooks:
            hook.remove()

    probs = {r["label"]: r["score"] for r in results}
    score = float(probs.get("fake", 0.0))

    print(f"ASVspoof score: {score:.4f} (model={MODEL_ID})")
    breakdown = {
        "fake_prob": score,
        "real_prob": float(probs.get("real", 0.0)),
    }
    return (score, breakdown, block_traces) if capture_trace else (score, breakdown)
