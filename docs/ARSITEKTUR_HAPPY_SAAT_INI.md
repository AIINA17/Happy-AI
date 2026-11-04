# Arsitektur Happy Saat Ini

Dokumen ini merangkum arsitektur yang saat ini terlihat dari implementasi repository
Happy. Happy adalah aplikasi **Voice AI Shopping Assistant** yang menggabungkan
percakapan suara, katalog e-commerce, verifikasi speaker, anti-spoofing, dan
penyimpanan sesi percakapan.

> Dokumen ini mendeskripsikan kondisi implementasi saat ini, bukan seluruh fitur yang
> masih berada pada tahap rancangan. Untuk fitur yang belum terhubung ke alur utama,
> statusnya ditulis secara eksplisit.

## 1. Gambaran Besar Sistem

Repository ini berbentuk monorepo dengan dua aplikasi utama:

```text
Happy-AI/
├── frontend/       Next.js + React + TypeScript
├── backend/        Python services
├── docker-compose.yml
├── README.md
└── docs/
```

Komponen runtime utama:

```text
Browser
  │
  ├── Next.js Frontend (:3000)
  │       │
  │       ├── Supabase Auth
  │       ├── HTTP API ───────────────┐
  │       └── LiveKit Client          │
  │                                   ▼
  │                         FastAPI Backend (:8000)
  │                                   │
  │                                   ├── Voice verification
  │                                   ├── Voice enrollment
  │                                   ├── Conversation/session API
  │                                   ├── E-commerce account API
  │                                   └── Face router (/face/*)
  │
  └── LiveKit audio room ◄────── LiveKit Agent worker
                                  │
                                  ├── Gemini realtime model
                                  ├── Shopping tools
                                  └── Supabase repositories

Supabase
  ├── Auth
  ├── Voice enrollment and verification data
  ├── Behavior profiles
  ├── Conversation sessions and logs
  ├── Product/review cards
  ├── Face profiles and face verification logs
  └── Encrypted e-commerce credentials
```

## 2. Deployment dan Service

### 2.1 Frontend

Frontend berada di [`frontend/`](../frontend/) dan menggunakan:

- Next.js App Router
- React dan TypeScript
- Tailwind CSS
- shadcn/ui berbasis Radix UI
- Supabase JavaScript client
- LiveKit client

Pada Docker Compose, frontend berjalan pada port `3000`.

### 2.2 Backend FastAPI

Backend utama berada di [`backend/voiceverification/server.py`](../backend/voiceverification/server.py).
Service ini berjalan pada port `8000` dan menangani:

- pembuatan token dan dispatch LiveKit;
- enrollment dan verifikasi suara;
- pemrosesan biometrik;
- behavior profile dan decision engine;
- log verifikasi dan sesi percakapan;
- visualisasi serta metrik pipeline;
- penyimpanan akun e-commerce;
- router verifikasi wajah dengan prefix `/face`.

Service menggunakan `BiometricService` singleton yang diinisialisasi saat startup.
Device dipilih berdasarkan ketersediaan CUDA, lalu fallback ke CPU.

### 2.3 LiveKit Agent

Worker agent berada di [`backend/agent/agent.py`](../backend/agent/agent.py).
Agent bukan aplikasi HTTP dan tidak dijalankan melalui uvicorn. Agent dijalankan
sebagai worker LiveKit, misalnya:

```bash
cd backend
python -m agent.agent start
```

Agent menggunakan:

- LiveKit Agents;
- Gemini realtime model untuk percakapan suara;
- tool function untuk pencarian produk, detail produk, cart, checkout, akun,
  pembayaran, order history, cuaca, dan web search;
- repository Supabase untuk sesi dan log percakapan.

Nama agent yang digunakan oleh backend dan worker harus sama:

```text
happy-shopping-assistant
```

### 2.4 Docker Compose

[`docker-compose.yml`](../docker-compose.yml) mendefinisikan tiga container:

| Service | Port | Fungsi |
|---|---:|---|
| `backend` | `8000` | FastAPI voice verification, business API, dan `/face/*` |
| `agent` | tidak mengekspos HTTP publik | LiveKit Agent worker |
| `frontend` | `3000` | Aplikasi web Next.js |

Backend dan agent meminta resource GPU melalui konfigurasi deployment Docker.
Healthcheck backend menggunakan `/health`, sedangkan agent menggunakan endpoint
healthcheck internal pada port `8081`.

