# Rancangan Pengembangan Happy untuk Capstone Expo

## 1. Latar Belakang

Happy merupakan **Voice AI Shopping Assistant** yang mengintegrasikan interaksi suara, kecerdasan buatan, dan verifikasi biometrik untuk mendukung pengalaman belanja yang lebih aman. Dalam expo capstone, tantangannya bukan hanya menunjukkan bahwa Happy dapat menerima perintah dan membantu proses belanja, tetapi juga memperlihatkan kompleksitas engineering yang bekerja di balik pengalaman pengguna tersebut.

Jika demonstrasi hanya berfokus pada percakapan dengan AI dan hasil belanja, pengunjung dapat menganggap sistem ini sebagai integrasi sederhana antara LLM dan antarmuka e-commerce. Karena itu, expo perlu memperlihatkan proses internal, mekanisme keamanan, integrasi antarkomponen, serta hasil evaluasi sistem.

Prinsip pengembangan yang diusulkan:

- **Observable engineering:** proses internal sistem dapat diamati secara langsung.
- **Demonstrable security:** mekanisme keamanan dapat diuji dengan skenario yang terukur.
- **Measurable performance:** klaim teknis didukung oleh metrik dan hasil pengujian.

Tujuannya bukan membuat sistem terlihat rumit melalui animasi, melainkan menunjukkan kompleksitas yang benar-benar ada dan dapat dipertanggungjawabkan.

## 2. Tujuan

1. Memperlihatkan tahapan pemrosesan biometrik secara transparan.
2. Menunjukkan bagaimana sistem merespons input yang sah, tidak cocok, atau berpotensi merupakan serangan.
3. Memperlihatkan hubungan antara hasil verifikasi biometrik dan izin melakukan aksi sensitif.
4. Menunjukkan integrasi komponen frontend, voice agent, backend, model biometrik, database, dan e-commerce.
5. Menyajikan hasil pengujian yang dapat digunakan untuk menjelaskan kemampuan serta keterbatasan sistem.

## 3. Fitur Utama yang Diusulkan

### 3.1. Live Biometric Pipeline Visualization

Fitur ini berupa dashboard yang menampilkan tahapan pemrosesan biometrik secara langsung ketika pengguna melakukan verifikasi. Dashboard harus menerima data dari proses backend yang benar-benar berjalan, bukan hanya menampilkan animasi atau angka statis.

#### A. Alur Voice Verification

1. **Audio Acquisition**
   - Menampilkan waveform audio.
   - Menampilkan durasi, sample rate, jumlah channel, dan status perekaman.
   - Contoh informasi: `16 kHz`, `Mono`, dan durasi audio aktual.

2. **Audio Preprocessing**
   - Menampilkan tahapan preprocessing yang memang diterapkan.
   - Jika digunakan, tampilkan normalisasi, pemeriksaan kualitas sinyal, segmentasi audio, atau ekstraksi fitur.
   - Waveform dan log-Mel spectrogram dapat digunakan sebagai visualisasi.
   - Jangan menampilkan tahapan yang sebenarnya tidak dilakukan oleh implementasi.

3. **ECAPA-TDNN Inference**
   - Menampilkan status inference, waktu pemrosesan, dan dimensi embedding aktual.
   - Embedding dapat divisualisasikan dalam bentuk heatmap atau grafik.
   - Jika aktivasi internal model ditampilkan, pastikan nilainya berasal dari model aktual dan maknanya dapat dijelaskan.

4. **Speaker Similarity**
   - Membandingkan embedding dari suara saat ini dengan embedding hasil enrollment.
   - Menampilkan skor cosine similarity, threshold, dan hasil perbandingan.
   - Grafik dapat memperlihatkan posisi skor terhadap threshold.

5. **Anti-Spoofing Analysis**
   - Menampilkan output model anti-spoofing yang benar-benar digunakan.
   - Tampilkan definisi skor, threshold, dan hasil pemeriksaan secara jelas.
   - Jangan menyamakan spoof probability dengan liveness score tanpa memastikan definisi dan arah skornya.

