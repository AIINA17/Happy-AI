# Arsitektur Happy — Detail per Komponen, Proses, Input, dan Output

Dokumen ini menjelaskan **cara kerja Happy dari dalam**: setiap komponen, apa yang
masuk ke komponen itu, apa yang dilakukannya, ke mana hasilnya pergi, dan apa yang
disimpan. Tujuannya agar kamu bisa memahami sistem ini sampai bagian terkecil, bukan
sekadar melihat kotak-kotak diagram.

> Dokumen pendamping yang sudah ada: [`ARSITEKTUR_HAPPY_SAAT_INI.md`](./ARSITEKTUR_HAPPY_SAAT_INI.md)
> (gambaran umum + tabel hasil uji). Dokumen ini lebih dalam dan memuat hal-hal yang
> tidak ada di sana: angka tensor nyata, urutan pemanggilan fungsi, model eksekusi, dan
> daftar temuan (bug, risiko, inkonsistensi).

---

## 0. Baca ini dulu

### 0.1 Versi kode yang dijelaskan

| | |
|---|---|
| Branch | `dev` |
| Commit | `e09c00b` (3 November 2026) |
| Alasan memilih `dev` | `dev` memuat seluruh isi `main` ditambah 2 commit (wizard onboarding). `origin/pipeline` hanya leluhur dari `main`, bukan fitur baru. |

> **Perhatian:** checkout lokalmu (`dev1`) tertinggal sekitar 37 commit dari `dev`.
> Nama file dan nomor baris yang disebut di sini mengacu ke `e09c00b`, jadi sebagian
> tidak akan cocok dengan isi folder kerjamu sampai kamu pindah ke `dev`.

### 0.2 Cara dokumen ini dibuat (supaya kamu tahu seberapa jauh bisa dipercaya)

Setiap klaim diberi salah satu label:

| Label | Arti |
|---|---|
| **[KODE]** | Dibaca langsung dari source code, tanpa menjalankannya. |
| **[DIJALANKAN]** | Saya jalankan kodenya dan mencatat hasilnya. Angkanya nyata, bukan salinan dari komentar. |
| **[DUGAAN]** | Kesimpulan wajar, tapi tidak bisa dibuktikan dari repo. Akan dijelaskan kenapa. |

**Yang dibaca penuh, baris demi baris:** seluruh backend inti (`server.py`, `agent/`,
`core/`, `services/`, `models/`, `db/`, `face_recognition/`, `utils/` yang dipakai
runtime), SQL migrasi, Dockerfile, `docker-compose.yml`, dan jalur utama frontend
(`useLiveKit`, `LiveKitControls`, `ChatArea`, `Sidebar`, enrollment suara dan wajah,
liveness, onboarding, penautan akun toko, halaman login, signup, history).

**Yang hanya dibaca tujuan dan sumber datanya (bukan baris per baris):** komponen
visualisasi murni (`components/pipeline/*`, `pipeline-flow/*`, `agent-tools/*`,
`charts/*`), halaman `/dashboard`, `/embeddings`, `/pipeline`, `/agent-pipeline`,
skrip analisis offline (`analysis/*`, `plot_*`, `test_*`), dan `prompts.py` (dibaca
penuh, tapi bagian tabel terjemahan query produk hanya diringkas).

**Yang dijalankan [DIJALANKAN]:**
- 39 tes unit (`voiceverification/tests`), semuanya lulus, **jika dijalankan dari dalam folder `voiceverification/`** (lihat temuan T-14).
- Satu giliran verifikasi suara lengkap pada kode `dev`: preprocessing, ECAPA-TDNN, wav2vec2, cascade keputusan, dengan bentuk tensor dan waktu nyata (Lampiran A).
- Simulasi profil perilaku dan kebijakan update (temuan T-05, T-06).

**Yang TIDAK saya lakukan:** menjalankan browser, sesi LiveKit/Gemini hidup, `docker
compose build`, atau memeriksa kebijakan RLS di Supabase (skemanya tidak ada di repo).
Perilaku yang bergantung pada hal-hal itu saya tandai **[DUGAAN]** atau **[KODE]**.

### 0.3 Singkatan dan istilah dasar

| Istilah | Arti singkat |
|---|---|
| **Embedding** | Deretan angka (vektor) yang mewakili sebuah suara/wajah. Suara → 192 angka, wajah → 512 angka. Dua sampel dari orang yang sama menghasilkan vektor yang "searah". |
| **Cosine similarity** | Ukuran seberapa searah dua vektor (−1 sampai 1). Karena vektor sudah dinormalisasi panjangnya 1, ia sama dengan *dot product*. |
| **ECAPA-TDNN** | Model jaringan saraf pengubah suara → embedding speaker. |
| **wav2vec2** | Model transformer yang dipakai di sini sebagai pendeteksi suara palsu/rekaman (anti-spoof). |
| **VAD** | Voice Activity Detection: deteksi kapan orang mulai dan berhenti bicara. |
| **SFU** | Server perantara audio/video WebRTC (di sini: LiveKit Cloud). |
| **Dispatch** | Perintah agar sebuah agent worker masuk ke sebuah room LiveKit. |
| **Room** | "Ruang" LiveKit tempat browser dan agent bertemu. Di Happy: satu room per pengguna, bernama `user-{uuid}`. |

---

## 1. Gambaran besar

```text
┌───────────────────────────── BROWSER (Next.js, port 3000) ─────────────────────────────┐
│ Supabase JS (login) · livekit-client (audio + data) · MediaRecorder · MediaPipe (WASM)  │
└──────┬─────────────────────────┬───────────────────────────────┬────────────────────────┘
       │ email+password          │ WebRTC audio, data packet     │ HTTPS + header
       │ → JWT                   │                               │ Authorization: Bearer <JWT>
       ▼                         ▼                               ▼
┌──────────────┐        ┌─────────────────┐        ┌───────────────────────────────────────────┐
│ Supabase     │        │ LiveKit Cloud   │◄───────┤ FastAPI backend (container :8000,         │
│  · Auth      │        │ (SFU / room     │ admin  │ di host :8001)                            │
│  · Postgres  │        │  user-{uuid})   │ API:   │  · suara: ECAPA-TDNN, wav2vec2, behavior, │
│  · Storage   │        └───────┬─────────┘ send_  │    decision engine                       │
│  · Realtime  │                │ audio+  data,   │  · wajah: InsightFace buffalo_l (/face/*) │
└──────▲───────┘                │ data    dispatch│  · sesi, log, enrollment, akun toko       │
       │ service-role key       │                 └───────────────────────────────────────────┘
       │ (backend & agent)      ▼
       │               ┌─────────────────────────────────────────────────────┐
       └───────────────┤ Agent worker  (python -m agent.agent start)         │
                       │  · Gemini Live API (satu model: STT + LLM + TTS)    │
                       │  · 20 tool function: belanja, cuaca, web search ... │
                       └──────────┬───────────────────────┬──────────────────┘
                                  │ REST                  │ REST
                                  ▼                       ▼
                        Toko Oren / Toko Hijau     wttr.in · DuckDuckGo
                        (e-commerce dummy, Vercel)
```

### 1.1 Tiga hal yang paling penting dipahami

1. **Ada dua jalur suara yang berbeda dan tidak boleh dicampur.**
   - **Jalur percakapan:** suara → LiveKit → agent → Gemini → suara balasan. Gemini yang
     mendengar, berpikir, dan berbicara. Tidak ada STT/TTS terpisah.
   - **Jalur verifikasi biometrik:** browser merekam potongan suara sendiri → mengunggahnya
     ke backend via HTTP → backend memutuskan siapa pembicaranya. Ini tidak melewati
     LiveKit maupun Gemini.
   Keduanya baru bertemu di agent, lewat satu pesan hasil yang dikirim backend ke room.

2. **Agent tidak percaya pada browser untuk urusan identitas.** Hasil verifikasi
   (`VERIFIED/REPEAT/DENIED`) dikirim oleh **backend langsung ke room lewat admin API
   LiveKit**, bukan dilaporkan oleh browser. Agent hanya menerima paket yang
   `participant is None` (artinya dikirim dari server). Lihat bagian 4.3.

3. **Gerbang keamanan ada di agent, bukan di LLM.** Fungsi `require_voice_verification`
   dipanggil di dalam tool sensitif (bagian 5.9). Gemini tidak bisa "memutuskan sendiri"
   untuk melewatinya, karena pengecekannya terjadi di kode Python, bukan di prompt.

---

## 2. Inventaris komponen

| # | Komponen | Berjalan sebagai | Kode | Port | Bicara dengan |
|---|---|---|---|---|---|
| 1 | **Frontend** | Next.js 16 (App Router), React 19, build `standalone` | `frontend/` | 3000 | Supabase Auth, backend (HTTP), LiveKit Cloud, Nominatim, CDN MediaPipe |
| 2 | **Backend FastAPI** | `uvicorn voiceverification.server:app` | `backend/voiceverification/` + `backend/face_recognition/` | 8000 di dalam container, **8001 di host** | Supabase, LiveKit admin API, toko dummy (hanya saat menautkan akun) |
| 3 | **Router wajah** | Bukan proses sendiri. `APIRouter` prefix `/face`, di-mount ke aplikasi #2 | `backend/face_recognition/main.py` | (ikut #2) | Supabase, LiveKit admin API |
| 4 | **Agent worker** | `python -m agent.agent start` (CLI `livekit-agents`) | `backend/agent/` | 8081 (health, bawaan worker) | LiveKit Cloud, Gemini Live API, Supabase, toko dummy, wttr.in, DuckDuckGo |
| 5 | **LiveKit Cloud** | Layanan eksternal (SFU) | — | — | Browser, agent, backend |
| 6 | **Supabase** | Layanan eksternal | — | — | Frontend (auth + beberapa query langsung), backend, agent |
| 7 | **Gemini Live API** | Layanan eksternal | — | — | Agent |
| 8 | **Toko dummy** | Layanan eksternal, `dummy-ecommerce-tau.vercel.app` (oren), `ecommerce-hijau.vercel.app` (hijau) | didaftarkan di `backend/ecommerce_sources.py` | — | Agent, backend |

**Model yang dimuat ke memori saat proses backend start** (semua dimuat sekaligus, jadi
cold-start berat):

| Model | Dimuat oleh | Perangkat |
|---|---|---|
| ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`) | `BiometricService.__init__` (event startup FastAPI) | CUDA jika ada, kalau tidak CPU |
| wav2vec2 anti-spoof (`MelodyMachine/Deepfake-audio-detection-V2`) | `warm_up()` di `BiometricService.__init__` | **Selalu CPU** [KODE]: `pipeline(...)` dibuat tanpa argumen `device` |
| InsightFace `buffalo_l` | `face_recognition/main.py` membuat `ArcFaceModel()` **saat modul di-import** | CUDA jika `CUDAExecutionProvider` tersedia, kalau tidak CPU |

Di sisi browser, MediaPipe (`FaceLandmarker` untuk liveness, `FaceDetector` untuk
enrollment wajah) dimuat dari CDN (`cdn.jsdelivr.net` untuk WASM, `storage.googleapis.com`
untuk file model `.task`/`.tflite`). Jadi fitur wajah di browser **butuh internet**.

---

## 3. Konfigurasi, build, dan cara menjalankan

### 3.1 Variabel lingkungan

**`backend/.env`** (dipakai backend DAN agent, keduanya `env_file` yang sama):

| Variabel | Dipakai oleh | Fungsi |
|---|---|---|
| `SUPABASE_URL` | backend, agent | Alamat project Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | backend, agent | Kunci service-role: **melewati RLS**. Dipakai untuk semua akses DB/Storage dan juga untuk memverifikasi JWT pengguna |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | backend (token + admin API), agent (mendaftar sebagai worker) | Koneksi LiveKit Cloud |
| `GOOGLE_API_KEY` | agent | Kunci Gemini (model realtime dan model penamaan sesi) |
| `ECOMMERCE_CRED_ENCRYPTION_KEY` | backend, agent | Kunci Fernet untuk mengenkripsi password toko. Hilang/berubah = semua kredensial tersimpan tidak bisa didekripsi |
| `VOICE_DEBUG_CAPTURE_DIR`, `VOICE_DEBUG_CAPTURE_LIMIT` (default 20) | backend | **Opsional, diagnostik.** Kalau diisi, `/verify-voice` menyimpan webm mentah, wav hasil proses, dan metadata keputusan (maksimal N berkas) |
| `LATENCY_NETWORK_ESTIMATE_SEC` (default 0.5) | agent | Konstanta untuk log estimasi waktu yang dirasakan user |

**`frontend/.env`** (semua `NEXT_PUBLIC_*` **ditanam ke bundle saat build**, bukan dibaca saat jalan):

| Variabel | Fungsi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Klien Supabase di browser (login + beberapa query langsung) |
| `NEXT_PUBLIC_SERVER_URL` | Alamat backend **yang bisa dijangkau browser**. Nama service Docker seperti `backend` tidak akan bisa di-resolve oleh browser |
| `NEXT_PUBLIC_LIVEKIT_URL` | Alamat WebSocket LiveKit Cloud |

> Karena ditanam saat build, **mengubah `frontend/.env` tidak berpengaruh sebelum
> image frontend di-build ulang.** `docker-compose.yml` meneruskannya sebagai
> `build.args`.

### 3.2 Docker

**`docker-compose.yml`** mendefinisikan 3 service:

| Service | Build | Port host → container | Healthcheck | GPU |
|---|---|---|---|---|
| `backend` | `./backend`, `Dockerfile` | **8001 → 8000** | `GET http://localhost:8000/health` tiap 30 s, `start_period` 60 s | reservasi NVIDIA, semua GPU |
| `agent` | `./backend`, `Dockerfile.agent` | (tidak dibuka) | `GET http://localhost:8081/` (server health bawaan worker, port produksi default 8081) | reservasi NVIDIA |
| `frontend` | `./frontend`, `Dockerfile` | 3000 → 3000 | tidak ada | tidak |

`agent` dan `frontend` bergantung (`depends_on`) pada `backend`, tapi `depends_on` hanya
mengatur urutan start, bukan menunggu backend siap.

**Image backend** (`backend/Dockerfile`), langkah demi langkah:

1. Basis `pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime`.
2. `apt install`: `build-essential`, `gcc`, **`ffmpeg`** (wajib: konversi webm→wav), `libsndfile1`, `portaudio19-dev`.
3. `pip install -r requirements.lock.txt` (versi persis, 735 baris).
4. `pip install --no-deps --force-reinstall onnxruntime-gpu==1.23.2`. **Alasan** (tertulis di
   komentar): `insightface` hanya meminta `onnxruntime` generik, sehingga pip bisa mendaratkan
   build CPU terakhir dan menimpa build GPU, membuat `CUDAExecutionProvider` diam-diam mati.
5. `COPY . .`
6. **Model di-"bake" ke image**: `SpeakerVerifier(device='cpu')` dan `warm_up()` dijalankan saat
   build agar model sudah terunduh. Hasilnya: cold-start tidak bergantung pada Hugging Face.
