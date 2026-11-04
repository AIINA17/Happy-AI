"""Capture real face-verification runs for the /pipeline explainer page's
face-recognition block — same spirit as
voiceverification/analysis/capture_pipeline_traces.py: call the actual
recognition pipeline (insightface's buffalo_l FaceAnalysis, via
ArcFaceModel.app.get(), the exact object face_recognition/main.py uses)
directly on real local photos, so every number is measured, not invented.

Real per-stage data this captures, straight from InsightFace's own `Face`
object — no separate instrumentation needed, these ARE the real outputs of
each of buffalo_l's models in sequence:
  - detection (det_10g.onnx):      bbox, det_score
  - landmark (2d106det.onnx):      kps (5-pt), landmark_2d_106
  - alignment (insightface.utils.face_align.norm_crop, the exact function
    the recognition model calls internally before embedding):
                                    112x112 aligned face crop
  - recognition (w600k_r50.onnx, ArcFace): 512-d embedding

Decision: cosine similarity vs the enrolled embedding, threshold 0.45 (see
face_recognition/face_service.py) — VERIFIED or DENIED, no REPEAT/cascade
like the voice pipeline (this pipeline's decision logic really is just one
threshold check).

Important documented gap, carried over honestly: there is no liveness check
in this code path on a static image (see test_face_conditions.py's own
docstring) — liveness only runs against a live browser camera capture via a
separate blink/mouth/turn challenge (liveness_challenge.py). A photo of a
photo can plausibly still come back VERIFIED here; that's not a bug in this
script, it's the real, documented security boundary of this pipeline.

Run from backend/ (sys.path is fixed up below):
    python face_recognition/analysis/capture_face_traces.py

Writes face_traces.json next to this script. Copy to
frontend/public/pipeline-demo/face-traces.json to serve it statically.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))
FACE_DIR = os.path.dirname(ANALYSIS_DIR)
BACKEND_DIR = os.path.dirname(FACE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from face_recognition.arcface_model import ArcFaceModel  # noqa: E402
from face_recognition.face_service import FaceRecognitionService  # noqa: E402
from face_recognition.face_trace import decode_image, extract_face_trace, json_safe  # noqa: E402

DATASET_DIR = Path(FACE_DIR) / "dataset"
DEFAULT_OUT = Path(ANALYSIS_DIR) / "face_traces.json"

LIVENESS_NOTE = (
    "Pipeline ini TIDAK mengecek liveness pada foto statis — itu bukan "
    "celah yang luput diuji, tapi batas keamanan yang memang didokumentasikan "
    "di kode (lihat face_recognition/test_face_conditions.py). Liveness "
    "(kedip/mulut/toleh) hanya berjalan lewat tantangan kamera langsung di "
    "browser (liveness_challenge.py), terpisah dari jalur pengenalan ini."
)


def _extract(model: ArcFaceModel, path: Path) -> dict:
    img = decode_image(path.read_bytes())
    try:
        return extract_face_trace(model, img, source_file=str(path.relative_to(FACE_DIR)))
    except ValueError as e:
        raise SystemExit(f"{path}: {e}")


def main() -> int:
    model = ArcFaceModel()
    service = FaceRecognitionService(threshold=0.45)

    enroll_path = DATASET_DIR / "enroll.jpg"
    if not enroll_path.exists():
        raise SystemExit(f"Missing {enroll_path}")
    enroll = _extract(model, enroll_path)
    print(f"Enrolled from {enroll_path.name} — det_score={enroll['detection']['det_score']}")

    scenarios = []
    image_exts = ("*.jpg", "*.jpeg", "*.png")

    def _images(folder: Path) -> list[Path]:
        files: list[Path] = []
        for ext in image_exts:
            files.extend(folder.glob(ext))
        return sorted(files)

    def _pick(folder: Path, preferred: str | None = None) -> list[Path]:
        files = _images(folder)
        if preferred:
            match = [f for f in files if f.name == preferred]
            if match:
                return match[:1]
        return files[:1]

    genuine_files = _pick(DATASET_DIR / "genuine")
    impostor_files = _pick(DATASET_DIR / "impostor", "WhatsApp Image 2026-06-06 at 19.31.22.jpeg")
    for label, files, scenario_id, title in [
        ("genuine", genuine_files, "face_genuine_verified", "Wajah pemilik asli"),
        ("impostor", impostor_files, "face_impostor_denied", "Wajah orang lain"),
    ]:
        if not files:
            print(f"  (skip {label}: no files found)")
            continue
        path = files[0]
        probe = _extract(model, path)
        similarity = service.cosine_similarity(probe["_embedding"], enroll["_embedding"])
        decision = "VERIFIED" if similarity >= service.threshold else "DENIED"

        scenarios.append({
            "scenario_id": scenario_id,
            "title": title,
            "probe": json_safe(probe),
            "similarity": round(float(similarity), 4),
            "threshold": service.threshold,
            "decision": decision,
        })
        print(f"{scenario_id:25s} -> similarity={similarity:.4f} decision={decision}")

    out = {
        "liveness_note": LIVENESS_NOTE,
        "enrolled": json_safe(enroll),
        "threshold": service.threshold,
        "scenarios": scenarios,
    }

    DEFAULT_OUT.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_OUT.write_text(json.dumps(out, indent=2))
    print(f"\nWrote {len(scenarios)} scenario(s) to {DEFAULT_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