6. **Decision Engine**
   - Menampilkan keputusan akhir, misalnya `VERIFIED`, `REPEAT`, atau `DENIED`.
   - Sertakan alasan keputusan berdasarkan aturan yang diterapkan.
   - Jika ada beberapa pemeriksaan, tampilkan kontribusi masing-masing terhadap keputusan.

#### B. Contoh Event Backend

Frontend dapat menerima pembaruan melalui WebSocket atau mekanisme streaming lain dari FastAPI. Contoh nama event berikut merupakan rancangan, bukan endpoint yang sudah dipastikan tersedia di repository.

| Event | Informasi yang dapat ditampilkan |
|---|---|
| `audio_received` | Durasi, sample rate, dan status input |
| `preprocessing_completed` | Status dan durasi preprocessing |
| `embedding_generated` | Dimensi embedding dan inference time |
| `similarity_computed` | Skor similarity dan threshold |
| `spoof_check_completed` | Skor anti-spoofing dan status pemeriksaan |
| `verification_decided` | Keputusan akhir dan alasan |

**Nilai engineering:** fitur ini memperlihatkan observability pada pipeline AI dan menghubungkan visualisasi frontend dengan proses inferensi backend yang nyata.

### 3.2. Security Attack Simulation Lab

Fitur ini menyediakan lingkungan pengujian untuk memperlihatkan perilaku sistem dalam beberapa skenario keamanan. Hasil setiap percobaan dicatat agar dapat dibandingkan.

#### Skenario pengujian

**A. Genuine Speaker**
- Pengguna terdaftar berbicara secara langsung.
- Menguji kemampuan verifikasi speaker dan alur akses yang sesuai kebijakan.

**B. Replay Attack**
- Rekaman suara diputar kembali melalui perangkat audio.
- Menguji kemampuan model anti-spoofing mendeteksi indikasi audio replay.
- Hasil harus berasal dari pengujian aktual; tidak boleh diasumsikan semua replay akan terdeteksi.

**C. Impostor Speaker**
- Orang lain mencoba menggunakan akun dengan suaranya sendiri.
- Menguji apakah skor similarity dan keputusan sistem menolak speaker yang tidak cocok.

**D. Fallback Verification**
- Simulasikan kegagalan voice verification.
- Jalankan face verification untuk aksi sensitif sesuai alur yang dirancang.
- Catat alasan fallback dipicu dan hasil pemeriksaan wajah.

#### Informasi yang ditampilkan

- Jenis skenario.
- Hasil verifikasi suara.
- Skor similarity dan threshold.
- Output anti-spoofing.
- Hasil face verification jika dijalankan.
- Keputusan akhir dan alasan.
- Riwayat percobaan untuk membandingkan skenario.

Skor numerik harus diambil dari hasil sistem aktual. Hindari menampilkan angka ilustrasi seolah-olah merupakan hasil eksperimen.

### 3.3. Transaction Security & Policy Engine

Fitur ini menghubungkan verifikasi biometrik dengan tindakan belanja. Sistem tidak hanya memeriksa siapa yang berbicara, tetapi juga menentukan apakah suatu tindakan memerlukan verifikasi tambahan.

#### Alur konseptual

1. Pengguna memberikan perintah suara.
2. Sistem mengidentifikasi intent dan aksi yang diminta.
3. Policy engine mengklasifikasikan kebutuhan otorisasi berdasarkan jenis dan risiko aksi.
4. Jika diperlukan, sistem menjalankan verifikasi biometrik.
5. Backend memeriksa identitas akun, hak akses, dan status transaksi.
6. Sistem mengizinkan, meminta verifikasi tambahan, atau menolak aksi.

#### Contoh demonstrasi

- Melihat produk atau menanyakan harga dapat menggunakan alur berisiko rendah sesuai kebijakan.
- Aksi sensitif, seperti checkout atau perubahan akun, dapat mensyaratkan verifikasi tambahan.
- Jika voice verification gagal, sistem menjalankan fallback yang ditentukan.
- Jika seluruh verifikasi yang diwajibkan gagal, aksi sensitif tidak boleh dieksekusi.
- Dashboard menampilkan alasan keputusan dan catatan audit yang relevan.

LLM tidak boleh menjadi satu-satunya penentu izin transaksi. Keputusan otorisasi harus ditegakkan oleh backend. Hasil biometrik juga tidak menggantikan pemeriksaan hak akses dan status transaksi.

