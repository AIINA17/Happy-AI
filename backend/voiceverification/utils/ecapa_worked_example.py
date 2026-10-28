"""Simplified, illustrative walkthrough of the ECAPA-TDNN pipeline's major
architectural steps — mel-like features, a TDNN (dilated 1D conv), two
SE-Res2Blocks (squeeze-excitation), multi-layer feature aggregation,
attentive statistics pooling, and a final FC projection + L2 norm.

This is NOT the pretrained model and does not use its trained weights —
`models/speaker_verifier.py`'s forward hooks already capture the real
model's actual activations for the /pipeline page's magnitude chart. This
module exists only to make the *shape* of each operation concrete with a
small, followable worked example: real short audio slice in, small fixed
illustrative weights, real arithmetic out. Dimensions are deliberately tiny
(4 frames, 4 "mel" bins, 2 blocks, 4-d toy embedding) versus the real
model's (many frames, 80 mel bins, 4 blocks, 192-d embedding) so every step
fits on screen and in one judge's attention span.
"""

from __future__ import annotations

import numpy as np
import librosa

N_FRAMES = 4
N_MEL = 4
N_BLOCKS = 2
FRAME_LEN = 400  # 25ms @ 16kHz
HOP = 200  # 12.5ms, 50% overlap
TOY_EMBED_DIM = 4


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


def _rows(arr) -> list[list[float]]:
    """Always return a 2D (rows x cols) nested list, so the frontend never
    has to branch on 1D vs 2D."""
    a = np.atleast_2d(np.asarray(arr, dtype=float))
    return [[round(float(v), 4) for v in row] for row in a]