Perintah umum:

```bash
docker-compose up --build backend agent frontend
```

## 3. Frontend

### 3.1 Route utama

Route App Router yang tersedia antara lain:

| Route | Fungsi |
|---|---|
| `/` | Halaman utama voice shopping setelah login |
| `/login` | Login Supabase |
| `/signup` | Registrasi Supabase |
| `/history/[id]` | Detail sesi percakapan |
| `/pipeline` | Penjelasan pipeline verifikasi suara |
| `/agent-pipeline` | Visualisasi alur tool agent |
| `/dashboard` | Dashboard embedding/profil |
| `/embeddings` | Visualisasi embedding |
| `/analysis` | Dashboard spektrogram dan metrik verifikasi |

### 3.2 Halaman utama dan state UI

[`frontend/app/page.tsx`](../frontend/app/page.tsx) melakukan hal-hal berikut:

1. Memeriksa session melalui Supabase Auth.
2. Mengarahkan pengguna yang belum login ke `/login`.
3. Menampilkan [`Sidebar`](../frontend/components/Sidebar.tsx) untuk:
   - logout;
   - daftar sesi;
   - voice enrollment;
   - face enrollment;
   - pengaitan akun e-commerce.
4. Menampilkan [`ChatArea`](../frontend/components/ChatArea.tsx) untuk:
   - pesan user dan agent;
   - kontrol voice;
   - kartu produk;
   - kartu review.
5. Menggunakan `useLiveKit` untuk koneksi audio dan event agent.

### 3.3 Hook LiveKit

[`frontend/hooks/useLiveKit.ts`](../frontend/hooks/useLiveKit.ts) mengelola:

- join dan disconnect room LiveKit;
- publish track microphone;
- status UI seperti `CONNECTING`, `LISTENING`, `RECORDING`,
  `VERIFYING`, `FACE_VERIFYING`, dan `CHATTING`;
- perekaman sampel suara dari track microphone yang sudah dipublish;
- pengiriman audio ke `/verify-voice`;
- penerimaan data agent melalui LiveKit data channel;
- penerimaan pesan user/agent;
- penerimaan product cards dan review cards;
- pemicu face capture berdasarkan command agent;
- status verifikasi `VERIFIED`, `REPEAT`, atau `DENIED`;
- indikator agent sedang berpikir atau mengalami kondisi stuck.

Frontend menggunakan kembali track microphone LiveKit untuk verifikasi suara,
sehingga tidak membuka `getUserMedia` kedua secara bersamaan.

### 3.4 Enrollment suara

[`frontend/components/VoiceEnrollment.tsx`](../frontend/components/VoiceEnrollment.tsx)
memandu pengguna merekam beberapa kalimat referensi selama sekitar 10 detik per
profil. Audio dikirim ke endpoint `/enroll-voice`.

Contoh kalimat enrollment saat ini berupa perintah natural kepada Happy, bukan
teks Sumpah Pemuda. Profil dapat:

- dibuat;
- ditampilkan;
- diberi label;
- dihapus.

### 3.5 Enrollment dan liveness wajah

Komponen yang berhubungan dengan wajah:

- [`FaceEnrollment.tsx`](../frontend/components/FaceEnrollment.tsx)
- [`FaceLivenessCapture.tsx`](../frontend/components/FaceLivenessCapture.tsx)
- [`FaceVerification.tsx`](../frontend/components/FaceVerification.tsx)

Komponen tersebut menggunakan endpoint `/face/*`. Liveness capture dapat meminta
tantangan seperti kedipan, gerakan mulut, atau gerakan kepala sebelum mengambil
frame untuk verifikasi.

### 3.6 Visualisasi dan dashboard

Frontend memiliki beberapa permukaan observability:

- `/pipeline`: replay trace dari `public/pipeline-demo/traces.json`, serta mode
  live menggunakan `/verify-voice/explain` jika pengguna login;
- `/agent-pipeline`: visualisasi trace tool agent;
- `/analysis`: spektrogram, log verifikasi suara, threshold, log verifikasi
  wajah, dan threshold wajah;
- `/embeddings` dan `/dashboard`: visualisasi/projecting embedding.

Mode replay pada `/pipeline` memakai data JSON statis agar tetap dapat digunakan
untuk presentasi ketika backend tidak tersedia. Mode replay harus dibedakan dari
hasil live backend saat demonstrasi.

