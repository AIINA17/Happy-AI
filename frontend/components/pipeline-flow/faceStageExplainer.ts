import type { BlockExplainer } from "@/components/pipeline/blockExplainer";

// Explanations for each insightface buffalo_l pipeline stage, keyed by the
// same stage ids as SidePanel.tsx's FaceStagePanel. Numbers are drawn from
// the project's own measured run on the test photo (see
// PENJELASAN_PERHITUNGAN_SUARA_WAJAH.md §10), not textbook placeholders.
const STAGE_EXPLAINERS: Record<
  "detection" | "landmark" | "alignment" | "recognition",
  BlockExplainer
> = {
  detection: {
    formula: [
      "letterbox ke 640×640 (rasio dipertahankan); piksel' = (piksel − 127,5) / 128, BGR→RGB",
      "jaringan → 3 skala (stride 8/16/32) × (skor, kotak, 5 titik) per jangkar, 16.800 jangkar total",
      "buang skor < 0,5; NMS (kotak dengan IoU > 0,4 terhadap kotak terbaik dibuang)",
    ],
    input: "Gambar JPEG hasil decode, bentuk [H, W, 3] uint8, urutan kanal BGR.",
    output: "Kotak wajah [x1,y1,x2,y2] + det_score (keyakinan), plus 5 titik kunci (dipakai di tahap berikutnya).",
    process:
      "Memindai gambar pada beberapa skala untuk menemukan wajah, menyaring kandidat berdasarkan skor keyakinan, lalu menghapus kotak yang tumpang-tindih (NMS) sampai tersisa satu kotak terbaik per wajah.",
    calculation:
      "Kanvas 640×640 → (640/8)²·2 + (640/16)²·2 + (640/32)²·2 = 16.800 jangkar kandidat. Hanya kandidat dengan skor ≥ 0,5 yang lolos ke tahap NMS.",
    why:
      "Gambar penuh berisi latar dan mungkin orang lain — pengenalan wajah harus bekerja hanya pada wajah yang relevan. Sistem menolak kalau terdeteksi 0 atau lebih dari 1 wajah, agar jelas wajah siapa yang sedang diperiksa.",
  },
  landmark: {
    formula: [
      "5 titik kunci: mata kiri, mata kanan, hidung, sudut mulut kiri, sudut mulut kanan (x,y)",
      "diprediksi relatif ke posisi jangkar, lalu diskalakan balik ke koordinat gambar asli",
    ],
    input: "Kotak wajah dari tahap detection + gambar aslinya.",
    output:
      "5 koordinat (x,y) titik kunci utama, plus (dari model tambahan) 106 titik landmark 2D yang lebih detail.",
    process:
      "Menentukan posisi presisi mata, hidung, dan sudut mulut pada wajah yang terdeteksi — titik-titik inilah yang jadi acuan untuk meluruskan wajah di tahap berikutnya.",
    calculation:
      "Contoh nyata: mata kiri (204,3; 100,9), mata kanan (247,2; 102,9), hidung (224,1; 128,7), mulut kiri (202,7; 139,1), mulut kanan (244,8; 141,1) — dalam piksel.",
    why:
      "Tanpa titik acuan yang presisi, wajah yang miring atau berputar tidak bisa diluruskan dengan benar — dan jaringan pengenal wajah dilatih khusus untuk wajah yang sudah dalam pose standar.",
  },
  alignment: {
    formula: [
      "T* = argmin_T Σᵢ ‖T(titikᵢ) − templatᵢ‖²",
      "(transformasi serupa — rotasi + skala + translasi — terbaik ke templat ArcFace 112×112)",
    ],
    input: "Gambar asli + 5 titik kunci dari tahap sebelumnya.",
    output: "Potongan wajah yang sudah diluruskan, 112×112 piksel.",
    process:
      "Mencari rotasi, skala, dan pergeseran terbaik yang membuat 5 titik kunci wajah ini sedekat mungkin dengan 5 titik templat standar, lalu menerapkan transformasi itu untuk memotong & meluruskan wajah.",
    calculation:
      "Contoh nyata: skala 0,88, rotasi −3,2° sudah cukup untuk meluruskan wajah uji ke kanvas 112×112 sesuai templat ArcFace.",
    why:
      "Wajah di kamera bisa miring, dekat, jauh, atau bergeser. Daripada menuntut jaringan pengenal menangani semua variasi itu, variasi pose/skala/posisi dihilangkan di awal — hanya rotasi/skala/translasi yang dipakai (bukan distorsi bebas), karena yang membedakan identitas wajah adalah proporsinya (jarak mata, lebar mulut), dan proporsi itu harus tetap terjaga.",
  },
  recognition: {
    formula: [
      "x' = (x − 127,5) / 127,5  (normalisasi piksel ke [−1, +1], BGR→RGB)",
      "embedding_mentah = ResNet50(x')  →  [512]",
      "embedding = embedding_mentah / ‖embedding_mentah‖  (L2, panjang jadi 1)",
    ],
    input: "Wajah yang sudah diluruskan, 112×112×3, piksel dinormalisasi.",
    output: "Vektor 512 angka dengan panjang 1 — 'sidik jari wajah'.",
    process:
      "Jaringan konvolusi 50 lapis mengubah piksel wajah jadi 512 angka: lapisan awal menangkap tepi & tekstur, lapisan tengah menangkap bagian wajah (mata, hidung), lapisan akhir menggabungkannya jadi representasi wajah utuh, lalu dinormalisasi panjangnya jadi 1.",
    calculation:
      "Contoh nyata: norma vektor mentah ≈19,65 sebelum L2; setelah dibagi normanya sendiri, panjang vektor jadi tepat 1,000000 dengan simpangan baku elemen ≈0,0442.",
    why:
      "ArcFace dilatih dengan syarat jarak SUDUT minimal antar orang (wajah sama harus rapat, wajah berbeda harus menjauh secara sudut) — karena yang dilatih adalah sudut, perbandingan yang tepat adalah cosine similarity, bukan jarak biasa. Inilah alasan panjang vektor dinormalisasi jadi 1, sama seperti embedding suara.",
  },
};

export function faceStageExplainer(
  stage: "detection" | "landmark" | "alignment" | "recognition",
): BlockExplainer {
  return STAGE_EXPLAINERS[stage];
}