7. `CMD uvicorn voiceverification.server:app --host 0.0.0.0 --port 8000`.

**Image agent** sama, tanpa langkah 4 dan 6, `CMD python -m agent.agent start`. Model **tidak**
di-bake di image agent (agent tidak memuat ECAPA/wav2vec2).

**Image frontend:** tiga tahap `node:20-alpine` (`deps` → `builder` → `runner`). Variabel
`NEXT_PUBLIC_*` masuk lewat `ARG`/`ENV` saat `npm run build`. Output `standalone`, dijalankan
dengan `node server.js`.

### 3.3 Dependensi dengan alasan khusus (dari komentar `requirements.txt`)

| Paket | Pin | Kenapa dipatok |
|---|---|---|
| `transformers` | `==4.30.2` | Harus di bawah 4.31: rilis lebih baru butuh `huggingface_hub` mayor yang membuang argumen `use_auth_token`, padahal `speechbrain 0.5.16` masih memakainya. Upgrade sepihak diam-diam merusak speaker verification |
| `huggingface_hub` | `==0.16.4` | Pasangan dari di atas |
| `speechbrain` | `==0.5.16` | Versi yang dipakai model ECAPA |
| `torchcodec` | (bebas) | `torchaudio` versi baru butuh ini untuk memuat audio sama sekali. Tanpanya `extract_embedding()` gagal |
| `onnxruntime-gpu` | `==1.23.2` | Lihat langkah 4 Dockerfile |

### 3.4 Menjalankan secara lokal (dari `backend/README.md`, diperiksa terhadap kode)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt            # atau requirements.lock.txt
uvicorn voiceverification.server:app --port 8000 --reload   # proses 1
python -m agent.agent start                                  # proses 2, terminal lain
cd ../frontend && npm install && npm run dev                 # proses 3
```

Dua proses Python **harus dijalankan dari `backend/`** (bukan dari dalam
`voiceverification/`), karena import-nya memakai path penuh (`voiceverification.xxx`,
`agent.xxx`, `face_recognition.xxx`). Pengecualian: tes unit (temuan T-14).

---

## 4. Identitas, autentikasi, dan kepercayaan

### 4.1 Siapa yang bisa melakukan apa

```text
        Browser ──(email+password)──► Supabase Auth ──► access_token (JWT)
           │
           │  Authorization: Bearer <JWT>        (setiap panggilan ke backend)
           ▼
        Backend:  get_user_id_from_request(request)
                   1. header harus berawalan "Bearer "      → kalau tidak: 401 "Missing Authorization header"
                   2. supabase.auth.get_user(token)          → panggilan jaringan ke Supabase Auth
                   3. user.id (UUID)                         → inilah "user_id" untuk semua query
                   4. exception APA PUN                      → 401 "Token verification failed"
```

Hal-hal kecil yang perlu diketahui [KODE]:

- Verifikasi JWT memakai **klien service-role** (`db/connection.py`), tidak ada klien anon terpisah.
- Pesan `"Invalid token"` di `auth_utils.py` **tidak pernah sampai ke klien**: `HTTPException`
  itu dilempar di dalam blok `try` yang ditangkap `except Exception`, sehingga yang terkirim
  selalu `"Token verification failed"`.
- Fungsi ini **sinkron**, dan dipanggil langsung di dalam handler `async`. Artinya setiap request
  menahan event loop backend selama round-trip ke Supabase Auth (lihat bagian 13).
- Tidak ada cache JWT: setiap request = satu panggilan ke Supabase.

### 4.2 Token LiveKit

Backend (`/join-token`) membuat `AccessToken` dengan `identity = user_id` dan izin hanya untuk
room `user-{user_id}` (`room_join`, `can_publish`, `can_subscribe`). Browser tidak punya izin
admin. Jadi pengguna hanya bisa masuk ke room miliknya sendiri.

### 4.3 Hasil verifikasi tidak dipercaya dari browser

Masalahnya: jika browser yang melapor "saya VERIFIED", siapa pun yang membuka devtools bisa
memalsukannya (`localParticipant.publishData(...)`).

Solusinya, di dua sisi:

| Sisi | Apa yang dilakukan | File |
|---|---|---|
| Backend | Setelah memutuskan, memanggil **admin API LiveKit** `room.send_data(...)` ke room `user-{id}` dengan topic `VOICE_RESULT` atau `FACE_RESULT` | `utils/room_notify.py` |
| Agent | Di handler `data_received`, **menolak paket yang punya `participant`** (`packet.participant is not None`). Paket dari admin API tidak punya participant | `agent/agent.py`, `on_data` |

Dengan begini, hanya kode yang memegang `LIVEKIT_API_SECRET` (backend) yang bisa
menghasilkan paket yang diterima agent. Browser, yang dikendalikan pengguna, tidak bisa.

Penegasan: payload `VOICE_RESULT`/`FACE_RESULT` tidak punya field `type`, sehingga handler data
di browser (`handleAgentDataRef`, yang membaca field `type`) **mengabaikannya**. Browser tidak
perlu tahu isinya.

### 4.4 Peta autentikasi setiap endpoint [KODE]

| Kelompok | Endpoint | Autentikasi |
|---|---|---|
| Wajib JWT | `/join-token`, `/verify-voice`, `/verify-voice/explain`, `/enroll-voice`, `/enrollments` (GET, DELETE), `/speakers/{id}/label`, `/logs/sessions` (+`/{id}`), `/conversation-sessions/{id}` (PATCH, DELETE), `/embeddings/visualize`, `/embeddings/project`, `/spectrograms`, `/verification-metrics`, `/ecommerce-account` (POST, GET, DELETE) | `get_user_id_from_request` |
| Wajib JWT | `/face/enroll-face`, `/face/liveness-challenge`, `/face/verify-face`, `/face/verify-face/explain`, `/face/verification-metrics` | `get_user_id_from_request` |
| JWT **+ pencocokan id** | `GET`/`DELETE /face/enroll-face/{user_id}` | JWT, lalu `user_id` di URL harus sama dengan id di token, kalau tidak 403 |
| **Tanpa autentikasi** | `/health`, `/face/health` | publik |
| **Tanpa autentikasi** | `GET /face/enrolled-users`, `GET /face/verification-logs`, **`DELETE /face/verification-logs`** | publik (lihat temuan T-01) |

Kepemilikan data diperiksa di tiap endpoint tulis/hapus dengan `.eq("user_id", user_id)`.

### 4.5 Rahasia dan enkripsi

| Rahasia | Di mana disimpan | Perlindungan |
|---|---|---|
| Password akun toko | `ecommerce_accounts.encrypted_password` | Enkripsi simetris **Fernet** (`utils/crypto.py`). Dekripsi hanya di proses backend/agent, saat login ke toko |
| Token login toko | Memori proses agent (`auth_state["accounts"][source]`) | Tidak disimpan ke DB, hilang saat job agent selesai |
| `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` | Melewati RLS. Siapa pun yang memegangnya punya akses penuh ke database |
| Embedding suara/wajah | Kolom di Postgres (wajah: `jsonb` per `002_face_profiles.sql`; tipe kolom suara tidak ada di repo) | **Tidak terenkripsi**, hanya dilindungi akses DB. Embedding tidak bisa dibalik jadi audio/wajah, tapi tetap data biometrik |

Password toko **sengaja diketik di formulir HTTP, bukan diucapkan** ke agent, karena ucapan
masuk ke `conversation_logs` dalam teks biasa. (Komentar di `server.py`.)

### 4.6 CORS

`allow_origins=["*"]` dengan `allow_credentials=True`. Karena autentikasi memakai header
`Authorization` (bukan cookie), ini tidak membuat sesi bisa dibajak lewat situs lain, tapi
berarti **semua asal** boleh memanggil API selama punya JWT. Komentar kode sendiri bertuliskan
"restrict in production".

---

## 5. Alur end-to-end, langkah demi langkah

Format tiap alur: **Pemicu → langkah bernomor (siapa, input, proses, output) → apa yang disimpan.**

### 5.1 Daftar dan masuk

| Langkah | Siapa | Terjadi apa |
|---|---|---|
| 1 | `app/login/page.tsx` | Saat dibuka, `supabase.auth.getSession()`. Kalau sudah ada sesi → `router.replace("/")`. |
| 2 | `AuthCard` | Pengguna mengisi email+password. Login: `supabase.auth.signInWithPassword`. Daftar: `supabase.auth.signUp`. |
| 3 | Supabase Auth | Mengembalikan sesi berisi `access_token` (JWT) + `refresh_token`. `supabase-js` menyimpannya di browser. |
| 4 | Halaman | Sukses → `router.replace("/")`. Daftar tanpa sesi (butuh konfirmasi email) → dialog "Cek email kamu untuk verifikasi". |

Setiap halaman terproteksi (`/`, `/history/[id]`, `/analysis`, `/dashboard`, `/embeddings`)
melakukan sendiri: `getSession()` + `onAuthStateChange`, dan `router.replace("/login")` kalau tidak
ada sesi. **Tidak ada `middleware.ts`**, jadi proteksi rute murni di sisi klien [KODE]. Itu cukup
untuk UX, tapi bukan batas keamanan; batas keamanannya adalah JWT yang diperiksa backend.

`access_token` dipegang di state React (`session?.access_token`) dan diturunkan sebagai prop
`token` ke `Sidebar`, `ChatArea`, `VoiceEnrollment`, dsb.

Catatan: halaman `/signup` **membuang error** dari `signUp` tanpa menampilkan apa pun
(`// Error feedback is handled via the login page flow`, tapi halaman itu tidak memberi umpan
balik apa pun). Halaman `/login` menampilkan dialog error.

### 5.2 Onboarding

`Sidebar` membuka `OnboardingTour` otomatis **sekali per pengguna per browser**, ditandai di
`localStorage` dengan kunci `happy_onboarding_done_{userId}`. Bisa dibuka lagi dari menu "Panduan Awal".

Wizard 5 langkah: sambutan → daftarkan suara → daftarkan wajah → hubungkan akun toko → selesai.
Selama wizard terbuka, ia **polling tiap 2,5 detik** ke tiga endpoint untuk membalik lencana "selesai":

| Cek | Endpoint | Dianggap selesai jika |
|---|---|---|
| Suara | `GET /enrollments` | jumlah enrollment > 0 |
| Wajah | `GET /face/enroll-face/{userId}` | `enrolled: true` |
| Toko | `GET /ecommerce-account` | minimal satu source `linked` |

### 5.3 Enrollment suara

**Pemicu:** tombol "Enroll Voice" (`VoiceEnrollment.tsx`). **Batas:** 3 profil per pengguna, dijaga
di UI (`MAX_ENROLLMENTS = 3`) dan di backend (`count_enrollments >= 3` → HTTP 400).

**Di browser**

1. `getUserMedia({audio: true})`, tanpa batasan khusus (**pemrosesan bawaan browser aktif**: echo cancellation, noise suppression, auto gain di Chrome).
2. `MediaRecorder` dengan `audio/webm;codecs=opus`.
3. Hitung mundur 10 detik (`RECORDING_DURATION = 10`) lalu berhenti otomatis; pengguna juga bisa menekan stop lebih awal. Kalimat yang ditampilkan untuk dibaca berputar dari 3 teks.
4. Setelah berhenti, **belum diunggah**. Muncul dialog nama; blob ditahan di memori (`pendingBlob`).
5. Pengguna mengisi nama → `POST /enroll-voice` (multipart: `audio` = webm, `label` = nama).

**Di backend** (`/enroll-voice`, `server.py`)

| # | Proses | Input → Output |
|---|---|---|
| 1 | `get_user_id_from_request` | JWT → `user_id` |
| 2 | `count_enrollments(user_id) >= 3`? | → 400 jika penuh |
| 3 | `save_audio` | webm upload → file sementara `tmp_audio/<uuid>.webm` → `ffmpeg -ar 16000 -ac 1 -f wav` → `tmp_audio/<uuid>.wav`; webm dihapus |
| 4 | `normalize_audio` | wav → muat 16 kHz mono → hitung RMS → **kalikan gain `0.1/RMS`** → clip ke ±1 → tulis ulang wav |
| 5 | `extract_embedding` (di thread) | wav → ECAPA-TDNN → **vektor 192 angka, dinormalisasi panjang 1** |
| 6 | Cek label duplikat | query `speaker_profiles` per (user, label) → 400 jika ada |
| 7 | `save_embedding` | insert baris `speaker_profiles` `{user_id, embedding, label}` → mengembalikan `id` baris |
| 8 | Render spektrogram | wav → STFT (`n_fft=1024`, `hop=512`) → dB → PNG → upload ke **Supabase Storage** bucket `spectrograms`, path `{user_id}/{profile_id}.png` (bucket dibuat otomatis jika belum ada, privat). **Kegagalan di langkah ini tidak menggagalkan enrollment.** |
| 9 | Profil perilaku | jika belum ada untuk (user, label): `pitch = rata-rata YIN (50-300 Hz)`, `rate = durasi klip (detik)` → `BehaviorProfile(n_samples=1, var=0)` → upsert `behavior_profiles` |
| 10 | `finally` | hapus file wav sementara |

**Yang tersimpan:** embedding (192 angka), label, spektrogram PNG, profil perilaku awal.
**Yang TIDAK tersimpan:** audio asli. Setelah enrollment, rekaman suaramu hilang; sistem
hanya punya vektor dan gambar spektrogram.

> Catatan tentang "rate": di seluruh kode, "speaking rate" adalah **durasi klip dalam detik**
> (`len(y) / sr`), bukan kecepatan bicara (kata/detik). Nama field di jejak pipeline,
> `rate_proxy_sec`, mengakui hal ini. Konsekuensinya dibahas di bagian 6.6 dan temuan T-05.

### 5.4 Enrollment wajah

**Pemicu:** `FaceEnrollment.tsx`. **Batas:** 1 wajah per pengguna (`face_profiles.user_id` adalah primary key, enrollment ulang menimpa).

**Di browser**

1. Muat `FaceDetector` MediaPipe (`blaze_face_short_range`, delegate GPU) dari CDN.
2. Kamera: `getUserMedia({video: {640x480 ideal, facingMode: "user"}, audio: false})`.
3. Loop `requestAnimationFrame` memanggil `detectForVideo`. Jika ada wajah, kotak deteksi digambar dan **pengatur waktu stabilitas** berjalan.
4. Setelah wajah terdeteksi **stabil selama 1,5 detik** (`STABILITY_DURATION_MS = 1500`), frame digambar ke canvas dan dikonversi ke JPEG kualitas 0,92.
5. `POST /face/enroll-face` (multipart `image`, header JWT).

Catatan: loop klien hanya memakai `detections[0]`. Kalau ada lebih dari satu wajah, klien **tidak
memblokir**; yang menolak adalah server.

**Di backend** (`face_recognition/main.py` → `arcface_model.py`)

