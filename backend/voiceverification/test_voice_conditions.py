"""Batch voice-verification test across 3 ground-truth conditions, using the
exact same verification call the live server makes (POST /verify-voice ->
BiometricService.verify_against_multiple_embeddings in services/biometric_service.py),
including the RMS normalization step (utils/audio.py's normalize_audio) the
server always applies before verifying. No FastAPI/Supabase/LiveKit server
needed — this calls the biometric pipeline directly, offline, on local WAV
files.

Folder layout expected (gitignored — supply your own recordings):
    dataset/enroll.wav        one enrollment sample of the real owner, OR
    dataset/enroll/*.wav      a folder of several (mirrors multi-enrollment)
    dataset/genuine/*.wav     condition 1: the real owner's own voice
    dataset/impostor/*.wav    condition 2: a different person's voice
    dataset/spoof/*.wav       condition 3: replayed/synthesized audio

Run from anywhere (sys.path is fixed up below):
    python voiceverification/test_voice_conditions.py

Behavior-profile gating (decision_engine.py's behavior_score check) is
intentionally skipped here — it only ever downgrades an otherwise-VERIFIED
result to REPEAT based on a per-user pitch/rate history this isolated,
one-shot test has no way to build, so every call passes behavior_profiles={}.
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

TEST_FILE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TEST_FILE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import torch  # noqa: E402

from voiceverification.services.biometric_service import BiometricService  # noqa: E402
from voiceverification.utils.audio import normalize_audio  # noqa: E402

DATASET_DIR = Path(TEST_FILE_DIR) / "dataset"
CONDITIONS = ("genuine", "impostor", "spoof")


def _normalized_copy(wav_path: Path, tmp_dir: Path) -> Path:
    """Copy wav_path into tmp_dir and run the server's normalize_audio on the
    copy — never mutate the caller's original dataset file."""
    copy_path = tmp_dir / wav_path.name
    shutil.copy(wav_path, copy_path)
    normalize_audio(str(copy_path))
    return copy_path


def _load_enrollments(enroll_path: Path, tmp_dir: Path, biometric: BiometricService) -> list[dict]:
    if enroll_path.is_dir():
        wav_files = sorted(enroll_path.glob("*.wav"))
    elif enroll_path.is_file():
        wav_files = [enroll_path]
    else:
        wav_files = []

    if not wav_files:
        raise SystemExit(
            f"No enrollment audio found at {enroll_path} "
            "(expected dataset/enroll.wav or dataset/enroll/*.wav)"
        )

    embeddings = []
    for wav_file in wav_files:
        norm_copy = _normalized_copy(wav_file, tmp_dir)
        embedding = biometric.speaker.extract_embedding(str(norm_copy))
        embeddings.append({"embedding": embedding, "label": wav_file.stem})
        print(f"✅ Enrolled '{wav_file.stem}' from {wav_file.name}")

    return embeddings


EXPECTED_VERIFIED = {"genuine": True, "impostor": False, "spoof": False}


def _is_correct(condition: str, decision: str) -> bool:
    return (decision == "VERIFIED") == EXPECTED_VERIFIED[condition]


def _run_condition(
    condition: str,
    folder: Path,
    biometric: BiometricService,
    enroll_embeddings: list[dict],
    tmp_dir: Path,
    log_rows: list[dict],
) -> None:
    if not folder.is_dir():
        print(f"⚠️  Skipping '{condition}': {folder} does not exist")
        return

    wav_files = sorted(folder.glob("*.wav"))
    if not wav_files:
        print(f"⚠️  Skipping '{condition}': no .wav files in {folder}")
        return

    print(f"\n▶ Condition: {condition} ({len(wav_files)} file(s))")
    for wav_file in wav_files:
        norm_copy = _normalized_copy(wav_file, tmp_dir)
        result = biometric.verify_against_multiple_embeddings(
            live_wav=str(norm_copy),
            enroll_embeddings=enroll_embeddings,
            behavior_profiles={},
        )

        decision = result["decision"]
        correct = _is_correct(condition, decision)
        print(
            f"  {wav_file.name:30s} | decision={decision:9s} "
            f"| score={result['score']:.3f} | spoof_prob={result['spoof_prob']:.3f} "
            f"| {'✅ correct' if correct else '❌ WRONG'}"
        )

        log_rows.append(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "condition": condition,
                "file": wav_file.name,
                "decision": decision,
                "verified": result["verified"],
                "correct": correct,
                "speaker_score": f"{result['score']:.4f}",
                "spoof_prob": f"{result['spoof_prob']:.4f}",
                "best_match_label": result["best_label"],
                "reason": result["reason"],
                "pitch_hz": f"{result['pitch']:.2f}" if result["pitch"] is not None else "",
                "speech_rate_sec": f"{result['rate']:.2f}" if result["rate"] is not None else "",
            }
        )


def _write_log(log_file: Path, rows: list[dict]) -> None:
    if not rows:
        return

    fieldnames = list(rows[0].keys())
    file_exists = log_file.exists()
    log_file.parent.mkdir(parents=True, exist_ok=True)

    with log_file.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(rows)


def _print_summary(rows: list[dict]) -> None:
    print("\n=== SUMMARY ===")
    for condition in CONDITIONS:
        condition_rows = [r for r in rows if r["condition"] == condition]
        if not condition_rows:
            continue
        n_correct = sum(1 for r in condition_rows if r["correct"])
        total = len(condition_rows)
        expected = "VERIFIED" if EXPECTED_VERIFIED[condition] else "not VERIFIED"
        print(
            f"{condition:10s} | {n_correct}/{total} correct "
            f"(expected: {expected}, {n_correct / total:.0%})"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run genuine/impostor/spoof WAV files through the real "
        "voice-verification pipeline and log the results to a CSV file."
    )
    parser.add_argument("--dataset_dir", default=str(DATASET_DIR), help="Base dataset folder")
    parser.add_argument(
        "--enroll",
        default=None,
        help="Enrollment wav file or folder (default: <dataset_dir>/enroll.wav, "
        "falling back to <dataset_dir>/enroll/)",
    )
    parser.add_argument(
        "--log_file",
        default=str(Path(TEST_FILE_DIR) / "voice_verification_test_log.csv"),
        help="CSV file to append results to",
    )
    parser.add_argument(
        "--device",
        default="cuda" if torch.cuda.is_available() else "cpu",
        help="Device for the speaker model (default: auto-detect, same as the live server)",
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    enroll_path = Path(args.enroll) if args.enroll else dataset_dir / "enroll.wav"
    if not enroll_path.exists():
        enroll_path = dataset_dir / "enroll"

    print(f"Loading BiometricService on device='{args.device}'...")
    biometric = BiometricService(device=args.device)

    log_rows: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="vv_condition_test_") as tmp_dir_str:
        tmp_dir = Path(tmp_dir_str)

        enroll_embeddings = _load_enrollments(enroll_path, tmp_dir, biometric)

        for condition in CONDITIONS:
            _run_condition(
                condition,
                dataset_dir / condition,
                biometric,
                enroll_embeddings,
                tmp_dir,
                log_rows,
            )

    _write_log(Path(args.log_file), log_rows)
    _print_summary(log_rows)
    print(f"\nLogged {len(log_rows)} result(s) to {args.log_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
