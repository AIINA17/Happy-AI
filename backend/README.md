# Backend — Voice Verification & Face Recognition Services

Backend ini terdiri dari **tiga proses Python terpisah** yang harus dijalankan sendiri-sendiri:
`voiceverification` (FastAPI, verifikasi suara + logic bisnis utama), `agent` (LiveKit Agent worker,
otak percakapan), dan `face_recognition` (FastAPI, verifikasi wajah — berdiri sendiri, belum
terhubung ke dua yang lain).

## Struktur

- `voiceverification/server.py` — aplikasi FastAPI utama (endpoint join-token, verify-voice,
  enroll-voice, logs, sessions, ecommerce-account)
- `voiceverification/core/` — core logic biometrik (anti-spoofing, decision engine, behavior profile, dll.)
- `voiceverification/models/` — wrapper model speaker verification (SpeechBrain ECAPA)
- `voiceverification/services/` — service layer untuk verifikasi biometrik dan kalibrasi
- `voiceverification/db/` — akses Supabase (speaker_repo, behavior_repo, conversation_logs,
  conversation_sessions, ecommerce_repo)
- `voiceverification/utils/` — utilitas audio dan analitik
- `agent/` — LiveKit Agent (LLM tools, dispatch, dsb.) — **sibling** dari `voiceverification/`,
  bukan di dalamnya. Bukan aplikasi HTTP, jadi tidak dijalankan lewat uvicorn — lihat bagian
  "Menjalankan Agent" di bawah.
- `face_recognition/` — aplikasi FastAPI terpisah untuk enrollment & verifikasi wajah
  (ArcFace via InsightFace). Sibling juga dari `voiceverification/` dan `agent/`.

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

Backend (`voiceverification`) akan tersedia di http://localhost:8000.

`face_recognition` belum ada di `docker-compose.yml` — jalankan manual (lihat bagian di bawah)
kalau butuh service ini juga.

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

### Menjalankan face_recognition (FastAPI, terpisah)

```bash
uvicorn face_recognition.main:app --host 0.0.0.0 --port 8001 --reload
```

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

**`face_recognition` (port 8001)**

- `POST /enroll-face` — enroll wajah user
- `POST /verify-face` — verifikasi wajah
- `GET /enrolled-users` — daftar user yang sudah enroll wajah
- `DELETE /enroll-face/{user_id}` — hapus enrollment wajah
- `GET /verification-logs`, `DELETE /verification-logs` — log verifikasi wajah

Untuk detail lengkap, lihat `face_recognition/main.py`.
