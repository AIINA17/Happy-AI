"""
Offline ROC/EER analysis for the currently deployed speaker verification +
anti-spoofing pipeline, run against dataset/{genuine,impostor,spoof}.

Not used by the live server — run directly:
    python -m utils.roc_analysis
"""

import os

import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import roc_curve

from core.asvspoof import compute_score
from services.biometric_service import BiometricService

ENROLL = "dataset/enroll.wav"
GENUINE_DIR = "dataset/genuine"
IMPOSTOR_DIR = "dataset/impostor"
SPOOF_DIR = "dataset/spoof"


def process_folder(folder, label, biometric, enroll_embeddings):
    speaker_scores, spoof_scores, labels = [], [], []

    for f in sorted(os.listdir(folder)):
        path = os.path.join(folder, f)
        if not (f.endswith(".wav") or f.endswith(".mp3")):
            continue

        result = biometric.verify_against_multiple_embeddings(
            live_wav=path,
            enroll_embeddings=enroll_embeddings,
        )
        spk = result["score"]
        spoof = compute_score(path)[0]

        speaker_scores.append(spk)
        spoof_scores.append(spoof)
        labels.append(label)

        print(f"{f:20s} | speaker={spk:.3f} spoof={spoof:.3f} label={label}")

    return speaker_scores, spoof_scores, labels


def main():
    biometric = BiometricService()
    enroll_embeddings = [{
        "embedding": biometric.speaker.extract_embedding(ENROLL),
        "label": "enroll",
    }]

    speaker_scores, spoof_scores, labels = [], [], []
    for folder, label, name in [
        (GENUINE_DIR, 1, "genuine"),
        (IMPOSTOR_DIR, 0, "impostor"),
        (SPOOF_DIR, 0, "spoof"),
    ]:
        print(f"▶ Processing {name}")
        spk, spf, lbl = process_folder(folder, label, biometric, enroll_embeddings)
        speaker_scores += spk
        spoof_scores += spf
        labels += lbl

    speaker_scores = np.array(speaker_scores)
    spoof_scores = np.array(spoof_scores)
    labels = np.array(labels)

    # === ROC: speaker verification only ===
    fpr, tpr, thresholds = roc_curve(labels, speaker_scores)
    eer_idx = np.argmin(np.abs(fpr - (1 - tpr)))
    eer_threshold = thresholds[eer_idx]
    eer = fpr[eer_idx]

    print("\n=== SPEAKER ROC ===")
    print(f"EER        : {eer:.3f}")
    print(f"EER thresh : {eer_threshold:.3f}")

    plt.figure(figsize=(6, 6))
    plt.plot(fpr, tpr, label="Speaker ROC")
    plt.plot([0, 1], [1, 0], "k--")
    plt.scatter(fpr[eer_idx], tpr[eer_idx], color="red", label=f"EER={eer:.2f}")
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.title("Speaker Verification ROC")
    plt.legend()
    plt.grid()
    plt.tight_layout()
    plt.show()

    # === ROC: speaker + anti-spoof combined ===
    combined_scores = 0.7 * speaker_scores + 0.3 * (1 - spoof_scores)

    fpr_c, tpr_c, th_c = roc_curve(labels, combined_scores)
    eer_idx_c = np.argmin(np.abs(fpr_c - (1 - tpr_c)))
    eer_c = fpr_c[eer_idx_c]
    eer_th_c = th_c[eer_idx_c]

    print("\n=== COMBINED ROC ===")
    print(f"EER        : {eer_c:.3f}")
    print(f"EER thresh : {eer_th_c:.3f}")

    plt.figure(figsize=(6, 6))
    plt.plot(fpr_c, tpr_c, label="Combined ROC")
    plt.plot([0, 1], [1, 0], "k--")
    plt.scatter(fpr_c[eer_idx_c], tpr_c[eer_idx_c], color="red", label=f"EER={eer_c:.2f}")
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.title("Combined Verification ROC")
    plt.legend()
    plt.grid()
    plt.tight_layout()
    plt.show()


if __name__ == "__main__":
    main()
