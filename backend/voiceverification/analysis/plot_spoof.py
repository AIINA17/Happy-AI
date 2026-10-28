import os
import numpy as np
import matplotlib.pyplot as plt

from voiceverification.core.asvspoof import compute_score


# ==========================================================
# KONFIGURASI
# ==========================================================

BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dataset")

GENUINE_DIR = os.path.join(BASE_DIR, "genuine")
SPOOF_DIR = os.path.join(BASE_DIR, "spoof")

OUTPUT_DISTRIBUTION = os.path.join(
    BASE_DIR,
    "distribution_spoof_probability.png"
)

OUTPUT_THRESHOLD = os.path.join(
    BASE_DIR,
    "distribution_spoof_probability_threshold.png"
)


# ==========================================================
# MEMBACA SPOOF PROBABILITY
# ==========================================================

def get_spoof_probabilities(folder):
    """
    Menjalankan compute_score() untuk seluruh file audio
    dalam satu folder dan mengembalikan spoof probability.
    """

    probabilities = []

    valid_extensions = (
        ".wav",
        ".mp3",
        ".flac",
        ".ogg",
        ".m4a"
    )

    files = sorted(
        [
            f for f in os.listdir(folder)
            if f.lower().endswith(valid_extensions)
        ]
    )

    print("=" * 70)
    print(f"Folder: {folder}")
    print(f"Jumlah file: {len(files)}")
    print("=" * 70)

    for filename in files:

        filepath = os.path.join(folder, filename)

        try:
            result = compute_score(filepath)

            # compute_score() menghasilkan:
            #
            # (
            #     spoof_probability,
            #     {
            #         "flatness": ...,
            #         "temporal_var": ...,
            #         "highband": ...,
            #         "ml_prob": ...
            #     }
            # )

            spoof_probability = float(result[0])

            probabilities.append(spoof_probability)

            print(
                f"{filename:15s} "
                f"spoof_prob = {spoof_probability:.4f}"
            )

        except Exception as e:
            print(
                f"[ERROR] {filename}: {e}"
            )

    return np.array(probabilities)


# ==========================================================
# HITUNG THRESHOLD
# ==========================================================

def calculate_threshold(genuine_scores, spoof_scores):
    """
    Mencari threshold berdasarkan titik dengan selisih
    FAR dan FRR paling kecil.

    genuine:
        skor di bawah threshold dianggap genuine

    spoof:
        skor di atas threshold dianggap spoof
    """

    all_scores = np.concatenate([
        genuine_scores,
        spoof_scores
    ])

    thresholds = np.unique(
        np.sort(all_scores)
    )

    best_threshold = None
    best_difference = float("inf")

    best_far = None
    best_frr = None

    for threshold in thresholds:

        # False Acceptance Rate:
        # spoof yang salah dianggap genuine
        false_acceptance = np.sum(
            spoof_scores < threshold
        )

        far = (
            false_acceptance /
            len(spoof_scores)
        )

        # False Rejection Rate:
        # genuine yang salah dianggap spoof
        false_rejection = np.sum(
            genuine_scores >= threshold
        )

        frr = (
            false_rejection /
            len(genuine_scores)
        )

        difference = abs(far - frr)

        if difference < best_difference:

            best_difference = difference

            best_threshold = threshold
            best_far = far
            best_frr = frr

    return (
        best_threshold,
        best_far,
        best_frr
    )


# ==========================================================
# MAIN
# ==========================================================

