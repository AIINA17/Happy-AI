# Isi X-Banner Capstone

## HAPPY

### Voice AI Shopping Assistant dengan Verifikasi Biometrik

**From Voice to Trust**

ID-Capstone: `[ID kelompok]`  
Kelompok: `[Nama kelompok]`  
Anggota: `[Nama anggota]`  
Pembimbing: `[Nama pembimbing]`  
DTETI – Universitas Gadjah Mada

> **Catatan desain:** Letakkan logo UGM dan DTETI pada bagian header atau footer
> banner. Gunakan akun dan data demo, bukan data pribadi pengguna.

---

## 1. Latar Belakang Permasalahan

Belanja digital memberikan kemudahan, tetapi pengguna masih harus berinteraksi
melalui banyak menu, formulir, dan halaman. Voice assistant dapat membuat
interaksi belanja menjadi lebih natural, tetapi perintah suara untuk aksi
sensitif seperti mengelola keranjang atau checkout menimbulkan tantangan
keamanan.

Sistem tidak cukup hanya memahami **apa yang dikatakan pengguna**. Sistem juga
perlu memastikan:

- siapa yang sedang berbicara;
- apakah audio berasal dari pengguna asli;
- apakah audio memiliki indikasi replay atau spoofing;
- apakah aksi yang diminta memang boleh dilakukan oleh pengguna.

### Pesan singkat untuk banner

> **Bagaimana membuat pengalaman belanja berbasis suara yang natural sekaligus
> lebih aman?**

### Gambar yang disarankan

- Ilustrasi pengguna memberikan perintah suara kepada asisten belanja.
- Ilustrasi alur masalah: `Voice Command → Risiko Akses Tidak Sah`.
- Ikon microphone, AI, dan security/shield.

---

## 2. Solusi yang Ditawarkan

Happy adalah **Voice AI Shopping Assistant** yang menggabungkan percakapan
suara, kecerdasan buatan, verifikasi speaker, anti-spoofing, dan face
verification sebagai fallback.

Alur solusi:

```text
Perintah Suara
      ↓
Voice Shopping Assistant
      ↓
Speaker Verification
      ↓
Anti-Spoofing
      ↓
Decision Engine
      ↓
Aksi Belanja Diizinkan atau Dibatasi
```

Jika voice verification gagal tiga kali berturut-turut, sistem menjalankan
verifikasi wajah sebagai jalur fallback:

```text
3× Voice Verification Gagal
      ↓
Face Liveness Challenge
      ↓
Face Verification
      ↓
Authorization
```

### Pesan utama

> **Happy tidak hanya memahami apa yang dikatakan pengguna, tetapi juga
> memeriksa siapa yang berbicara dan apakah tindakan tersebut diizinkan.**

### Gambar yang disarankan

- Diagram alur solusi dari microphone hingga authorization.
- Ilustrasi dua jalur autentikasi: suara dan wajah.
- Ikon `Voice`, `AI`, `Shield`, dan `Face Recognition`.

---

## 3. Implementasi Solusi

### Komponen sistem

| Komponen | Implementasi |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui |
| Voice communication | LiveKit Client dan LiveKit Agent |
| Conversational AI | Gemini realtime model |
| Backend | FastAPI dan Python |
| Speaker verification | ECAPA-TDNN melalui SpeechBrain |
| Anti-spoofing | Pemeriksaan deepfake/replay audio |
| Face verification | ArcFace/InsightFace |
| Database dan autentikasi | Supabase |
| Deployment | Docker Compose |

### Alur implementasi

1. Pengguna melakukan login melalui Supabase Auth.
2. Pengguna melakukan voice enrollment dengan merekam kalimat referensi.
3. Sistem menyimpan profil/embedding suara pengguna.
4. Pengguna memulai sesi voice shopping melalui LiveKit.
5. Gemini memahami perintah dan memanggil tools e-commerce.
6. Untuk kebutuhan verifikasi, audio diproses oleh backend.
7. ECAPA-TDNN menghitung kecocokan suara terhadap profil enrollment.
8. Anti-spoofing memeriksa indikasi replay atau audio palsu.
9. Decision engine menghasilkan keputusan `VERIFIED`, `REPEAT`, atau `DENIED`.
10. Setelah tiga kegagalan voice verification, sistem mengirim perintah
    verifikasi wajah.
