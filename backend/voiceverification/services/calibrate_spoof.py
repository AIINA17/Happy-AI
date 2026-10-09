import os
from voiceverification.core.asvspoof import compute_score
from voiceverification.core.calibration import find_eer_threshold


def calibrate_spoof(genuine_dir, spoof_dir):
    genuine_scores = []
    spoof_scores = []
    print("[ANTI-SPOOF CALIBRATION] Starting calibration...")
    for f in os.listdir(genuine_dir):
        print(f"[ANTI-SPOOF CALIBRATION] Processing genuine file: {f}")
        score, _ = compute_score(os.path.join(genuine_dir, f))
        genuine_scores.append(score)

    for f in os.listdir(spoof_dir):
        print(f"[ANTI-SPOOF CALIBRATION] Processing spoof file: {f}")
        score, _ = compute_score(os.path.join(spoof_dir, f))
        spoof_scores.append(score)

    threshold, eer = find_eer_threshold(
        scores_genuine=genuine_scores,
        scores_impostor=spoof_scores
    )

    print(f"[ANTI-SPOOF CALIBRATION]")
    print(f"Threshold : {threshold:.4f}")
    print(f"EER       : {eer*100:.2f}%")

    return threshold

if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print("Usage:")
        print("  python -m services.calibrate_spoof <genuine_dir> <spoof_dir>")
        sys.exit(1)

    genuine_dir = sys.argv[1]
    spoof_dir = sys.argv[2]

    calibrate_spoof(genuine_dir, spoof_dir)
