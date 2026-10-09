# Backend — Voice Verification & Face Recognition Services

Backend ini terdiri dari **dua proses Python terpisah** yang harus dijalankan sendiri-sendiri:
`voiceverification` (FastAPI, verifikasi suara + face recognition + logic bisnis utama) dan
`agent` (LiveKit Agent worker, otak percakapan).

`face_recognition` (verifikasi wajah, ArcFace via InsightFace) bukan proses/app FastAPI
terpisah lagi — sekarang di-mount sebagai `APIRouter` (prefix `/face`) ke dalam app
`voiceverification/server.py`, jadi jalan satu proses/container yang sama dengan voice
verification. Belum dipanggil dari `agent/` (alur verifikasi agent masih voice-only);
menghubungkannya ke alur verifikasi agent adalah langkah lanjutan yang belum dikerjakan.

## Struktur

- `voiceverification/server.py` — aplikasi FastAPI utama (endpoint join-token, verify-voice,
  enroll-voice, logs, sessions, ecommerce-account, dan `/face/*` lewat `include_router`)
- `voiceverification/core/` — core logic biometrik (anti-spoofing, decision engine, behavior profile, dll.)
- `voiceverification/models/` — wrapper model speaker verification (SpeechBrain ECAPA)
- `voiceverification/services/` — service layer untuk verifikasi biometrik dan kalibrasi
- `voiceverification/db/` — akses Supabase (speaker_repo, behavior_repo, conversation_logs,
  conversation_sessions, ecommerce_repo, face_repo, face_verification_logs)
- `voiceverification/utils/` — utilitas audio dan analitik
- `agent/` — LiveKit Agent (LLM tools, dispatch, dsb.) — **sibling** dari `voiceverification/`,
  bukan di dalamnya. Bukan aplikasi HTTP, jadi tidak dijalankan lewat uvicorn — lihat bagian
  "Menjalankan Agent" di bawah.
- `face_recognition/` — `APIRouter` untuk enrollment & verifikasi wajah (ArcFace via
  InsightFace), di-mount ke `voiceverification/server.py` dengan prefix `/face`. Sibling juga
  dari `voiceverification/` dan `agent/`, tapi bukan app FastAPI sendiri lagi — `main.py` di
  sini cuma mendefinisikan `router`, tidak ada `app` / entrypoint uvicorn sendiri. Datanya
  (embedding + log verifikasi) disimpan di Supabase lewat `voiceverification/db/face_repo.py`
  dan `face_verification_logs.py`, bukan file JSON lokal lagi — lihat
  `voiceverification/db/migrations/002_face_profiles.sql`.

Ketiganya (`voiceverification`, `agent`, `face_recognition`) adalah package Python yang
diimport pakai path lengkap (`voiceverification.xxx`, `agent.xxx`, `face_recognition.xxx`) —
semuanya dijalankan dari cwd `backend/`, bukan dari dalam masing-masing folder.

## ENV Requirement

- Python 3.10
- ffmpeg, libsndfile1 (sudah di-handle oleh Dockerfile untuk `voiceverification`/`agent`)
- Akses ke Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
- Konfigurasi LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
- `ECOMMERCE_CRED_ENCRYPTION_KEY` — key Fernet untuk enkripsi kredensial e-commerce yang
  disimpan tiap user (lihat `voiceverification/utils/crypto.py`). Kalau key ini hilang/diganti,
  semua kredensial e-commerce yang sudah tersimpan jadi tidak bisa didekripsi lagi.

## Menjalankan dengan Docker (direkomendasikan untuk voiceverification + agent)

Dari root project:

```bash
docker-compose up --build backend agent
```

Backend (`voiceverification`, termasuk `/face/*`) akan tersedia di http://localhost:8000.

## Menjalankan Secara Lokal (tanpa Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt   # atau requirements.lock.txt untuk versi yang persis tervalidasi