| # | Proses | Output |
|---|---|---|
| 1 | JWT → `user_id` | — |
| 2 | `cv2.imdecode` byte gambar | array BGR; jika gagal → `ValueError` → HTTP 400 |
| 3 | `FaceAnalysis("buffalo_l").get(image)` | daftar wajah. **0 wajah → 400** ("Tidak ada wajah terdeteksi"), **>1 wajah → 400** ("Terdeteksi lebih dari satu wajah") |
| 4 | `faces[0].embedding` | vektor float32 **512 angka** (model ArcFace `w600k_r50`) |
| 5 | Normalisasi L2 | panjang 1 |
| 6 | `face_repo.save_embedding` | upsert `face_profiles {user_id, embedding, updated_at}` |

Respons: `{"status": "ENROLLMENT_SUCCESS", "embedding_dim": 512, ...}`.

### 5.5 Menautkan akun toko

**Pemicu:** `EcommerceAccountLink.tsx` (dialog dari menu akun atau langkah 3 onboarding).
Toko yang tersedia didaftarkan di **satu tempat**: `backend/ecommerce_sources.py`
(`oren` = "Toko Oren", `hijau` = "Toko Hijau"). Daftar yang sama **disalin manual** di frontend
(`STORES` di `EcommerceAccountLink.tsx`; komentarnya: "keep in sync").

| Langkah | Siapa | Proses |
|---|---|---|
| 1 | Browser | Pilih toko, isi username+password (tersedia tombol akun demo yang sudah di-seed di tiap toko), `POST /ecommerce-account {username, password, source}` |
| 2 | Backend | `source` harus ada di registri, kalau tidak 400 |
| 3 | Backend → toko | `POST {base_url}/api/auth/register`. Status 200/201 = akun baru berhasil dibuat |
| 4 | Backend → toko | Jika register gagal (mis. akun sudah ada) → `POST {base_url}/api/auth/token` untuk **memvalidasi** kredensial. Gagal → 400 "kredensial tidak valid" |
| 5 | Backend | Jaringan ke toko gagal → 502 |
| 6 | Backend | `save_ecommerce_account` → upsert `ecommerce_accounts` pada `(user_id, source)` dengan **password terenkripsi Fernet** |

`GET /ecommerce-account` mengembalikan per toko `{label, linked, username}` (tanpa password).
`DELETE /ecommerce-account?source=...` memutus satu toko.

### 5.6 Memulai sesi suara

**Pemicu:** pengguna menekan tombol mic besar (`LiveKitControls` → `handleClick` → `toggleRoom` → `joinRoom`).

```text
 Browser                      Backend                       LiveKit Cloud              Agent worker
    │                            │                               │                          │
 1  │ GPS → Nominatim → "Kota"   │                               │                          │
 2  │── POST /join-token ───────►│                               │                          │
    │   {user_city}              │ 3 JWT → user_id               │                          │
    │                            │ 4 buat AccessToken            │                          │
    │                            │── list_participants ─────────►│                          │
    │                            │◄─ ada agent aktif? ───────────│                          │
    │                            │ 5 jaga duplikasi (15 dtk)     │                          │
    │                            │── hapus dispatch lama ───────►│                          │
    │                            │── create_dispatch ───────────►│                          │
    │                            │   agent_name, metadata        │── job ke worker ────────►│
    │◄── {token, room} ──────────│                               │                          │ 6 connect(ctx)
 7  │── room.connect ───────────────────────────────────────────►│◄── agent join ───────────│
 8  │── publish mic track ──────────────────────────────────────►│── audio ────────────────►│
    │◄──────────────── audio balasan + data packet ──────────────│◄─────────────────────────│
```

**Langkah rinci**

1. **Lokasi** (`useUserLocation`, aktif saat `LiveKitControls` ter-mount): `navigator.geolocation.getCurrentPosition` (timeout 10 s, `maximumAge: 0`) → reverse geocode ke **Nominatim OpenStreetMap** (`accept-language=id`) → ambil `address.city || town || village || county || state`. Kota hanya disimpan di state React (cache lama di `localStorage` dihapus). Jika ditolak/gagal, kota `null`.
2. **`POST /join-token`** dengan body `{"user_city": ...}` dan header JWT.
3. **Backend:** `room_name = f"user-{user_id}"`.
4. **Token LiveKit** dibuat (lihat 4.2).
5. **Pencegahan agent ganda**, dua lapis di backend (dibuat karena dulu satu klik bisa memunculkan dua agent berbicara bersamaan):
   - *Lapis 1 (kebenaran dasar):* tanya LiveKit `list_participants` untuk room; jika ada peserta berjenis `AGENT` yang belum `DISCONNECTED` → jangan dispatch.
   - *Lapis 2 (celah start-up):* penanda in-memory `_recent_dispatches[room]` selama 15 detik (`DISPATCH_GRACE_SEC`), dicek-dan-diset atomik dengan `asyncio.Lock`, untuk kasus dua panggilan hampir bersamaan sebelum agent sempat masuk. Penanda ini **hanya hidup di satu proses backend** (aman karena hanya ada satu instance; kalau di-scale, harus dipindah ke Redis/Supabase).
6. Jika harus dispatch: `list_dispatch(room)` → **hapus** semua dispatch dengan `agent_name == "happy-shopping-assistant"` (dispatch zombie dari sesi sebelumnya bisa membuat agent baru tidak pernah masuk) → `create_dispatch(room, agent_name, metadata={"user_city": ...})`.
7. **Respons** `{status, token, room}`.
8. **Browser** membuat `Room({adaptiveStream: true, dynacast: true})`, memasang handler event, `room.connect(LIVEKIT_URL, token)`, lalu `createLocalAudioTrack()` dan `publishTrack`. Track mic disimpan di `micTrackRef` (dipakai lagi untuk verifikasi, lihat 5.8).
9. **LiveKit** meneruskan job ke worker agent yang terdaftar dengan nama sama. Mode eksekusi default adalah **satu proses OS per job** [KODE: `JobExecutorType.PROCESS` di non-Windows].
10. **Agent** menjalankan `connect(ctx)`:
    - room harus berawalan `user-`, kalau tidak langsung return;
    - `_active_rooms` (set per proses) mencegah dua agent di room yang sama dalam satu proses;
    - membaca `user_city` dari `ctx.job.metadata`;
    - membuat `room_state` (status verifikasi, penghitung percobaan, lock) dan mengaitkannya ke `auth_state["agent_state"]`;
    - membuat `AgentSession` dengan model realtime Gemini (bagian 5.7);
    - `session.start(...)` dengan **noise cancellation BVC** pada audio masuk dan audio keluar **24 kHz**;
    - `scan_user_audio()` (pelacak akhir ucapan untuk log latensi);
    - `user_id` diturunkan dari **nama room**, bukan dari daftar peserta (peserta mungkin belum selesai masuk; versi lama menyetel `None` dan menabrak constraint NOT NULL di Supabase);
    - **greeting**: `generate_reply(SESSION_INSTRUCTION)`; model diinstruksikan membuka dengan "Hi! Gue Happy, teman terbaik lo. Lagi butuh apa nih?" (ia boleh memparafrasekan, ini instruksi, bukan teks yang diputar apa adanya);
    - `start_verification()` (bagian 5.8);
    - `await disconnected_event.wait()`: job hidup selama room hidup.
11. **UI:** `CONNECTING` → (event `Connected`) `CHATTING`.

### 5.7 Satu giliran percakapan (jalur Gemini)

**Konfigurasi model** (`agent/agent.py`, `AgentSession`):

| Parameter | Nilai | Arti |
|---|---|---|
| `model` | `models/gemini-2.5-flash-native-audio-latest` | Model **speech-to-speech**: satu model mendengar, berpikir, dan bicara. **Tidak ada STT dan TTS terpisah** |
| `voice` | `Kore` | Suara bawaan Gemini |
| `language` | `id-ID` | Petunjuk bahasa untuk transkripsi bawaan Gemini. Ditambahkan karena ucapan Indonesia sering ditranskripsi ke bunyi Inggris terdekat |
| `silence_duration_ms` | `VAD_SILENCE_MS = 350` | Berapa lama Gemini menunggu hening sebelum menganggap giliran bicara selesai. Sudah diturunkan dari default ±800 → 500 → 350. Naikkan lagi bila agent mulai memotong saat pengguna jeda berpikir |
| `context_window_compression` | `SlidingWindow()` | Gemini membuang/meringkas giliran lama agar tidak kena `GoAway` (paksa reconnect) saat konteks penuh |
| `min_interruption_duration` / `min_interruption_words` | `1.2` / `2` | Maksud komentarnya: kurangi interupsi palsu oleh batuk/"mhm". **[DUGAAN]** pengaruhnya untuk model realtime belum terbukti: plugin Gemini memicu interupsi sendiri lewat event `interrupted` dari server, dan `AgentSession` mengabaikan pengaturan endpointing-nya untuk model realtime |
| Audio masuk | BVC noise cancellation | `livekit-plugins-noise-cancellation` pada audio dari pengguna sebelum ke Gemini |
| Audio keluar | `SAMPLE_RATE = 24000` | Sesuai keluaran asli Gemini (dulu 16000, membuat suara seperti telepon) |

**Urutan kejadian dalam satu giliran:**

```text
 1  Pengguna bicara                  mic browser (AEC/NS/AGC bawaan aktif) → track publish ke LiveKit (opus)
 2  LiveKit → agent                  agent menerima track audio pengguna
 3  Agent → Gemini                   audio melewati BVC → 16 kHz → websocket Gemini Live (mengalir terus, termasuk hening)
 3b (paralel, hanya untuk log)       tap kedua: rtc.AudioStream mentah tanpa BVC → UserSpeechTracker (ambang -45 dBFS)
 4  Gemini: VAD server               hening 350 ms → "giliran selesai" → mulai menghasilkan
 5  Gemini → agent                   potongan audio 24 kHz + transkrip (kata pengguna & jawaban) + (jika perlu) panggilan tool
 6  Agent → LiveKit                  frame audio balasan; saat frame pertama keluar, status agent = "speaking"
 7  LiveKit → browser                track audio agent; browser menempelkan <audio> ke <body> dan memutarnya
```

**Pesan teks yang sampai ke layar** berasal dari event `conversation_item_added` (satu per
ucapan pengguna atau jawaban agent). `handle_conversation` melakukan, **berurutan di bawah
`conversation_lock`** (agar urutan tidak tertukar saat insert DB berjalan di thread):

1. `ensure_conversation_session()`: membuat baris `conversation_sessions` sekali per room (`label = "New session"`).
2. Menambah ke `room_state["transcript"]` (maksimal 20 giliran, hanya untuk pelabelan otomatis).
3. Simpan ke `conversation_logs` `{session_id, role, content}` (di thread).
4. `publish_data(topic="chat")` dengan JSON `{"type": "USER_MESSAGE" | "AGENT_MESSAGE", "text", "ts"}`.
5. Khusus **giliran pengguna**: giliran pertama memicu pelabelan sesi di background; lalu cek verifikasi suara (5.8).
6. Khusus **giliran agent**: `trim_chat_ctx_if_needed` memangkas riwayat plugin ke 120 item (plugin menyimpan riwayat yang tidak pernah menyusut dan memutarnya ulang penuh setiap reconnect; di percakapan panjang itu bisa memakan menit).

Di browser, `handleAgentDataRef` membaca JSON dan memanggil `addMessage`; pesan masuk ke state
`messages` lalu tampil di `ChatModeView` (atau panel "Live transcript" di desktop).

> **Penting:** teks yang tampil dan tersimpan adalah **transkripsi internal Gemini** atas ucapanmu.
> Model "mendengar" audio langsung, jadi salah-transkripsi di layar tidak otomatis berarti model
> salah paham, dan sebaliknya.

**Indikator keadaan agent** (`agent_state_changed` → pesan data ke browser, topic `chat`):

| Pesan | Dikirim bila | Efek di UI |
|---|---|---|
| `AGENT_THINKING {active: true}` | agent tetap di "thinking" > 5 s (`THINKING_INDICATOR_DELAY_SEC`) | indikator mengetik |
| `AGENT_THINKING {active: false}` | state apa pun selain thinking | indikator hilang |
| `AGENT_STUCK` | tetap "thinking" > 10 s (`STUCK_TIMEOUT_SEC`), atau sebuah giliran berakhir tanpa pernah "speaking", atau event `error` | toast "Happy belum nyambung nih" |

Pemulihan otomatis (`_notify_and_recover`, debounce 5 s): kirim `AGENT_STUCK`, tunggu 2 s agar plugin
sempat reconnect, lalu `generate_reply` yang meminta agent minta maaf singkat dan menanyakan ulang
pertanyaan terakhir. Ini dibuat karena plugin Google **menelan** error socket 1007/1011 tanpa
memancarkan `error`, sehingga satu-satunya gejalanya adalah giliran yang berakhir tanpa jawaban.

### 5.8 Verifikasi suara dalam sesi

Ini inti sistem biometrik. Ia berjalan **berdampingan** dengan percakapan dan memakai jalur HTTP.

**Kapan dipicu** (agent, `start_verification`):

- tepat setelah greeting;
- setelah **setiap** giliran pengguna selama `is_voice_verified` masih `False`, `is_face_verifying` `False`, dan tidak sedang lockout. Jadi verifikasi **tidak menunggu** pengguna meminta aksi sensitif, ia mencoba terus secara pasif sejak awal percakapan.

`start_verification` tidak melakukan apa-apa bila sudah terverifikasi atau `is_verifying` sudah `True`.
Jika jalan: `is_verifying = True`, kirim `{"type":"VOICE_CMD","action":"START_RECORD"}` (topic
`VOICE_CMD`), dan jalankan watchdog **30 s** yang me-reset `is_verifying` bila hasil tak kunjung datang.

**Di browser** (`startVADRecordingRef` di `useLiveKit.ts`):

| Konstanta | Nilai | Fungsi |
|---|---|---|
| `START` | RMS 0,015 | Ambang suara untuk **mulai** merekam |
| `STOP` | RMS 0,01 | Di bawah ini dihitung hening |
| `SILENCE_MS` | 800 | Hening selama ini = kandidat berhenti |
| `MIN_SPEECH_MS` | 3000 | Minimal **akumulasi** durasi bicara (hening tidak dihitung) sebelum boleh berhenti |
| `MAX_RECORD_MS` | 15000 | Batas keras satu rekaman, dihitung sejak mulai merekam |

Langkah:

1. Abaikan jika sudah ada rekaman berjalan; wajib punya token login.
2. UI → `LISTENING`, status "Bicara satu kalimat penuh ya...".
3. **Memakai ulang track mic yang sudah dipublish ke LiveKit** (`micTrackRef`), tidak membuka `getUserMedia` kedua. Alasan di komentar: capture kedua dari perangkat yang sama berebut mic/CPU dengan pipeline audio percakapan dan membuat balasan agent tersendat berdetik-detik tiap verifikasi diulang.
4. **Mematikan** `echoCancellation`, `noiseSuppression`, `autoGainControl` pada track itu selama rekaman (`applyConstraints`). Alasan di komentar: model anti-spoof dikalibrasi pada rekaman mentah, dan pemrosesan Chrome membuat ucapan asli sering terbaca sebagai serangan replay. Ada pengatur waktu pengaman (`MAX_RECORD_MS + SILENCE_MS + 5000` = 20,8 s) yang **memulihkan** pengaturan itu kalau rekaman tak pernah mulai. Efek samping yang diakui kode: agent sebentar kehilangan echo cancellation.
5. Loop `requestAnimationFrame` menghitung RMS domain-waktu (`AnalyserNode`, `fftSize 2048`). RMS > `START` → `MediaRecorder.start()` (`audio/webm;codecs=opus`), UI → `RECORDING`.
6. Setiap frame, bila RMS ≥ `STOP`, tambahkan selisih waktu ke `speechMs` dan reset hitungan hening. Bila RMS < `STOP`: mulai hitung hening; jika hening > 800 ms **dan** `speechMs ≥ 3000` → `recorder.stop()`; jika hening > 800 ms tetapi bicara belum 3 s → status "Lanjut bicara sebentar lagi ya..." dan terus menunggu.
7. Jika sejak mulai rekam sudah > 15 s → paksa berhenti.
8. `onstop`: tutup `AudioContext`, pulihkan pemrosesan mic, jika ada data → UI `VERIFYING` → `POST /verify-voice` (multipart `audio`, JWT segar dari `getSession()`).
9. Respons dibaca: `status`, `score`, `reason`. `finally`: `onScore`, `onVerificationResult(status, score, reason)` (memicu toast), UI kembali `CHATTING`. Bila fetch melempar: status `DENIED`, alasan "Verification request failed".

> Jika pengguna **tidak pernah** melewati ambang `START`, rekaman tidak pernah mulai dan tidak ada
> permintaan ke backend. Satu-satunya "penutup" adalah watchdog agent (30 s).

**Di backend** (`/verify-voice`):

| # | Proses | Catatan |
|---|---|---|
| 1 | `_load_user_context` | `load_all_embeddings` + `load_behavior_profile` per label (berurutan, masing-masing satu query, di thread) |
| 2 | Belum enroll? | Mengembalikan **HTTP 200** `{"status":"ERROR","reason":"No enrollment profile found for user."}` **tanpa** mengirim `VOICE_RESULT` (temuan T-02) |
| 3 | `save_audio` + `normalize_audio` | webm → wav 16 kHz mono → gain ke RMS 0,1 (6.1) |
| 4 | `verify_against_multiple_embeddings` (di thread) | inti biometrik, 6.2–6.6 |
| 5 | Simpan profil perilaku bila diperbarui | `behavior_profiles` upsert |
| 6 | Proyeksi PCA | hanya jika ≥ 2 enrollment: **ECAPA dijalankan sekali lagi** pada audio yang sama untuk titik live di dashboard |
| 7 | `append_verification_log` | baris `voice_verification_logs`; kegagalan ditelan (log metrik tidak boleh merusak verifikasi) |
| 8 | `publish_room_result` | push `VOICE_RESULT {decision, score, ts}` ke room; best-effort |
| 9 | Respons | `{verified, status, reason, score, spoof_prob, best_index, all_scores, matched_label}` |
| 10 | `finally` | hapus wav sementara |

**Di agent**, `_handle_voice_result` (hanya dari paket tepercaya):

| Keputusan | Efek pada `room_state` |
|---|---|
| `VERIFIED` | `is_voice_verified = True`, `voice_status = "VERIFIED"`, `verify_attempts = 0`, `last_verified_at = now`; lalu `_announce_verified("suara")` |
| `DENIED` | `voice_status = "DENIED"`, `verify_attempts += 1` |
| `REPEAT` | `voice_status = "REPEAT"`, `verify_attempts += 1` |
| (apa pun) | `is_verifying = False`; jika `verify_attempts ≥ 3` → `start_face_verification()` |

> `DENIED` **dan** `REPEAT` sama-sama menambah penghitung. Jadi tiga kali "terlalu singkat"
> (yang statusnya REPEAT) tetap mengarah ke fallback wajah.

`_announce_verified`: menjalankan **auto-login** ke setiap toko yang sudah ditautkan pengguna
(sekali, kalau belum login), lalu `generate_reply` agar agent memberi tahu dengan santai bahwa
verifikasi berhasil dan sudah login.

**Kedaluwarsa:** `REVERIFY_INTERVAL = 600` detik (10 menit). Pengecekannya **malas**: status
berubah menjadi `EXPIRED` hanya saat `require_voice_verification` atau `check_voice_status`
dijalankan, tidak oleh timer. Konsekuensinya, sebelum salah satu dipanggil, `is_voice_verified`
tetap `True` dan agent tidak memulai verifikasi ulang secara pasif [KODE].

### 5.9 Fallback verifikasi wajah

**Pemicu:** `verify_attempts ≥ 3` setelah sebuah hasil suara.

**Agent** (`start_face_verification`): lewati bila sudah terverifikasi atau sedang face-verifying;
set `is_face_verifying = True`; `generate_reply` agar agent menjelaskan akan beralih ke wajah;
**menunggu suaranya selesai diputar** (`speech_handle.wait_for_playout()`); kirim
`{"type":"FACE_CMD","action":"START_FACE_CAPTURE"}` (topic `FACE_CMD`); watchdog **35 s**. Bila
watchdog habis: reset `is_face_verifying` dan pasang **lockout 60 s**.

**Browser** (`FaceLivenessCapture.tsx`, dibuka oleh `faceVerifyOpen`):

| # | Langkah | Rincian |
|---|---|---|
| 1 | `POST /face/liveness-challenge` | server menjawab `{liveness_token, challenge_type, expires_in: 25}`. `challenge_type` dipilih server secara acak dari `blink`, `mouth`, `turn`; token disimpan di dict memori `{user_id, type, expires_at}` |
| 2 | Kamera | 640x480, `facingMode: "user"` |
| 3 | `FaceLandmarker` MediaPipe | float16, delegate GPU, mode VIDEO, `numFaces: 5`, blendshape aktif. **Dimuat di latar belakang sejak komponen ter-mount**, karena memuatnya baru saat dibutuhkan (WASM + model) membekukan thread utama beberapa detik di tengah panggilan dan terlihat seperti agent mati |
| 4 | Loop deteksi | menggambar kotak wajah (hijau jika tepat 1 wajah, merah jika >1). **Tantangan hanya dinilai bila tepat 1 wajah** dan kemajuan di-reset kalau jumlah wajah berubah |
| 5 | Aturan lulus | **blink:** `min(eyeBlinkLeft, eyeBlinkRight)` harus turun di bawah **0,15** lalu naik di atas **0,5**. **mouth:** `jawOpen` dengan ambang sama. **turn:** jarak horizontal ujung hidung dibagi lebar kumpulan landmark harus > **0,45** |
| 6 | Batas waktu | 15 s (`LIVENESS_TIMEOUT_MS`) → `DENIED` "Waktu habis" |
| 7 | Lulus | ambil frame → JPEG 0,92 → `POST /face/verify-face` (`image`, `liveness_token`) |

**Backend** (`/face/verify-face`):

| # | Kondisi | Hasil |
|---|---|---|
| 1 | `liveness_token` **ada** | `consume_challenge(token, user_id)`: token dihapus **apa pun hasilnya** (sekali pakai). Tidak ada/kedaluwarsa/milik user lain → log `LIVENESS_FAILED`, push `FACE_RESULT` DENIED, kembalikan `status: "LIVENESS_FAILED"` |
| 2 | `liveness_token` **tidak ada** | **pengecekan liveness dilewati** (dimaksudkan untuk tombol uji manual) |
| 3 | Belum enroll wajah | log `NO_FACE_ENROLLMENT`, push DENIED |
| 4 | Normal | ekstrak embedding foto → cosine ke embedding enrollment → **≥ 0,45** = `VERIFIED`, selain itu `DENIED` → simpan `face_verification_logs` → push `FACE_RESULT {decision, similarity, ts}` |
| 5 | Exception | `ValueError` (0 atau >1 wajah) → log `ERROR`, push DENIED, HTTP 400. Lainnya → `SERVER_ERROR`, HTTP 500 |

**Agent** (`_handle_face_result`):

- `VERIFIED` → set flag terverifikasi yang **sama persis** dengan jalur suara (`require_voice_verification` tidak membedakan sumbernya), reset penghitung dan lockout, `_announce_verified("wajah")`.
- selain itu → `lockout_until = now + 60 s` dan agent menyampaikan bisa coba lagi sebentar lagi.

Selama lockout, tool sensitif menjawab "coba lagi sekitar N detik" dan verifikasi pasif ditahan.
Begitu lockout lewat, penghitung di-reset dan verifikasi pasif berjalan lagi.

> **Batas yang harus dipahami (temuan T-03, T-04):** gerakan liveness dinilai **seluruhnya di
> browser**. Server hanya mengeluarkan token sekali pakai dan memastikan token itu ada. Server
> **tidak bisa tahu** apakah gerakannya benar-benar dilakukan. Dan karena token bersifat
> opsional, endpoint yang sama bisa dipanggil **tanpa** token sambil tetap mengirim `FACE_RESULT`
> `VERIFIED` ke agent.

### 5.10 Tool belanja: apa yang dikerjakan agent saat Gemini memanggil fungsi

Gemini memanggil salah satu dari **20 function tool** (`agent/tools.py`). Tabel gerbangnya:

| Tool | Gerbang suara? | Perlu sudah login ke toko? | Efek samping |
|---|---|---|---|
| `get_user_city` | tidak | tidak | membaca `room_state["user_city"]` |
| `get_weather(city)` | tidak | tidak | `GET wttr.in/{city}?format=3` |
| `web_search(query)` | tidak | tidak | DuckDuckGo, **batas 15 s** (`asyncio.wait_for`) |
| `search_product(...)` | tidak | tidak | lihat di bawah; **menulis `product_cards` + kirim kartu ke layar** |
| `get_product_detail(id, source)` | tidak | tidak | `GET {toko}/api/products/{id}` |
| `get_product_from_search_index(n)` | tidak | tidak | membaca cache `last_search_products` (10 teratas) |
| `send_product_cards(products)` | tidak | tidak | pilih tangan kartu; maks 5; **tidak pernah mengirim list kosong** |
| `send_review_cards(id, source)` | tidak | tidak | menulis `review_cards`, kirim kartu review |
| `check_login_status` | tidak | tidak | membaca `auth_state` |
| `check_voice_status` | tidak | tidak | membaca/mengedaluwarsakan status |
| `get_cart(source)` | **tidak** | ya | `GET {toko}/api/cart` |
| `get_order_history(source)` | **tidak** (disengaja, ada di daftar non-sensitif prompt) | ya | `GET {toko}/api/orders` |
| `get_order_detail(id, source)` | **tidak** (disengaja) | ya | `GET {toko}/api/orders/{id}` |
| `login(source="")` | **ya** | — | login ke toko tertaut; memuat & mendekripsi kredensial |
| `logout(source="")` | **ya** | — | menghapus token dari memori |
| `get_shopkupay_balance(source)` | **ya** | ya | `GET {toko}/api/user` |
| `add_to_cart(id, source, qty)` | **ya** | ya | `POST {toko}/api/cart` |
| `remove_from_cart(cart_id, source)` | **ya** | ya | `DELETE {toko}/api/cart?cart_id=` |
| `checkout(source, payment_method)` | **ya** | ya | `POST {toko}/api/orders`, lalu kosongkan keranjang |
| `pay_order(order_id, source)` | **ya** | ya | `POST {toko}/api/orders/{id}/pay` (hanya jika status `pending`) |

Catatan: `get_cart` **tidak** ada di daftar sensitif maupun non-sensitif di prompt, tapi di kode
ia tidak digerbang suara. Karena tool ini butuh login toko, dan login hanya terjadi lewat
`login()` (digerbang) atau auto-login setelah verifikasi, ia terlindungi secara tidak langsung,
**selama token login belum hilang**. Token login toko **tidak kedaluwarsa** saat status suara
menjadi `EXPIRED`, jadi `get_cart`/`get_order_*` tetap bisa dipakai setelah verifikasi suara
kedaluwarsa [KODE].

**`require_voice_verification(action_name)`** (urutan pengecekan):

1. Jika `is_voice_verified` dan sudah lewat 600 s sejak `last_verified_at` → ubah ke `EXPIRED`.
2. Status `VERIFIED` → lolos (`None`).
3. Sedang lockout? → pesan "coba lagi sekitar N detik" (atau reset bila sudah lewat).
4. Selain itu, pesan sesuai status (`EXPIRED`/`REPEAT`/`DENIED`/belum diverifikasi). Pesan ini
   **dikembalikan ke Gemini sebagai hasil tool**, lalu Gemini yang menyampaikannya ke pengguna.
   Tool tidak melakukan aksi apa pun.

**Alur `search_product`** (paling kompleks):

1. `asyncio.gather` memanggil `adapter.search_products()` untuk **semua toko serentak** (`return_exceptions=True`, jadi satu toko mati tidak menggagalkan yang lain; toko gagal dicatat).
2. Tiap adapter mengambil **seluruh katalog** (`GET /api/products`, API tidak mendukung filter server) dan menormalkan tiap produk: `price` & `rating` jadi angka, `image_url` jadi URL absolut (cadangan `picsum.photos`), tambah `source`, `source_label`, `link`, dan samakan bentuk info toko (`store` vs `shop_name`/`shop_city`).
3. Filter **lokal**: `query` (cocok di nama/deskripsi/keywords, tidak peka huruf besar), aturan khusus bila query berkata ponsel (buang produk yang namanya memuat kata laptop/aksesori), `category` (persis), `min_price`, `max_price`, `min_rating`, `city`.
4. **Urutan:** dikelompokkan per toko, diurutkan di dalam kelompok, lalu **diselang-seling (round-robin)** antar toko. Alasan: distribusi rating/harga tiap toko dummy berbeda sistematis, sehingga mengurutkan gabungan lalu memotong 5 teratas bisa menghapus satu toko sepenuhnya dari tampilan.
5. Simpan 10 teratas ke `auth_state["last_search_products"]` (untuk `get_product_from_search_index`).
6. `_send_product_cards_internal(5 teratas)`: insert baris `product_cards {session_id, products}` (di thread), **tidur 2 detik**, lalu `publish_data(topic="PRODUCT_DATA")` `{type: "PRODUCT_CARDS", products}`. Alasan jeda 2 s tidak tertulis di kode; kemungkinan agar kartu muncul setelah agent mulai bicara **[DUGAAN]**.
7. Mengembalikan ke Gemini teks ringkas `SEARCH_RESULT_INTERNAL ...` berisi nomor, nama, ID, source, plus instruksi eksplisit agar **tidak membacakan daftar**.

Di browser, `PRODUCT_CARDS` masuk ke `handleProductCards`: **array kosong diabaikan** (agar kartu tidak
terhapus), dan `latestReviews` dikosongkan. Kartu tampil di `ProductCarousel` (mode suara; gambar
berotasi tiap 1 detik bila lebih dari satu gambar, navigasi panah keyboard) atau di
`ProductSidebar`. Tautan "buka produk" memakai `product.link`.

