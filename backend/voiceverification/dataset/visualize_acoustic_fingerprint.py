"""
Visualisasi ciri akustik MENTAH yang sebenarnya ditangkap ECAPA-TDNN,
sebelum diringkas jadi embedding 192-D. Untuk keperluan presentasi/sidang.

Berbeda dari visualize_speaker_fingerprint.py (yang memvisualisasikan
embedding hasil model), file ini memvisualisasikan input & fitur akustik
level rendah:

1. mel_filterbank_input.png
   80-band log-mel filterbank -- INI ADALAH INPUT ASLI yang masuk ke
   ECAPA-TDNN (persis hasil `compute_features` + `mean_var_norm` di
   pipeline SpeechBrain, lihat hyperparams.yaml: compute_features =
   Fbank(n_mels=80)). Ditampilkan untuk Enroll, satu sampel Genuine,
   dan satu sampel Impostor supaya terlihat pola formant/energinya beda.

2. mel_energy_profile.png
   Rata-rata energi tiap pita mel (mean sepanjang waktu) -> "amplop
   spektral" / warna suara (timbre) tiap orang, dibandingkan antara
   Enroll, rata-rata seluruh Genuine, dan rata-rata seluruh Impostor.

3. pitch_f0_comparison.png
   Kontur pitch (F0) memakai librosa.pyin -- "nada dasar suara" yang
   paling mudah dipahami orang awam sebagai ciri khas suara seseorang.
   Panel kiri: kontur F0 sepanjang waktu untuk satu sampel tiap kelas.
   Panel kanan: boxplot F0 rata-rata per file, Genuine vs Impostor.
"""

import os
import glob

import numpy as np
import torch
import librosa
import matplotlib.pyplot as plt

from voiceverification.models.speaker_verifier import SpeakerVerifier

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENROLL_WAV = os.path.join(BASE_DIR, "enroll.wav")
GENUINE_DIR = os.path.join(BASE_DIR, "genuine")
IMPOSTOR_DIR = os.path.join(BASE_DIR, "impostor")

OUT_FBANK = os.path.join(BASE_DIR, "mel_filterbank_input.png")
OUT_PROFILE = os.path.join(BASE_DIR, "mel_energy_profile.png")
OUT_PITCH = os.path.join(BASE_DIR, "pitch_f0_comparison.png")

SR = 16000


def audio_files(folder):
    files = []
    for ext in ("*.wav", "*.WAV", "*.flac", "*.FLAC", "*.mp3", "*.MP3"):
        files.extend(glob.glob(os.path.join(folder, ext)))
    return sorted(files)


def compute_fbank(sb_model, wav_path):
    """Fitur log-mel persis seperti yang dipakai ECAPA-TDNN SpeechBrain
    (Fbank 80-band + sentence-level mean normalization)."""
    waveform = sb_model.load_audio(wav_path)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    wav_lens = torch.ones(waveform.shape[0])
    with torch.no_grad():
        feats = sb_model.mods.compute_features(waveform)
        feats = sb_model.mods.mean_var_norm(feats, wav_lens)
    return feats.squeeze(0).cpu().numpy()  # (T, 80)


def compute_fbank_raw(sb_model, wav_path):
    """Log-mel SEBELUM sentence-level mean normalization. mean_var_norm
    membuang rata-rata tiap pita per file (biar tahan beda perangkat
    rekam) -- jadi bentuk amplop spektral khas orang cuma kelihatan di
    versi mentah ini, bukan versi yang sudah dinormalisasi."""
    waveform = sb_model.load_audio(wav_path)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    with torch.no_grad():
        feats = sb_model.mods.compute_features(waveform)
    return feats.squeeze(0).cpu().numpy()  # (T, 80)