11. Face liveness challenge dan ArcFace memproses verifikasi wajah.
12. Hasil verifikasi digunakan untuk menentukan apakah aksi sensitif dapat
    dijalankan.

### Diagram arsitektur yang disarankan

```text
Browser / Frontend
       │
       ├── Supabase Auth
       ├── LiveKit Client
       └── HTTP API
              │
              ▼
       FastAPI Backend
       ├── Voice Enrollment
       ├── Voice Verification
       ├── Anti-Spoofing
       ├── Face Verification
       ├── Decision Engine
       └── Supabase Repository
              ▲
              │
       LiveKit Agent
       ├── Gemini Realtime
       └── E-commerce Tools
```

### Gambar yang disarankan

- Screenshot halaman utama Happy.
- Screenshot voice enrollment.
- Screenshot product recommendation.
- Screenshot pipeline verifikasi suara.
- Diagram arsitektur seperti di atas.
- Screenshot face liveness challenge, jika tersedia dan layak ditampilkan.

---

## 4. Hasil Implementasi, Pengujian, dan Evaluasi

Pengujian menggunakan **30 data terbaru untuk setiap kategori pengujian**.
Hasil berikut adalah hasil pada dataset pengujian yang tersedia, bukan jaminan
performa untuk seluruh pengguna dan kondisi lingkungan.

### Hasil voice verification

Total pengujian: **90 data**

| Kondisi | Jumlah | VERIFIED | DENIED | REPEAT |
|---|---:|---:|---:|---:|
| Genuine speaker | 30 | 25 | 0 | 5 |
| Impostor speaker | 30 | 0 | 27 | 3 |
| Spoof/replay audio | 30 | 0 | 30 | 0 |

Metrik:

- Genuine acceptance rate: **83,3%**
- Genuine repeat rate: **16,7%**
- Impostor acceptance rate: **0%**
- Spoof acceptance rate: **0%**
- Spoof ditolak berdasarkan keputusan akhir: **100%**

### Hasil face verification

Total pengujian: **60 data**

| Kondisi | Jumlah | VERIFIED | DENIED |
|---|---:|---:|---:|
| Genuine user | 30 | 30 | 0 |
| Impostor user | 30 | 0 | 30 |

Threshold similarity: **0,45**

Metrik:

- Genuine acceptance rate: **100%**
- Impostor rejection rate: **100%**

### FAR, FRR, dan EER

| Modul | FAR | FRR | EER |
|---|---:|---:|---:|
| Voice verification | 0% | 16,7% | 3,33% |
| Face verification | 0% | 0% | 0% |

Keterangan:

- Pada voice verification, status `REPEAT` dihitung sebagai belum diterima
  ketika menghitung FRR.
- EER dihitung dari sweep skor kontinu genuine versus impostor.
- Nilai metrik berlaku untuk data pengujian yang digunakan.

### Gambar/grafik yang disarankan

- Bar chart perbandingan `VERIFIED`, `DENIED`, dan `REPEAT`.
- Confusion matrix voice verification.
- Confusion matrix face verification.
- Grafik perbandingan skor genuine dan impostor.
- Badge metrik:
  - `FAR 0%`
  - `FRR 16,7% Voice`
  - `EER 3,33% Voice`
  - `Face Genuine Acceptance 100%`
- Screenshot hasil `VERIFIED`, `REPEAT`, dan `DENIED`.

> Hindari menampilkan wajah, suara, email, token, password, atau kredensial
> e-commerce milik pengguna. Gunakan data demo yang sudah dianonimkan.

---

## 5. Kesimpulan

