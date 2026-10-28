"""Simplified, illustrative walkthrough of the wav2vec2 anti-spoofing
classifier's major architectural steps — a strided 1D conv feature
extractor working DIRECTLY on raw waveform samples (unlike ECAPA's
hand-crafted mel features), a feature projection, one self-attention
(transformer encoder) step, and a final pooling + classification head.

This is NOT the pretrained model and does not use its trained weights —
`core/asvspoof.py`'s forward hooks already capture the real model's actual
activations for the /pipeline page's magnitude chart. This module exists
only to make the *shape* of each operation concrete with a small, followable
worked example: real short audio slice in, small fixed illustrative
weights, real arithmetic out. Dimensions are deliberately tiny (17 raw
samples, 3 conv channels, 4 hidden dims, 8 time frames) versus the real
model's (16kHz audio, 512 conv channels, 768 hidden dims, ~frame-per-20ms)
so every step fits on screen.
"""

from __future__ import annotations

import numpy as np
import librosa

N_RAW_SAMPLES = 17
CONV_KERNEL = 3
CONV_STRIDE = 2
N_CONV_CHANNELS = 3
N_HIDDEN = 4
N_FRAMES = 8  # = (N_RAW_SAMPLES - CONV_KERNEL) // CONV_STRIDE + 1
N_CLASSES = 2


def _rows(arr) -> list[list[float]]:
    a = np.atleast_2d(np.asarray(arr, dtype=float))
    return [[round(float(v), 4) for v in row] for row in a]


def _softmax(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x = x - np.max(x, axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


def build_worked_example(wav_path: str) -> list[dict]:
    steps: list[dict] = []
    rng = np.random.default_rng(7)

    # 1. Raw audio — a real, very short slice. wav2vec2's conv stack reads
    # samples directly; there is no mel-filterbank stage like ECAPA's.
    y, sr = librosa.load(wav_path, sr=16000, mono=True)
    if len(y) < N_RAW_SAMPLES:
        y = np.pad(y, (0, N_RAW_SAMPLES - len(y)))
    raw = y[:N_RAW_SAMPLES]

    steps.append({
        "step": "raw_audio",
        "title": "Audio masuk (cuplikan nyata, sample mentah)",
        "formula": None,
        "input": None,
        "output": _rows(raw),
        "note": (
            f"{N_RAW_SAMPLES} sample mentah pertama dari audio yang sama "
            "dengan skenario ini — wav2vec2 membaca gelombang langsung, "
            "tidak lewat fitur mel seperti ECAPA."
        ),
        "extra": None,
    })

    # 2. Strided 1D conv feature extractor (3 toy channels, kernel=3, stride=2).
    kernels = rng.normal(0, 0.5, size=(N_CONV_CHANNELS, CONV_KERNEL))
    conv_out = np.zeros((N_FRAMES, N_CONV_CHANNELS))
    for t in range(N_FRAMES):
        window = raw[t * CONV_STRIDE: t * CONV_STRIDE + CONV_KERNEL]
        for c in range(N_CONV_CHANNELS):
            conv_out[t, c] = float(kernels[c] @ window)

    steps.append({
        "step": "conv_feature_extractor",
        "title": "Ekstraksi Fitur CNN (konvolusi 1D langsung dari waveform)",
        "formula": f"output[t,c] = Σ kernel_c[k] · sample[{CONV_STRIDE}t+k], k=0..{CONV_KERNEL - 1}",
        "input": _rows(raw),
        "output": _rows(conv_out),
        "note": (
            f"Stride={CONV_STRIDE} memperkecil {N_RAW_SAMPLES} sample jadi {N_FRAMES} "
            f"frame, {N_CONV_CHANNELS} kanal ilustrasi (model asli: 7 lapis conv bertumpuk, 512 kanal)."
        ),
        "extra": None,
    })

    # 3. Feature projection: conv channels -> hidden size.
    proj_w = rng.normal(0, 0.4, size=(N_HIDDEN, N_CONV_CHANNELS))
    hidden = conv_out @ proj_w.T

    steps.append({
        "step": "feature_projection",
        "title": "Proyeksi Fitur",
        "formula": "hidden = conv_out · Wᵀ",
        "input": _rows(conv_out),
        "output": _rows(hidden),
        "note": f"Diproyeksikan ke {N_HIDDEN}-d per frame (model asli ke 768-d, siap masuk transformer).",
        "extra": None,
    })

    # 4. Self-attention (one transformer encoder layer, toy).
    wq = rng.normal(0, 0.4, size=(N_HIDDEN, N_HIDDEN))
    wk = rng.normal(0, 0.4, size=(N_HIDDEN, N_HIDDEN))
    wv = rng.normal(0, 0.4, size=(N_HIDDEN, N_HIDDEN))
    q = hidden @ wq
    k = hidden @ wk
    v = hidden @ wv
    attn_scores = (q @ k.T) / np.sqrt(N_HIDDEN)
    attn_weights = _softmax(attn_scores, axis=-1)
    attended = attn_weights @ v

    steps.append({
        "step": "self_attention",
        "title": "Self-Attention (1 layer transformer encoder, dari 12 lapis asli)",
        "formula": "Attention(Q,K,V) = softmax(QKᵀ/√d) · V",
        "input": _rows(hidden),
        "output": _rows(attended),
        "note": (
            "Tiap frame 'melihat' semua frame lain dan mengambil rata-rata "
            "berbobot — beda total dari ECAPA yang memakai pooling statistik, bukan atensi."
        ),
        "extra": {"attention_weights_frame_0": [round(float(w), 4) for w in attn_weights[0]]},
    })

    # 5. Pool over time + classification head.
    pooled = attended.mean(axis=0)
    clf_w = rng.normal(0, 0.4, size=(N_CLASSES, N_HIDDEN))
    logits = clf_w @ pooled
    probs = _softmax(logits)

    steps.append({
        "step": "classification_head",
        "title": "Pooling + Klasifikasi",
        "formula": "probs = softmax(W · rata²_waktu(attended) + b)",
        "input": _rows(attended),
        "output": _rows(probs),
        "note": "2 angka keluaran: probabilitas 'asli' vs 'palsu' (urutan ilustrasi, bukan dari bobot model asli).",
        "extra": {"logits": [round(float(v), 4) for v in logits]},
    })

    return steps
