#!/usr/bin/env python3
import argparse
from pathlib import Path

import librosa
import librosa.display
import matplotlib.pyplot as plt
import numpy as np

TARGET_SR = 16000
PREEMPHASIS_ALPHA = 0.97
N_MFCC = 80
N_FFT = 512
WIN_LENGTH = int(0.025 * TARGET_SR)   # 25 ms
HOP_LENGTH = int(0.010 * TARGET_SR)   # 10 ms
CMVN_EPS = 1e-8


def load_audio(path):
    y, sr = librosa.load(path, sr=TARGET_SR, mono=True)
    if len(y) == 0:
        raise ValueError("Audio kosong")

    peak = np.max(np.abs(y))
    if peak > 0:
        y = y / peak
    return y.astype(np.float32), sr


def pre_emphasis(y, alpha=PREEMPHASIS_ALPHA):
    return np.append(y[0], y[1:] - alpha * y[:-1]).astype(np.float32)


def compute_fft(y, sr):
    window = np.hanning(len(y))
    spectrum = np.fft.rfft(y * window)
    magnitude = np.abs(spectrum)
    if magnitude.max() > 0:
        magnitude /= magnitude.max()
    frequency = np.fft.rfftfreq(len(y), d=1.0 / sr)
    return frequency, magnitude


def compute_spectrogram(y):
    S = librosa.stft(
        y,
        n_fft=N_FFT,
        hop_length=HOP_LENGTH,
        win_length=WIN_LENGTH,
        window="hann",
    )
    return librosa.amplitude_to_db(np.abs(S), ref=np.max)


def compute_mfcc(y, sr):
    return librosa.feature.mfcc(
        y=y,
        sr=sr,
        n_mfcc=N_MFCC,
        n_fft=N_FFT,
        hop_length=HOP_LENGTH,
        win_length=WIN_LENGTH,
        window="hann",
        center=True,
    )


def apply_cmvn(mfcc):
    mean = np.mean(mfcc, axis=1, keepdims=True)
    std = np.std(mfcc, axis=1, keepdims=True)
    return (mfcc - mean) / (std + CMVN_EPS)


def make_combined_figure(
    y, sr, frequency, magnitude, spectrogram_db,
    mfcc, mfcc_cmvn, input_path, output_path
):
    t = np.arange(len(y)) / sr

    fig, axes = plt.subplots(
        5, 1, figsize=(13, 18), constrained_layout=True
    )

    # 1. Raw waveform
    axes[0].plot(t, y, linewidth=0.8)
    axes[0].set_title("1. Waveform Sinyal Mentah")
    axes[0].set_xlabel("Waktu (detik)")
    axes[0].set_ylabel("Amplitudo")
    axes[0].grid(True, alpha=0.25)

    # 2. FFT
    axes[1].plot(frequency, magnitude, linewidth=0.8)
    axes[1].set_title("2. Spektrum Frekuensi Hasil FFT")
    axes[1].set_xlabel("Frekuensi (Hz)")
    axes[1].set_ylabel("Magnitude ternormalisasi")
    axes[1].set_xlim(0, sr / 2)
    axes[1].grid(True, alpha=0.25)

    # 3. Spectrogram
    img = librosa.display.specshow(
        spectrogram_db,
        sr=sr,
        hop_length=HOP_LENGTH,
        x_axis="time",
        y_axis="hz",
        ax=axes[2],
    )
    axes[2].set_title("3. Spectrogram")
    axes[2].set_ylim(0, sr / 2)
    fig.colorbar(img, ax=axes[2], format="%+2.0f dB")

    # 4. MFCC
    img = librosa.display.specshow(
        mfcc, x_axis="time", ax=axes[3], cmap="viridis"
    )
    axes[3].set_title(f"4. MFCC ({N_MFCC} Koefisien)")
    axes[3].set_ylabel("Koefisien MFCC")
    fig.colorbar(img, ax=axes[3])

    # 5. MFCC + CMVN
    img = librosa.display.specshow(
        mfcc_cmvn, x_axis="time", ax=axes[4], cmap="viridis"
    )
    axes[4].set_title(f"5. MFCC Setelah CMVN ({N_MFCC} Koefisien)")
    axes[4].set_ylabel("Koefisien MFCC")
    axes[4].set_xlabel("Waktu (detik)")
    fig.colorbar(img, ax=axes[4])

    fig.suptitle(
        f"Visualisasi Tahapan Pemrosesan Audio\n"
        f"{input_path.name} | Sampling Rate = {sr} Hz",
        fontsize=16,
    )
    fig.savefig(output_path, dpi=300, bbox_inches="tight")
    plt.close(fig)