**`checkout`**: gerbang suara → akun & login → `get_cart` → hitung total → (ShopKuPay: cek saldo ≥ total) →
susun `items` dari keranjang → `POST /api/orders` → bila sukses, **hapus semua item keranjang
serentak** → kembalikan ringkasan + tautan pesanan. Metode bayar yang disebut di docstring:
`VA_BCA, VA_BRI, VA_Mandiri, GoPay, OVO, ShopeePay, DANA, ShopKuPay`; kode **tidak memvalidasi**
nilai ini, API tokolah yang menolak yang tidak dikenal.

**Aturan perilaku yang ditanam di prompt** (`prompts.py`, ±900 baris), ringkasannya:

- Belanja **hanya** di toko milik sendiri (`oren`, `hijau`); jangan menyarankan marketplace lain.
- Setiap produk membawa `source`; semua tool per-toko wajib menerimanya. Saat membandingkan, sebut nama toko.
- Setelah pencarian, **jangan membacakan daftar**: sebut jumlah, katakan sudah tampil, ajak memilih nomor. Hasil >5 → tanya budget dulu.
- Filter bersifat **kumulatif** antar giliran, hanya direset bila pengguna ganti kategori.
- Harga diucapkan **dibulatkan** ("13 jutaan"), tautan **tidak dibacakan** ("linknya udah di chat").
- Wajib `send_review_cards` setiap kali pengguna minta detail/review; dilarang mengaku sudah mengirim bila belum memanggil.
- Tidak boleh checkout tanpa konfirmasi jelas; selalu konfirmasi metode bayar.
- `get_user_city()` dipanggil diam-diam di awal; kota tidak boleh jadi filter otomatis, hanya petunjuk.
- Tidak pernah meminta username/password; akun ditautkan lewat formulir.
- Verifikasi suara **bukan** menu pengaturan; saat tool terblokir, panggil `check_voice_status()` dan sampaikan jawabannya apa adanya.

### 5.11 Mengakhiri sesi, pelabelan, dan riwayat

1. Pengguna menekan tombol mic lagi → `leaveRoom` (`room.disconnect()`, hentikan perekam jika ada) dan `onEndChat` → `handleNewChat` mengosongkan `messages`/`products` dan menyegarkan daftar sesi sekarang **dan lagi 3 detik kemudian** (karena pelabelan backend selesai setelah segarkan pertama).
2. **Agent:** event `disconnected` → hapus dari `_active_rooms`, nyalakan `disconnected_event` → `label_session_from_transcript()` terakhir.
3. **Pelabelan sesi** (`label_session_from_transcript`, memakai model teks terpisah `gemini-3.5-flash-lite` lewat `genai.Client.models.generate_content` di thread): prompt berbahasa Indonesia meminta judul **maksimal 6 kata** dari maksimal 20 giliran pertama → `update_conversation_session_label`. Dipanggil dua kali: sekali tepat setelah giliran pertama pengguna (agar sidebar tidak lama menampilkan "New session"), dan sekali saat panggilan berakhir untuk menyempurnakan.
4. **Riwayat:** `Sidebar` memuat `GET /logs/sessions` (di-cache di variabel modul `cachedSessions` agar tidak berkedip). Memilih sesi → `/history/{id}` → `GET /logs/sessions/{id}` yang mengembalikan `logs`, `product_cards`, `review_cards`. Halaman menggabungkan pesan dan kartu review, **mengurutkan menurut waktu**, meratakan semua kartu produk, lalu merender `ChatArea` dengan `isViewingHistory` (mode baca saja).
5. Ganti nama: `PATCH /conversation-sessions/{id}/label`. Hapus: `DELETE /conversation-sessions/{id}` menghapus baris `conversation_logs` lalu `conversation_sessions`. `review_cards` ikut terhapus karena FK `on delete cascade` (migrasi 004). Perilaku `product_cards` **[DUGAAN]**: skema tabelnya tidak ada di repo, sehingga tidak bisa dipastikan apakah ia ikut terhapus.

### 5.12 Halaman analitik dan penjelasan

| Rute | Login | Sumber data | Isinya |
|---|---|---|---|
| `/analysis` | ya | `GET /spectrograms` (URL bertanda tangan 1 jam), `GET /verification-metrics` (maks 200 log + threshold), `GET /face/verification-metrics` | Spektrogram tiap suara terdaftar, grafik skor verifikasi suara vs threshold, log dan threshold verifikasi wajah. **Tidak ada tautan menuju halaman ini**: harus diketik manual |
| `/dashboard` | ya | **Query langsung dari browser ke Supabase** (`conversation_sessions`, `conversation_logs`, `voice_verification_logs`) + **Supabase Realtime** (channel `voice-verification-live`) + `/embeddings/*` | KPI jumlah sesi/pesan, sesi 7 hari terakhir, rasio pesan user vs asisten, grafik "latensi", sesi terbaru, titik verifikasi live pada scatter embedding. Query **tanpa filter `user_id`**, jadi isolasi datanya bergantung RLS (temuan T-09). Grafik "latensi" **bukan latensi audio** dan punya cacat urutan (temuan T-10) |
| `/embeddings` | ya | `GET /embeddings/visualize`, `POST /embeddings/project` | Scatter 2D (PCA) embedding suara terdaftar; rekam "suara uji" yang diproyeksikan ke ruang yang sama dan diberi warna sesuai skor |
| `/pipeline` | tidak (mode replay), ya (mode live) | replay: berkas statis `public/pipeline-demo/traces.json` dan `face-traces.json`. Live: `POST /verify-voice/explain` dan `POST /face/verify-face/explain` | Diagram alir interaktif (`@xyflow/react`) pipeline biometrik; klik blok untuk melihat data nyata tahap itu |
| `/agent-pipeline` | tidak | berkas statis `public/pipeline-demo/tool-traces.json` | Diagram alir pemanggilan tool agent dari data tangkapan nyata |

Endpoint `explain` **tidak menyimpan apa pun**: tidak ada log verifikasi, tidak ada update profil
perilaku, tidak ada push ke room. Alasannya (komentar kode): percobaan di booth/demo tidak boleh
mencemari riwayat akun presenter atau memicu aksi agent. Data jejak dibentuk oleh
`utils/pipeline_trace.py`: pratinjau gelombang (200 bucket puncak), spektrogram mel 40x≤80,
ringkasan tensor tiap blok model (lewat *forward hook*), dan dua "contoh kerja" mainan
(`ecapa_worked_example.py`, `antispoof_worked_example.py`) yang **bukan** model sungguhan.
Berkas replay dibuat offline oleh `analysis/capture_*_traces.py`.

---

## 6. Pipeline biometrik, sampai bagian terkecil

Angka bertanda **[DIJALANKAN]** berasal dari satu giliran verifikasi nyata yang saya jalankan pada
kode `dev` (Lampiran A): klip enrollment 12,96 detik dan klip uji 5,71 detik, keduanya suara
sintetis macOS (bukan suara manusia), jadi **skor** di sini hanya ilustrasi, tetapi **bentuk
tensor, urutan langkah, dan waktu** adalah nyata.

### 6.0 Peta satu giliran verifikasi

```text
 webm/opus (dari browser)
    │ ① ffmpeg → wav 16 kHz mono                                          ~30 ms [DIJALANKAN]
    ▼
 wav ──② normalize_audio: kalikan gain agar RMS = 0.1, clip ±1            ~1 ms (setelah warm-up)
    ├────────────────────────────────┬─────────────────────────────────────────────┐
    ▼                                ▼                                             ▼
 ③ ECAPA-TDNN                     ④ trim hening (top_db 25)                    ⑤ durasi bicara + YIN
   Fbank 80 → blok → 192-D           ▼                                            speech_sec, pitch, rate
   cosine ke tiap enrollment      wav2vec2 anti-spoof → fake_prob
   → best_score, best_label       (0 = asli, 1 = palsu)
    └────────────────────────────────┴─────────────────────────────────────────────┘
                                     ▼
                       ⑥ decide(): cascade aturan  →  VERIFIED / REPEAT / DENIED
                                     ▼
                  ⑦ (jika VERIFIED) update profil perilaku bila kebijakan mengizinkan
```

### 6.1 Prapemrosesan audio

**Input:** berkas webm (kontainer WebM, codec Opus) hasil `MediaRecorder`.

1. `save_audio` menulis upload ke `tmp_audio/<uuid>.webm`. **Nama berkas dari klien diabaikan** (komentar: "Jangan percaya filename").
2. `ffmpeg -y -i <webm> -ar 16000 -ac 1 -f wav <wav>`: 16 kHz, mono, WAV. Error `ffmpeg` dipangkas ke 800 karakter terakhir. File webm dihapus.
3. `normalize_audio`: `librosa.load(sr=16000, mono=True)` → `rms = sqrt(mean(y²))` → bila `rms > 1e-6`: `y = clip(y * (0.1 / rms), -1, 1)` → tulis ulang WAV.

**Alasan normalisasi** (komentar `utils/audio.py`): volume mic berbeda antar perangkat; tanpa ini, sampel
dari mic pelan sistematis lebih lemah energinya daripada saat enrollment (atau sebaliknya),
menggeser semua fitur hilir.

**[DIJALANKAN]** RMS klip enrollment `0,1821 → 0,1000`, klip uji `0,1808 → 0,1000`.

Efek samping yang perlu diketahui: normalisasi ini **menguatkan noise** pada rekaman yang sangat
pelan, dan **memotong (clip)** puncak pada rekaman yang sangat keras. Panggilan `normalize_audio`
pertama setelah proses start terukur 0,9 detik pada jalan ulang terakhir (2,3 detik pada jalan
pertama, saat berkas pustaka belum di-*cache*) karena inisialisasi librosa/numba; yang berikutnya ~1 ms.
Jadi itu biaya *cold start*, bukan biaya per verifikasi.

### 6.2 Speaker verification: ECAPA-TDNN

**Model:** `speechbrain/spkrec-ecapa-voxceleb` (dilatih pada VoxCeleb), dimuat dari
`pretrained_models/spkrec-ecapa-voxceleb` (path **relatif terhadap cwd**, lihat temuan T-13).

**Input:** wav 16 kHz mono. **Output:** vektor `float32` berukuran **192**, **panjangnya 1** (L2).

Isi `encode_batch` (hiperparameter dari `hyperparams.yaml` yang dipakai, bentuk dari jejak nyata):

| Tahap | Modul SpeechBrain | Bentuk keluaran [DIJALANKAN, klip 5,71 s] | Arti |
|---|---|---|---|
| ① fitur | `compute_features` = `Fbank(n_mels=80)` | `[1, 572, 80]` | Spektrogram mel log: 572 bingkai (hop 10 ms) × 80 pita |
| ② normalisasi | `mean_var_norm` (`InputNormalization`) | `[1, 572, 80]`, rata-rata 0, std ≈ 15,0 | Menghilangkan perbedaan skala/saluran |
| ③ blok 0 | `embedding_model.blocks.0` = `TDNNBlock` (kernel 5, dilasi 1) | `[1, 1024, 572]` | Konvolusi 1-D awal: 80 → 1024 kanal |
| ④ blok 1-3 | `blocks.1..3` = `SERes2NetBlock` (kernel 3, dilasi 2, 3, 4) | `[1, 1024, 572]` ×3 | Konteks waktu makin lebar + *Squeeze-Excitation* (pembobotan kanal) + struktur Res2Net |
| ⑤ agregasi | `mfa` = `TDNNBlock` (kernel 1, 3072 kanal) | `[1, 3072, 572]` | *Multi-layer Feature Aggregation*: menggabung keluaran blok 1-3 |
| ⑥ pooling | `asp` = `AttentiveStatisticsPooling` (attention 128) | `[1, 6144, 1]` | Merangkum **seluruh** waktu jadi satu titik: rata-rata + simpangan baku **berbobot atensi** dari 3072 kanal (3072 × 2 = 6144) |
| ⑦ norm | `asp_bn` (`BatchNorm1d`) | `[1, 6144, 1]` | |
| ⑧ proyeksi | `fc` (`Conv1d` ke `lin_neurons = 192`) | `[1, 192, 1]` | Embedding mentah |
| ⑨ norm emb | `mean_var_norm_emb` | `[192]` | Setelah `squeeze` |
| ⑩ L2 | (kode kita) `emb / ‖emb‖` | `[192]`, norma 1,000000 | Agar cosine = dot product |

Kunci pemahaman: tahap ⑥ adalah momen "durasi menghilang". Panjang klip (572 bingkai) dipadatkan
menjadi satu vektor berukuran tetap, sehingga klip 3 detik dan 10 detik menghasilkan vektor yang
sama panjangnya. Tetapi klip yang **lebih pendek memberi statistik yang lebih berisik**, itulah
sebabnya skor jatuh pada ucapan singkat (ilustrasi dari pengujian di sesi sebelumnya: suara yang
**sama persis** menghasilkan skor 0,95 pada 10 detik, 0,77 pada 2,8 detik, 0,39 pada 1,1 detik,
0,17 pada 0,4 detik).

**Membandingkan:** `compare_embeddings(a, b) = float(np.dot(a, b))`. Karena kedua vektor panjang 1,
ini **persis cosine similarity**, rentang **−1 sampai 1** (docstring kode menulis "0 to 1", yang
keliru: sampel spoof pernah memberi skor negatif). **[DIJALANKAN]** skor klip uji terhadap
enrollment: **0,9413** (orang/suara sama, kalimat berbeda).

**Banyak enrollment:** skor dihitung terhadap **tiap** profil (maks 3), lalu diambil **yang tertinggi**
(`argmax`), bukan rata-rata. `best_label` = label profil pemenang. Konsekuensinya: tiap profil
tambahan memberi satu "kesempatan" lagi untuk melewati ambang. Itu wajar untuk satu orang yang
mendaftarkan beberapa kondisi suara, tapi secara statistik menaikkan peluang salah-terima kecil.

### 6.3 Anti-spoofing: wav2vec2

**Model:** `MelodyMachine/Deepfake-audio-detection-V2` (`Wav2Vec2ForSequenceClassification`),
dimuat lewat `transformers.pipeline("audio-classification")`. **Selalu CPU** (tidak ada argumen `device`).
Label keluaran: `0 = fake`, `1 = real`; kode memakai `probs["fake"]`.

**Input:** wav yang sama, tetapi dengan langkah tambahan: `librosa.effects.trim(top_db=25)` membuang
hening di awal/akhir. **Output:** satu angka `fake_prob` di 0..1.

Arsitektur (dari `config.json` model yang tersimpan) dan bentuk dari jejak nyata. Klip dipangkas
menjadi 5,57 s = 89.085 sampel:

