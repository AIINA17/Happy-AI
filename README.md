# Voice Verification & Voice Shopping Assistant

Proyek ini adalah sistem end‑to‑end untuk verifikasi suara dan voice shopping assistant.
Backend melakukan verifikasi biometrik (siapa yang berbicara) dan proteksi anti‑spoofing,
sementara frontend menyediakan pengalaman belanja dengan suara (conversational commerce)
berbasis web.

## Gambaran Umum

Sistem dirancang untuk skenario di mana pengguna:

1. **Enroll suara** terlebih dulu (merekam beberapa kalimat referensi).
2. **Melakukan verifikasi** setiap kali akan mengakses fitur sensitif (misalnya transaksi).
3. **Berinteraksi dengan asisten belanja** melalui suara (terhubung ke LiveKit + LLM agent).
4. **Melihat riwayat percakapan dan rekomendasi produk** di halaman history.

Fokus utama proyek:

- Autentikasi berbasis suara yang kuat (speaker verification).
- Deteksi spoofing / pemalsuan suara (contoh: playback, deepfake).
- Pengelolaan profil perilaku dan sesi percakapan untuk analitik risiko.
- Antarmuka web modern untuk login/signup, chat, dan riwayat percakapan.

## Arsitektur 

Monorepo ini terdiri dari dua bagian besar:

- **Backend (`backend/`)**
    - Aplikasi **FastAPI** di `voiceverification/server.py`.
    - Endpoint untuk join token LiveKit, verifikasi suara, enrollment, log percakapan, dan sesi.
    - Integrasi **LiveKit Agent** di `agent/` (sibling dari `voiceverification/`) sebagai otak percakapan (LLM + tools).
    - Modul biometrik di `voiceverification/core/` dan `voiceverification/services/`:
        - Speaker verification (model ECAPA‑TDNN via SpeechBrain).
        - ASVspoof / anti‑spoofing.
        - Behavior profiling & decision engine untuk menggabungkan beberapa sinyal risiko.
    - Penyimpanan data di **Supabase** melalui layer `voiceverification/db/`.

- **Frontend (`frontend/web/`)**
    - Aplikasi **Next.js (App Router)** untuk UI voice shopping assistant.
    - Autentikasi email/password via **Supabase**.
    - Komponen UI utama:
        - Sidebar: daftar sesi percakapan, kontrol enrollment suara.
        - ChatArea: tampilan chat/voice + rekomendasi produk.
        - VoiceEnrollment: alur perekaman dan penyimpanan voice print.
    - Integrasi **LiveKit client** lewat hook `useLiveKit` untuk:
        - Join room audio.
        - Merekam dan mengirim sampel suara ke backend untuk verifikasi.
        - Menerima respons agent dan kartu produk.

## Alur Utama Sistem

1. **Registrasi & Login**
    - Pengguna mendaftar dengan email/password (Supabase Auth).
    - Setelah login, token Supabase digunakan untuk mengakses API backend.

2. **Enrollment Suara**
    - Di Sidebar, pengguna memilih menu enrollment.
    - Komponen `VoiceEnrollment` memandu pengguna membaca teks tertentu.
    - Audio dikirim ke endpoint `/enroll-voice`, disimpan sebagai embedding suara.

3. **Verifikasi Suara**
    - Saat sesi voice dimulai, **LiveKit Agent** meminta pengguna berbicara.
    - Audio direkam (via `useLiveKit`) dan dikirim ke `/verify-voice`.
    - Backend menghitung skor kemiripan, mengecek spoofing, dan memutuskan hasil (VERIFIED/REPEAT/DENIED).
    - Hasil ditampilkan di frontend melalui `VerificationToast` dan komponen status.

4. **Percakapan & Rekomendasi Produk**
    - Agent mendengarkan suara pengguna dan mengubahnya menjadi pesan teks.
    - LLM + tools di backend mengakses katalog produk dummy dan mengirim kartu produk ke frontend.
    - Chat (pesan dan produk) disimpan sebagai log sesi percakapan di Supabase.

5. **Riwayat Percakapan**
    - Pengguna dapat membuka halaman history dan memilih sesi tertentu.
    - Frontend memuat log percakapan dan rekomendasi produk dari backend dan menampilkannya dalam mode read‑only.

## Ringkasan Teknologi

- **Backend**: Python, FastAPI, uvicorn, SpeechBrain, ASVspoof pipeline, LiveKit Agent, Supabase Python client.
- **Frontend**: Next.js 16 (App Router), React, TypeScript, Tailwind CSS, Supabase JS, LiveKit client.
- **Infra**: Docker & docker-compose untuk orkestrasi `backend`, `agent`, dan `frontend`.

## Detail Lebih Lanjut

- Cara menjalankan backend dan penjelasan modul lebih detail ada di `backend/README.md`.
- Cara menjalankan frontend dan struktur UI ada di `frontend/README.md`.