Happy berhasil mengimplementasikan voice shopping assistant yang menggabungkan
interaksi suara dengan lapisan verifikasi biometrik. Sistem dapat:

- menerima perintah belanja secara natural;
- mencari dan menampilkan rekomendasi produk;
- memverifikasi identitas speaker;
- membantu mendeteksi audio spoof atau replay;
- meminta pengguna mengulangi input yang belum meyakinkan;
- menggunakan face verification sebagai fallback setelah tiga kegagalan voice
  verification;
- membatasi aksi sensitif berdasarkan hasil decision engine.

Pada dataset pengujian yang digunakan, voice verification tidak menerima
impostor maupun spoof sebagai `VERIFIED`. Face verification menerima seluruh
data genuine dan menolak seluruh data impostor pada sampel pengujian.

Pengembangan selanjutnya dapat mencakup dataset yang lebih besar, variasi
noise dan perangkat yang lebih beragam, kalibrasi threshold yang lebih luas,
serta evaluasi berulang pada kondisi penggunaan nyata.

### Kalimat penutup banner

> **Happy: From Voice to Trust**

### Gambar penutup yang disarankan

- Logo Happy atau wordmark proyek.
- Screenshot dashboard dengan status `VERIFIED` dan `Agent Permission:
  ALLOWED`.
- Ikon kombinasi microphone, fingerprint/voice wave, face, dan shield.

---

## Susunan Visual X-Banner yang Disarankan

### Header

- Logo UGM
- Logo DTETI
- Judul `HAPPY`
- Subjudul `Voice AI Shopping Assistant dengan Verifikasi Biometrik`
- ID-Capstone dan nama kelompok

### Bagian tengah

Gunakan lima blok bernomor:

1. **Latar Belakang**
2. **Solusi**
3. **Implementasi**
4. **Hasil Pengujian**
5. **Kesimpulan**

### Footer

- Nama anggota
- Nama pembimbing
- QR code menuju video/demo atau repository jika diperlukan
- Kalimat `From Voice to Trust`

## Catatan Produksi

- Gunakan ukuran dan template resmi panitia jika tersedia.
- Pastikan semua teks terbaca dari jarak beberapa meter.
- Hindari paragraf panjang; gunakan poin dan angka besar.
- Gunakan warna konsisten:
  - Biru untuk voice/AI.
  - Oranye untuk anti-spoofing.
  - Ungu untuk face verification.
  - Hijau untuk `VERIFIED`.
  - Kuning untuk `REPEAT`.
  - Merah untuk `DENIED`.
- Cantumkan sumber gambar atau ikon eksternal pada bagian kecil footer.
- Jika seluruh gambar dibuat oleh tim, tuliskan:

  ```text
  Seluruh screenshot dan ilustrasi prototipe dibuat oleh Tim Capstone Happy.
  ```

---

# Versi Ringkas untuk X-Banner 60 × 160 cm

Bagian ini adalah versi yang lebih padat untuk ditempatkan pada template
portrait berukuran 60 × 160 cm. Gunakan teks ini sebagai isi utama banner,
sedangkan uraian panjang di atas dapat digunakan untuk laporan atau caption
pendamping.

## HEADER

**HAPPY**  
**Voice AI Shopping Assistant**  
*From Voice to Trust*

ID-Capstone: `[ID kelompok]`  
`[Nama kelompok]`  
`[Nama anggota]`  
Pembimbing: `[Nama pembimbing]`

**DTETI – Universitas Gadjah Mada**

> **Letakkan logo UGM dan DTETI di area header sesuai template.**

## 1. LATAR BELAKANG

Belanja online masih membutuhkan banyak interaksi melalui menu dan formulir.
Voice assistant membuat proses belanja lebih natural, tetapi perintah suara
untuk aksi sensitif memerlukan verifikasi keamanan.

**Tantangan:**

- Apakah pengguna yang berbicara adalah pemilik akun?
- Apakah audio berasal dari pengguna asli?
- Apakah aksi belanja tersebut boleh dijalankan?