| Tahap | Modul | Bentuk [DIJALANKAN] | Arti |
|---|---|---|---|
| ① | `feature_extractor.conv_layers.0` | `[1, 512, 17816]` | **7 lapis konvolusi langsung pada sampel mentah** (kernel 10,3,3,3,3,2,2; stride 5,2,2,2,2,2,2). Berbeda dari ECAPA, tidak ada fitur mel buatan tangan |
| ② | `conv_layers.3` | `[1, 512, 2226]` | Resolusi waktu turun tiap lapis |
| ③ | `conv_layers.6` | `[1, 512, 278]` | Total stride 320 sampel = **20 ms per bingkai** |
| ④ | `feature_projection` | `[1, 278, 768]` | 512 → `hidden_size` 768 |
| ⑤ | `encoder.layers.0 / 5 / 11` | `[1, 278, 768]` | **12 lapis transformer** (12 kepala atensi, FFN 3072). Tiga lapis dicontohkan (awal/tengah/akhir) |
| ⑥ | `projector` | `[1, 278, 256]` | `classifier_proj_size = 256` |
| ⑦ | rata-rata waktu + `classifier` | `[1, 2]` | dua logit → softmax → `{fake, real}` |

**[DIJALANKAN]** `fake_prob = 0,000040`, `real_prob = 0,999960`.

Sifat yang harus diketahui:

- **Keluarannya nyaris biner.** Pada 37 berkas dataset lama yang saya pulihkan dari riwayat git, nilainya berkumpul di sekitar 0,00002 (asli) atau 0,99998 (palsu); hampir tidak ada nilai di tengah. Karena itu ambang `replay_warn = 0,50` dan `replay_deny = 0,85` hampir selalu memberi hasil yang sama.
- Pada 37 berkas itu: genuine 13/13 lolos, impostor (suara asli orang lain) 12/13 lolos, spoof 9/11 tertangkap; AUC 0,883, EER sekitar 9%. **Sampel kecil.** Dua klaim di kode (EER ~15% di `asvspoof.py`, EER ~0 di `decision_engine.py`) berbeda satu sama lain dan dari hasil ini (temuan T-12).
- Komentar `decision_engine.py` (investigasi produksi 2026-10-30) mencatat bahwa pada kanal nyata browser+LiveKit (webm/opus + AEC/NS/AGC), **suara asli sering mendapat `fake_prob ≥ 0,95`**, tidak bisa dibedakan dari klaster spoof pada data bersih. Itulah alasan `replay_deny` tidak lagi menolak keras.
- **Gagal-terbuka:** bila audio tidak terbaca, terlalu pendek (≤ 512 sampel setelah trim), atau senyap, `compute_score` mengembalikan `0.0` (artinya "asli"). Perlindungan dari jalur ini hilang; yang tersisa hanyalah skor speaker dan batas durasi.

> Skor ini **tidak berkaitan dengan siapa yang bicara**. Ia hanya menjawab "rekaman/palsu atau suara
> hidup?". (Docstring `compute_score`.)

### 6.4 Durasi ucapan, pitch, dan "rate"

`_speech_duration(wav)`: muat 16 kHz → `trim(top_db=25)` → `panjang_trim / sr`. **[DIJALANKAN]** klip uji:
durasi 5,71 s, ucapan 5,57 s.

- Jika `speech_sec < MIN_SPEECH_SEC (1,0)`: keputusan langsung **REPEAT** ("Suaranya terlalu singkat, coba ucapkan satu kalimat penuh"). `decide()` **tidak dipanggil**; pitch/rate/perilaku dilewati.
- Jika tidak: `y` dimuat lagi, lalu
  - `pitch = nanmean(librosa.yin(y, fmin=50, fmax=300, sr))`. **[DIJALANKAN]** 210,5 Hz untuk suara sintetis uji.
  - `rate = len(y) / sr`: **durasi seluruh klip dalam detik**, termasuk hening. 5,71 s pada uji.

Dua catatan jujur tentang kualitas sinyal ini:

1. `librosa.yin` tidak memberi tanda bersuara/tak bersuara (yang punya adalah `pyin`). Rata-rata `yin` karena itu mencakup bingkai hening, desis, dan napas, jadi "pitch" adalah **perkiraan kasar**, bukan F0 bersih.
2. "Rate" adalah durasi klip, bukan kecepatan bicara. Pada verifikasi, durasi klip ditentukan oleh **aturan perekam browser** (minimal 3 s bicara, maksimal 15 s) dan kalimat apa yang diucapkan, bukan oleh kebiasaan bicara orangnya.

### 6.5 Profil perilaku dan pembaruan adaptif

**Struktur** (`BehaviorProfile`): `n_samples`, `mean_pitch`, `var_pitch`, `mean_rate`, `var_rate`,
`last_update_ts`. Pembaruan memakai algoritma **Welford** (rata-rata dan jumlah kuadrat selisih
berjalan, `var_*` sebenarnya adalah M2, bukan varians):

```text
n += 1
dp = pitch - mean_pitch
mean_pitch += dp / n
var_pitch  += dp * (pitch - mean_pitch)        # M2
std_pitch   = sqrt(var_pitch / n)  jika > 1e-9, selain itu 1e-6
```

**Skor perilaku** (`compute_behavior_score`): `z = (x - mean) / max(std, 1e-6)`;
`score_pitch = exp(-0,5·z_pitch²)`, `score_rate = exp(-0,5·z_rate²)`;
`behavior_score = 0,5·(score_pitch + score_rate)`, rentang 0..1.

**Pengaruhnya pada keputusan:** hanya satu tempat, di `decide()` cabang `VERIFIED`. Bila
`behavior_n_samples ≥ 5` **dan** `behavior_score < 0,15` → diturunkan jadi `REPEAT`. Perilaku
**tidak pernah** menyebabkan `DENIED`, dan dilewati penuh jika profil belum cukup tebal.

**Pembaruan adaptif** (`TrustedUpdatePolicy.should_update`), semua syarat harus terpenuhi:

| # | Syarat | Nilai |
|---|---|---|
| 0 | `behavior_score` tidak `None` | — |
| 1 | keputusan `VERIFIED` | — |
| 2 | skor speaker ≥ | 0,65 |
| 3 | `fake_prob` ≤ | 0,20 |
| 4 | `behavior_score` ≥ | 0,60 |
| 5 | **`n_samples < 5 dan n_samples ≠ 0` → tolak** | `min_samples = 5` |
| 6 | bukan percobaan ulang | — |
| 7 | sudah ≥ 3600 s sejak update terakhir | `min_update_interval` |
| 8 | `|z_pitch|` dan `|z_rate|` ≤ | 2,0 |

**Yang saya buktikan dengan menjalankannya [DIJALANKAN]** (detail di temuan T-05 dan T-06):

- Profil buatan enrollment (`n_samples = 1`, `var = 0`) memberi `std = 1e-6`. Dengan pitch **persis sama** dan durasi hanya beda 1 detik, `z_rate = 1.000.000`, `score_rate = 0`, sehingga `behavior_score` tertahan di **0,500**.
- `should_update` dengan kondisi sempurna: `n_samples = 0` → `True`, **`1, 2, 4` → `False`**, `5` → `True`. Karena enrollment menciptakan profil `n = 1`, dan `n` **tidak bisa naik dari 1** (syarat 5 menolak), profil **tidak pernah tumbuh**. Akibatnya gerbang perilaku (butuh `n ≥ 5`) **tidak pernah aktif**.
- Jika `n` sampai 0 atau ≥ 5, `should_update` **melempar `TypeError`** karena `biometric_service.py` mengirim `last_update_ts` berupa `datetime`, sedangkan fungsi mengurangkannya dari `time()` (float). Tes unit lolos karena memakai float.

### 6.6 Mesin keputusan

`DecisionConfig` (nilai bawaan):

| Parameter | Nilai | Dipakai |
|---|---|---|
| `abs_min_speaker` | 0,35 | penjaga keras pertama |
| `replay_deny` | 0,85 | |
| `replay_warn` | 0,50 | |
| `voice_accept` | 0,45 | |
| `voice_repeat` | 0,30 | **tidak memengaruhi hasil apa pun** (lihat di bawah) |
| `behavior_repeat` | 0,15 | |
| `behavior_min_samples` | 5 | |
| `combined_accept`, `combined_repeat` | 0,52 / 0,40 | **tidak dipakai di mana pun** [KODE: `grep` tidak menemukan pemakai] |

**Urutan evaluasi** (setelah pemeriksaan durasi di `biometric_service`):

| # | Cek | Gagal → |
|---|---|---|
| 0 | `speech_sec ≥ 1,0` (di luar `decide`) | `REPEAT` "Suaranya terlalu singkat..." |
| 1 | `speaker_score ≥ 0,35` | `DENIED` "Speaker score too low" |
| 2 | `replay_prob < 0,85` | `REPEAT` "Replay attack detected, please repeat" (dulu `DENIED`, diturunkan) |
| 3 | `replay_prob < 0,50` | `REPEAT` "Potential replay attack detected" |
| 4 | `speaker_score ≥ 0,45` | lanjut ke 5 |
| 4a | (jika lolos 4) gerbang perilaku | `REPEAT` "Voice matched but behavior pattern is unusual" |
| 4b | (jika lolos semua) | **`VERIFIED`** "Speaker verified successfully" |
| 5 | `speaker_score ≥ 0,30` | `REPEAT` "Uncertain verification, please repeat" |
| 6 | selain itu | `DENIED` "Speaker verification failed" |

**Hasil sebenarnya per rentang skor speaker [DIJALANKAN]**, dengan `replay_prob = 0`:

| `speaker_score` | Keputusan |
|---|---|
| < 0,35 | `DENIED` ("Speaker score too low") |
| 0,35 ≤ s < 0,45 | `REPEAT` ("Uncertain verification, please repeat") |
| ≥ 0,45 | `VERIFIED` (jika tidak tersaring replay/perilaku) |

Dua hal yang tidak intuitif:

- Karena `abs_min_speaker (0,35) > voice_repeat (0,30)`, **cabang 6** ("Speaker verification failed") **tidak pernah tercapai**: saya mencoba 2001 skor dari −1 sampai 1; **0** menghasilkan alasan itu. Nilai `voice_repeat` boleh berapa pun ≤ 0,35 tanpa mengubah perilaku.
- Tes `test_REGRESSION_voice_repeat_is_unreachable_with_default_config` menulis di docstring bahwa pesan "Uncertain verification" **tidak pernah dapat dikembalikan**. Itu **tidak benar**: skor 0,35 sampai 0,449 mengembalikannya (tes itu hanya memeriksa skor 0,31, yang memang `DENIED`).

Replay: karena `replay_deny` kini hanya `REPEAT`, **tidak ada jalur di mana skor anti-spoof saja menghasilkan `DENIED`**. `DENIED` hanya muncul dari skor speaker < 0,35. Penghitung percobaan agent tetap bertambah pada `REPEAT`, jadi replay yang berulang akhirnya tetap berujung ke fallback wajah.

**Pembatas yang menentukan hasil di lapangan:** syarat `speaker_score ≥ 0,45` dan batas durasi bicara.
Batas durasi 1,0 detik di backend (`MIN_SPEECH_SEC`) lebih longgar daripada aturan perekam browser
(3 detik bicara); keduanya sengaja berbeda: browser memaksa pengguna bicara cukup lama, backend
hanya pagar terakhir.

### 6.7 Pipeline wajah

Model: **InsightFace `buffalo_l`** (`FaceAnalysis`, `prepare(ctx_id=0, det_size=(640, 640))`).
Komponen di dalamnya, sesuai docstring `capture_face_traces.py` dan log pemuatan model:

| Tahap | Model | Keluaran |
|---|---|---|
| deteksi | `det_10g.onnx` | kotak (`bbox`), skor deteksi, 5 titik kunci (`kps`) |
| landmark | `2d106det.onnx` | 106 titik 2D |
| perataan | `insightface.utils.face_align.norm_crop(kps, 112, "arcface")` | potongan wajah **112×112** |
| pengenalan | `w600k_r50.onnx` (ArcFace ResNet-50) | embedding **512** angka |
| (dimuat tapi tidak dipakai) | `genderage.onnx` | — |

Aturan: **tepat satu wajah**; 0 atau >1 → `ValueError` → HTTP 400. Embedding dinormalisasi L2.
Keputusan: `cosine(foto, enrollment) ≥ 0,45` → `VERIFIED`, selain itu `DENIED`. **Tidak ada tingkat
`REPEAT`**, tidak ada perilaku, tidak ada anti-spoof di sisi server. Satu-satunya pertahanan terhadap
foto cetak/layar adalah tantangan liveness di browser (5.9), dan skrip uji wajah sendiri
menyatakan "pipeline ini tidak punya cek anti-spoof sisi-server pada gambar statis".

Embedding wajah **tidak dibandingkan antar banyak enrollment**: hanya satu per pengguna.

---

## 7. Peta API backend (FastAPI, satu aplikasi, router wajah di-mount)

Autentikasi: lihat 4.4. "JWT" = header `Authorization: Bearer <token Supabase>`, divalidasi
`auth.get_user` memakai klien service-role. Kolom "Menyentuh" memuat tabel Supabase / storage
yang dibaca atau ditulis endpoint itu (dari `grep` pemanggilan `.table(...)` per baris kode).

| Metode & path | Auth | Fungsi | Menyentuh |
|---|---|---|---|
| `POST /join-token` | JWT | Membuat token LiveKit untuk `user-{uuid}`, menjadwalkan *dispatch* agent (dengan dedup, 5.6) | LiveKit admin API |
| `POST /verify-voice` | JWT | Satu giliran verifikasi suara (bab 6). Menerima upload audio webm | `speaker_profiles` (baca), `behavior_profiles` (baca/tulis), `voice_verification_logs` (tulis), LiveKit `send_data` (`VOICE_RESULT`) |
| `POST /verify-voice/explain` | JWT | Sama, tetapi mengembalikan jejak lengkap tiap tahap (gelombang, spektrogram, blok ECAPA/wav2vec2, langkah cascade) untuk halaman `/pipeline` | membaca saja |
| `POST /enroll-voice` | JWT | Daftarkan satu sampel suara (maks 3 per pengguna). Menyimpan embedding + PNG spektrogram + profil perilaku awal | `speaker_profiles` (tulis), `behavior_profiles` (tulis), Storage `spectrograms` (tulis) |
| `GET /enrollments` | JWT | Daftar profil suara milik pengguna | `speaker_profiles` |
| `DELETE /enrollments/{id}` | JWT | Hapus satu profil suara berikut profil perilaku dan PNG | `speaker_profiles`, `behavior_profiles`, Storage |
| `PATCH /speakers/{id}/label` | JWT | Ganti label profil (label juga kunci `behavior_profiles`, jadi dua tabel diubah) | `speaker_profiles`, `behavior_profiles` |
| `GET /spectrograms` | JWT | URL bertanda tangan PNG spektrogram tiap profil (halaman `/analysis`) | `speaker_profiles`, Storage |
| `GET /embeddings/visualize`, `POST /embeddings/project` | JWT | Proyeksi PCA embedding untuk halaman `/embeddings` | `speaker_profiles` |
| `GET /verification-metrics` | JWT | Ringkasan log verifikasi suara | `voice_verification_logs` |
| `GET /logs/sessions`, `GET /logs/sessions/{id}` | JWT | Daftar sesi percakapan dan detailnya (pesan + kartu produk + kartu ulasan) | `conversation_sessions`, `conversation_logs`, `product_cards`, `review_cards` |
| `PATCH /conversation-sessions/{id}/label` | JWT | Ubah judul sesi | `conversation_sessions` |
| `DELETE /conversation-sessions/{id}` | JWT | Hapus sesi dan log pesannya | `conversation_sessions`, `conversation_logs` (+ kaskade FK) |
| `POST/GET/DELETE /ecommerce-account` | JWT | Tautkan / baca / lepas akun toko (kata sandi dienkripsi Fernet) | `ecommerce_accounts` |
| `GET /health` | publik | Cek hidup | — |
| `POST /face/enroll-face` | JWT | Daftarkan wajah (tepat satu wajah, 512-D) | `face_profiles` |
| `POST /face/liveness-challenge` | JWT | Mengeluarkan tantangan liveness + token sekali pakai (TTL 25 s) | memori proses |
| `POST /face/verify-face` | JWT | Verifikasi wajah; bila ada `liveness_token`, token dikonsumsi lebih dulu | `face_profiles` (baca), `face_verification_logs` (tulis), LiveKit `send_data` (`FACE_RESULT`) |
| `POST /face/verify-face/explain` | JWT | Versi berjejak untuk halaman `/pipeline` | membaca saja |
| `GET/DELETE /face/enroll-face/{user_id}` | JWT + `user_id` harus sama dengan token | Lihat / hapus profil wajah | `face_profiles` |
| `GET /face/enrolled-users` | **publik** | Daftar `user_id` yang punya profil wajah | `face_profiles` |
| `GET /face/verification-metrics` | JWT | Ringkasan log verifikasi wajah | `face_verification_logs` |
| `GET /face/verification-logs`, `DELETE /face/verification-logs` | **publik** | Baca / **hapus semua** log wajah (lihat T-01) | `face_verification_logs` |
| `GET /face/health` | publik | Cek hidup | — |

