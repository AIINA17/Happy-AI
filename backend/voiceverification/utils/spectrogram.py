"""Render an STFT spectrogram PNG from a WAV file, for the analysis dashboard."""

import io

import librosa
import librosa.display
import matplotlib

# Must be selected before pyplot is imported: the server has no GUI backend.
matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

SR = 16000
N_FFT = 1024
HOP_LENGTH = 512


def render_spectrogram_png(wav_path: str, title: str) -> bytes:
    y, sr = librosa.load(wav_path, sr=SR, mono=True)

    magnitude_db = librosa.amplitude_to_db(
        np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP_LENGTH)),
        ref=np.max,
    )

    fig, ax = plt.subplots(figsize=(12, 5))

    img = librosa.display.specshow(
        magnitude_db,
        sr=sr,
        hop_length=HOP_LENGTH,
        x_axis="time",
        y_axis="hz",
        ax=ax,
    )

    ax.set_title(f"Spektrogram - {title}")
    ax.set_xlabel("Waktu (detik)")
    ax.set_ylabel("Frekuensi (Hz)")
    fig.colorbar(img, ax=ax, format="%+2.0f dB")

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=100, bbox_inches="tight")
    plt.close(fig)

    return buffer.getvalue()
