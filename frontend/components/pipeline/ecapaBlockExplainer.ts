import type { BlockExplainer } from "./blockExplainer";

// Explanations for each ECAPA-TDNN sub-module, keyed the same way as
// ecapaBlockFormula.ts / ecapaBlockLabel.ts. Content is drawn from the
// project's own measured numbers (see PENJELASAN_PERHITUNGAN_SUARA_WAJAH.md
// §5) — a real run on a 5.71 s clip (T = 572 frames) — not textbook
// placeholders. The real shape/mean/std for *this* run is already shown
// above this block in the panel; these numbers are illustrative context.
const BLOCK_EXPLAINERS: Record<string, BlockExplainer> = {
  "mods.compute_features": {
    formula: [
      "frame: potong gelombang jadi 25 ms, geser 10 ms (tumpang tindih 60%)",
      "X[k] = FFT(frame × jendela Hamming), k = 0..200 (n_fft=400 → 201 bin, jarak 40 Hz)",
      "P[k] = |X[k]|²  (daya, fase dibuang)",
      "E[t,m] = Σ_k P[t,k] · filter_mel[k,m], m = 0..79  (80 filter segitiga skala mel)",
      "Fbank[t,m] = 10·log10(max(E[t,m], 1e-10))  (dB)",
    ],
    input:
      "Gelombang audio mentah, 16.000 sampel/detik, mono — bentuk [1, N] dengan N = durasi(detik) × 16.000. Baru berupa naik-turun amplitudo, belum ada info siapa yang bicara.",
    output:
      "Fbank (log-mel spectrogram), bentuk [1, T, 80] — T frame waktu (satu per 10 ms) × 80 pita frekuensi mel dalam desibel.",
    process:
      "Memotong gelombang jadi frame-frame pendek 25 ms, menghitung kandungan frekuensinya lewat FFT, lalu meringkas 201 bin frekuensi jadi 80 pita mel yang lebih rapat di frekuensi rendah (tempat pitch & formant pembicara berada) dan mengubahnya ke skala desibel.",
    calculation:
      "Klip 5,71 detik → 572 frame. n_fft=400 → 201 bin FFT (jarak antar bin 40 Hz), lalu diringkas jadi 80 pita mel → keluaran [1, 572, 80].",
    why:
      "Gelombang mentah tidak memperlihatkan nada atau warna suara pembicara — informasi itu baru terlihat lewat kandungan frekuensinya. Skala mel meniru kepekaan telinga manusia (rapat di frekuensi rendah, kasar di tinggi), sekaligus memangkas 201 angka jadi 80 tanpa kehilangan informasi penting untuk mengenali pembicara.",
  },
  "mods.mean_var_norm": {
    formula: [
      "μ[m] = rata-rata_t Fbank[t,m]  (rata-rata tiap pita mel sepanjang klip)",
      "Fbank'[t,m] = Fbank[t,m] − μ[m]  (std_norm=False → simpangan baku TIDAK dibagi)",
    ],
    input: "Fbank mentah dalam dB, bentuk [1, T, 80].",
    output:
      "Fbank ternormalisasi, bentuk sama [1, T, 80] — tiap pita mel sudah dikurangi rata-ratanya sendiri.",
    process:
      "Untuk tiap pita mel, menghitung rata-ratanya sepanjang klip lalu mengurangkannya dari semua frame pada pita itu (Cepstral Mean Normalization).",
    calculation:
      "Mengalikan gain g pada gelombang mentah menggeser Fbank_dB sebesar 20·log10(g) secara konstan di semua pita — CMN menghapus pergeseran konstan ini. Terbukti: cosine embedding tetap 1,0000 untuk gain 0,02 sampai 1,0 selama sinyalnya tidak terpotong.",
    why:
      "Inilah penormal utama terhadap volume mic dan karakter mikrofon yang bersifat tetap — bukan normalisasi RMS di server. Tanpa ini, orang yang sama dengan volume mic berbeda bisa terlihat seperti pembicara berbeda bagi model.",
  },
  "mods.embedding_model.mfa": {
    formula: [
      "h = concat(blok₁, blok₂, blok₃, sepanjang kanal)  →  [1, 3072, T]",
      "keluaran = Conv₁(h)  (TDNN kernel 1, 3072 → 3072)",
    ],
    input: "Tiga tensor keluaran SE-Res2Block 1, 2, dan 3, masing-masing [1, 1024, T].",
    output: "Satu tensor gabungan [1, 3072, T].",
    process:
      "Menumpuk keluaran tiga blok berbeda kedalaman di sumbu kanal, lalu mencampurnya lewat satu lapisan konvolusi kernel-1.",
    calculation: "3 × 1024 kanal = 3072 kanal gabungan, diproses lapisan dengan ≈9,4 juta parameter.",
    why:
      "Lapisan awal menyimpan detail akustik halus (timbre), lapisan akhir menyimpan pola yang lebih abstrak. Mengenali pembicara butuh keduanya, jadi digabung — bukan hanya memakai keluaran blok terakhir. Ini salah satu perbaikan utama ECAPA dibanding x-vector pendahulunya.",
  },
  "mods.embedding_model.asp": {
    formula: [
      "μ[c] = rata-rata_t h[c,t];  σ[c] = std_t h[c,t]  (statistik global klip, per kanal)",
      "e[c,t] = Vᵀ·tanh(W·[h;μ;σ] + b)  (skor atensi per frame per kanal)",
      "α[c,t] = softmax_t(e[c,t])  (bobot, Σ_t α[c,t] = 1)",
      "μ̃[c] = Σ_t α[c,t]·h[c,t]",
      "σ̃[c] = √(Σ_t α[c,t]·(h[c,t]−μ̃[c])²)",
      "keluaran = concat(μ̃, σ̃)  →  6144",
    ],
    input: "[1, 3072, T] — satu vektor 3072-D per frame waktu.",
    output: "[1, 6144, 1] — satu vektor tetap per klip. T hilang, menjadi 1.",
    process:
      "Menilai frame mana yang paling informatif lewat atensi, lalu meringkas seluruh klip jadi rata-rata dan simpangan baku berbobot — satu-satunya tahap di mana durasi klip dan isi kalimat tidak lagi berpengaruh pada ukuran keluaran.",
    calculation:
      "3072 kanal rata-rata + 3072 kanal simpangan baku = 6144. T (misalnya 572 frame) 'menghilang' jadi 1 di sini — klip 3 detik dan 15 detik sama-sama berakhir di ukuran 6144.",
    why:
      "Tidak semua frame sama bergunanya — vokal bersuara kaya informasi pembicara, hening/desis kurang. Atensi memberi bobot tinggi pada frame informatif. Karena bobotnya selalu berjumlah 1, keluarannya berukuran tetap berapa pun panjang klip — inilah yang membuat model text-independent, tidak perlu kalimat sama saat enroll dan verifikasi.",
  },
  "mods.embedding_model.asp_bn": {
    formula: ["keluaran = BatchNorm1d(concat(μ̃, σ̃))  (skala & offset per elemen dari statistik data latih)"],
    input: "[1, 6144, 1] — gabungan rata-rata & simpangan baku berbobot dari ASP.",
    output: "Bentuk sama [1, 6144, 1], skalanya sudah distandarkan.",
    process:
      "Menyetel ulang skala dan offset tiap elemen vektor 6144-D agar sebarannya konsisten dengan yang dilihat model saat dilatih.",
    calculation:
      "6144 elemen, masing-masing diskalakan dengan parameter BatchNorm (γ, β) yang dipelajari saat training — bukan dihitung ulang dari klip ini.",
    why:
      "Menstabilkan skala aktivasi sebelum masuk lapisan terakhir (fc) — tanpa ini, perbedaan skala antar elemen bisa membuat proyeksi akhir lebih sulit dipelajari dan kurang stabil.",
  },
  "mods.embedding_model.fc": {
    formula: ["embedding = W · pooled + b  (Conv1d kernel 1, 6144 → 192)"],
    input: "[1, 6144, 1] — statistik klip yang sudah dinormalisasi.",
    output: "[1, 192, 1], diratakan jadi vektor [192].",
    process:
      "Memadatkan 6144 angka ringkasan jadi 192 angka akhir — inilah 'sidik jari suara' sebelum normalisasi penutup.",
    calculation:
      "≈1,18 juta parameter memetakan 6144 → 192. Model ini dilatih mengklasifikasi 7.205 pembicara sebelum lapisan ini dibuang dan digantikan dengan mengambil langsung embedding 192-D-nya.",
    why:
      "Ukuran 192 adalah keseimbangan antara kompresi (efisien disimpan & dibandingkan) dan daya pembeda (cukup kaya untuk memisahkan ribuan orang, termasuk orang yang tidak ada di data latih).",
  },
  "mods.mean_var_norm_emb": {
    formula: ["z = embedding − μ_global  (μ_global: rata-rata dari seluruh data latih, std_norm=False)"],
    input: "Embedding mentah [192].",
    output: "Embedding terpusat [192], sebelum L2 di server.",
    process:
      "Mengurangi rata-rata global (bukan rata-rata klip ini) yang dihitung sekali saat training, untuk memusatkan embedding di sekitar nol.",
    calculation:
      "Norma embedding sebelum tahap ini bisa ratusan (misal ≈314 pada satu klip uji); setelah dikurangi μ_global lalu di-L2 di server, norma akhirnya persis 1,000000.",
    why:
      "Memusatkan embedding membuat sebaran vektor antar pembicara lebih seragam, sehingga perbandingan arah (cosine similarity) di langkah berikutnya lebih bermakna.",
  },
};

