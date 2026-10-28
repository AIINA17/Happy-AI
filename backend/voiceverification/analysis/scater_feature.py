import os
import numpy as np
import matplotlib.pyplot as plt

from voiceverification.core.asvspoof import compute_score


# ============================================================
# KONFIGURASI
# ============================================================

BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dataset")

FOLDERS = {
    "Genuine": os.path.join(BASE_DIR, "genuine"),
    "Spoof": os.path.join(BASE_DIR, "spoof"),
}


# ============================================================
# MENGAMBIL HASIL DARI compute_score()
# ============================================================

def get_features(audio_path):

    # compute_score() mengembalikan:
    #
    # (
    #     ml_prob,
    #     {
    #         "flatness": ...,
    #         "temporal_var": ...,
    #         "highband": ...,
    #         "ml_prob": ...
    #     }
    # )

    score, features = compute_score(audio_path)

    flatness = float(features["flatness"])
    temporal_var = float(features["temporal_var"])
    highband = float(features["highband"])
    spoof_probability = float(features["ml_prob"])

    return {
        "score": spoof_probability,
        "flatness": flatness,
        "temporal_var": temporal_var,
        "highband": highband
    }


# ============================================================
# MEMPROSES DATASET
# ============================================================

def collect_data():

    data = []

    for label, folder in FOLDERS.items():

        print()
        print(f"Memproses {label}...")
        print(f"Folder: {folder}")

        if not os.path.exists(folder):
            print("Folder tidak ditemukan.")
            continue

        audio_files = [
            f for f in os.listdir(folder)
            if f.lower().endswith(
                (".wav", ".mp3", ".flac", ".ogg", ".m4a")
            )
        ]

        print(f"Jumlah file: {len(audio_files)}")

        for filename in sorted(audio_files):

            audio_path = os.path.join(
                folder,
                filename
            )

            try:

                features = get_features(audio_path)

                data.append({
                    "label": label,
                    "file": filename,
                    **features
                })

                print(
                    f"{filename}: "
                    f"score={features['score']:.4f}, "
                    f"flat={features['flatness']:.4f}, "
                    f"var={features['temporal_var']:.4f}, "
                    f"high={features['highband']:.4f}"
                )

            except Exception as e:

                print(
                    f"Gagal memproses {filename}: {e}"
                )

    return data


# ============================================================
# SCATTER PLOT
# ============================================================

def create_scatter(data):

    if not data:
        print("Tidak ada data yang berhasil diproses.")
        return

    # ========================================================
    # 1. SPECTRAL FLATNESS VS TEMPORAL VARIANCE
    # ========================================================

    plt.figure(figsize=(9, 7))

    for label in FOLDERS.keys():

        samples = [
            x for x in data
            if x["label"] == label
        ]

        if not samples:
            continue

        x = [
            sample["flatness"]
            for sample in samples
        ]

        y = [
            sample["temporal_var"]
            for sample in samples
        ]

        plt.scatter(
            x,
            y,
            label=label,
            s=70
        )

    plt.xlabel("Spectral Flatness")
    plt.ylabel("Temporal Energy Variance")

    plt.title(
        "Sebaran Spectral Flatness dan Temporal Energy Variance"
    )

    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()

    output = os.path.join(
        BASE_DIR,
        "scatter_flatness_temporal.png"
    )

    plt.savefig(
        output,
        dpi=300,
        bbox_inches="tight"
    )

    plt.close()

    print()
    print(
        f"Scatter 1 disimpan:\n{output}"
    )


    # ========================================================
    # 2. SPECTRAL FLATNESS VS SPOOF PROBABILITY
    # ========================================================

    plt.figure(figsize=(9, 7))

    for label in FOLDERS.keys():

        samples = [
            x for x in data
            if x["label"] == label
        ]

        if not samples:
            continue

        x = [
            sample["flatness"]
            for sample in samples
        ]

        y = [
            sample["score"]
            for sample in samples
        ]

        plt.scatter(
            x,
            y,
            label=label,
            s=70
        )

    plt.xlabel("Spectral Flatness")
    plt.ylabel("Spoof Probability")

    plt.title(
        "Hubungan Spectral Flatness dan Spoof Probability"
    )

    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()

    output = os.path.join(
        BASE_DIR,
        "scatter_flatness_spoof_probability.png"
    )

    plt.savefig(
        output,
        dpi=300,
        bbox_inches="tight"
    )

    plt.close()

    print(
        f"Scatter 2 disimpan:\n{output}"
    )


    # ========================================================
    # 3. TEMPORAL VARIANCE VS SPOOF PROBABILITY
    # ========================================================

    plt.figure(figsize=(9, 7))

    for label in FOLDERS.keys():

        samples = [
            x for x in data
            if x["label"] == label
        ]

        if not samples:
            continue

        x = [
            sample["temporal_var"]
            for sample in samples
        ]

        y = [
            sample["score"]
            for sample in samples
        ]

        plt.scatter(
            x,
            y,
            label=label,
            s=70
        )

    plt.xlabel("Temporal Energy Variance")
    plt.ylabel("Spoof Probability")

    plt.title(
        "Hubungan Temporal Energy Variance dan Spoof Probability"
    )

    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()

    output = os.path.join(
        BASE_DIR,
        "scatter_temporal_spoof_probability.png"
    )

    plt.savefig(
        output,
        dpi=300,
        bbox_inches="tight"
    )

    plt.close()

    print(
        f"Scatter 3 disimpan:\n{output}"
    )


# ============================================================
# RINGKASAN
# ============================================================

def print_summary(data):

    print()
    print("=" * 70)
    print("RINGKASAN DATA")
    print("=" * 70)

    for label in FOLDERS.keys():

        samples = [
            x for x in data
            if x["label"] == label
        ]

        print(
            f"{label}: {len(samples)} sampel"
        )

        if not samples:
            continue

        print(
            f"  Rata-rata Spectral Flatness       : "
            f"{np.mean([x['flatness'] for x in samples]):.6f}"
        )

        print(
            f"  Rata-rata Temporal Energy Variance: "
            f"{np.mean([x['temporal_var'] for x in samples]):.6f}"
        )

        print(
            f"  Rata-rata High-Band Energy Ratio  : "
            f"{np.mean([x['highband'] for x in samples]):.6f}"
        )

        print(
            f"  Rata-rata Spoof Probability       : "
            f"{np.mean([x['score'] for x in samples]):.6f}"
        )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    print("=" * 70)
    print("ANALISIS FITUR ANTI-SPOOF")
    print("Menggunakan compute_score() dari pipeline utama")
    print("=" * 70)

    data = collect_data()

    print_summary(data)

    create_scatter(data)

    print()
    print("=" * 70)
    print("SELESAI")
    print("=" * 70)