Catatan bentuk: audio dikirim sebagai `multipart/form-data`; nama file dari klien tidak dipakai.
Semua kerja berat dijalankan lewat `asyncio.to_thread` agar *event loop* FastAPI tidak terblokir
(bab 13).

---

## 8. Peta data: apa disimpan di mana

### 8.1 Tabel Supabase

Tabel yang **ada migrasinya di repo** (`backend/voiceverification/db/migrations/`):

| Tabel | Kolom penting | Catatan |
|---|---|---|
| `ecommerce_accounts` | `user_id`, `source` (`oren`/`hijau`), `username`, `encrypted_password`, `created_at`, `updated_at`; kunci utama `(user_id, source)` | RLS aktif, hanya kebijakan SELECT milik sendiri. Migrasi 003 mengubah kunci dari `user_id` saja menjadi `(user_id, source)` dan membuang `default 'tau'` |
| `face_profiles` | `user_id` (PK, FK `auth.users`, cascade), `embedding` **jsonb** (512 angka), `created_at`, `updated_at` | Satu wajah per pengguna; di-*upsert* |
| `face_verification_logs` | `id`, `user_id`, `image_filename`, `verified`, `status`, `similarity`, `threshold`, `error_message`, `created_at` | RLS aktif **tanpa kebijakan**, jadi hanya service-role yang bisa baca |
| `review_cards` | `id`, `session_id` (FK `conversation_sessions`, cascade), `product_name`, `reviews` jsonb, `created_at` | RLS: pemilik sesi boleh SELECT |

Tabel yang **dipakai kode tetapi tidak ada migrasinya di repo** (dibuat di luar repo, mungkin lewat
dashboard Supabase; strukturnya hanya bisa disimpulkan dari kode yang menulis/membacanya; lihat T-11):

| Tabel | Kolom yang terlihat dari kode |
|---|---|
| `speaker_profiles` | `id`, `user_id`, `embedding` (192 angka), `label`, `created_at` |
| `behavior_profiles` | `user_id`, `label`, `n_samples`, `mean_pitch`, `var_pitch`, `mean_rate`, `var_rate`, `last_update_ts` (di-*upsert*; diduga kunci `(user_id, label)`) |
| `voice_verification_logs` | `user_id`, `label`, `decision`, `reason`, `speaker_score`, `spoof_prob`, `behavior_score`, `pca_x`, `pca_y`, `all_scores`, `created_at` |
| `conversation_sessions` | `id`, `user_id`, `label`, (diduga `created_at`) |
| `conversation_logs` | `session_id`, `role` (`user`/`assistant`), `content`, (diduga `created_at`) |
| `product_cards` | `session_id`, `products` (JSON daftar produk) |

Embedding disimpan sebagai **daftar angka JSON** (bukan tipe `vector` pgvector), sehingga seluruh
pembandingan dilakukan di Python setelah semua profil pengguna dimuat (aman karena ≤ 3 profil/orang).

### 8.2 Storage dan memori

| Data | Lokasi | Masa hidup |
|---|---|---|
| PNG spektrogram per profil | bucket Supabase Storage `spectrograms` (privat, dibuat otomatis oleh `_ensure_bucket`), jalur per pengguna dan profil | sampai profil dihapus |
| Audio mentah pengguna | `tmp_audio/` di backend | **dihapus setelah diproses** (webm langsung setelah konversi); audio tidak disimpan permanen |
| Tantangan liveness | kamus di memori proses backend | 25 detik, sekali pakai; **hilang bila backend restart** dan **tidak dibagi antar instance** |
| `_recent_dispatches` (dedup agent) | memori proses backend | 15 detik |
| `room_state` (status verifikasi, percobaan, lockout, id sesi) | memori proses agent, satu salinan per ruang | selama sesi; **hilang** saat agent mati |
| Model (ECAPA, wav2vec2, buffalo_l) | memori proses backend | selama proses hidup |

### 8.3 Di browser

`@supabase/supabase-js` menyimpan sesi (JWT + refresh token) di penyimpanan browser. Halaman
`/dashboard` membaca langsung dari Supabase (tanpa lewat backend) tabel `conversation_sessions`,
`conversation_logs`, dan `voice_verification_logs`, serta berlangganan perubahan realtime pada
`voice_verification_logs` (channel `voice-verification-live`). Itu membuat **RLS pada tabel-tabel
tersebut** menjadi satu-satunya penjaga izin untuk jalur itu, dan RLS-nya tidak ada di repo (T-11).

---

## 9. Katalog pesan LiveKit (data channel)

Semua lewat `publish_data` / `send_data` dengan `reliable=True`, isi **JSON UTF-8**, dibedakan oleh
*topic*. Browser menerima semuanya di satu handler (`RoomEvent.DataReceived`, `useLiveKit.ts`) dan
memilah menurut `msg.type`; agent hanya menerima dua topic.

| Topic | `type` / bentuk | Pengirim → penerima | Kapan | Efek |
|---|---|---|---|---|
| `chat` | `AGENT_MESSAGE {text, ts}` | agent → browser | transkrip jawaban agent selesai | gelembung chat; juga disimpan ke `conversation_logs` |
| `chat` | `USER_MESSAGE {text, ts}` | agent → browser | transkrip ucapan user selesai | gelembung chat user (hasil STT Gemini, bukan STT di browser) |
| `chat` | `AGENT_THINKING {active}` | agent → browser | agent masuk status `thinking` ≥ 5 s (`THINKING_INDICATOR_DELAY_SEC`) lalu keluar | indikator "mengetik" |
| `chat` | `AGENT_STUCK` | agent → browser | masih `thinking` setelah 10 s (`STUCK_TIMEOUT_SEC`) | ajakan "coba ulangi" |
| `PRODUCT_DATA` | `PRODUCT_CARDS {products[]}` | agent → browser | hasil `search_product`, setelah jeda 2 s | carousel produk |
| `PRODUCT_DATA` | `REVIEW_CARDS {product_name, reviews[]}` | agent → browser | hasil tool ulasan, setelah jeda 0,5 s | kartu ulasan |
| `VOICE_CMD` | `{type:"VOICE_CMD", action:"START_RECORD"}` | agent → browser | `start_verification()` | browser merekam (VAD) lalu `POST /verify-voice` |
| `FACE_CMD` | `{type:"FACE_CMD", action:"START_FACE_CAPTURE"}` | agent → browser | setelah 3× gagal suara, setelah agent selesai berbicara | membuka modal liveness + kamera |
| `VOICE_RESULT` | `{decision, score, ts}` | **backend → agent** (via LiveKit admin) | akhir `/verify-voice` | agent mengubah `room_state` |
| `FACE_RESULT` | `{decision, similarity, ts}` | **backend → agent** | semua jalur keluar `/face/verify-face` | idem |

Aturan penerimaan di agent: paket `VOICE_RESULT`/`FACE_RESULT` dipakai **hanya bila
`packet.participant is None`**, yaitu dikirim server lewat admin API. Paket dari peserta mana pun
(termasuk browser pengguna sendiri) dicatat sebagai "forged" dan dibuang. Browser sendiri **tidak
memproses** topic `VOICE_RESULT`/`FACE_RESULT`; ia memperbarui UI dari respons HTTP.

Audio **tidak** lewat data channel: mikrofon pengguna dipublikasikan sebagai *track* audio ke ruang
LiveKit, dan suara agent kembali sebagai track audio (bab 5.7).

---

## 10. Mesin status

### 10.1 Sisi agent: `room_state` (satu per ruang)

| Kunci | Awal | Arti |
|---|---|---|
| `is_voice_verified` | `False` | sudah lolos (suara atau wajah) |
| `is_verifying` | `False` | rekaman verifikasi suara sedang berjalan |
| `is_face_verifying` | `False` | verifikasi wajah sedang berjalan |
| `verify_attempts` | `0` | percobaan suara gagal beruntun (maks `MAX_VERIFY_ATTEMPTS = 3`) |
| `voice_status` | `"UNVERIFIED"` | `UNVERIFIED / VERIFIED / DENIED / REPEAT` |
| `last_verified_at` | `None` | cap waktu lolos terakhir; kedaluwarsa setelah 600 s (`REVERIFY_INTERVAL`, dicek malas di `require_voice_verification`) |
| `lockout_until` | `None` | pembekuan percobaan suara (60 s, `LOCKOUT_COOLDOWN_SEC`) |
| `conversation_session_id`, `label_set`, `transcript`, `user_id`, `user_city`, `session_lock` | — | sesi percakapan, pelabelan satu kali, identitas, kota, kunci |

```text
                 start_verification()
 UNVERIFIED ───────────────────────────► (is_verifying=True, kirim VOICE_CMD)
     ▲                                          │ VOICE_RESULT
     │ 600 s kedaluwarsa                         ├─ VERIFIED ─► VERIFIED (attempts=0, last_verified_at=now)
     │                                          ├─ REPEAT   ─► voice_status=REPEAT, attempts+1  (REPEAT ikut dihitung gagal!)
     │                                          └─ DENIED   ─► voice_status=DENIED, attempts+1
     │            attempts ≥ 3  ─► start_face_verification() ─► FACE_CMD
     │                                   FACE_RESULT: VERIFIED → VERIFIED
     │                                                DENIED / timeout → lockout_until = now+60 s
     └──────────── 30 s tanpa hasil (watchdog) ─► is_verifying=False
                   35 s tanpa hasil wajah ─► is_face_verifying=False, lockout 60 s
```

Catatan kebijakan: percobaan ulang pasif dipicu **setiap giliran bicara pengguna** selama belum
terverifikasi dan tidak sedang lockout/verifikasi wajah (baris "VOICE CHECK" di `agent.py`), jadi
pengguna tidak perlu diminta eksplisit. Saat `lockout_until` sudah lewat, `verify_attempts` dan
`lockout_until` direset. **`REPEAT` dihitung sebagai percobaan gagal sama seperti `DENIED`**
(`verify_attempts += 1` di kedua cabang, `agent.py` `_handle_voice_result`), jadi tiga ucapan
yang hanya "kurang yakin" (skor 0,35-0,449, atau ucapan terlalu singkat) sudah cukup memicu
verifikasi wajah (temuan T-07). `lockout_until` **hanya** dipasang saat verifikasi wajah juga gagal
atau kedaluwarsa; kegagalan suara saja tidak membekukan apa pun.

### 10.2 Sisi browser: `UiState`

`IDLE → CONNECTING → CHATTING` saat sesi dimulai (`RoomEvent.Connected`); dari `CHATTING`:

```text
 CHATTING ──VOICE_CMD──► LISTENING ──(bicara cukup lama)──► RECORDING ──► VERIFYING ──► CHATTING
 CHATTING ──FACE_CMD───► FACE_VERIFYING ───────────────────────────────────────────► CHATTING
 (apa pun) ──Disconnected / tombol stop / error──► IDLE
```

`LISTENING` menunggu pengguna berbicara; `RECORDING` mengumpulkan ucapan (minimal 3 detik bicara
`MIN_SPEECH_MS = 3000`, maksimal 15 detik `MAX_RECORD_MS = 15000`); `VERIFYING` menunggu respons
`/verify-voice`. Hasil dilaporkan ke UI lewat `try/finally`, jadi kegagalan jaringan tetap
mengembalikan status ke `CHATTING`.

---

## 11. Peta frontend

| Halaman | Berkas | Dipakai untuk | Data dari |
|---|---|---|---|
| `/` | `app/page.tsx` | Aplikasi utama: sidebar, sesi suara, chat, kartu produk, enrollment | hook `useLiveKit`, backend, Supabase Auth |
| `/login`, `/signup` | `app/login`, `app/signup` | Masuk / daftar | Supabase Auth |
| `/dashboard` | `app/dashboard/page.tsx` (1361 baris) | Analitik pengguna: sesi, pesan, metrik verifikasi; realtime | Supabase **langsung** + backend |
| `/history/[id]` | `app/history/[id]` | Detail satu sesi | `GET /logs/sessions/{id}` |
| `/pipeline` | `app/pipeline/page.tsx` | Penjelasan interaktif pipeline verifikasi (suara + wajah) | `/verify-voice/explain`, `/face/verify-face/explain` |
| `/agent-pipeline` | `app/agent-pipeline/page.tsx` | Penjelasan alur tool agent | data statis/trace |
| `/embeddings` | `app/embeddings/page.tsx` | Visualisasi PCA embedding | `/embeddings/*` |
| `/analysis` | `app/analysis/page.tsx` | Spektrogram per profil (tersembunyi: tidak ada tombol, ketik URL manual) | `/spectrograms` |