## 4. Alur Data Utama

### 4.1 Login dan autentikasi

1. Pengguna login atau signup melalui Supabase Auth.
2. Frontend memperoleh Supabase access token.
3. Token dikirim pada header `Authorization` ketika mengakses API voice.
4. Backend mengambil identitas pengguna dari request melalui
   `voiceverification/auth/auth_utils.py`.

### 4.2 Memulai sesi voice

1. Frontend meminta `POST /join-token`.
2. Backend mengambil user ID dari token.
3. Backend membuat room dengan pola:

   ```text
   user-{user_id}
   ```

4. Backend membuat LiveKit access token.
5. Backend menghapus dispatch lama yang stale untuk room dan agent tersebut.
6. Backend membuat dispatch baru ke `happy-shopping-assistant`.
7. Frontend join room LiveKit menggunakan token.
8. Agent masuk ke room dan memulai sesi percakapan.

### 4.3 Percakapan dan shopping tools

1. Pengguna berbicara melalui room LiveKit.
2. Agent menerima audio dan menggunakannya pada model Gemini realtime.
3. Gemini dapat memanggil function tools di
   [`backend/agent/tools.py`](../backend/agent/tools.py).
4. Tool mengakses adapter e-commerce atau sumber data yang relevan.
5. Agent mengirim:
   - pesan teks;
   - status thinking;
   - product cards;
   - review cards;
   - command verifikasi atau face capture
   melalui data channel LiveKit.
6. Frontend memperbarui chat dan kartu produk.
7. Pesan, product cards, dan review cards disimpan ke Supabase.

### 4.4 Enrollment suara

```text
VoiceEnrollment
  → POST /enroll-voice
  → validasi audio dan ekstraksi embedding
  → speaker_repo
  → Supabase
```

Enrollment digunakan sebagai referensi untuk pencocokan suara di sesi berikutnya.
Profil behavior dapat dikaitkan dengan label enrollment.

### 4.5 Verifikasi suara

```text
Microphone / LiveKit track
  → MediaRecorder
  → POST /verify-voice
  → simpan dan normalisasi audio
  → BiometricService
  → speaker similarity
  → anti-spoofing
  → behavior profile
  → decision engine
  → log verifikasi
  → response + room notification
  → frontend toast/status
```

Hasil utama yang digunakan UI adalah:

- `VERIFIED`: verifikasi berhasil;
- `REPEAT`: input perlu diulang;
- `DENIED`: verifikasi ditolak.

Backend juga menyediakan `/verify-voice/explain` untuk data trace yang lebih
terperinci bagi halaman pipeline.

### 4.6 Face verification

Face verification berjalan melalui router dari
[`backend/face_recognition/main.py`](../backend/face_recognition/main.py) yang
di-include ke aplikasi FastAPI utama dengan prefix `/face`.

Alur umumnya:

```text
Camera frame
  → liveness challenge
  → face detection/alignment sesuai implementasi model
  → ArcFace/InsightFace embedding
  → perbandingan terhadap face profile
  → log verifikasi wajah
  → hasil ke frontend
```

Face verification tersedia sebagai service/API dan dipakai oleh komponen frontend.
Pada alur voice agent, face recognition juga sudah terhubung sebagai fallback:
setelah tiga hasil voice verification berturut-turut berupa `DENIED` atau
`REPEAT`, agent meminta pengguna melakukan verifikasi wajah.

Urutan fallback tersebut adalah:

```text
Voice attempt 1 gagal
  → Voice attempt 2 gagal
  → Voice attempt 3 gagal
  → agent mengirim FACE_CMD / START_FACE_CAPTURE
  → frontend menjalankan liveness challenge dan mengambil gambar
  → POST /face/verify-face
  → backend mengirim FACE_RESULT ke agent
  → VERIFIED: gate aksi dibuka
  → DENIED/error: cooldown lockout diterapkan
```

Hasil face verification yang berhasil membuka gate yang sama dengan verifikasi
suara. Dengan demikian, tool agent tidak membedakan apakah status `VERIFIED`
diperoleh dari suara atau dari fallback wajah.

## 5. Backend Biometrics dan Decision Engine

### 5.1 Struktur modul