def plot_fbank_triplet(sb_model):
    genuine_files = audio_files(GENUINE_DIR)
    impostor_files = audio_files(IMPOSTOR_DIR)

    fb_enroll = compute_fbank(sb_model, ENROLL_WAV)
    fb_genuine = compute_fbank(sb_model, genuine_files[0])
    fb_impostor = compute_fbank(sb_model, impostor_files[0])

    vmin = min(fb_enroll.min(), fb_genuine.min(), fb_impostor.min())
    vmax = max(fb_enroll.max(), fb_genuine.max(), fb_impostor.max())

    fig, axes = plt.subplots(3, 1, figsize=(12, 10), sharex=False)
    data = [
        (fb_enroll, f"Enroll ({os.path.basename(ENROLL_WAV)})"),
        (fb_genuine, f"Genuine ({os.path.basename(genuine_files[0])}) -- orang yang sama"),
        (fb_impostor, f"Impostor ({os.path.basename(impostor_files[0])}) -- orang berbeda"),
    ]

    for ax, (fb, title) in zip(axes, data):
        im = ax.imshow(
            fb.T, origin="lower", aspect="auto", cmap="magma", vmin=vmin, vmax=vmax,
            extent=[0, fb.shape[0] * 0.01, 0, 80],
        )
        ax.set_title(title, fontsize=10, loc="left")
        ax.set_ylabel("Indeks Pita Mel (0-79)")

    axes[-1].set_xlabel("Waktu (detik)")
    fig.colorbar(im, ax=axes, label="Log-Mel Energy (ternormalisasi)", fraction=0.02, pad=0.02)
    fig.suptitle(
        "Log-Mel Filterbank (80 pita): Input Asli ke ECAPA-TDNN\n"
        "Perhatikan pola pita gelap/terang (formant) berbeda antara baris 1-2 (orang sama) vs baris 3 (orang lain)",
        fontsize=12,
    )
    fig.savefig(OUT_FBANK, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"Disimpan: {OUT_FBANK}")


def plot_mel_energy_profile(sb_model):
    genuine_files = audio_files(GENUINE_DIR)
    impostor_files = audio_files(IMPOSTOR_DIR)

    def avg_profile(paths):
        profiles = []
        for p in paths:
            fb = compute_fbank_raw(sb_model, p)
            profiles.append(fb.mean(axis=0))  # rata-rata sepanjang waktu -> (80,)
        return np.mean(profiles, axis=0), np.std(profiles, axis=0)

    enroll_profile = compute_fbank_raw(sb_model, ENROLL_WAV).mean(axis=0)
    genuine_mean, genuine_std = avg_profile(genuine_files)
    impostor_mean, impostor_std = avg_profile(impostor_files)

    dist_genuine = float(np.linalg.norm(enroll_profile - genuine_mean))
    dist_impostor = float(np.linalg.norm(enroll_profile - impostor_mean))
    closer = "Genuine" if dist_genuine < dist_impostor else "Impostor"
    subtitle = (
        f"Amplop Enroll lebih dekat ke {closer} "
        f"(jarak ke Genuine={dist_genuine:.2f}, ke Impostor={dist_impostor:.2f})"
    )

    x = np.arange(80)
    plt.figure(figsize=(12, 6))
    plt.plot(x, enroll_profile, color="#d62728", linewidth=2, label="Enroll")
    plt.plot(x, genuine_mean, color="#1f77b4", linewidth=2, label=f"Rata-rata Genuine (n={len(genuine_files)})")
    plt.fill_between(x, genuine_mean - genuine_std, genuine_mean + genuine_std, color="#1f77b4", alpha=0.15)
    plt.plot(x, impostor_mean, color="#ff7f0e", linewidth=2, label=f"Rata-rata Impostor (n={len(impostor_files)})")
    plt.fill_between(x, impostor_mean - impostor_std, impostor_mean + impostor_std, color="#ff7f0e", alpha=0.15)

    plt.xlabel("Indeks Pita Mel (0 = frekuensi rendah, 79 = frekuensi tinggi)")
    plt.ylabel("Rata-rata Log-Mel Energy (mentah, sebelum normalisasi)")
    plt.title(f"Amplop Spektral Rata-rata (\"Warna Suara\") per Kelompok\n{subtitle}")
    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(OUT_PROFILE, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"Disimpan: {OUT_PROFILE}")
    print(f"[Amplop spektral] jarak Enroll-Genuine={dist_genuine:.3f}, Enroll-Impostor={dist_impostor:.3f}")


