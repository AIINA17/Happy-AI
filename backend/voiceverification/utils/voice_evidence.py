"""Visual evidence for "how do you know two voices are different?".

Builds the plots for defending the speaker-verification pipeline: the actual
192-D ECAPA-TDNN speaker embeddings collapsed to 2D, the cosine-similarity
score gap between genuine and impostor attempts, the behavioral (pitch/rate)
signal, and the ROC/EER — all computed from the same dataset/{genuine,
impostor} used by utils/roc_analysis.py.

Not used by the live server. Run from backend/voiceverification/:
    python -m utils.voice_evidence
"""

import os
import sys

import librosa
import matplotlib.pyplot as plt
import numpy as np
from sklearn.decomposition import PCA
from sklearn.metrics import roc_curve

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(os.path.dirname(_HERE))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from voiceverification.core.calibration import find_eer_threshold
from voiceverification.core.decision_engine import DecisionConfig
from voiceverification.models.speaker_verifier import SpeakerVerifier

_DATASET_DIR = os.path.join(os.path.dirname(_HERE), "dataset")
ENROLL = os.path.join(_DATASET_DIR, "enroll.wav")
GENUINE_DIR = os.path.join(_DATASET_DIR, "genuine")
IMPOSTOR_DIR = os.path.join(_DATASET_DIR, "impostor")
OUT_PATH = os.path.join(_DATASET_DIR, "voice_evidence.png")


def _wavs(folder):
    return sorted(
        os.path.join(folder, f)
        for f in os.listdir(folder)
        if f.endswith((".wav", ".mp3"))
    )


def _mean_pitch(y, sr):
    f0 = librosa.yin(y, fmin=50, fmax=300, sr=sr)
    return float(np.nanmean(f0))


def main():
    verifier = SpeakerVerifier()
    enroll_emb = verifier.extract_embedding(ENROLL)

    labels, embeddings, scores, pitches, rates = [], [], [], [], []
    for folder, label in [(GENUINE_DIR, "genuine"), (IMPOSTOR_DIR, "impostor")]:
        for path in _wavs(folder):
            emb = verifier.extract_embedding(path)
            score = verifier.compare_embeddings(emb, enroll_emb)

            y, sr = librosa.load(path, sr=16000)
            pitch = _mean_pitch(y, sr)
            rate = len(y) / sr

            labels.append(label)
            embeddings.append(emb)
            scores.append(score)
            pitches.append(pitch)
            rates.append(rate)

            print(
                f"{os.path.basename(path):16s} | {label:9s} | "
                f"score={score:.3f} pitch={pitch:.1f}Hz dur={rate:.2f}s"
            )

    labels = np.array(labels)
    embeddings = np.array(embeddings)
    scores = np.array(scores)
    pitches = np.array(pitches)
    rates = np.array(rates)
    is_genuine = labels == "genuine"

    # Speaker embeddings (incl. enroll) projected 192-D -> 2D.
    coords = PCA(n_components=2).fit_transform(np.vstack([enroll_emb, embeddings]))
    enroll_xy, sample_xy = coords[0], coords[1:]

    eer_threshold, eer = find_eer_threshold(scores[is_genuine], scores[~is_genuine])
    fpr, tpr, _ = roc_curve(is_genuine.astype(int), scores)

    fig, axes = plt.subplots(2, 2, figsize=(11, 10))

    ax = axes[0, 0]
    ax.scatter(*sample_xy[is_genuine].T, c="tab:green", label="genuine (orang sama)")
    ax.scatter(*sample_xy[~is_genuine].T, c="tab:red", label="impostor (orang lain)")
    ax.scatter(*enroll_xy, c="black", marker="*", s=250, label="enrolled voice")
    ax.set_title("Speaker embedding (ECAPA-TDNN, 192-D -> 2D via PCA)")
    ax.set_xlabel("PC1")
    ax.set_ylabel("PC2")
    ax.legend()

    ax = axes[0, 1]
    ax.hist(scores[is_genuine], bins=10, alpha=0.7, color="tab:green", label="genuine")
    ax.hist(scores[~is_genuine], bins=10, alpha=0.7, color="tab:red", label="impostor")
    ax.axvline(DecisionConfig().voice_accept, color="black", linestyle="--", label="accept threshold")
    ax.set_title("Cosine similarity to enrolled voice")
    ax.set_xlabel("score")
    ax.set_ylabel("count")
    ax.legend()

    ax = axes[1, 0]
    ax.scatter(pitches[is_genuine], rates[is_genuine], c="tab:green", label="genuine")
    ax.scatter(pitches[~is_genuine], rates[~is_genuine], c="tab:red", label="impostor")
    ax.set_title("Behavioral biometric: pitch vs speaking duration")
    ax.set_xlabel("mean pitch (Hz)")
    ax.set_ylabel("duration (s)")
    ax.legend()

    ax = axes[1, 1]
    ax.plot(fpr, tpr, label="ROC")
    ax.plot([0, 1], [0, 1], "k--")
    ax.set_title(f"ROC curve (EER = {eer:.1%})")
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.legend()

    fig.tight_layout()
    fig.savefig(OUT_PATH, dpi=150)

    print(f"\nSaved -> {OUT_PATH}")
    print(f"Genuine score:  mean={scores[is_genuine].mean():.3f} std={scores[is_genuine].std():.3f}")
    print(f"Impostor score: mean={scores[~is_genuine].mean():.3f} std={scores[~is_genuine].std():.3f}")
    print(f"EER: {eer:.1%} at threshold {eer_threshold:.3f}")


if __name__ == "__main__":
    main()
