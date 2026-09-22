import os
import numpy as np
import librosa
import warnings

from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

warnings.filterwarnings("ignore", category=RuntimeWarning)

SR = 16000
N_FFT = 1024
HOP = 512

# Feature extraction (same logic as inference)
def extract_features(path):
    try:
        y, _ = librosa.load(path, sr=SR, mono=True)
        if len(y) == 0:
            return None

        y, _ = librosa.effects.trim(y, top_db=25)
        if len(y) < 1024:
            return None

        stft = np.abs(
            librosa.stft(y, n_fft=N_FFT, hop_length=HOP)
        ) + 1e-9

        # 1. Spectral Flatness
        flat = np.mean(
            librosa.feature.spectral_flatness(S=stft)
        )

        # 2. Temporal Energy Variance (NORMALIZED)
        energy = np.mean(stft, axis=0)
        if np.max(energy) > 0:
            energy /= np.max(energy)
        temp_var = np.var(energy)

        # 3. High-band Energy Ratio
        freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)

        voice_band = stft[(freqs > 300) & (freqs < 3400)]
        high_band  = stft[(freqs > 10000) & (freqs < 16000)]

        voice = np.mean(voice_band) if voice_band.size > 0 else 0.0
        high  = np.mean(high_band)  if high_band.size > 0 else 0.0

        high_ratio = high / voice if voice > 1e-6 else 0.0

        return [flat, temp_var, high_ratio]

    except Exception as e:
        print(f"Error {path}: {e}")
        return None


# Load training dataset (genuine, impostor, spoof)
def load_dataset(base="dataset"):
    X, y = [], []

    # POSITIVE CLASS: genuine user
    genuine_dir = os.path.join(base, "genuine")
    for f in os.listdir(genuine_dir):
        path = os.path.join(genuine_dir, f)
        feat = extract_features(path)
        if feat is not None:
            X.append(feat)
            y.append(1)

    # POSITIVE CLASS: impostor (human lain, tapi suara LIVE/asli — bukan
    # rekaman). Untuk anti-spoofing ini tetap "genuine" (label 1), karena
    # model ini cuma mendeteksi live vs rekaman/replay, bukan identitas
    # siapa yang bicara (itu tugas speaker verification, bukan di sini).
    impostor_dir = os.path.join(base, "impostor")
    for f in os.listdir(impostor_dir):
        path = os.path.join(impostor_dir, f)
        feat = extract_features(path)
        if feat is not None:
            X.append(feat)
            y.append(1)

    # NEGATIVE CLASS: spoof (rekaman/replay)
    spoof_dir = os.path.join(base, "spoof")
    for f in os.listdir(spoof_dir):
        path = os.path.join(spoof_dir, f)
        feat = extract_features(path)
        if feat is not None:
            X.append(feat)
            y.append(0)

    return np.array(X), np.array(y)


# Train lightweight ASVspoof detector
def train():
    print("🔄 Loading dataset...")
    X, y = load_dataset()

    print(f"Total samples : {len(X)}")
    print(f"Genuine  (1)  : {np.sum(y==1)}")
    print(f"Negative (0)  : {np.sum(y==0)}")

    Xtr, Xte, ytr, yte = train_test_split(
        X, y,
        test_size=0.3,
        stratify=y,
        random_state=42
    )

    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(
            max_iter=1000,
            class_weight="balanced"
        ))
    ])

    pipe.fit(Xtr, ytr)

    print("\n📊 Evaluation:")
    ypred = pipe.predict(Xte)
    print(confusion_matrix(yte, ypred))
    print(classification_report(yte, ypred, digits=4))

    # Extract model parameters for inference implementation
    scaler = pipe.named_steps["scaler"]
    clf    = pipe.named_steps["clf"]

    print("\n📌 COPY KE asvspoof.py:")
    print("-" * 60)
    print("MODEL_MEANS  =", list(scaler.mean_))
    print("MODEL_SCALES =", list(scaler.scale_))
    print("MODEL_COEFFS =", list(clf.coef_[0]))
    print("MODEL_BIAS   =", float(clf.intercept_[0]))
    print("-" * 60)


if __name__ == "__main__":
    train()