**Gambar:** pengguna berbicara ke microphone + ikon shield.

## 2. SOLUSI

Happy menggabungkan:

- Voice shopping assistant.
- Speaker verification.
- Anti-spoofing audio.
- Face verification sebagai fallback.
- Decision engine untuk otorisasi aksi.

```text
Voice Command
      ↓
Speaker Verification
      ↓
Anti-Spoofing
      ↓
Decision Engine
      ↓
Secure Shopping Action
```

Setelah **3 kali voice verification gagal**, sistem menjalankan **face
verification** sebagai fallback.

**Gambar:** diagram alur suara → AI → verifikasi → shield.

## 3. IMPLEMENTASI

**Teknologi:**

```text
Frontend      : Next.js, React, TypeScript
Voice         : LiveKit
AI Agent      : Gemini Realtime
Backend       : FastAPI, Python
Voice Model   : ECAPA-TDNN
Face Model    : ArcFace/InsightFace
Database      : Supabase
Deployment    : Docker
```

**Alur penggunaan:**

1. User melakukan voice enrollment.
2. User memberikan perintah belanja.
3. Agent mencari dan merekomendasikan produk.
4. Sistem memverifikasi suara dan keaslian audio.
5. Jika voice gagal 3 kali, sistem meminta verifikasi wajah.
6. Decision engine mengizinkan atau membatasi aksi sensitif.

**Gambar:** screenshot aplikasi, kartu produk, dan pipeline biometrik.

## 4. HASIL PENGUJIAN

### Voice Verification

Pengujian menggunakan 30 data terbaru untuk setiap kategori.

| Kondisi | Data | Verified | Denied | Repeat |
|---|---:|---:|---:|---:|
| Genuine | 30 | 25 | 0 | 5 |
| Impostor | 30 | 0 | 27 | 3 |
| Spoof | 30 | 0 | 30 | 0 |

### Face Verification

| Kondisi | Data | Verified | Denied |
|---|---:|---:|---:|
| Genuine | 30 | 30 | 0 |
| Impostor | 30 | 0 | 30 |

### Metrik

```text
                 FAR       FRR       EER
Voice            0%        16,7%     3,33%
Face             0%        0%        0%
```

**Catatan:** hasil berlaku pada dataset pengujian yang digunakan. Status
`REPEAT` dihitung sebagai belum diterima dalam FRR voice.

**Gambar:** bar chart hasil `VERIFIED / DENIED / REPEAT` atau confusion matrix.

## 5. KESIMPULAN

Happy berhasil mengintegrasikan voice shopping dengan verifikasi biometrik.
Sistem dapat:

- memahami perintah belanja secara natural;
- memverifikasi identitas speaker;
- mendeteksi indikasi audio spoof;
- menggunakan face verification sebagai fallback;
- membatasi aksi sensitif berdasarkan hasil verifikasi.

> **Happy: From Voice to Trust**

## FOOTER

`[QR code video/demo, jika diperlukan]`  
`[Sumber gambar atau ikon eksternal]`

### Rekomendasi penempatan pada template 60 × 160 cm

```text
┌────────────────────┐
│ LOGO + JUDUL       │  0–20 cm
├────────────────────┤
│ LATAR BELAKANG     │ 20–42 cm
├────────────────────┤
│ SOLUSI             │ 42–68 cm
├────────────────────┤
│ IMPLEMENTASI       │ 68–100 cm
├────────────────────┤
│ HASIL PENGUJIAN    │100–140 cm
├────────────────────┤
│ KESIMPULAN + QR    │140–160 cm
└────────────────────┘
```

Gunakan maksimal satu screenshot utama atau satu diagram kecil pada setiap
bagian. Untuk ukuran ini, tabel hasil pengujian sebaiknya dibuat sebagai
infografik atau angka besar agar tetap terbaca dari jarak pengunjung.

---

