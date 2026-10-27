"""Capture a small set of REAL pipeline runs (plus one clearly-labeled
synthetic behavior profile, see below) for the /pipeline explainer page's
"replay" mode — the safe, no-backend-dependency default for the expo booth
demo.

No FastAPI/Supabase/LiveKit needed — same as test_voice_conditions.py, this
calls BiometricService directly, offline, on local WAV files under
dataset/{enroll,genuine,impostor,spoof}/ (gitignored; supply your own
recordings). Never mutates the dataset/ files themselves.

Every scenario reports whatever the pipeline actually measures — in
particular, `spoof_sample` is NOT assumed to land in any particular decision
bucket; read the printed fake_prob/decision and let the demo narrative match
reality, not the other way around.

Run from backend/ or voiceverification/ (sys.path is fixed up below):
    python voiceverification/analysis/capture_pipeline_traces.py

Writes pipeline_traces.json next to this script. Copy that file to
frontend/public/pipeline-demo/traces.json to serve it statically.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))
VOICEVERIFICATION_DIR = os.path.dirname(ANALYSIS_DIR)
BACKEND_DIR = os.path.dirname(VOICEVERIFICATION_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import librosa  # noqa: E402
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402

from voiceverification.core.behavior_profile import BehaviorProfile  # noqa: E402
from voiceverification.services.biometric_service import BiometricService  # noqa: E402
from voiceverification.utils.audio import normalize_audio  # noqa: E402
from voiceverification.utils.pipeline_trace import (  # noqa: E402
    build_trace_record,
    build_waveform_preview,
)

DATASET_DIR = Path(VOICEVERIFICATION_DIR) / "dataset"
DEFAULT_OUT = Path(ANALYSIS_DIR) / "pipeline_traces.json"

# Each scenario: which real file to use, what (if anything) to do to it
# before running it through the pipeline, and how it should be labeled in
# the output JSON's scenario_type (see utils/pipeline_trace.py's schema).
SCENARIOS = [
    dict(
        id="genuine_verified",
        title="Pemilik suara asli — berhasil diverifikasi",
        wav=DATASET_DIR / "genuine" / "g1.wav",
        transform="none",
        scenario_type="real_recording",
    ),
    dict(
        id="impostor_denied",
        title="Suara orang lain — ditolak",
        wav=DATASET_DIR / "impostor" / "i1.wav",
        transform="none",
        scenario_type="real_recording",
    ),
    dict(
        id="spoof_sample",
        title="Audio replay/spoof — dicek anti-spoofing",
        wav=DATASET_DIR / "spoof" / "s2.wav",
        transform="none",
        scenario_type="real_recording",
    ),
    dict(
        id="repeat_short_utterance",
        title="Ucapan terlalu singkat — diminta ulang",
        wav=DATASET_DIR / "genuine" / "g2.wav",
        transform="truncate_short",
        scenario_type="truncated_real_recording",
    ),
    dict(
        id="repeat_behavior_anomaly",
        title="Suara cocok, tapi pola perilaku tidak biasa — diminta ulang",
        wav=DATASET_DIR / "genuine" / "g3.wav",
        transform="synthetic_behavior_profile",
        scenario_type="synthetic_behavior_profile",
    ),
]

TARGET_SHORT_SPEECH_SEC = 1.0

# BehaviorProfile.var_* stores the Welford running M2 (sum of squared
# deviations), so std = sqrt(M2 / n). These values are picked so BOTH
# z_pitch and z_rate land far enough out (~-20 and ~-10) that both Gaussian
# kernel terms in compute_behavior_score collapse toward 0 — a single
# off-axis term wouldn't be enough, since behavior_score averages the two.
SYNTHETIC_N_SAMPLES = 5
SYNTHETIC_PITCH_OFFSET_HZ = 40.0
SYNTHETIC_VAR_PITCH = 20.0  # std_pitch = sqrt(20/5) = 2.0 Hz
SYNTHETIC_RATE_OFFSET_SEC = 2.0
SYNTHETIC_VAR_RATE = 0.2  # std_rate = sqrt(0.2/5) ≈ 0.2 s


def _normalized_copy(wav_path: Path, tmp_dir: Path, name: str | None = None) -> Path:
    """Copy wav_path into tmp_dir and run the server's normalize_audio on
    the copy — never mutate the caller's original dataset file."""
    copy_path = tmp_dir / (name or wav_path.name)
    shutil.copy(wav_path, copy_path)
    normalize_audio(str(copy_path))
    return copy_path


def _truncate_to_short_speech(wav_path: Path, tmp_dir: Path, target_sec: float) -> Path:
    """Write a copy containing only ~target_sec of speech starting at the
    detected speech onset, so it lands under biometric_service's
    MIN_SPEECH_SEC gate regardless of the source file's leading silence."""
    y, sr = librosa.load(str(wav_path), sr=16000, mono=True)
    _, trim_idx = librosa.effects.trim(y, top_db=25)
    start = int(trim_idx[0])
    end = min(len(y), start + int(target_sec * sr))
    y_short = y[start:end]

    out_path = tmp_dir / f"short_{wav_path.name}"
    sf.write(str(out_path), y_short, sr)
    return out_path