### 3.4. Real-Time System Architecture & Observability

Fitur ini menampilkan hubungan dan status komponen utama Happy secara langsung.

#### Komponen yang dapat dipantau

| Komponen | Informasi yang dapat ditampilkan |
|---|---|
| Frontend Next.js | Status UI dan permintaan pengguna |
| LiveKit Agent | Status sesi dan pemrosesan voice |
| FastAPI | Request, response, error, dan latency |
| Model biometrik | Inference time dan hasil evaluasi |
| Supabase | Status serta durasi query yang benar-benar terjadi |
| Dummy e-commerce | Status produk, cart, dan transaksi |

Diagram arsitektur harus mengikuti alur yang benar-benar diterapkan. Contoh jalur konseptual:

`Frontend → LiveKit Agent → FastAPI → Biometric Verification → Authorization → E-commerce`

Komponen database hanya ditampilkan pada jalur request yang memang mengaksesnya.

#### Metrik yang disarankan

- **End-to-end latency:** waktu dari perintah diberikan sampai hasil diterima.
- **Stage latency:** waktu yang dihabiskan pada setiap tahap.
- **Error dan retry:** jumlah kegagalan, timeout, atau pengulangan.
- **Service status:** status komponen yang benar-benar dipantau.

Fitur ini memperlihatkan pemahaman terhadap integrasi layanan, observability, dan penanganan kegagalan.

### 3.5. Evaluation & Benchmark Dashboard

Dashboard evaluasi menyajikan bukti terukur atas kemampuan sistem.

#### Metrik yang disarankan

| Metrik | Tujuan |
|---|---|
| False Acceptance Rate (FAR) | Mengukur proporsi percobaan impostor yang diterima |
| False Rejection Rate (FRR) | Mengukur proporsi percobaan pengguna sah yang ditolak |
| Metrik anti-spoofing | Mengukur performa deteksi spoofing pada data uji |
| Inference latency | Mengukur waktu pemrosesan model |
| End-to-end latency | Mengukur waktu dari input sampai hasil akhir |

#### Eksperimen yang dapat dilakukan

1. Menguji beberapa threshold similarity dan mengamati trade-off FAR dan FRR.
2. Menguji dampak noise dan jarak mikrofon terhadap verifikasi.
3. Membandingkan genuine speech, impostor speech, dan replay attack.
4. Mengukur latency dalam beberapa kondisi beban jika sistem mendukung pengujian multi-sesi.
5. Menguji kondisi layanan atau database tidak tersedia.

Pengujian harus menggunakan prosedur yang konsisten. Data evaluasi sebaiknya dipisahkan dari data pengembangan agar hasil tidak tampak lebih baik akibat kebocoran data atau sampel yang terlalu mirip.

### 3.6. Face Verification Visualization

Karena face verification dirancang sebagai fallback, prosesnya juga dapat ditampilkan pada dashboard.

Tahapan yang dapat ditampilkan—sesuai implementasi aktual—meliputi:

1. **Face detection:** lokasi wajah pada frame.
2. **Face alignment:** penyesuaian posisi wajah jika digunakan.
3. **Face embedding:** representasi fitur wajah dari model.
4. **Identity comparison:** skor kecocokan terhadap data enrollment.
5. **Liveness check:** hasil pemeriksaan liveness jika modul tersebut tersedia.
6. **Fallback decision:** keputusan apakah persyaratan verifikasi terpenuhi.

Face detection, face recognition, face verification, dan liveness detection merupakan fungsi berbeda dan tidak boleh digambarkan seolah-olah otomatis dilakukan oleh satu model yang sama.

### 3.7. Dua Mode Demonstrasi

Untuk memisahkan pengalaman pengguna dari penjelasan teknis, aplikasi dapat menyediakan dua mode.

#### Mode 1 — Shopping Experience
Pengunjung mencoba Happy sebagai pengguna:
- Meminta rekomendasi atau mencari produk.
- Menanyakan informasi produk.
- Mengelola keranjang.
- Menjalankan alur checkout demo sesuai aturan keamanan.