# Versi Naratif Mengikuti Gaya Contoh Kating

Bagian ini dapat digunakan jika template memiliki gaya seperti contoh kating:
judul section berbentuk kapsul, narasi utama di bagian atas, lalu kotak
permasalahan/solusi, gambar bernomor, diagram arsitektur, dan kotak kesimpulan.

## Bagian 1 — Latar Belakang

### Judul section

**Latar Belakang**

### Narasi utama

Perkembangan teknologi conversational AI membuka peluang baru dalam pengalaman
belanja digital melalui interaksi berbasis suara. Namun, voice assistant tidak
hanya perlu memahami perintah pengguna, tetapi juga harus mempertimbangkan
keamanan ketika menjalankan aksi sensitif seperti mengelola keranjang atau
melanjutkan checkout. Perintah suara dapat berasal dari pengguna yang sah,
impostor, atau audio replay yang diputar kembali.

Kondisi tersebut menunjukkan perlunya sistem yang mampu menggabungkan
kemudahan voice shopping dengan verifikasi identitas dan pemeriksaan keaslian
audio. Oleh karena itu, dikembangkan Happy sebagai Voice AI Shopping Assistant
yang menghubungkan percakapan suara, verifikasi biometrik, dan decision engine
untuk membantu mengontrol akses terhadap aksi belanja.

### Kotak “Permasalahan Utama”

- Interaksi belanja melalui menu dan formulir masih kurang natural.
- Perintah suara untuk aksi sensitif dapat disalahgunakan.
- Sistem perlu membedakan pengguna genuine dan impostor.
- Audio replay atau spoof perlu diperiksa.
- Kegagalan voice verification memerlukan jalur fallback.

### Gambar yang ditempatkan

Gunakan empat visual kecil bernomor seperti contoh:

1. Screenshot user memberikan perintah suara kepada Happy.
2. Screenshot rekomendasi produk.
3. Ilustrasi impostor atau replay audio dengan ikon peringatan.
4. Diagram masalah `Voice Command → Identity Risk → Secure Authorization`.

## Bagian 2 — Solusi Kami

### Judul section

**Solusi Kami**

### Nama solusi

**HAPPY: Voice AI Shopping Assistant with Biometric Verification**

### Narasi utama

Happy menyediakan pengalaman belanja berbasis suara yang terhubung dengan
LiveKit Agent, Gemini realtime, backend FastAPI, dan tools e-commerce. Pengguna
memulai dengan voice enrollment, kemudian dapat memberikan perintah belanja
secara natural. Sistem memproses suara melalui speaker verification menggunakan
ECAPA-TDNN dan pemeriksaan anti-spoofing sebelum decision engine menentukan
apakah aksi sensitif dapat dilakukan.

Apabila pengguna gagal melakukan voice verification sebanyak tiga kali
berturut-turut, Happy mengaktifkan face verification sebagai fallback. Proses
ini dilengkapi liveness challenge sebelum gambar diverifikasi menggunakan
ArcFace/InsightFace. Hasil verifikasi suara atau wajah kemudian digunakan oleh
agent sebagai dasar authorization.

### Diagram alur utama

```text
Pengguna
   ↓
Voice Shopping Assistant
   ↓
Voice Verification
   ├── ECAPA-TDNN
   └── Anti-Spoofing
   ↓
Decision Engine
   ↓
ALLOWED / REPEAT / BLOCKED
   │
   └── 3× gagal → Face Liveness + Face Verification
```

### Diagram arsitektur yang ditempatkan

```text
Frontend Next.js
        │
        ├── Supabase Auth
        └── LiveKit Client
                │
                ▼
        FastAPI Backend
        ├── Voice Verification
        ├── Anti-Spoofing
        ├── Face Verification
        └── Decision Engine
                ▲
                │
        LiveKit Agent
        ├── Gemini Realtime
        └── E-commerce Tools
                │
                ▼
             Supabase
```

### Gambar yang ditempatkan

