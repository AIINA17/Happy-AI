# Backend — Voice Verification Service

Backend ini adalah layanan FastAPI untuk verifikasi suara, anti-spoofing, dan manajemen sesi percakapan, dengan integrasi LiveKit Agent.

## Struktur

- `voiceverification/server.py` — aplikasi FastAPI utama (endpoint join-token, verify-voice, enroll-voice, logs, sessions)
- `voiceverification/agent/` — LiveKit Agent (LLM tools, dispatch, dsb.)
- `voiceverification/core/` — core logic biometrik (ASVspoof, decision engine, behavior profile, dll.)
- `voiceverification/models/` — wrapper model speaker verification (SpeechBrain ECAPA)
- `voiceverification/services/` — service layer untuk verifikasi biometrik dan kalibrasi
- `voiceverification/db/` — akses Supabase (speaker_repo, behavior_repo, conversation_logs, conversation_sessions)
- `voiceverification/utils/` — utilitas audio dan analitik

## ENV Requirement

- Python 3.10
- ffmpeg, libsndfile1 (sudah di-handle oleh Dockerfile)
- Akses ke Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
- Konfigurasi LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)

## Menjalankan dengan Docker (direkomendasikan)

Dari root project:

```bash
cd HAPPY-AI
docker-compose up --build backend agent
```

Backend akan tersedia di http://localhost:8000.

## Menjalankan Secara Lokal (tanpa Docker)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Set environment variables (bisa pakai .env)
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export LIVEKIT_URL=...
export LIVEKIT_API_KEY=...
export LIVEKIT_API_SECRET=...

cd voiceverification
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

## Endpoint Utama (ringkas)

- `POST /join-token` — generate token LiveKit + dispatch agent
- `POST /verify-voice` — verifikasi suara (upload audio) dan hitung skor
- `POST /enroll-voice` — enroll suara user
- `GET /logs/sessions` — daftar sesi percakapan
- `GET /logs/sessions/{session_id}` — log pesan + product cards per sesi

Untuk detail lengkap, lihat definisi router di `voiceverification/server.py`.
