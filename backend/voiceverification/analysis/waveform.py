from pathlib import Path

import librosa
import librosa.display
import matplotlib.pyplot as plt
import numpy as np


# ============================================================
# KONFIGURASI
# ============================================================

# = voiceverification/dataset (this script now lives in voiceverification/analysis)
DATASET_DIR = Path(__file__).resolve().parent.parent / "dataset"

CLASSES = ["genuine", "impostor", "spoof"]

SR = 16000
N_FFT = 1024
HOP_LENGTH = 512


# ============================================================
# MENCARI FILE AUDIO
# ============================================================

def get_audio_file(folder):
    extensions = [
        "*.wav",
        "*.mp3",
        "*.flac",
        "*.ogg",
        "*.m4a"
    ]

    files = []

    for extension in extensions:
        # rglob digunakan agar file juga dicari
        # sampai ke dalam subfolder
        files.extend(folder.rglob(extension))

    if not files:
        return None

    # Menggunakan file pertama yang ditemukan
    return files[0]


# ============================================================
# MEMBUAT WAVEFORM
# ============================================================

def create_waveform(y, sr, class_name):
    plt.figure(figsize=(12, 4))

    librosa.display.waveshow(
        y,
        sr=sr
    )

    plt.title(
        f"Waveform - {class_name.capitalize()}"
    )

    plt.xlabel("Waktu (detik)")
    plt.ylabel("Amplitudo")

    plt.tight_layout()

    output_file = (
        DATASET_DIR /
        f"waveform_{class_name}.png"
    )

    plt.savefig(
        output_file,
        dpi=300,
        bbox_inches="tight"
    )

    plt.close()

    print(f"Waveform disimpan: {output_file}")


# ============================================================
# MEMBUAT SPEKTROGRAM
# ============================================================

def create_spectrogram(y, sr, class_name):

    # STFT
    D = librosa.stft(
        y,
        n_fft=N_FFT,
        hop_length=HOP_LENGTH
    )

    # Magnitude
    magnitude = np.abs(D)

    # Konversi ke decibel
    magnitude_db = librosa.amplitude_to_db(
        magnitude,
        ref=np.max
    )

    # Buat figure terpisah
    plt.figure(figsize=(12, 5))

    img = librosa.display.specshow(
        magnitude_db,
        sr=sr,
        hop_length=HOP_LENGTH,
        x_axis="time",
        y_axis="hz"
    )

    plt.colorbar(
        img,
        format="%+2.0f dB"
    )

    plt.title(
        f"Spektrogram - {class_name.capitalize()}"
    )

    plt.xlabel("Waktu (detik)")
    plt.ylabel("Frekuensi (Hz)")

    plt.tight_layout()

    output_file = (
        DATASET_DIR /
        f"spectrogram_{class_name}.png"
    )

    plt.savefig(
        output_file,
        dpi=300,
        bbox_inches="tight"
    )

    plt.close()

    print(f"Spektrogram disimpan: {output_file}")


# ============================================================
# PROSES DATASET
# ============================================================

for class_name in CLASSES:

    folder = DATASET_DIR / class_name

    audio_file = get_audio_file(folder)

    if audio_file is None:
        print(
            f"Tidak ditemukan file audio pada: "
            f"{folder}"
        )
        continue

    print("\n========================================")
    print(f"Kondisi : {class_name}")
    print(f"File    : {audio_file}")
    print("========================================")

    # Load audio
    y, sr = librosa.load(
        audio_file,
        sr=SR,
        mono=True
    )

    # Buat waveform
    create_waveform(
        y,
        sr,
        class_name
    )

    # Buat spektrogram
    create_spectrogram(
        y,
        sr,
        class_name
    )


print("\nSemua visualisasi selesai dibuat.")