def _measure_pitch_rate(wav_path: Path) -> tuple[float, float]:
    """Same extraction biometric_service.py does, used here only to build a
    *plausible* synthetic BehaviorProfile offset from this sample's real
    values — not part of the actual decision pipeline."""
    y, sr = librosa.load(str(wav_path), sr=16000)
    pitch = float(np.nanmean(librosa.yin(y, fmin=50, fmax=300, sr=sr)))
    rate = float(len(y) / sr)
    return pitch, rate


def _synthetic_anomalous_profile(pitch: float, rate: float) -> BehaviorProfile:
    return BehaviorProfile(
        n_samples=SYNTHETIC_N_SAMPLES,
        mean_pitch=pitch + SYNTHETIC_PITCH_OFFSET_HZ,
        var_pitch=SYNTHETIC_VAR_PITCH,
        mean_rate=rate + SYNTHETIC_RATE_OFFSET_SEC,
        var_rate=SYNTHETIC_VAR_RATE,
        last_update_ts=datetime.now(timezone.utc),
    )


def _load_enrollment(biometric: BiometricService, tmp_dir: Path) -> list[dict]:
    enroll_dir = DATASET_DIR / "enroll"
    wav_files = sorted(enroll_dir.glob("*.wav")) if enroll_dir.is_dir() else []
    if not wav_files:
        single = DATASET_DIR / "enroll.wav"
        wav_files = [single] if single.exists() else []

    if not wav_files:
        raise SystemExit(
            f"No enrollment audio found under {DATASET_DIR} "
            "(expected dataset/enroll/*.wav or dataset/enroll.wav)"
        )

    embeddings = []
    for wav_file in wav_files:
        norm_copy = _normalized_copy(wav_file, tmp_dir)
        embedding = biometric.speaker.extract_embedding(str(norm_copy))
        embeddings.append({"embedding": embedding, "label": wav_file.stem})
        print(f"Enrolled '{wav_file.stem}' from {wav_file.name}")

    return embeddings


def _run_scenario(
    spec: dict,
    biometric: BiometricService,
    enroll_embeddings: list[dict],
    tmp_dir: Path,
) -> dict:
    wav_path: Path = spec["wav"]
    if not wav_path.exists():
        raise SystemExit(f"Missing dataset file for scenario '{spec['id']}': {wav_path}")

    behavior_profiles: dict[str, BehaviorProfile] = {}
    synthetic_note = None

    if spec["transform"] == "truncate_short":
        live_wav = _truncate_to_short_speech(wav_path, tmp_dir, TARGET_SHORT_SPEECH_SEC)
        normalize_audio(str(live_wav))
    elif spec["transform"] == "synthetic_behavior_profile":
        live_wav = _normalized_copy(wav_path, tmp_dir)
        pitch, rate = _measure_pitch_rate(live_wav)
        # Matched against whichever enrolled label this sample actually
        # best-matches isn't known yet at this point, so we key the
        # profile under every enrolled label — harmless, since only the
        # best-matching one will be looked up by biometric_service.
        synthetic_profile = _synthetic_anomalous_profile(pitch, rate)
        for prof in enroll_embeddings:
            behavior_profiles[prof["label"]] = synthetic_profile
        synthetic_note = (
            "behavior_profile konstruksi sintetis (mean pitch/rate digeser jauh "
            "dari nilai sampel ini); audio dan skor speaker/anti-spoof berasal "
            "dari rekaman asli."
        )
    else:
        live_wav = _normalized_copy(wav_path, tmp_dir)

    result = biometric.verify_against_multiple_embeddings(
        live_wav=str(live_wav),
        enroll_embeddings=enroll_embeddings,
        behavior_profiles=behavior_profiles,
        explain=True,
    )

    preview = build_waveform_preview(str(live_wav))

    trace = build_trace_record(
        scenario_id=spec["id"],
        title=spec["title"],
        scenario_type=spec["scenario_type"],
        source_file=str(wav_path.relative_to(VOICEVERIFICATION_DIR)),
        enrolled_label=result["best_label"],
        result=result,
        preview=preview,
        synthetic_note=synthetic_note,
    )

    print(
        f"{spec['id']:25s} -> decision={result['decision']:9s} "
        f"score={result['score']:.3f} spoof_prob={result['spoof_prob']:.5f} "
        f"behavior_score={result['behavior_score']}"
    )

    return trace


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run a handful of real genuine/impostor/spoof WAV files "
        "through the real voice-verification pipeline in explain mode, and "
        "write the results as pipeline-explainer JSON traces."
    )
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output JSON path")
    parser.add_argument(
        "--device",
        default="cuda" if torch.cuda.is_available() else "cpu",
        help="Device for the speaker model (default: auto-detect, same as the live server)",
    )
    args = parser.parse_args()

    print(f"Loading BiometricService on device='{args.device}'...")
    biometric = BiometricService(device=args.device)

    traces = []
    with tempfile.TemporaryDirectory(prefix="pipeline_trace_capture_") as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)
        enroll_embeddings = _load_enrollment(biometric, tmp_dir)

        for spec in SCENARIOS:
            traces.append(_run_scenario(spec, biometric, enroll_embeddings, tmp_dir))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(traces, indent=2))
    print(f"\nWrote {len(traces)} scenario trace(s) to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
