import os
import numpy as np
import matplotlib.pyplot as plt
from sklearn.metrics import roc_curve
from voiceverification.core.decision_engine import DecisionConfig

# === IMPORT MODEL KAMU ===
from voiceverification.services.biometric_service import BiometricService
from voiceverification.core.replay_heuristic import replay_heuristic

ENROLL = "voiceverification/dataset/enroll.wav"
GENUINE_DIR = "voiceverification/dataset/genuine"
IMPOSTOR_DIR = "voiceverification/dataset/impostor"
SPOOF_DIR = "voiceverification/dataset/spoof"

speaker_scores = []
replay_scores = []
labels = []  # 1 = genuine, 0 = impostor/spoof



def process_folder(folder, label):
    biometric = BiometricService()

    for f in os.listdir(folder):
        path = os.path.join(folder, f)
        if not f.endswith(".wav"):
            continue

        spk = biometric.verify_user(path, ENROLL)["final_score"]
        rep = replay_heuristic(path)["replay_prob"]

        speaker_scores.append(spk)
        replay_scores.append(rep)
        labels.append(label)

        print(f"{f:20s} | speaker={spk:.3f} replay={rep:.3f} label={label}")


print("▶ Processing genuine")
process_folder(GENUINE_DIR, 1)

print("▶ Processing impostor")
process_folder(IMPOSTOR_DIR, 0)

print("▶ Processing spoof")
process_folder(SPOOF_DIR, 0)

speaker_scores = np.array(speaker_scores)
replay_scores = np.array(replay_scores)
labels = np.array(labels)

# === ROC SPEAKER ONLY ===
fpr, tpr, thresholds = roc_curve(labels, speaker_scores)
eer_idx = np.argmin(np.abs(fpr - (1 - tpr)))
eer_threshold = thresholds[eer_idx]
eer = fpr[eer_idx]

print("\n=== SPEAKER ROC ===")
print(f"EER        : {eer:.3f}")
print(f"EER thresh : {eer_threshold:.3f}")

# === PLOT ROC ===
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

# === COMBINED SCORE ROC ===
combined_scores = 0.7 * speaker_scores + 0.3 * (1 - replay_scores)

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