| Direktori | Tanggung jawab |
|---|---|
| `voiceverification/core/` | anti-spoofing, behavior profile, scoring, calibration, decision |
| `voiceverification/services/` | orchestration service biometrik dan kalibrasi |
| `voiceverification/models/` | wrapper model speaker verification |
| `voiceverification/utils/` | audio, trace, spectrogram, evidence, crypto |
| `voiceverification/auth/` | ekstraksi user ID dari request |
| `voiceverification/db/` | repository Supabase |

### 5.2 Speaker verification

Speaker verification menggunakan model ECAPA-TDNN melalui SpeechBrain. Audio
live dibandingkan dengan satu atau beberapa embedding enrollment menggunakan
skor kemiripan.

Tujuan tahap ini adalah menjawab:

```text
Apakah suara ini cocok dengan profil pengguna?
```

### 5.3 Anti-spoofing

Sistem memiliki model dan utilitas anti-spoofing untuk membantu mendeteksi
indikasi replay atau audio palsu. Anti-spoofing adalah pemeriksaan berbeda dari
speaker verification:

```text
Speaker verification → siapa yang berbicara?
Anti-spoofing       → apakah audio tampak asli?
```

Nilai dan threshold harus selalu dijelaskan berdasarkan definisi implementasinya.
Jangan menyamakan `fake probability`, `real probability`, dan `liveness score`
tanpa memastikan arah skornya.

### 5.4 Arsitektur pipeline biometrik

#### Voice verification

```text
Audio WebM
  → konversi WebM ke WAV
  → normalisasi 16 kHz, mono
  → ECAPA-TDNN melalui SpeechBrain
  → voice embedding
  → cosine similarity terhadap embedding enrollment
  → speaker score
```

ECAPA-TDNN digunakan untuk menentukan kemiripan identitas suara. Sistem dapat
membandingkan audio live terhadap beberapa profil enrollment dan memilih
`best_match_label` dengan skor terbaik.

#### Anti-spoofing

```text
Audio 16 kHz
  → Wav2Vec2 feature extractor
  → convolutional feature layers
  → transformer encoder
  → pooling/projection dan classification head
  → fake probability
```

Implementasi menggunakan model pretrained
`MelodyMachine/Deepfake-audio-detection-V2`. Skor anti-spoofing menunjukkan
indikasi audio fake/replay dan tidak menentukan identitas pembicara. Hasil
speaker verification, anti-spoofing, durasi speech, dan behavior score
kemudian dipertimbangkan oleh decision engine.

#### Face recognition

```text
Camera image
  → face detection
  → validasi tepat satu wajah
  → ArcFace/InsightFace model buffalo_l
  → face embedding ternormalisasi
  → cosine similarity terhadap face profile
  → VERIFIED jika similarity >= 0.45
```

Pada jalur fallback agent, face recognition didahului server-picked liveness
challenge. Liveness challenge dan face verification digunakan setelah tiga
kegagalan voice verification berturut-turut.

### 5.5 Behavior profile

Behavior profile menyimpan sinyal perilaku per profil suara dan digunakan sebagai
bagian dari analisis keputusan. Repository terkait berada pada:

- `voiceverification/core/behavior_profile.py`
- `voiceverification/core/behavior_scoring.py`
- `voiceverification/db/behavior_repo.py`

### 5.6 Gate aksi sensitif pada agent

[`backend/agent/tools.py`](../backend/agent/tools.py) memiliki `auth_state` dan
`require_voice_verification`. Gate ini:

- memeriksa status voice verification;
- menangani status `VERIFIED`, `REPEAT`, `DENIED`, dan `EXPIRED`;
- menerapkan interval verifikasi ulang;
- menerapkan lockout cooldown setelah kegagalan berulang;
- membatasi aksi sensitif tanpa menjadikan LLM sebagai satu-satunya sumber
  otorisasi.

Browsing dapat tetap diizinkan saat verifikasi gagal, sedangkan aksi sensitif
dibatasi sesuai aturan tool.

## 6. API Backend

### 6.1 Voice dan session API

Endpoint yang tersedia pada FastAPI utama meliputi:

| Endpoint | Fungsi |
|---|---|
| `POST /join-token` | Membuat token room dan dispatch agent |
| `POST /verify-voice` | Verifikasi audio suara |
| `POST /verify-voice/explain` | Verifikasi dengan trace penjelasan |
| `POST /enroll-voice` | Membuat enrollment suara |
| `GET /enrollments` | Membaca profil suara |
| `DELETE /enrollments/{id}` | Menghapus profil suara |
| `PATCH /speakers/{id}/label` | Mengubah label profil |
| `GET /logs/sessions` | Daftar sesi percakapan |
| `GET /logs/sessions/{id}` | Detail pesan dan kartu sesi |
| `PATCH /conversation-sessions/{id}/label` | Mengubah label sesi |
| `DELETE /conversation-sessions/{id}` | Menghapus sesi |
| `POST/GET/DELETE /ecommerce-account` | Kelola akun e-commerce |
| `GET /verification-metrics` | Log dan threshold verifikasi |
| `GET /spectrograms` | Data spektrogram profil |
| `GET /embeddings/visualize` | Data visualisasi embedding |
| `POST /embeddings/project` | Project embedding |
| `GET /health` | Healthcheck backend |

### 6.2 Face API

Router wajah tersedia melalui prefix `/face`:

| Endpoint | Fungsi |
|---|---|
| `GET /face/health` | Healthcheck modul wajah |
| `POST /face/enroll-face` | Enrollment wajah |
| `POST /face/liveness-challenge` | Mendapatkan tantangan liveness |
| `POST /face/verify-face` | Verifikasi wajah |
| `GET /face/enroll-face/{user_id}` | Mengambil status enrollment |
| `GET /face/enrolled-users` | Daftar pengguna terdaftar |
| `DELETE /face/enroll-face/{user_id}` | Menghapus enrollment |
| `GET /face/verification-metrics` | Metrik verifikasi wajah |
| `GET /face/verification-logs` | Log verifikasi wajah |
| `DELETE /face/verification-logs` | Menghapus log verifikasi wajah |

Catatan: berdasarkan dokumentasi backend, beberapa endpoint wajah masih menerima
`user_id` sebagai form field biasa dan belum menggunakan mekanisme JWT yang sama
dengan endpoint voice. Hal ini perlu diseragamkan sebelum dianggap sebagai
boundary keamanan produksi.

## 7. Data dan Penyimpanan

Supabase digunakan untuk Auth sekaligus data aplikasi. Repository database
berada di `backend/voiceverification/db/`.

Data utama yang disimpan meliputi:

- profil dan embedding suara;
- behavior profile;
- verification logs;
- conversation sessions;
- conversation messages;
- product cards;
- review cards;
- profil wajah;
- face verification logs;
- spektrogram atau URL artefak audio;
- kredensial e-commerce yang dienkripsi per user.

Kredensial e-commerce menggunakan encryption key dari environment
`ECOMMERCE_CRED_ENCRYPTION_KEY`. Key tersebut harus konsisten; jika hilang atau
berubah, data kredensial lama tidak dapat didekripsi.

## 8. Data Hasil Pengujian Biometrik

Repository menyediakan log pengujian berikut:

- [Voice verification test log](../backend/voiceverification/voice_verification_test_log.csv)
- [Face verification test log](../backend/face_recognition/face_verification_test_log.csv)

Log bertanggal **29 Oktober 2026** dan digunakan untuk merangkum perilaku
implementasi pada sampel pengujian yang tersedia. Ringkasan di bawah
menggunakan **30 record paling baru untuk setiap kondisi pengujian**, diurutkan
berdasarkan `timestamp` di dalam masing-masing kondisi. Jadi, voice memakai
30 genuine, 30 impostor, dan 30 spoof; face memakai 30 genuine dan 30
impostor.

### 8.1 Voice verification

Subset yang digunakan berisi **90 percobaan**: 30 genuine, 30 impostor, dan
30 spoof. File log menyediakan 39 genuine, 39 impostor, dan 30 spoof; untuk
setiap kondisi dipilih 30 record paling baru. Karena pengujian menggunakan
beberapa profil enrollment, label pada kolom `best_match_label` tidak
diseragamkan menjadi satu label.

| Kondisi | Jumlah | Verified/diterima | Denied | Repeat | Hasil yang benar |
|---|---:|---:|---:|---:|---:|
| Genuine | 30 | 25 | 0 | 5 | 25 |
| Impostor | 30 | 0 | 27 | 3 | 30 |
| Spoof | 30 | 0 | 30 | 0 | 30 |

Ringkasan skor `speaker_score`:

| Kondisi | Minimum | Maksimum | Rata-rata |
|---|---:|---:|---:|
| Genuine | 0.3541 | 1.0000 | 0.5677 |
| Impostor | 0.0448 | 0.3553 | 0.2062 |
| Spoof | -0.1222 | 0.3071 | 0.0784 |

Dengan definisi sederhana pada log:

- Genuine acceptance rate pada subset ini adalah **25/30 = 83,3%**.
- Genuine rejection atau `REPEAT` rate pada subset ini adalah **5/30 = 16,7%**.
- Impostor tidak ada yang diterima sebagai `VERIFIED`: **0/30 = 0%**.
- Impostor yang tidak diterima sebagai pengguna sah berjumlah **30/30 = 100%**,
  terdiri dari 27 `DENIED` dan 3 `REPEAT`.
- Seluruh sampel spoof menghasilkan `DENIED`, yaitu **30/30 = 100%** pada
  subset terbaru ini.

Kolom `spoof_prob` juga tercatat di log. Nilainya tidak boleh dibaca terpisah
sebagai bukti bahwa anti-spoofing sendirian membuat seluruh keputusan, karena
keputusan akhir pada implementasi merupakan gabungan speaker verification,
anti-spoofing, behavior analysis, dan decision engine.

### 8.2 Face verification

Subset yang digunakan berisi **60 percobaan**: 30 genuine dan 30 impostor.
File log menyediakan tepat 30 record untuk masing-masing kondisi. Threshold
similarity yang digunakan adalah **0.45**.

| Kondisi | Jumlah | Verified/diterima | Ditolak | Hasil yang benar |
|---|---:|---:|---:|---:|
| Genuine | 30 | 30 | 0 | 30 |
| Impostor | 30 | 0 | 30 | 30 |

Ringkasan `similarity`:

| Kondisi | Minimum | Maksimum | Rata-rata |
|---|---:|---:|---:|
| Genuine | 0.6082 | 1.0000 | 0.7129 |
| Impostor | -0.1739 | 0.2141 | 0.0495 |

Pada sampel ini:

- Genuine acceptance rate adalah **30/30 = 100%**.
- Impostor rejection rate adalah **30/30 = 100%**.
- Seluruh genuine memiliki similarity di atas threshold `0.45`.
- Seluruh impostor memiliki similarity di bawah threshold `0.45`.

### 8.3 FAR, FRR, dan EER

Metrik dihitung dari 30 record terbaru pada setiap kondisi:

```text
FAR = impostor yang diterima / total data impostor
FRR = genuine yang tidak diterima / total data genuine
EER = titik ketika FAR dan FRR paling mendekati pada sweep threshold skor
```

Pada perhitungan FRR, status `REPEAT` dihitung sebagai **belum diterima**.
Hal ini lebih konservatif daripada hanya menghitung status `DENIED`, karena
pengguna genuine dengan status `REPEAT` masih belum memperoleh akses dan harus
mengulangi verifikasi.

#### Voice verification

Dengan keputusan yang tercatat pada log:

- FAR berdasarkan status `VERIFIED`: **0/30 = 0%**.
- FRR dengan `REPEAT` dihitung sebagai belum diterima: **5/30 = 16,7%**.
- Jika hanya status `DENIED` yang dihitung sebagai false rejection, nilainya
  **0/30 = 0%**, tetapi angka ini tidak merepresentasikan lima input yang
  masih harus diulang.
- EER berdasarkan sweep `speaker_score` genuine versus impostor adalah
  **3,33%**, pada threshold analisis sekitar **0,3547**, dengan FAR dan FRR
  masing-masing **3,33%**.

#### Face verification

Dengan threshold operasional similarity `0,45`:

- FAR: **0/30 = 0%**.
- FRR: **0/30 = 0%**.
- EER berdasarkan sweep `similarity` genuine versus impostor adalah **0%**
  pada threshold analisis sekitar **0,4112**.

EER merupakan threshold-analysis dari skor kontinu, sehingga threshold analisis
EER tidak otomatis menggantikan threshold operasional yang digunakan aplikasi.
EER voice dan face juga dihitung hanya dari pasangan genuine-versus-impostor.
Kinerja terhadap spoof dilaporkan terpisah sebagai bagian dari evaluasi
anti-spoofing.

### 8.4 Interpretasi dan batasan hasil