def build_worked_example(wav_path: str) -> list[dict]:
    steps: list[dict] = []

    # 1. Raw audio — a real, short slice of the actual input.
    y, sr = librosa.load(wav_path, sr=16000, mono=True)
    needed = FRAME_LEN + HOP * (N_FRAMES - 1)
    if len(y) < needed:
        y = np.pad(y, (0, needed - len(y)))
    frames = np.stack([y[i * HOP: i * HOP + FRAME_LEN] for i in range(N_FRAMES)])

    steps.append({
        "step": "raw_audio",
        "title": "Audio masuk (cuplikan nyata)",
        "formula": None,
        "input": None,
        "output": _rows(frames[:, :8]),
        "note": (
            f"{N_FRAMES} frame pendek (~25ms, overlap 50%) diambil dari "
            "audio yang sama dengan skenario ini; hanya 8 sample pertama "
            "tiap frame yang ditampilkan."
        ),
        "extra": None,
    })

    # 2. Simplified mel-like features: bin FFT magnitude, log-compress.
    mel = np.zeros((N_FRAMES, N_MEL))
    window = np.hanning(FRAME_LEN)
    for t in range(N_FRAMES):
        spec = np.abs(np.fft.rfft(frames[t] * window))
        bands = np.array_split(spec, N_MEL)
        mel[t] = [np.log1p(b.mean()) for b in bands]

    steps.append({
        "step": "mel_features",
        "title": "Fitur akustik sederhana (mirip mel-filterbank)",
        "formula": "log(1 + rata-rata energi FFT per pita frekuensi)",
        "input": _rows(frames[:, :8]),
        "output": _rows(mel),
        "note": f"Disederhanakan jadi {N_MEL} pita frekuensi (model asli memakai 80 pita mel).",
        "extra": None,
    })

    # 3. TDNN: 1D conv across time, same fixed kernel for every mel channel.
    kernel = np.array([0.25, 0.5, 0.25])
    padded = np.pad(mel, ((1, 1), (0, 0)), mode="edge")
    tdnn = np.stack([kernel @ padded[t:t + 3] for t in range(N_FRAMES)])

    steps.append({
        "step": "tdnn",
        "title": "TDNN / Konvolusi 1D sepanjang waktu",
        "formula": "output[t] = 0.25·x[t-1] + 0.5·x[t] + 0.25·x[t+1]",
        "input": _rows(mel),
        "output": _rows(tdnn),
        "note": "Kernel contoh tetap (bukan hasil training) — menangkap konteks antar-frame di sekitar tiap waktu.",
        "extra": None,
    })

    # 4. SE-Res2Blocks: conv -> squeeze (avg over time) -> excite (sigmoid gate) -> scale.
    se_weight = 1.5
    block_kernels = [np.array([0.2, 0.6, 0.2]), np.array([0.3, 0.4, 0.3])]
    block_outputs: list[np.ndarray] = []
    cur = tdnn
    for b in range(N_BLOCKS):
        k = block_kernels[b % len(block_kernels)]
        padded = np.pad(cur, ((1, 1), (0, 0)), mode="edge")
        conv_out = np.stack([k @ padded[t:t + 3] for t in range(N_FRAMES)])

        squeeze = conv_out.mean(axis=0)
        gate = _sigmoid(squeeze * se_weight)
        scaled = conv_out * gate

        steps.append({
            "step": f"se_res2block_{b + 1}",
            "title": f"SE-Res2Block {b + 1} (squeeze–excitation sederhana)",
            "formula": "squeeze = rata² sepanjang waktu; gate = sigmoid(squeeze×w); output = conv × gate",
            "input": _rows(cur),
            "output": _rows(scaled),
            "note": (
                "Blok residual bergaya Res2Net dengan gerbang squeeze-excitation "
                f"(model asli punya 4 blok serupa, disederhanakan jadi {N_BLOCKS})."
            ),
            "extra": {
                "squeeze": _rows(squeeze)[0],
                "gate": _rows(gate)[0],
            },
        })
        block_outputs.append(scaled)
        cur = scaled

    # 5. Multi-layer Feature Aggregation: concat block outputs along channels.
    mfa = np.concatenate(block_outputs, axis=1)
    steps.append({
        "step": "mfa",
        "title": "Multi-layer Feature Aggregation",
        "formula": "gabungkan (concat) output semua SE-Res2Block di sepanjang kanal",
        "input": None,
        "output": _rows(mfa),
        "note": f"{N_BLOCKS} blok × {N_MEL} kanal digabung jadi {mfa.shape[1]} kanal per frame.",
        "extra": None,
    })

    # 6. Attentive Statistics Pooling: attention-weighted mean + std over time.
    attn_logits = mfa.sum(axis=1)
    attn = np.exp(attn_logits - attn_logits.max())
    attn = attn / attn.sum()
    weighted_mean = (attn[:, None] * mfa).sum(axis=0)
    weighted_var = (attn[:, None] * (mfa - weighted_mean) ** 2).sum(axis=0)
    weighted_std = np.sqrt(weighted_var + 1e-8)
    pooled = np.concatenate([weighted_mean, weighted_std])

    steps.append({
        "step": "asp",
        "title": "Attentive Statistics Pooling",
        "formula": "bobot perhatian per frame (softmax) → rata² & std berbobot di seluruh waktu",
        "input": _rows(mfa),
        "output": _rows(pooled),
        "note": "Frame yang bobot perhatiannya lebih besar lebih menentukan rata²/std akhir — bukan rata² polos.",
        "extra": {"attention_weights": _rows(attn)[0]},
    })

    # 7. FC projection (toy small embedding dim) + L2 normalization.
    rng = np.random.default_rng(42)
    fc_weights = rng.normal(0, 0.3, size=(TOY_EMBED_DIM, pooled.shape[0]))
    projected = fc_weights @ pooled
    embedding = projected / (np.linalg.norm(projected) + 1e-8)

    steps.append({
        "step": "fc_projection",
        "title": "Proyeksi Embedding (FC) + Normalisasi L2",
        "formula": "embedding = (W · pooled) / ‖W · pooled‖",
        "input": _rows(pooled),
        "output": _rows(embedding),
        "note": f"Diproyeksikan ke {TOY_EMBED_DIM}-d untuk contoh ini (model asli memproyeksikan ke 192-d).",
        "extra": None,
    })

    return steps
