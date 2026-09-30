"""
Visualisasi untuk menjelaskan BAGAIMANA ECAPA-TDNN membedakan suara satu
orang dengan orang lain. Dibuat untuk keperluan presentasi/sidang.

Menghasilkan 3 gambar dari data asli (enroll.wav + genuine/ + impostor/):

1. pca_embedding_space.png
   Proyeksi 2D (PCA) dari embedding 192-dimensi tiap sampel suara.
   Menunjukkan bahwa suara pemilik akun (enroll + genuine) mengelompok
   berdekatan, sedangkan suara orang lain (impostor) terpisah jauh.

2. similarity_heatmap_matrix.png
   Matriks cosine similarity antar semua sampel. Blok diagonal yang
   terang (mirip) untuk pasangan sesama pemilik akun, dan blok gelap
   (tidak mirip) untuk pasangan pemilik-vs-orang lain, adalah bukti
   visual bahwa model bisa membedakan identitas suara.

3. embedding_fingerprint_comparison.png
   "Sidik jari suara": pola 192 nilai embedding untuk satu sampel
   Enroll, satu Genuine, dan satu Impostor digambar berdampingan.
   Pola Enroll vs Genuine terlihat serupa, sedangkan pola Impostor
   terlihat berbeda -> inilah "ciri khas" yang dipelajari ECAPA.
"""

import os
import glob

import numpy as np
import matplotlib.pyplot as plt
from sklearn.decomposition import PCA

from voiceverification.models.speaker_verifier import SpeakerVerifier

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENROLL_WAV = os.path.join(BASE_DIR, "enroll.wav")
GENUINE_DIR = os.path.join(BASE_DIR, "genuine")
IMPOSTOR_DIR = os.path.join(BASE_DIR, "impostor")
EMBED_CACHE = os.path.join(BASE_DIR, "all_embeddings_cache.npz")

OUT_PCA = os.path.join(BASE_DIR, "pca_embedding_space.png")
OUT_HEATMAP = os.path.join(BASE_DIR, "similarity_heatmap_matrix.png")
OUT_FINGERPRINT = os.path.join(BASE_DIR, "embedding_fingerprint_comparison.png")


def audio_files(folder):
    files = []
    for ext in ("*.wav", "*.WAV", "*.flac", "*.FLAC", "*.mp3", "*.MP3"):
        files.extend(glob.glob(os.path.join(folder, ext)))
    return sorted(files)


def build_embeddings():
    if os.path.exists(EMBED_CACHE):
        data = np.load(EMBED_CACHE, allow_pickle=True)
        return data["embeddings"], list(data["labels"]), list(data["names"])

    speaker = SpeakerVerifier(device="cpu")

    genuine_files = audio_files(GENUINE_DIR)
    impostor_files = audio_files(IMPOSTOR_DIR)

    embeddings = []
    labels = []
    names = []

    print(f"Mengekstrak embedding Enroll: {os.path.basename(ENROLL_WAV)}")
    embeddings.append(speaker.extract_embedding(ENROLL_WAV))
    labels.append("Enroll")
    names.append("Enroll")

    for f in genuine_files:
        print(f"Mengekstrak embedding Genuine: {os.path.basename(f)}")
        embeddings.append(speaker.extract_embedding(f))
        labels.append("Genuine")
        names.append(os.path.splitext(os.path.basename(f))[0])

    for f in impostor_files:
        print(f"Mengekstrak embedding Impostor: {os.path.basename(f)}")
        embeddings.append(speaker.extract_embedding(f))
        labels.append("Impostor")
        names.append(os.path.splitext(os.path.basename(f))[0])

    embeddings = np.vstack(embeddings)
    np.savez(EMBED_CACHE, embeddings=embeddings, labels=labels, names=names)
    return embeddings, labels, names


def plot_pca(embeddings, labels):
    pca = PCA(n_components=2)
    coords = pca.fit_transform(embeddings)
    var = pca.explained_variance_ratio_

    labels = np.array(labels)
    style = {
        "Enroll": dict(marker="*", s=400, c="#d62728", label="Enroll (data acuan pemilik akun)", zorder=5, edgecolors="black"),
        "Genuine": dict(marker="o", s=110, c="#1f77b4", label="Genuine (pemilik akun, sesi lain)", zorder=3, edgecolors="white"),
        "Impostor": dict(marker="^", s=110, c="#ff7f0e", label="Impostor (orang lain)", zorder=3, edgecolors="white"),
    }

    plt.figure(figsize=(9, 7))
    for cls, kw in style.items():
        mask = labels == cls
        plt.scatter(coords[mask, 0], coords[mask, 1], **kw)

    plt.xlabel(f"Komponen Utama 1 ({var[0] * 100:.1f}% variansi)")
    plt.ylabel(f"Komponen Utama 2 ({var[1] * 100:.1f}% variansi)")
    plt.title("Proyeksi Embedding ECAPA-TDNN (192-D -> 2D via PCA)\nSuara pemilik akun mengelompok, suara orang lain terpisah")
    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(OUT_PCA, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"Disimpan: {OUT_PCA}")