Angka di atas adalah hasil pada file log yang tersedia, bukan jaminan performa
untuk semua pengguna, perangkat, lingkungan, atau jenis serangan. Dataset ini
masih terbatas, terutama karena:

- voice subset menggunakan 30 record terbaru untuk setiap kondisi; profil
  enrollment pada log bervariasi;
- jumlah sampel tetap terbatas dan hasil voice memiliki genuine `REPEAT`;
- log yang tersedia tidak mencakup pengujian sistematis untuk semua kondisi
  noise, jarak microphone, perangkat, dan variasi pencahayaan;
- voice genuine yang berstatus `REPEAT` menunjukkan masih ada kemungkinan
  false rejection atau input yang belum cukup jelas;
- hasil face test hanya menunjukkan performa pada gambar yang tersedia;
- metrik latency, ROC, EER, FAR, dan FRR formal belum dapat disimpulkan hanya
  dari dua CSV ini.

Untuk materi presentasi, gunakan istilah **“hasil pada sampel pengujian”** dan
sertakan jumlah sampel agar tidak terdengar sebagai klaim performa universal.

## 9. Konfigurasi Environment

### Backend

Variabel penting:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
GOOGLE_API_KEY
ECOMMERCE_CRED_ENCRYPTION_KEY
```

### Frontend

Variabel penting:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SERVER_URL
NEXT_PUBLIC_LIVEKIT_URL
```

`NEXT_PUBLIC_SERVER_URL` harus dapat diakses dari browser. Nama service Docker
seperti `backend` biasanya tidak dapat di-resolve langsung oleh browser host;
gunakan URL yang sesuai dengan cara frontend diakses, misalnya
`http://localhost:8000` saat development lokal.

## 10. Batasan dan Status Integrasi Saat Ini

1. **Fallback wajah sudah terhubung pada alur agent.** Fallback dipicu setelah
   tiga kegagalan voice verification berturut-turut. Face verification tetap
   merupakan jalur fallback, bukan pengganti pemeriksaan suara pada percobaan
   awal.
2. **Pipeline replay bukan live inference.** `/pipeline` dapat menampilkan trace
   statis dari `public/pipeline-demo/traces.json`; gunakan mode live jika ingin
   menunjukkan hasil backend aktual.
3. **Face router sudah berada di FastAPI utama.** Dokumentasi lama yang menyebut
   service wajah pada port terpisah perlu dianggap tidak berlaku untuk kondisi
   implementasi sekarang.
4. **Endpoint wajah memiliki pola autentikasi yang belum seragam** dengan endpoint
   voice.
5. **Threshold dan metrik tidak boleh dianggap sebagai jaminan keamanan umum.**
   Interpretasi hanya berlaku untuk dataset dan prosedur pengujian yang digunakan.
6. **Data sensitif harus dibatasi.** Jangan menampilkan embedding mentah, token,
   password, kredensial e-commerce, atau data biometrik pengguna lain pada demo.

## 11. Ringkasan Alur End-to-End

```text
1. User signup/login melalui Supabase Auth
2. Frontend memperoleh access token
3. User melakukan voice enrollment
4. Profil suara disimpan di Supabase
5. User memulai sesi voice
6. Backend membuat LiveKit token dan dispatch agent
7. Frontend dan agent masuk ke room yang sama
8. User berbicara kepada Gemini realtime melalui LiveKit
9. Agent menjalankan shopping tools jika diperlukan
10. Sistem melakukan verifikasi suara untuk kebutuhan yang ditentukan
11. BiometricService menjalankan speaker verification, anti-spoofing,
    behavior analysis, dan decision engine
12. Gate agent menentukan apakah aksi sensitif boleh dijalankan
13. Product cards, review cards, pesan, dan status dikirim ke frontend
14. Sesi dan hasil percakapan disimpan di Supabase
15. User dapat melihat riwayat sesi dan dashboard analisis
```

## 12. Referensi Implementasi

- [README proyek](../README.md)
- [README backend](../backend/README.md)
- [README frontend](../frontend/README.md)
- [FastAPI server](../backend/voiceverification/server.py)
- [LiveKit Agent](../backend/agent/agent.py)
- [Agent tools](../backend/agent/tools.py)
- [Hook LiveKit](../frontend/hooks/useLiveKit.ts)
- [Halaman utama](../frontend/app/page.tsx)
- [Rencana visualisasi pipeline](./EXPO_VOICE_PIPELINE_PLAN.md)