def save_individual_figures(
    y, sr, frequency, magnitude, spectrogram_db,
    mfcc, mfcc_cmvn, input_path, output_dir
):
    stem = input_path.stem

    # Waveform
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.plot(np.arange(len(y)) / sr, y, linewidth=0.8)
    ax.set_title("Waveform Sinyal Mentah")
    ax.set_xlabel("Waktu (detik)")
    ax.set_ylabel("Amplitudo")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(output_dir / f"{stem}_01_waveform.png", dpi=300)
    plt.close(fig)

    # FFT
    fig, ax = plt.subplots(figsize=(12, 4))
    ax.plot(frequency, magnitude, linewidth=0.8)
    ax.set_title("Spektrum Frekuensi Hasil FFT")
    ax.set_xlabel("Frekuensi (Hz)")
    ax.set_ylabel("Magnitude ternormalisasi")
    ax.set_xlim(0, sr / 2)
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(output_dir / f"{stem}_02_fft.png", dpi=300)
    plt.close(fig)

    # Spectrogram
    fig, ax = plt.subplots(figsize=(12, 5))
    img = librosa.display.specshow(
        spectrogram_db, sr=sr, hop_length=HOP_LENGTH,
        x_axis="time", y_axis="hz", ax=ax
    )
    ax.set_title("Spectrogram")
    ax.set_ylim(0, sr / 2)
    fig.colorbar(img, ax=ax, format="%+2.0f dB")
    fig.tight_layout()
    fig.savefig(output_dir / f"{stem}_03_spectrogram.png", dpi=300)
    plt.close(fig)

    # MFCC
    fig, ax = plt.subplots(figsize=(12, 6))
    img = librosa.display.specshow(
        mfcc, x_axis="time", ax=ax, cmap="viridis"
    )
    ax.set_title(f"MFCC ({N_MFCC} Koefisien)")
    ax.set_ylabel("Koefisien MFCC")
    fig.colorbar(img, ax=ax)
    fig.tight_layout()
    fig.savefig(output_dir / f"{stem}_04_mfcc.png", dpi=300)
    plt.close(fig)

    # MFCC CMVN
    fig, ax = plt.subplots(figsize=(12, 6))
    img = librosa.display.specshow(
        mfcc_cmvn, x_axis="time", ax=ax, cmap="viridis"
    )
    ax.set_title(f"MFCC Setelah CMVN ({N_MFCC} Koefisien)")
    ax.set_ylabel("Koefisien MFCC")
    ax.set_xlabel("Waktu (detik)")
    fig.colorbar(img, ax=ax)
    fig.tight_layout()
    fig.savefig(output_dir / f"{stem}_05_mfcc_cmvn.png", dpi=300)
    plt.close(fig)


def process_one_file(input_path, output_dir):
    print("=" * 70)
    print(f"Memproses: {input_path}")

    y, sr = load_audio(str(input_path))

    # FFT dan spectrogram dari sinyal mentah.
    frequency, magnitude = compute_fft(y, sr)
    spectrogram_db = compute_spectrogram(y)

    # Pre-emphasis sebelum MFCC, sesuai pipeline yang terdokumentasi.
    y_preemph = pre_emphasis(y)

    # MFCC 80 dimensi dan CMVN per-utterance.
    mfcc = compute_mfcc(y_preemph, sr)
    mfcc_cmvn = apply_cmvn(mfcc)

    stem = input_path.stem
    combined_path = output_dir / f"{stem}_pipeline.png"

    make_combined_figure(
        y, sr, frequency, magnitude, spectrogram_db,
        mfcc, mfcc_cmvn, input_path, combined_path
    )

    save_individual_figures(
        y, sr, frequency, magnitude, spectrogram_db,
        mfcc, mfcc_cmvn, input_path, output_dir
    )

    print(f"Sample rate      : {sr} Hz")
    print(f"Durasi           : {len(y) / sr:.3f} detik")
    print(f"Ukuran MFCC      : {mfcc.shape}")
    print(f"Ukuran MFCC CMVN : {mfcc_cmvn.shape}")
    print(f"Mean CMVN        : {np.mean(mfcc_cmvn):.6f}")
    print(f"Std CMVN         : {np.std(mfcc_cmvn):.6f}")
    print(f"Figure gabungan  : {combined_path}")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Visualisasi waveform, FFT, spectrogram, MFCC, "
            "dan MFCC setelah CMVN."
        )
    )
    parser.add_argument(
        "inputs", nargs="+",
        help="Satu atau beberapa file audio."
    )
    parser.add_argument(
        "--output-dir", default="visualisasi_audio",
        help="Folder hasil visualisasi."
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for item in args.inputs:
        input_path = Path(item)
        if not input_path.exists():
            print(f"[WARNING] File tidak ditemukan: {input_path}")
            continue
        try:
            process_one_file(input_path, output_dir)
        except Exception as exc:
            print(f"[ERROR] {input_path}: {exc}")

    print("\n" + "=" * 70)
    print("SELESAI")
    print(f"Hasil tersimpan di: {output_dir.resolve()}")
    print("=" * 70)


if __name__ == "__main__":
    main()