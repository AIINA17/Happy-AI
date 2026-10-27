"""Presentation-only helpers for the /pipeline explainer page: a compact
waveform preview for plotting, and a shared JSON shape ("trace record")
consumed by both the live `/verify-voice/explain` endpoint and the offline
`analysis/capture_pipeline_traces.py` script, so the two can never drift
apart.

Nothing here feeds back into the actual decision pipeline (decision_engine.py
/ biometric_service.py) — it only reshapes values those modules already
computed (via verify_against_multiple_embeddings(..., explain=True)) into
something a web page can render.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import librosa
import numpy as np

from voiceverification.core.decision_engine import DecisionConfig

MODEL_SPEAKER = "speechbrain/spkrec-ecapa-voxceleb (ECAPA-TDNN)"
MODEL_ANTISPOOF = "MelodyMachine/Deepfake-audio-detection-V2 (wav2vec2)"


def build_waveform_preview(wav_path: str, n_points: int = 200) -> dict:
    """Downsample a wav into ~n_points peak-amplitude buckets, plus its
    silence-trim boundaries (seconds) — never the raw sample array, which
    for a few seconds of 16kHz audio would be hundreds of KB per scenario.
    """
    y, sr = librosa.load(wav_path, sr=16000, mono=True)
    if len(y) == 0:
        return {
            "sample_rate": sr,
            "duration_sec": 0.0,
            "trim_start_sec": 0.0,
            "trim_end_sec": 0.0,
            "waveform_preview": [],
        }

    _, trim_idx = librosa.effects.trim(y, top_db=25)

    bucket = max(1, len(y) // n_points)
    preview = [
        float(np.max(np.abs(y[i:i + bucket])))
        for i in range(0, len(y), bucket)
    ]

    return {
        "sample_rate": sr,
        "duration_sec": len(y) / sr,
        "trim_start_sec": float(trim_idx[0]) / sr,
        "trim_end_sec": float(trim_idx[1]) / sr,
        "waveform_preview": preview[:n_points],
    }


def _to_list(vec) -> list[float]:
    return np.asarray(vec, dtype=float).tolist()


def build_trace_record(
    *,
    scenario_id: str,
    title: str,
    scenario_type: str,
    source_file: str | None,
    enrolled_label: str | None,
    result: dict[str, Any],
    preview: dict[str, Any],
    synthetic_note: str | None = None,
) -> dict:
    """Reshape a verify_against_multiple_embeddings(explain=True) result +
    build_waveform_preview() output into the PipelineTrace JSON schema the
    /pipeline frontend consumes (frontend/components/pipeline/types.ts
    mirrors this 1:1).
    """
    config: DecisionConfig = result["decision_config"]
    behavior_available = result["behavior_score"] is not None

    spoof_breakdown = result.get("spoof_breakdown") or {}

    return {
        "scenario_id": scenario_id,
        "title": title,
        "scenario_type": scenario_type,
        "source_file": source_file,
        "enrolled_label": enrolled_label,
        "synthetic_note": synthetic_note,

        "input": {
            "sample_rate": preview["sample_rate"],
            "duration_sec": preview["duration_sec"],
            "trim_start_sec": preview["trim_start_sec"],
            "trim_end_sec": preview["trim_end_sec"],
            "speech_sec": result["speech_sec"],
            "waveform_preview": preview["waveform_preview"],
        },

        "speaker_verification": {
            "model": MODEL_SPEAKER,
            "embedding_dim": len(result["live_embedding"]),
            "live_embedding": _to_list(result["live_embedding"]),
            "matched_enroll_embedding": _to_list(result["matched_enroll_embedding"]),
            "all_scores": [float(s) for s in result["all_scores"]],
            "best_index": result["best_index"],
            "best_label": result["best_label"],
            "score": result["score"],
            "thresholds": {
                "voice_accept": config.voice_accept,
                "voice_repeat": config.voice_repeat,
                "abs_min_speaker": config.abs_min_speaker,
            },
        },

        "anti_spoof": {
            "model": MODEL_ANTISPOOF,
            "fake_prob": spoof_breakdown.get("fake_prob", result["spoof_prob"]),
            "real_prob": spoof_breakdown.get("real_prob"),
            "thresholds": {
                "replay_warn": config.replay_warn,
                "replay_deny": config.replay_deny,
            },
        },

        "behavior_profiling": {
            "available": behavior_available,
            "n_samples": result.get("behavior_n_samples", 0),
            "pitch_hz": result["pitch"],
            "rate_proxy_sec": result["rate"],
            "z_pitch": result["z_pitch"],
            "z_rate": result["z_rate"],
            "behavior_score": result["behavior_score"],
            "thresholds": {
                "behavior_repeat": config.behavior_repeat,
                "behavior_min_samples": config.behavior_min_samples,
            },
        },

        "decision": {
            "final": result["decision"],
            "reason": result["reason"],
            "steps": result["decision_steps"],
        },

        "captured_at": datetime.now(timezone.utc).isoformat(),
    }