- Screenshot halaman utama Happy.
- Diagram pipeline biometrik.
- Screenshot face liveness challenge.
- Ikon teknologi: Next.js, LiveKit, Gemini, FastAPI, Supabase, ECAPA-TDNN,
  dan ArcFace/InsightFace.

## Bagian 3 — Implementasi

### Judul section

**Implementasi Solusi**

### Narasi singkat

Implementasi Happy terdiri dari frontend web, backend biometrik, LiveKit Agent,
model AI, dan database. Frontend menyediakan voice enrollment, voice shopping,
kartu produk, histori percakapan, serta tampilan hasil verifikasi. Backend
menangani pemrosesan audio, speaker verification, anti-spoofing, face
verification, logging, dan pengambilan keputusan. LiveKit Agent menghubungkan
percakapan suara dengan Gemini realtime dan tools e-commerce.

### Kotak teknologi

```text
Frontend      Next.js + React + TypeScript
Voice         LiveKit Client + LiveKit Agent
Conversational AI  Gemini Realtime
Backend       FastAPI + Python
Speaker Model ECAPA-TDNN / SpeechBrain
Face Model    ArcFace / InsightFace
Database      Supabase
Deployment    Docker Compose
```

### Alur penggunaan prototipe

1. Login atau signup.
2. Melakukan voice enrollment.
3. Mengucapkan permintaan pencarian produk.
4. Melihat rekomendasi produk dari Happy.
5. Melakukan verifikasi untuk aksi sensitif.
6. Menggunakan face verification jika voice verification gagal tiga kali.

### Gambar yang ditempatkan

- Screenshot voice enrollment.
- Screenshot percakapan voice shopping.
- Screenshot kartu produk.
- Screenshot status `VERIFIED`, `REPEAT`, atau `DENIED`.

### Arsitektur Biometrik yang Digunakan

#### A. Voice Verification — ECAPA-TDNN

```text
Audio WebM
   ↓
Konversi & normalisasi
16 kHz, mono
   ↓
ECAPA-TDNN / SpeechBrain
   ↓
Voice Embedding
   ↓
Cosine Similarity
dengan profil enrollment
   ↓
Speaker Score
```

**Fungsi:** menentukan apakah suara yang masuk memiliki kemiripan dengan
profil suara pengguna yang sudah terdaftar.

#### B. Anti-Spoofing — Wav2Vec2 Audio Classifier

```text
Audio 16 kHz
   ↓
Wav2Vec2 Feature Extractor
   ↓
Convolutional Feature Layers
   ↓
Transformer Encoder
   ↓
Fake / Real Classification
   ↓
Fake Probability
```

Model anti-spoofing yang digunakan adalah pretrained
`MelodyMachine/Deepfake-audio-detection-V2`. Model ini memeriksa indikasi
audio palsu atau replay; model ini tidak menentukan identitas pembicara.

#### C. Face Recognition — ArcFace/InsightFace

```text
Camera Image
   ↓
Face Detection
   ↓
Satu wajah terdeteksi
   ↓
ArcFace / InsightFace (buffalo_l)
   ↓
Face Embedding
   ↓
Cosine Similarity
   ↓
VERIFIED jika similarity ≥ 0,45
```

Pada jalur fallback, proses diawali dengan server-picked liveness challenge.
Face recognition digunakan setelah tiga kegagalan voice verification
berturut-turut.

### Diagram gabungan untuk banner

```text
                 AUDIO
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
 ECAPA-TDNN              Wav2Vec2 Classifier
 Speaker Identity        Anti-Spoofing
        └──────────┬──────────┘
                   ▼
           Decision Engine
                   │
          3× gagal voice?
                   │ Ya
                   ▼
          Liveness Challenge
                   ▼
          ArcFace / InsightFace
                   ▼
              Authorization
```

> **Versi sangat ringkas untuk desain:**  
> `Audio → ECAPA-TDNN + Anti-Spoofing → Decision Engine → Authorization`  
> `3× Voice Fail → Liveness → ArcFace → Authorization`