def extract_f0(path):
    y, sr = librosa.load(path, sr=SR, mono=True)
    f0, voiced_flag, _ = librosa.pyin(y, fmin=50, fmax=500, sr=sr)
    return f0  # NaN di frame unvoiced


def plot_pitch_comparison():
    genuine_files = audio_files(GENUINE_DIR)
    impostor_files = audio_files(IMPOSTOR_DIR)

    f0_enroll = extract_f0(ENROLL_WAV)
    f0_genuine_sample = extract_f0(genuine_files[0])
    f0_impostor_sample = extract_f0(impostor_files[0])

    print("Menghitung F0 rata-rata per file (Genuine)...")
    genuine_mean_f0 = []
    for f in genuine_files:
        f0 = extract_f0(f)
        genuine_mean_f0.append(np.nanmean(f0))

    print("Menghitung F0 rata-rata per file (Impostor)...")
    impostor_mean_f0 = []
    for f in impostor_files:
        f0 = extract_f0(f)
        impostor_mean_f0.append(np.nanmean(f0))

    enroll_mean_f0 = np.nanmean(f0_enroll)

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    ax = axes[0]
    hop = 512 / SR
    ax.plot(np.arange(len(f0_enroll)) * hop, f0_enroll, color="#d62728", linewidth=1.8, label="Enroll")
    ax.plot(np.arange(len(f0_genuine_sample)) * hop, f0_genuine_sample, color="#1f77b4", linewidth=1.5, alpha=0.85, label="Genuine (orang sama)")
    ax.plot(np.arange(len(f0_impostor_sample)) * hop, f0_impostor_sample, color="#ff7f0e", linewidth=1.5, alpha=0.85, label="Impostor (orang lain)")
    ax.set_xlabel("Waktu (detik)")
    ax.set_ylabel("F0 / Pitch (Hz)")
    ax.set_title("Kontur Pitch per Sampel")
    ax.legend()
    ax.grid(alpha=0.3)

    ax = axes[1]
    bp = ax.boxplot(
        [genuine_mean_f0, impostor_mean_f0],
        tick_labels=[f"Genuine\n(n={len(genuine_files)})", f"Impostor\n(n={len(impostor_files)})"],
        patch_artist=True,
        widths=0.5,
    )
    for patch, color in zip(bp["boxes"], ["#1f77b4", "#ff7f0e"]):
        patch.set_facecolor(color)
        patch.set_alpha(0.5)
    ax.axhline(enroll_mean_f0, color="#d62728", linestyle="--", linewidth=2, label=f"Enroll = {enroll_mean_f0:.1f} Hz")
    ax.set_ylabel("Rata-rata F0 per File (Hz)")
    ax.set_title("Sebaran Rata-rata Pitch: Genuine vs Impostor")
    ax.legend()
    ax.grid(alpha=0.3)

    fig.suptitle("Pitch (F0) sebagai Salah Satu Ciri Khas Suara", fontsize=13)
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig(OUT_PITCH, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"Disimpan: {OUT_PITCH}")

    print("\n" + "=" * 65)
    print("RINGKASAN PITCH (F0)")
    print("=" * 65)
    print(f"Enroll F0 rata-rata     : {enroll_mean_f0:.1f} Hz")
    print(f"Genuine F0 rata-rata    : {np.mean(genuine_mean_f0):.1f} Hz (+/- {np.std(genuine_mean_f0):.1f})")
    print(f"Impostor F0 rata-rata   : {np.mean(impostor_mean_f0):.1f} Hz (+/- {np.std(impostor_mean_f0):.1f})")


def main():
    speaker = SpeakerVerifier(device="cpu")
    plot_fbank_triplet(speaker.model)
    plot_mel_energy_profile(speaker.model)
    plot_pitch_comparison()


if __name__ == "__main__":
    main()
