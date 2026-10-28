"""Batch face-verification test across 3 ground-truth conditions, using the
exact same calls the live server makes: ArcFaceModel.extract_embedding +
FaceRecognitionService.verify (face_recognition/main.py's POST /face/verify-face).

Specifically, this exercises the *no-liveness-token* code path — the same one
main.py's own docstring says the manual test button (FaceVerification.tsx)
uses, i.e. "a plain recognition-only test". No FastAPI/Supabase/LiveKit
server needed — this calls the recognition pipeline directly, offline, on
local image files.

Folder layout expected (gitignored — supply your own photos):
    dataset/enroll.jpg        one photo of the real owner (single enrollment,
                               mirrors face_repo's one-embedding-per-user storage)
    dataset/genuine/*.jpg     condition 1: more photos of the real owner
    dataset/impostor/*.jpg    condition 2: photos of a different person
    dataset/spoof/*.jpg       condition 3: a photo of a photo / screen replay
                               of the owner

IMPORTANT about the "spoof" condition: this pipeline has no server-side
anti-spoof check on a static image. The actual defense against a printed
photo or screen replay is the liveness challenge (blink/mouth/turn —
face_recognition/liveness_challenge.py), which only runs against a live
camera capture in the browser and cannot be exercised from a file here. A
spoof photo of the real owner's own face can very plausibly still come back
VERIFIED, since nothing in this code path looks for liveness — that is the
real, documented gap this condition's data is meant to surface, not a bug in
this script. Spoof rows are logged with the raw outcome but are not graded
"correct"/"wrong" (unlike genuine/impostor, which do have a clear expected
answer).

Run from anywhere (sys.path is fixed up below):
    python face_recognition/test_face_conditions.py
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

TEST_FILE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TEST_FILE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from face_recognition.arcface_model import ArcFaceModel  # noqa: E402
from face_recognition.face_service import FaceRecognitionService  # noqa: E402

DATASET_DIR = Path(TEST_FILE_DIR) / "dataset"
CONDITIONS = ("genuine", "impostor", "spoof")
IMAGE_EXTS = (".jpg", ".jpeg", ".png")

# Matches the threshold main.py constructs FaceRecognitionService with.
DEFAULT_THRESHOLD = 0.45

EXPECTED_VERIFIED = {"genuine": True, "impostor": False}  # spoof: ungraded, see module docstring


def _iter_images(folder: Path) -> list[Path]:
    return sorted(p for ext in IMAGE_EXTS for p in folder.glob(f"*{ext}"))


def _load_enrollment(enroll_path: Path, arcface: ArcFaceModel) -> "np.ndarray":  # noqa: F821
    if not enroll_path.is_file():
        raise SystemExit(
            f"No enrollment photo found at {enroll_path} (expected a single "
            "dataset/enroll.jpg, .jpeg, or .png)"
        )

    try:
        embedding = arcface.extract_embedding(enroll_path.read_bytes())
    except ValueError as error:
        raise SystemExit(f"Enrollment photo {enroll_path.name} rejected: {error}") from None

    print(f"✅ Enrolled reference face from {enroll_path.name}")
    return embedding


def _is_correct(condition: str, verified: bool) -> bool | None:
    if condition not in EXPECTED_VERIFIED:
        return None
    return verified == EXPECTED_VERIFIED[condition]


def _run_condition(
    condition: str,
    folder: Path,
    arcface: ArcFaceModel,
    face_service: FaceRecognitionService,
    reference_embedding,
    log_rows: list[dict],
) -> None:
    if not folder.is_dir():
        print(f"⚠️  Skipping '{condition}': {folder} does not exist")
        return

    image_files = _iter_images(folder)
    if not image_files:
        print(f"⚠️  Skipping '{condition}': no image files in {folder}")
        return

    print(f"\n▶ Condition: {condition} ({len(image_files)} file(s))")
    for image_file in image_files:
        row = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "condition": condition,
            "file": image_file.name,
            "status": None,
            "verified": None,
            "correct": None,
            "similarity": None,
            "threshold": face_service.threshold,
            "error_message": None,
        }

        try:
            test_embedding = arcface.extract_embedding(image_file.read_bytes())
        except ValueError as error:
            row["status"] = "ERROR"
            row["error_message"] = str(error)
            print(f"  {image_file.name:30s} | ❌ ERROR: {error}")
            log_rows.append(row)
            continue

        result = face_service.verify(
            test_embedding=test_embedding,
            reference_embedding=reference_embedding,
        )
        correct = _is_correct(condition, result["verified"])

        row.update(
            status=result["status"],
            verified=result["verified"],
            correct=correct,
            similarity=f"{result['similarity']:.4f}",
        )
        log_rows.append(row)

        correct_label = "n/a (ungraded)" if correct is None else ("✅ correct" if correct else "❌ WRONG")
        print(
            f"  {image_file.name:30s} | status={result['status']:9s} "
            f"| similarity={result['similarity']:.3f} (threshold={face_service.threshold}) "
            f"| {correct_label}"
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

        errors = [r for r in condition_rows if r["status"] == "ERROR"]
        evaluated = [r for r in condition_rows if r["status"] != "ERROR"]
        error_note = f" ({len(errors)} skipped: no/multiple faces)" if errors else ""

        if not evaluated:
            print(f"{condition:10s} | 0 evaluated{error_note}")
            continue

        if condition in EXPECTED_VERIFIED:
            n_correct = sum(1 for r in evaluated if r["correct"])
            expected = "VERIFIED" if EXPECTED_VERIFIED[condition] else "not VERIFIED"
            print(
                f"{condition:10s} | {n_correct}/{len(evaluated)} correct "
                f"(expected: {expected}, {n_correct / len(evaluated):.0%}){error_note}"
            )
        else:
            n_verified = sum(1 for r in evaluated if r["verified"])
            print(
                f"{condition:10s} | {n_verified}/{len(evaluated)} came back VERIFIED "
                f"(ungraded — no liveness check in this path, see module docstring){error_note}"
            )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run genuine/impostor/spoof photos through the real "
        "face-verification pipeline and log the results to a CSV file."
    )
    parser.add_argument("--dataset_dir", default=str(DATASET_DIR), help="Base dataset folder")
    parser.add_argument(
        "--enroll",
        default=None,
        help="Enrollment photo (default: <dataset_dir>/enroll.jpg|.jpeg|.png)",
    )
    parser.add_argument(
        "--log_file",
        default=str(Path(TEST_FILE_DIR) / "face_verification_test_log.csv"),
        help="CSV file to append results to",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help="Cosine similarity threshold (default: same as the live server, 0.45)",
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    if args.enroll:
        enroll_path = Path(args.enroll)
    else:
        enroll_path = next(
            (dataset_dir / f"enroll{ext}" for ext in IMAGE_EXTS if (dataset_dir / f"enroll{ext}").is_file()),
            dataset_dir / "enroll.jpg",
        )

    print("Loading ArcFaceModel...")
    arcface = ArcFaceModel()
    face_service = FaceRecognitionService(threshold=args.threshold)

    reference_embedding = _load_enrollment(enroll_path, arcface)

    log_rows: list[dict] = []
    for condition in CONDITIONS:
        _run_condition(
            condition,
            dataset_dir / condition,
            arcface,
            face_service,
            reference_embedding,
            log_rows,
        )

    _write_log(Path(args.log_file), log_rows)
    _print_summary(log_rows)
    print(f"\nLogged {len(log_rows)} result(s) to {args.log_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
