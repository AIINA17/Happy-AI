import os
import librosa

from voiceverification.core.pitch import pitch_similarity
from voiceverification.core.speaking_rate import speaking_rate_similarity
from voiceverification.core.fusion import fuse
from voiceverification.models.speaker_verifier import SpeakerVerifier
from voiceverification.core.calibration import find_eer_threshold


def calibrate_biometric(genuine_dir, impostor_dir, enroll_path):
    verifier = SpeakerVerifier()

    genuine_scores = []
    impostor_scores = []

    print("[BIOMETRIC CALIBRATION] Starting calibration...")
    for f in os.listdir(genuine_dir):
        print(f"[BIOMETRIC CALIBRATION] Processing genuine file: {f}")
        live = os.path.join(genuine_dir, f)
        ecapa = verifier.verify(live, enroll_path)

        y1, sr = librosa.load(live, sr=16000)
        y2, _  = librosa.load(enroll_path, sr=16000)

        score = fuse(
            ecapa,
            pitch_similarity(y1, y2, sr),
            speaking_rate_similarity(y1, y2, sr),
        )
        genuine_scores.append(score)

    for f in os.listdir(impostor_dir):
        print(f"[BIOMETRIC CALIBRATION] Processing impostor file: {f}")
        live = os.path.join(impostor_dir, f)
        ecapa = verifier.verify(live, enroll_path)

        y1, sr = librosa.load(live, sr=16000)
        y2, _  = librosa.load(enroll_path, sr=16000)

        score = fuse(
            ecapa,
            pitch_similarity(y1, y2, sr),
            speaking_rate_similarity(y1, y2, sr),
        )
        impostor_scores.append(score)

    threshold, eer = find_eer_threshold(
        genuine_scores, impostor_scores
    )

    print(f"[BIOMETRIC CALIBRATION] Completed.")
    print(f"Threshold : {threshold:.4f}")
    print(f"EER       : {eer*100:.2f}%")

    return threshold

if __name__ == "__main__":
    import sys

    if len(sys.argv) != 4:
        print("Usage:")
        print("  python -m voiceverification.services.calibrate_biometric <genuine_dir> <impostor_dir> <enroll_path>")
        sys.exit(1)

    genuine_dir = sys.argv[1]
    impostor_dir = sys.argv[2]
    enroll_path = sys.argv[3]

    calibrate_biometric(genuine_dir, impostor_dir, enroll_path)