### Visual arsitektur yang disarankan

- Buat tiga kartu horizontal/vertikal:
  1. **Voice Verification — ECAPA-TDNN**
  2. **Anti-Spoofing — Wav2Vec2**
  3. **Face Recognition — ArcFace**
- Gunakan ikon waveform untuk voice, shield/waveform untuk anti-spoofing, dan
  wajah/scan untuk face recognition.
- Jangan menampilkan embedding mentah; tampilkan diagram embedding atau skor
  yang sudah dianonimkan.
- Pada banner 60 × 160 cm, diagram gabungan lebih baik dibuat sebagai tiga
  blok berwarna daripada menampilkan detail setiap layer model.

## Bagian 4 — Hasil Implementasi dan Evaluasi

### Judul section

**Hasil Pengujian dan Evaluasi**

### Narasi singkat

Pengujian dilakukan menggunakan 30 data terbaru pada setiap kategori
pengujian. Voice verification diuji menggunakan genuine speaker, impostor
speaker, dan spoof/replay audio. Face verification diuji menggunakan genuine
user dan impostor user. Hasil menunjukkan bahwa sistem tidak memberikan status
`VERIFIED` kepada data impostor maupun spoof pada dataset pengujian yang
digunakan.

### Infografik voice verification

```text
GENUINE       25 VERIFIED | 5 REPEAT
IMPOSTOR       0 VERIFIED | 27 DENIED | 3 REPEAT
SPOOF          0 VERIFIED | 30 DENIED
```

### Infografik face verification

```text
GENUINE       30 VERIFIED | 0 DENIED
IMPOSTOR       0 VERIFIED | 30 DENIED
```

### Metrik utama

```text
                    FAR       FRR       EER
Voice Verification  0%        16,7%     3,33%
Face Verification   0%        0%        0%
```

### Kotak interpretasi hasil

Voice verification menerima 25 dari 30 data genuine. Lima data genuine
mendapat status `REPEAT`, yang menunjukkan sistem meminta pengambilan suara
ulang ketika tingkat keyakinan belum cukup. Face verification menerima 30 dari
30 genuine dan menolak 30 dari 30 impostor pada dataset pengujian.

> **Catatan:** hasil ini berlaku pada dataset dan kondisi pengujian yang
> digunakan, bukan jaminan performa untuk seluruh pengguna atau seluruh kondisi
> lingkungan.

### Gambar/grafik yang ditempatkan

- Bar chart `VERIFIED / DENIED / REPEAT`.
- Confusion matrix voice verification.
- Confusion matrix face verification.
- Grafik distribusi speaker score genuine dan impostor.
- Badge besar `FAR 0%`, `EER 3,33%`, atau `Face Acceptance 100%`.

## Bagian 5 — Kesimpulan

### Judul section

**Kesimpulan**

### Narasi dalam kotak penutup

Happy berhasil mengintegrasikan voice shopping assistant dengan verifikasi
speaker, anti-spoofing, decision engine, dan face verification sebagai
fallback. Sistem dapat memahami perintah belanja secara natural, menampilkan
rekomendasi produk, memeriksa identitas serta keaslian audio, dan membatasi
aksi sensitif berdasarkan hasil verifikasi.

Hasil pengujian menunjukkan bahwa pada dataset yang digunakan, tidak ada
impostor atau spoof yang memperoleh status `VERIFIED`. Face verification juga
berhasil digunakan sebagai jalur fallback setelah tiga kegagalan voice
verification.

### Kalimat besar

**HAPPY — From Voice to Trust**

### Isi footer

```text
ID-Capstone: [ID kelompok]
Anggota: [Nama anggota]
Pembimbing: [Nama pembimbing]
DTETI – Universitas Gadjah Mada
```

Letakkan logo UGM dan DTETI pada header atau footer. QR code dapat diarahkan ke
video demo atau repository jika diwajibkan panitia.