# Set environment variables (bisa pakai .env)
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export LIVEKIT_URL=...
export LIVEKIT_API_KEY=...
export LIVEKIT_API_SECRET=...
export ECOMMERCE_CRED_ENCRYPTION_KEY=...
```

### Menjalankan voiceverification (FastAPI)

```bash
uvicorn voiceverification.server:app --host 0.0.0.0 --port 8000 --reload
```

### Menjalankan Agent (LiveKit worker)

```bash
python -m agent.agent start
```

Bukan aplikasi HTTP — ini worker yang connect ke LiveKit Cloud lalu menunggu job dispatch dari
sana, dijalankan lewat CLI `livekit-agents` (`cli.run_app`), bukan uvicorn. Lihat penjelasan
lebih lengkap soal ini di riwayat percakapan/diskusi proyek kalau lupa kenapa.

Tidak ada langkah terpisah untuk `face_recognition` — routernya sudah ikut ter-mount begitu
`voiceverification.server:app` dijalankan (lihat perintah di atas).

## Endpoint Utama (ringkas)

**`voiceverification` (port 8000)**

- `POST /join-token` — generate token LiveKit + dispatch agent
- `POST /verify-voice` — verifikasi suara (upload audio) dan hitung skor
- `POST /enroll-voice` — enroll suara user
- `GET /logs/sessions` — daftar sesi percakapan
- `GET /logs/sessions/{session_id}` — log pesan + product cards per sesi
- `GET /enrollments`, `DELETE /enrollments/{id}`, `PATCH /speakers/{id}/label` — kelola profil suara
- `POST/GET/DELETE /ecommerce-account` — link/cek/putus akun e-commerce milik user

Untuk detail lengkap, lihat definisi router di `voiceverification/server.py`.

**`face_recognition` (prefix `/face`, proses & port sama dengan `voiceverification`)**

- `POST /face/enroll-face` — enroll wajah user
- `POST /face/verify-face` — verifikasi wajah
- `GET /face/enrolled-users` — daftar user yang sudah enroll wajah
- `DELETE /face/enroll-face/{user_id}` — hapus enrollment wajah
- `GET /face/verification-logs`, `DELETE /face/verification-logs` — log verifikasi wajah

Untuk detail lengkap, lihat `face_recognition/main.py`.

> **Setup wajib sebelum endpoint `/face/*` bisa dipakai**: jalankan
> `voiceverification/db/migrations/002_face_profiles.sql` sekali di Supabase SQL Editor (bikin
> tabel `face_profiles` & `face_verification_logs`). Tanpa ini, `/face/enroll-face` dkk akan
> error "relation does not exist". Data lama yang sempat ke-enroll lewat file JSON lokal
> (`face_recognition/data/face_embeddings.json`) **tidak otomatis pindah** — `user_id` di file
> itu bukan UUID Supabase asli (misal enrollment test lama pakai `"izz"`, `"jq"` sebagai
> user_id), jadi tidak bisa dimasukkan ke kolom `uuid references auth.users(id)`. User perlu
> enroll ulang lewat aplikasi (yang mengirim `userId` Supabase asli) setelah migrasi ini jalan.
> File JSON lama dibiarkan ada di disk (tidak lagi dibaca kode) kalau mau dicek manual, boleh
> dihapus kapan saja.

> Catatan: endpoint `/face/*` ini masih pakai `user_id` sebagai form field biasa (tidak lewat
> `get_user_id_from_request`/JWT Supabase seperti endpoint voice) — perilaku ini dipertahankan
> sama seperti sebelum digabung, belum diseragamkan. Model ArcFace (`insightface` buffalo_l)
> juga sekarang ikut ter-load saat `voiceverification.server` start (nambah cold-start/memori
> proses `backend`), karena sebelumnya cuma nyala waktu `face_recognition` dijalankan manual.

### (Opsional) CUDA untuk face recognition di dev lokal

`face_recognition/arcface_model.py` otomatis pakai GPU (`CUDAExecutionProvider`) kalau
tersedia, fallback ke CPU kalau tidak — tidak perlu ubah kode apa pun. `onnxruntime` di sini
butuh runtime CUDA 12.x (`libcublasLt.so.12`, dst), yang berbeda dari CUDA yang dibawa `torch`
untuk voice verification (biasanya CUDA 13.x lewat paket `nvidia-*-cu13`) — jadi walau
`torch.cuda.is_available()` `True`, `onnxruntime` bisa saja masih fallback ke CPU kalau lib
CUDA 12 belum ada.

Paket ini **sengaja tidak** dimasukkan ke `requirements.txt`/`requirements.lock.txt` — cuma
kebutuhan mesin dev yang punya GPU, bukan dependency wajib (Dockerfile produksi belum setup GPU
passthrough sama sekali). Kalau mau enable di mesin dev kamu sendiri:

```bash
uv pip install --python .venv/bin/python \
  nvidia-cublas-cu12 nvidia-cudnn-cu12 nvidia-curand-cu12 \
  nvidia-cufft-cu12 nvidia-cuda-runtime-cu12
# (ganti `uv pip install --python .venv/bin/python` dengan `pip install` kalau venv-nya bukan
# buatan `uv`)
```

Setelah terpasang, `ArcFaceModel` otomatis mendeteksi dan memuatnya sendiri (lihat
`_preload_cuda_libs()` di `arcface_model.py`) — tidak perlu set `LD_LIBRARY_PATH` manual.
