import type { BlockExplainer } from "./blockExplainer";

// Explanations for each wav2vec2 anti-spoof sub-module, keyed the same way
// as antispoofBlockFormula.ts / antispoofBlockLabel.ts. Numbers are drawn
// from the project's own measured run (PENJELASAN_PERHITUNGAN_SUARA_WAJAH.md
// §7) on a 143,360-sample (8.96 s) clip, not textbook placeholders.
const BLOCK_EXPLAINERS: Record<string, BlockExplainer> = {
  "wav2vec2.feature_projection": {
    formula: ["h = LayerNorm(conv_out)", "projected = W·h + b  (512 → 768)"],
    input: "[1, T', 512] — keluaran tumpukan 7 lapis konvolusi.",
    output: "[1, T', 768] — siap masuk transformer.",
    process:
      "Menormalkan skala fitur lalu memproyeksikannya ke 768 dimensi, ukuran tersembunyi yang dipakai transformer di dalam model ini.",
    calculation: "512 → 768 lewat satu lapisan penuh per frame waktu; sumbu waktu T' tidak berubah.",
    why:
      "Transformer butuh dimensi tersembunyi tetap (768) untuk semua lapisannya; proyeksi ini menjembatani keluaran CNN (512 kanal) ke ukuran yang dipakai sisa jaringan.",
  },
  projector: {
    formula: ["pooled = rata-rata_t(h)  (mean pooling sepanjang waktu)", "y = W · pooled + b  (768 → 256)"],
    input: "[1, T', 768] — keluaran transformer terakhir.",
    output: "[1, 256] — satu vektor tetap per klip, waktu sudah diringkas jadi rata-rata.",
    process:
      "Meratakan seluruh frame waktu jadi satu vektor (mean pooling), lalu memproyeksikannya ke 256 dimensi sebelum klasifikasi akhir.",
    calculation:
      "768 → 256 lewat satu lapisan penuh; sumbu waktu T' hilang di sini lewat rata-rata sederhana (bukan atensi seperti ASP di ECAPA).",
    why:
      "Klasifikasi akhir butuh satu keputusan per klip, bukan per frame — langkah ini menyatukan seluruh klip jadi satu representasi sebelum ditebak fake/real.",
  },
  classifier: {
    formula: ["logits = W·y + b  (256 → 2: [fake, real])", "P(fake) = eᶻfake / (eᶻfake + eᶻreal)  (softmax)"],
    input: "[1, 256] dari projector.",
    output: "[1, 2] — dua probabilitas (fake, real) yang jumlahnya 1.",
    process:
      "Lapisan penuh terakhir memetakan vektor 256-D ke dua skor mentah (logits), lalu softmax mengubahnya jadi probabilitas.",
    calculation:
      "Pada pengukuran nyata, keluarannya cenderung hampir biner: sekitar 0,00002 (dianggap asli) atau 0,99997 (dianggap palsu) — jarang berada di tengah.",
    why:
      "Inilah jawaban akhir model: seberapa yakin rekaman ini rekaman ulang/sintetis dibanding suara hidup. Karena keluarannya hampir biner dan kurang stabil di kanal produksi nyata, skor ini dipakai sebagai lapisan tambahan yang meminta pengulangan, bukan penolakan langsung.",
  },
};