Komponen kunci: `LiveKitControls` (tombol sesi), `VoiceEnrollment` / `FaceEnrollment` /
`FaceLivenessCapture` / `FaceVerification` (alur biometrik; liveness memakai MediaPipe dari CDN),
`ProductCarousel` / `ProductCards` / `ReviewCards` (render `PRODUCT_DATA`), `ChatArea` /
`MessageBubble` / `TypingIndicator` (render `chat`), `EcommerceAccountLink` (tautan toko),
`VerificationMetrics` / `FaceVerificationMetrics` (grafik). `lib/supabase.ts` membuat satu klien
dari `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 12. Latensi: dari mana datangnya waktu tunggu

Yang dirasakan pengguna adalah **jarak absolut antara berhenti bicara dan suara agent mulai**.

| Komponen | Nilai | Status |
|---|---|---|
| Jaringan media browser ↔ LiveKit Cloud (RTT) | ~115 ms | [DIJALANKAN] |
| Searah masuk (ucapan → agent) | 217-284 ms | [DIJALANKAN] |
| Deteksi akhir ucapan oleh VAD Gemini | `VAD_SILENCE_MS = 350` ms | [KODE] (nilai di `dev`) |
| Waktu ke token pertama Gemini (*ttft*) | **belum diukur** | — |
| Jeda tool `search_product` | jaringan ke toko + 2 s jeda sebelum kartu dikirim | [KODE] |
| Verifikasi suara (berjalan **paralel** dengan percakapan, bukan di jalur balasan) | ffmpeg ~30 ms + ECAPA + wav2vec2 di CPU | [DIJALANKAN] sebagian |

Pemindahan wilayah LiveKit ke Singapura saya perkirakan hanya menghemat sekitar 170 ms per giliran
setelah RTT diukur (perkiraan awal 340 ms ternyata terlalu besar). Rinciannya ada di percakapan, bukan
di dokumen ini; dokumen ini hanya mencatat komponennya.

---

## 13. Konkurensi dan batas skala

| Aspek | Perilaku | Dampak |
|---|---|---|
| Agent | Satu **proses OS per ruang** (executor `PROCESS`) | Isolasi baik; memori besar per sesi |
| Backend | Satu proses uvicorn; `to_thread` untuk kerja berat | Model ML dibagi antar permintaan; beban CPU bisa saling menunda |
| Dedup dispatch | `_recent_dispatches` + `asyncio.Lock` di memori | Benar hanya untuk **satu instance** backend |
| Tantangan liveness | memori proses | Tidak bisa diskalakan ke >1 instance tanpa penyimpanan bersama |
| `room_state` | memori proses agent | Hilang saat agent restart; sesi tidak dapat dilanjutkan |
| Penulisan log percakapan | `conversation_lock` di agent | Urutan pesan di DB dijaga |
| Gemini | sesi WebSocket tunggal per ruang | Bila macet, hanya ada `AGENT_STUCK` (pemberitahuan), bukan sambung ulang oleh kode kita |

---

## 14. Temuan: hal yang perlu kamu ketahui (diurutkan menurut dampak)

Ini bukan daftar "kesalahan"; ini hal yang saya temukan saat membaca dan menjalankan kode, yang
sebaiknya kamu tahu **sebelum dosen atau penguji menanyakannya**. Label: **[DIJALANKAN]** terbukti
dengan eksekusi, **[KODE]** dari pembacaan kode.

| ID | Dampak | Temuan | Bukti |
|---|---|---|---|
| T-01 | Tinggi | `GET /face/enrolled-users`, `GET /face/verification-logs` dan **`DELETE /face/verification-logs`** tanpa autentikasi. Siapa pun yang bisa menjangkau backend dapat membaca daftar `user_id` yang punya profil wajah, membaca log, dan **menghapus semua log wajah**. | [KODE] 4.4 |
| T-02 | Sedang | Pengguna yang belum enroll suara: `/verify-voice` membalas HTTP 200 `status: "ERROR"` **tanpa** `VOICE_RESULT`. Agent baru bebas dari `is_verifying` setelah watchdog 30 s, dan hasilnya tidak masuk hitungan percobaan. | [KODE] 5.8 |
| T-03 | Tinggi (konsep) | Liveness wajah dinilai **di browser**. Server tidak bisa memastikan gerakan benar-benar terjadi; klien yang dimodifikasi dapat mengirim foto statis. | [KODE] 5.9 |
| T-04 | Tinggi (konsep) | `liveness_token` **opsional** di `/face/verify-face`: tanpa token, pemeriksaan liveness dilewati namun `FACE_RESULT` tetap dikirim ke agent. Jadi jalur "tanpa liveness" membuka gerbang yang sama. Komentar kode menyebut ini sengaja untuk tombol uji; tombol uji dan jalur produksi memakai endpoint yang sama. | [KODE] 5.9 |
| T-05 | Sedang | Gerbang perilaku **tidak pernah aktif**: profil dibuat enrollment dengan `n_samples = 1`; `should_update` menolak `n` di antara 1 dan 4, sehingga `n` tidak pernah naik; gerbang butuh `n ≥ 5`. Pada `n = 1`, `std = 1e-6` membuat skor perilaku nyaris 0,5 untuk pitch sama persis (dan ≈ 0 untuk selisih apa pun), jadi seandainya aktif pun sinyalnya rapuh. | [DIJALANKAN] 6.5 |
| T-06 | Sedang | Jika `n` mencapai 0 atau ≥ 5, `should_update` melempar `TypeError` karena `last_update_ts` berupa `datetime` sedangkan fungsi mengurangkannya dari `time()` (float). Tes unit tidak menangkapnya karena memakai float. | [DIJALANKAN] 6.5 |
| T-07 | Tinggi (UX) | `REPEAT` dihitung sebagai percobaan gagal. Tiga ucapan yang "kurang yakin" (skor 0,35-0,449, ucapan singkat, atau replay-warn) memicu verifikasi wajah, walau pemilik suara sah. Ini penjelasan terbaik mengapa pengguna sah sering terdorong ke fallback wajah. | [KODE] 10.1 |
| T-08 | Rendah | Cabang `"Speaker verification failed"` di `decide()` tidak pernah tercapai (`abs_min 0,35 > voice_repeat 0,30`); `voice_repeat` tidak berpengaruh; `combined_accept/combined_repeat` tidak dipakai di mana pun; docstring tes menyatakan "Uncertain verification" tak terjangkau padahal terjangkau untuk skor 0,35-0,449. | [DIJALANKAN] 6.6 |
| T-09 | Sedang | Halaman `/dashboard` membaca Supabase dari browser **tanpa filter `user_id`**. Isolasi data bergantung sepenuhnya pada RLS di Supabase, yang tidak ada di repo. | [KODE] 5.12, 8.3 |
| T-10 | Rendah | Grafik "latensi" di `/dashboard` bukan latensi audio dan punya cacat urutan; jangan dipakai sebagai klaim performa. | [KODE] 5.12 |
| T-11 | Sedang | Enam tabel inti (`speaker_profiles`, `behavior_profiles`, `voice_verification_logs`, `conversation_sessions`, `conversation_logs`, `product_cards`) **tidak punya migrasi di repo**, begitu pula kebijakan RLS-nya. Menyiapkan database baru dari repo saja tidak mungkin. | [KODE] 8.1 |
| T-12 | Rendah | Klaim akurasi anti-spoof saling bertentangan: EER ~15% (komentar `asvspoof.py`), EER ~0 (`decision_engine.py`), ≈9% dan AUC 0,883 pada evaluasi saya (37 berkas). Dokumen `ARSITEKTUR_HAPPY_SAAT_INI.md` melaporkan EER suara 3,33% (30 rekaman per kondisi, sweep skor speaker). Angka-angka itu menjawab pertanyaan yang berbeda; sebutkan mana yang kamu pakai. | [DIJALANKAN] 6.3 |
| T-13 | Rendah | Model ECAPA dimuat dari path relatif `pretrained_models/...` terhadap *current working directory*; menjalankan dari folder lain mengunduh ulang atau gagal. | [KODE] 6.2 |
| T-14 | Rendah | Tes unit hanya lulus bila dijalankan dari dalam `backend/voiceverification` (import `core`). Dari `backend/`, pengumpulan tes gagal (`No module named 'core'`). | [DIJALANKAN] |
| T-15 | Sedang | Anti-spoof **gagal-terbuka**: audio tak terbaca / terlalu pendek / senyap menghasilkan `fake_prob = 0` ("asli"). Selain itu keluarannya nyaris biner dan pada kanal browser+LiveKit sering menandai suara asli sebagai palsu, itu sebabnya `replay_deny` hanya `REPEAT` sekarang. Praktisnya, anti-spoof lebih berupa lapisan tambahan daripada pertahanan utama. | [KODE]+[DIJALANKAN] 6.3 |
| T-16 | Rendah | Docstring `compare_embeddings` menulis "0 to 1"; cosine sebenarnya −1..1. Komentar `abs_min_speaker` serupa menyiratkan skor non-negatif. | [KODE] 6.2 |

**Urutan pembahasan yang saya sarankan jika kamu ditanya "seberapa aman":** T-03/T-04 (liveness
bukan jaminan server), T-15 (anti-spoof bukan pertahanan utama), T-01 (endpoint wajah publik, ini
sebaiknya ditutup), lalu T-07 (penjelasan atas penolakan berulang pengguna sah).

---

## 15. Dokumentasi lama di repo yang sudah tidak cocok dengan kode

| Dokumen | Klaim | Kenyataan di `e09c00b` |
|---|---|---|
| `README.md` (akar) | `face_recognition/` adalah "aplikasi FastAPI terpisah (port lain)... belum terhubung ke alur voice verification/agent" | Router `/face` yang di-mount ke aplikasi backend yang sama (satu proses, satu port), dan **sudah** terhubung ke agent lewat `FACE_CMD`/`FACE_RESULT` (5.9). `docs/ARSITEKTUR_HAPPY_SAAT_INI.md` sendiri sudah menandai klaim "port terpisah" sebagai tidak berlaku. |
| `backend/README.md` | Daftar endpoint, perintah `uvicorn voiceverification.server:app --port 8000` | Perintah benar dan penjelasan router `/face` (satu proses, satu port) benar. Daftar endpoint memang "ringkas": tidak memuat `/face/liveness-challenge`, endpoint `/explain`, `/spectrograms`, `/embeddings/*`, dan metrik (lengkapnya di bab 7). Tidak salah, hanya tidak lengkap. |
| Komentar `test_*` | "Uncertain verification tak terjangkau" | Terjangkau (T-08). |
| Docstring/komentar skor | Cosine 0..1 | −1..1 (T-16). |

Dokumen lain (`docs/EXPO_VOICE_PIPELINE_PLAN.md`, `docs/ISI_X_BANNER_HAPPY_CAPSTONE.md`,
`Rancangan_Happy_Capstone_Expo.md`) adalah rencana/materi presentasi, **bukan** deskripsi kode, dan
tidak saya periksa baris per baris terhadap kode.

---

## 16. Glosarium

| Istilah | Arti dalam proyek ini |
|---|---|
| **ECAPA-TDNN** | Jaringan saraf pengenal penutur; mengubah ucapan jadi vektor 192 angka |
| **Embedding** | Vektor angka berukuran tetap yang mewakili suara (192-D) atau wajah (512-D) |
| **Cosine similarity** | Kesamaan arah dua vektor; pada vektor panjang 1 sama dengan dot product |
| **Fbank / mel** | Fitur frekuensi bergaya telinga manusia (80 pita) |
| **Anti-spoof / replay** | Deteksi rekaman/suara sintetis; di sini wav2vec2 |
| **VAD** | *Voice Activity Detection*: deteksi mulai/berhenti bicara |
| **SFU** | Server yang meneruskan audio/video antar peserta (LiveKit) |
| **Dispatch** | Perintah LiveKit agar worker agent masuk ke sebuah ruang |
| **Data channel** | Jalur pesan JSON di dalam ruang LiveKit, terpisah dari audio |
| **RLS** | *Row Level Security*: aturan Postgres/Supabase tentang baris mana yang boleh dibaca siapa |
| **JWT** | Token masuk dari Supabase Auth |
| **Service-role** | Kunci Supabase yang melewati RLS; hanya di server |
| **Fernet** | Enkripsi simetris yang dipakai untuk kata sandi toko |
| **Welford** | Algoritma rata-rata/varians berjalan satu lintasan |
| **EER** | *Equal Error Rate*: titik FAR = FRR |
| **FAR / FRR** | Salah-terima / salah-tolak |
| **REPEAT** | Hasil ketiga verifikasi: "ulangi", bukan lolos dan bukan ditolak |

---

## Lampiran A. Jejak nyata satu giliran verifikasi [DIJALANKAN]

Skrip: `real_trace.py` (di folder scratchpad sesi, bukan di repo). Kode: snapshot `dev` `e09c00b`.
Audio: suara sintetis macOS (`say -v Damayanti`), di-*encode* ke webm/opus 32 kbps seperti yang
dikirim browser. Mesin: Mac, CPU. Waktu = satu jalan, **bukan rata-rata**.

```text
webm: enroll 51.284 byte | live 23.236 byte
ffmpeg webm->wav 16k mono        33 ms / 30 ms        (enroll 12,96 s / live 5,71 s)
normalize_audio                  909 ms (cold) / 1 ms  RMS 0,1821→0,1000 / 0,1808→0,1000
muat ECAPA-TDNN                  1346 ms
muat wav2vec2 (warm_up)          1616 ms
ECAPA, klip enrollment           710 ms (panggilan pertama, termasuk pemanasan)
ECAPA, klip uji (+hook)           47 ms
wav2vec2 anti-spoof (+hook)      305 ms
trim durasi + YIN                  6 ms

embedding: (192,), norma 1,000000
cosine(uji, enrollment) = 0,9413
fake_prob = 0,000040  real_prob = 0,999960
speech_sec = 5,57 | pitch YIN = 210,5 Hz | rate = 5,71 s

cascade:
  abs_min_speaker  lolos | 0,941 ≥ 0,35
  replay_deny      lolos | 0,00004 < 0,85
  replay_warn      lolos | 0,00004 < 0,5
  voice_accept     lolos | 0,941 ≥ 0,45
  behavior_gate    lolos | dilewati (profil belum cukup)
→ VERIFIED "Speaker verified successfully"
```

Total kerja model per verifikasi pada jalan hangat ≈ 47 + 305 + 6 + 30 (ffmpeg) ≈ **0,4 detik** di
CPU Mac ini; waktu di server produksi tergantung CPU-nya dan **belum saya ukur**.

## Lampiran B. Evaluasi anti-spoof (ringkas)

Data: 37 berkas dataset lama yang saya pulihkan dari riwayat git (13 genuine, 13 impostor, 11
spoof). Model: `MelodyMachine/Deepfake-audio-detection-V2`, ambang 0,5.

| Kelompok | Hasil |
|---|---|
| Genuine | 13/13 diloloskan |
| Impostor (suara asli orang lain) | 12/13 diloloskan (anti-spoof tidak dirancang membedakan orang) |
| Spoof | 9/11 tertangkap |
| AUC / EER | 0,883 / ≈ 9% |

Peringatan: sampel sangat kecil dan bukan kanal produksi (browser + LiveKit + AEC/NS/AGC). Pada
kanal produksi, catatan investigasi di `decision_engine.py` melaporkan suara asli sering mendapat
`fake_prob ≥ 0,95`.

---

*Akhir dokumen. Dokumen ini belum di-commit; berkas ada di `docs/` sebagai berkas baru.*