#### Mode 2 — Engineering Lab
Juri dapat:
- Melihat pipeline biometrik.
- Menjalankan skenario pengujian keamanan.
- Memeriksa trace dan latency.
- Melihat alasan keputusan sistem.
- Membaca hasil evaluasi dan keterbatasan.

Engineering Lab harus menggunakan data demo yang disiapkan khusus. Jangan menyediakan akses untuk mengubah threshold produksi, melihat embedding mentah pengguna lain, atau melewati autentikasi.

## 4. Prioritas Implementasi

Pengembangan disarankan dilakukan bertahap agar fitur yang dibangun saling mendukung.

| Prioritas | Fitur | Tujuan |
|---|---|---|
| 1 | Live Biometric Pipeline Visualization | Memperlihatkan proses biometrik yang sudah ada |
| 2 | Security Attack Simulation Lab | Menguji perilaku sistem pada skenario berbeda |
| 3 | Transaction Security & Policy Engine | Menghubungkan verifikasi dengan otorisasi aksi |
| 4 | Evaluation & Benchmark Dashboard | Membuktikan kemampuan dengan metrik |
| 5 | System Architecture & Observability | Memperlihatkan integrasi dan performa layanan |
| 6 | Face Verification Visualization | Memperlihatkan proses fallback wajah |

Prioritas akhir perlu disesuaikan dengan kondisi kode saat ini, waktu menuju expo, serta status implementasi setiap model dan layanan.

## 5. Rancangan Alur Presentasi Expo

Demonstrasi dapat disusun sebagai eksperimen singkat.

1. **Tunjukkan pengalaman pengguna.** Pengunjung memberikan perintah belanja kepada Happy dan melihat hasilnya.
2. **Buka Engineering Lab.** Perlihatkan tahapan pemrosesan yang benar-benar terjadi ketika perintah tadi dijalankan.
3. **Jalankan skenario pembanding.** Uji input genuine dan setidaknya satu skenario gagal atau serangan yang relevan.
4. **Jelaskan keputusan sistem.** Tunjukkan bagaimana similarity, anti-spoofing, dan policy berkontribusi pada keputusan akhir.
5. **Tampilkan hasil evaluasi.** Sajikan metrik, keterbatasan, dan perbaikan yang sudah dilakukan.

Dengan urutan ini, pengunjung melihat manfaat produk sekaligus proses engineering yang mendukungnya.

## 6. Prinsip Implementasi dan Validitas

Agar demonstrasi tetap kredibel:

- Visualisasi harus terhubung dengan output dan event aktual dari backend.
- Jangan menampilkan tahap pemrosesan yang tidak dijalankan.
- Bedakan data ilustrasi dari hasil eksperimen nyata.
- Jelaskan definisi skor, threshold, dan arah interpretasi metrik.
- Catat alasan keputusan, bukan hanya hasil akhir.
- Jangan menyimpan atau menampilkan audio, embedding, atau data wajah lebih lama daripada yang diperlukan.
- Gunakan akun dan data demo khusus expo.
- Jangan mengklaim ketahanan terhadap semua serangan berdasarkan pengujian yang terbatas.
- Catat keterbatasan sistem secara terbuka dan gunakan hasil pengujian untuk mendukung klaim.

## 7. Rekomendasi Akhir

Paket pengembangan yang paling direkomendasikan untuk expo adalah:

1. **Live Biometric Pipeline Visualization** sebagai pusat demonstrasi teknis.
2. **Security Attack Simulation Lab** untuk memperlihatkan bagaimana sistem diuji.
3. **Transaction Security & Policy Engine** untuk menghubungkan biometrik dengan aksi belanja yang nyata.
4. **Evaluation & Benchmark Dashboard** sebagai bukti terukur atas kemampuan sistem.

Keempat fitur ini membentuk narasi engineering yang utuh:

- Pipeline menjelaskan **bagaimana sistem bekerja**.
- Security Lab menunjukkan **bagaimana sistem diuji**.
- Policy Engine menunjukkan **bagaimana hasil verifikasi digunakan**.
- Evaluation Dashboard menunjukkan **seberapa baik sistem bekerja berdasarkan pengujian**.

Fokusnya bukan membuat Happy tampak rumit, tetapi membuat engineering yang sudah ada menjadi terlihat, dapat diuji, dan dapat dipertanggungjawabkan.