const CONV_LAYER_EXPLAINERS: Record<string, BlockExplainer> = {
  "wav2vec2.feature_extractor.conv_layers.0": {
    formula: ["y[t,c] = Σ_k kernel_c[k] · x[5t+k], k=0..9  (kernel=10, stride=5, 1 → 512 kanal)"],
    input: "Gelombang mentah ternormalisasi (z-score), bentuk [1, N] — N = jumlah sampel setelah hening dibuang.",
    output: "[1, 512, T₁] dengan T₁ ≈ N/5 — 512 kanal fitur belajar-sendiri, bukan mel buatan tangan.",
    process:
      "Konvolusi 1D pertama langsung di atas sampel mentah, menggeser 5 sampel tiap langkah, mulai meringkas gelombang jadi fitur.",
    calculation:
      "Untuk 143.360 sampel (8,96 detik): lapisan ini menghasilkan ≈28.670 langkah waktu sebelum diringkas lebih lanjut oleh 6 lapis konvolusi berikutnya.",
    why:
      "Berbeda dari ECAPA, model ini sengaja TIDAK memakai Fbank mel buatan tangan — jejak pemalsuan (kompresi, karakter speaker, derau mikro) bisa hilang kalau dipaksa lewat ringkasan mel yang dirancang untuk mengenali pembicara, bukan mendeteksi keaslian.",
  },
  "wav2vec2.feature_extractor.conv_layers.3": {
    formula: ["y[t,c] = Σ_k kernel_c[k] · x[2t+k], k=0..2  (kernel=3, stride=2, 512 → 512 kanal)"],
    input: "Fitur dari lapisan konvolusi sebelumnya, [1, 512, T₃].",
    output: "[1, 512, T₄] dengan T₄ ≈ T₃/2 — makin pendek sumbu waktunya, makin abstrak fiturnya.",
    process:
      "Lapisan konvolusi ke-4 dari 7, terus meringkas sumbu waktu sambil memperhalus fitur yang sudah terbentuk di lapisan sebelumnya.",
    calculation:
      "Tiap lapisan dari #2 sampai #5 membagi panjang sumbu waktu dengan ≈2 (stride 2) — setelah 4 lapisan ini, sumbu waktu sudah menyusut sekitar 16× dari lapisan pertama.",
    why:
      "Tumpukan konvolusi bertahap inilah yang 'belajar sendiri' representasinya dari data (bukan dirancang manusia seperti mel), sehingga bisa menangkap artefak pemalsuan yang tidak terduga sebelumnya.",
  },
  "wav2vec2.feature_extractor.conv_layers.6": {
    formula: ["y[t,c] = Σ_k kernel_c[k] · x[2t+k], k=0..1  (kernel=2, stride=2, lapisan konvolusi terakhir)"],
    input: "[1, 512, T₆] dari lapisan sebelumnya.",
    output:
      "[1, 512, T'] — satu frame mewakili 400 sampel (25 ms) dan bergeser 320 sampel (20 ms) dari gelombang asli (gabungan stride ke-7 lapis = 320).",
    process:
      "Konvolusi terakhir dalam tumpukan 7 lapis; keluarannya siap diproyeksikan ke dimensi tersembunyi transformer.",
    calculation:
      "143.360 sampel → 447 frame keluaran (diukur nyata), tiap frame mewakili jendela 25 ms yang bergeser 20 ms — mirip fungsinya dengan Fbank di ECAPA, tapi fiturnya dipelajari, bukan dirancang.",
    why:
      "Inilah batas antara pemrosesan sinyal lokal (konvolusi) dan pemahaman konteks global (transformer berikutnya) — representasi di titik ini sudah ringkas tapi masih per-frame, belum tahu hubungan antar frame yang berjauhan.",
  },
};

const ENCODER_LAYER_EXPLAINER: BlockExplainer = {
  formula: [
    "Attention(Q,K,V) = softmax(Q·Kᵀ/√d_k)·V  (12 kepala, tiap kepala 64 dimensi)",
    "h' = LayerNorm(h + Attention(h))",
    "keluaran = LayerNorm(h' + FFN(h'))  dengan FFN: 768 → 3072 → 768, aktivasi GELU",
  ],
  input: "[1, T', 768] dari lapisan sebelumnya (atau dari feature_projection untuk layer pertama).",
  output: "Bentuk sama [1, T', 768] — transformer tidak mengubah ukuran, hanya memperkaya isinya dengan konteks.",
  process:
    "Self-attention membuat setiap frame waktu 'melihat' dan menimbang semua frame lain di klip, lalu hasilnya diperhalus lewat jaringan maju (feed-forward) — diulang 12 kali, lapisan ini salah satunya.",
  calculation:
    "12 kepala atensi × 64 dimensi = 768; jaringan maju memperbesar sementara ke 3072 lalu mengecil lagi ke 768 di tiap lapisan.",
  why:
    "Artefak rekaman ulang (replay) seperti gema ruangan atau karakter speaker muncul di SELURUH klip, bukan hanya lokal — self-attention bisa menghubungkan frame yang berjauhan, sesuatu yang konvolusi lokal saja tidak bisa lakukan.",
};

export function blockExplainer(name: string): BlockExplainer | null {
  if (BLOCK_EXPLAINERS[name]) return BLOCK_EXPLAINERS[name];
  if (CONV_LAYER_EXPLAINERS[name]) return CONV_LAYER_EXPLAINERS[name];
  if (name.startsWith("wav2vec2.encoder.layers.")) return ENCODER_LAYER_EXPLAINER;
  return null;
}