def plot_similarity_heatmap(embeddings, names, labels):
    sim = embeddings @ embeddings.T  # embeddings sudah dinormalisasi -> cosine similarity

    n = len(names)
    plt.figure(figsize=(10, 9))
    im = plt.imshow(sim, cmap="viridis", vmin=-1, vmax=1)
    plt.colorbar(im, label="Cosine Similarity")

    plt.xticks(range(n), names, rotation=90, fontsize=7)
    plt.yticks(range(n), names, fontsize=7)

    n_genuine = labels.count("Genuine")
    boundary_1 = 0.5  # setelah Enroll
    boundary_2 = 0.5 + n_genuine  # setelah blok Genuine
    for b in (boundary_1, boundary_2):
        plt.axhline(b, color="white", linewidth=1.2)
        plt.axvline(b, color="white", linewidth=1.2)

    plt.title(
        "Matriks Cosine Similarity Antar Sampel Suara\n"
        "Blok terang = suara orang yang sama, blok gelap = suara berbeda orang"
    )
    plt.tight_layout()
    plt.savefig(OUT_HEATMAP, dpi=300, bbox_inches="tight")
    plt.close()
    print(f"Disimpan: {OUT_HEATMAP}")


def plot_fingerprint(embeddings, labels, names):
    idx_enroll = labels.index("Enroll")
    idx_genuine = labels.index("Genuine")
    idx_impostor = labels.index("Impostor")

    emb_enroll = embeddings[idx_enroll]
    emb_genuine = embeddings[idx_genuine]
    emb_impostor = embeddings[idx_impostor]

    sim_genuine = float(np.dot(emb_enroll, emb_genuine))
    sim_impostor = float(np.dot(emb_enroll, emb_impostor))

    fig, axes = plt.subplots(4, 1, figsize=(13, 9), gridspec_kw={"height_ratios": [1, 1, 1, 1.4]})

    for ax, emb, title, color in zip(
        axes[:3],
        [emb_enroll, emb_genuine, emb_impostor],
        [f"Enroll ({names[idx_enroll]})", f"Genuine ({names[idx_genuine]})", f"Impostor ({names[idx_impostor]})"],
        ["#d62728", "#1f77b4", "#ff7f0e"],
    ):
        ax.bar(range(len(emb)), emb, color=color, width=1.0)
        ax.set_title(title, fontsize=10, loc="left")
        ax.set_xlim(0, len(emb))
        ax.set_ylabel("Nilai")
        ax.set_xticks([])

    ax = axes[3]
    ax.plot(emb_enroll, color="#d62728", linewidth=1.3, label="Enroll")
    ax.plot(emb_genuine, color="#1f77b4", linewidth=1.3, alpha=0.85, label=f"Genuine (mirip Enroll, similarity={sim_genuine:.3f})")
    ax.plot(emb_impostor, color="#ff7f0e", linewidth=1.3, alpha=0.85, label=f"Impostor (beda dari Enroll, similarity={sim_impostor:.3f})")
    ax.set_xlabel("Indeks Dimensi Embedding (1 - 192)")
    ax.set_ylabel("Nilai")
    ax.legend(loc="upper right", fontsize=9)
    ax.grid(alpha=0.3)

    fig.suptitle(
        "\"Sidik Jari Suara\": Pola Vektor Embedding 192-Dimensi\n"
        "Pola Enroll vs Genuine mirip (sesama pemilik akun), pola Impostor berbeda",
        fontsize=12,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.94))
    fig.savefig(OUT_FINGERPRINT, dpi=300, bbox_inches="tight")
    plt.close(fig)
    print(f"Disimpan: {OUT_FINGERPRINT}")


def print_summary(embeddings, labels):
    labels = np.array(labels)
    enroll = embeddings[labels == "Enroll"][0]
    genuine = embeddings[labels == "Genuine"]
    impostor = embeddings[labels == "Impostor"]

    sim_genuine = genuine @ enroll
    sim_impostor = impostor @ enroll

    print("\n" + "=" * 65)
    print("RINGKASAN: SEBERAPA JAUH ECAPA MEMISAHKAN SUARA")
    print("=" * 65)
    print(f"Rata-rata similarity Enroll vs Genuine  : {sim_genuine.mean():.4f} (+/- {sim_genuine.std():.4f})")
    print(f"Rata-rata similarity Enroll vs Impostor : {sim_impostor.mean():.4f} (+/- {sim_impostor.std():.4f})")
    print(f"Margin pemisahan (gap rata-rata)         : {sim_genuine.mean() - sim_impostor.mean():.4f}")


def main():
    embeddings, labels, names = build_embeddings()
    print_summary(embeddings, labels)
    plot_pca(embeddings, labels)
    plot_similarity_heatmap(embeddings, names, labels)
    plot_fingerprint(embeddings, labels, names)


if __name__ == "__main__":
    main()