const RES2BLOCK_EXPLAINER: BlockExplainer = {
  formula: [
    "x₁..x₈ = split(x, 8×128 kanal)  (Res2Net: pecah 1024 kanal jadi 8 bagian)",
    "yᵢ = Conv₃(xᵢ + yᵢ₋₁), i = 2..8  (tiap bagian diproses bertingkat, kernel 3)",
    "y = concat(y₁..y₈)  (gabung kembali jadi 1024 kanal)",
    "s = avgpool_t(y);  a = sigmoid(W₂·ReLU(W₁·s))  (SE: bobot perhatian per kanal)",
    "keluaran = (y ⊙ a) + x  (kalikan bobot kanal, lalu residual ditambah masukan asli)",
  ],
  input: "Fitur dari blok sebelumnya, bentuk [1, 1024, T] — 1024 kanal 'detektor pola' × T frame waktu.",
  output: "Bentuk sama [1, 1024, T] — blok residual tidak mengubah ukuran, hanya memperhalus isinya.",
  process:
    "Memecah 1024 kanal jadi 8 kelompok dan memprosesnya bertingkat (Res2Net) agar tiap blok menangkap pola pada beberapa skala waktu sekaligus, lalu menimbang tiap kanal berdasarkan relevansinya untuk klip ini (Squeeze-and-Excitation), dan menambahkan kembali masukan asli (residual) agar jaringan tetap mudah dilatih.",
  calculation:
    "Blok dengan dilasi 4 (paling jauh di ECAPA): tiap konvolusi kernel 3 menambah jangkauan ±4 frame, dan 7 konvolusi bertingkat dalam Res2Net memberi jangkauan total ±28 frame (≈280 ms) untuk satu titik waktu.",
  why:
    "Res2Net menangkap pola cepat dan lambat dalam satu blok dengan parameter jauh lebih hemat dibanding konvolusi penuh; SE menonjolkan kanal yang relevan untuk klip ini dan meredam yang tidak; residual membuat jaringan sedalam ini tetap bisa dilatih — tiap blok cukup belajar 'koreksi kecil' terhadap masukannya.",
};

export function blockExplainer(name: string): BlockExplainer | null {
  if (BLOCK_EXPLAINERS[name]) return BLOCK_EXPLAINERS[name];
  if (name.startsWith("mods.embedding_model.blocks.")) return RES2BLOCK_EXPLAINER;
  return null;
}