def main():

    print()
    print("=" * 70)
    print("ANALISIS DISTRIBUSI SPOOF PROBABILITY")
    print("=" * 70)
    print()

    # ------------------------------------------------------
    # 1. Genuine
    # ------------------------------------------------------

    print("Memproses GENUINE...")

    genuine_scores = get_spoof_probabilities(
        GENUINE_DIR
    )

    print()

    # ------------------------------------------------------
    # 2. Spoof / Replay
    # ------------------------------------------------------

    print("Memproses SPOOF/REPLAY...")

    spoof_scores = get_spoof_probabilities(
        SPOOF_DIR
    )

    print()

    # ------------------------------------------------------
    # Validasi
    # ------------------------------------------------------

    if len(genuine_scores) == 0:
        raise RuntimeError(
            "Tidak ditemukan sampel genuine."
        )

    if len(spoof_scores) == 0:
        raise RuntimeError(
            "Tidak ditemukan sampel spoof."
        )

    # ------------------------------------------------------
    # 3. Statistik
    # ------------------------------------------------------

    print("=" * 70)
    print("STATISTIK")
    print("=" * 70)

    print(
        f"Genuine : n={len(genuine_scores)}, "
        f"mean={np.mean(genuine_scores):.6f}, "
        f"min={np.min(genuine_scores):.6f}, "
        f"max={np.max(genuine_scores):.6f}"
    )

    print(
        f"Spoof   : n={len(spoof_scores)}, "
        f"mean={np.mean(spoof_scores):.6f}, "
        f"min={np.min(spoof_scores):.6f}, "
        f"max={np.max(spoof_scores):.6f}"
    )

    # ------------------------------------------------------
    # 4. Threshold
    # ------------------------------------------------------

    threshold, far, frr = calculate_threshold(
        genuine_scores,
        spoof_scores
    )

    print()
    print("=" * 70)
    print("HASIL KALIBRASI THRESHOLD")
    print("=" * 70)

    print(
        f"Threshold : {threshold:.6f}"
    )

    print(
        f"FAR       : {far:.6f} "
        f"({far * 100:.2f}%)"
    )

    print(
        f"FRR       : {frr:.6f} "
        f"({frr * 100:.2f}%)"
    )

    print(
        f"Selisih FAR-FRR : "
        f"{abs(far - frr):.6f}"
    )

    # ======================================================
    # 5. DISTRIBUTION TANPA THRESHOLD
    # ======================================================

    plt.figure(figsize=(10, 6))

    plt.hist(
        genuine_scores,
        bins=8,
        alpha=0.65,
        label="Genuine"
    )

    plt.hist(
        spoof_scores,
        bins=8,
        alpha=0.65,
        label="Spoof/Replay"
    )

    plt.xlabel("Spoof Probability")
    plt.ylabel("Jumlah Sampel")

    plt.title(
        "Distribusi Spoof Probability "
        "pada Genuine dan Spoof/Replay"
    )

    plt.legend()
    plt.grid(axis="y", alpha=0.3)

    plt.tight_layout()

    plt.savefig(
        OUTPUT_DISTRIBUTION,
        dpi=300,
        bbox_inches="tight"
    )

    plt.close()

    print()
    print(
        "Distribution plot disimpan:"
    )
    print(
        OUTPUT_DISTRIBUTION
    )

    # ======================================================
    # 6. DISTRIBUTION + THRESHOLD
    # ======================================================

    plt.figure(figsize=(10, 6))

    plt.hist(
        genuine_scores,
        bins=8,
        alpha=0.65,
        label="Genuine"
    )

    plt.hist(
        spoof_scores,
        bins=8,
        alpha=0.65,
        label="Spoof/Replay"
    )

    # Garis threshold
    plt.axvline(
        threshold,
        linestyle="--",
        linewidth=2,
        label=(
            f"Threshold = "
            f"{threshold:.4f}"
        )
    )

    plt.xlabel("Spoof Probability")
    plt.ylabel("Jumlah Sampel")

    plt.title(
        "Distribusi Spoof Probability "
        "dan Threshold Hasil Kalibrasi"
    )

    plt.legend()
    plt.grid(axis="y", alpha=0.3)

    plt.tight_layout()

    plt.savefig(
        OUTPUT_THRESHOLD,
        dpi=300,
        bbox_inches="tight"
    )

    plt.close()

    print()
    print(
        "Distribution + threshold plot disimpan:"
    )
    print(
        OUTPUT_THRESHOLD
    )

    print()
    print("=" * 70)
    print("SELESAI")
    print("=" * 70)


if __name__ == "__main__":
    main()