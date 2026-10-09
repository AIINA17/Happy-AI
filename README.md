# Voice Verification & Voice Shopping Assistant

Proyek ini adalah sistem end‑to‑end untuk verifikasi biometrik (suara, dan secara terpisah wajah)
dan voice shopping assistant. Backend melakukan verifikasi biometrik (siapa yang berbicara) dan
proteksi anti‑spoofing, sementara frontend menyediakan pengalaman belanja dengan suara
(conversational commerce) berbasis web.

## Gambaran Umum

Sistem dirancang untuk skenario di mana pengguna:

1. **Enroll suara** (dan opsional wajah) terlebih dulu (merekam beberapa kalimat referensi / foto wajah).
2. **Melakukan verifikasi** setiap kali akan mengakses fitur sensitif (misalnya transaksi).
3. **Berinteraksi dengan asisten belanja** melalui suara (terhubung ke LiveKit + LLM agent).
4. **Menghubungkan akun e-commerce miliknya sendiri**, supaya agent belanja atas nama akun itu — bukan akun bersama.
5. **Melihat riwayat percakapan dan rekomendasi produk** di halaman history.

Fokus utama proyek:

- Autentikasi berbasis suara yang kuat (speaker verification).
- Deteksi spoofing / pemalsuan suara (model deepfake/replay detector pretrained).
- Verifikasi wajah sebagai jalur biometrik tambahan (ArcFace/InsightFace, terpisah dari alur suara).
- Pengelolaan profil perilaku dan sesi percakapan untuk analitik risiko.
- Antarmuka web modern (Next.js + shadcn/ui) untuk login/signup, chat, dan riwayat percakapan.

## Arsitektur

Monorepo ini terdiri dari dua bagian besar:

- **Backend (`backend/`)** — tiga service Python yang berjalan terpisah:
    - **`voiceverification/`** — aplikasi FastAPI utama (`voiceverification/server.py`).
        - Endpoint untuk join token LiveKit, verifikasi suara, enrollment, log percakapan, sesi, dan link akun e-commerce.
        - Modul biometrik di `voiceverification/core/` dan `voiceverification/services/`:
            - Speaker verification (model ECAPA‑TDNN via SpeechBrain).
            - Anti‑spoofing (model deepfake/replay detector pretrained, bukan model buatan sendiri).
            - Behavior profiling & decision engine untuk menggabungkan beberapa sinyal risiko.
        - Penyimpanan data di **Supabase** melalui layer `voiceverification/db/` (termasuk kredensial
          e-commerce yang dienkripsi per-user).
    - **`agent/`** (sibling dari `voiceverification/`, bukan di dalamnya) — LiveKit Agent sebagai
      otak percakapan (LLM + tools: search produk, cart, checkout, dll). Bukan aplikasi HTTP —
      ini worker yang connect ke LiveKit Cloud dan menerima job dispatch, dijalankan lewat CLI
      `livekit-agents`, bukan uvicorn.
    - **`face_recognition/`** — aplikasi FastAPI terpisah (port lain) untuk enrollment & verifikasi
      wajah (ArcFace via InsightFace). Berdiri sendiri, dipanggil langsung dari frontend — belum
      terhubung ke alur voice verification/agent.

- **Frontend (`frontend/`)**
    - Aplikasi **Next.js (App Router)** untuk UI voice shopping assistant, di-styling dengan
      **shadcn/ui** (Radix UI + Tailwind CSS) untuk konsistensi visual.
    - Autentikasi email/password via **Supabase**.
    - Komponen UI utama:
        - Sidebar: daftar sesi percakapan, kontrol enrollment suara & wajah, link akun e-commerce.
        - ChatArea: tampilan chat/voice + rekomendasi produk.
        - VoiceEnrollment / FaceEnrollment: alur perekaman & penyimpanan voice print / face embedding.
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
    - Hasil ditampilkan di frontend lewat toast notification.

4. **Link Akun E-commerce**
    - Pengguna menghubungkan akun e-commerce miliknya sendiri lewat form (bukan diucapkan ke agent).
    - Setelah suara terverifikasi, agent otomatis login pakai akun yang sudah terhubung itu.

5. **Percakapan & Rekomendasi Produk**
    - Agent mendengarkan suara pengguna dan mengubahnya menjadi pesan teks.
    - LLM + tools di backend mengakses katalog produk dummy dan mengirim kartu produk ke frontend.
    - Chat (pesan dan produk) disimpan sebagai log sesi percakapan di Supabase.

6. **Riwayat Percakapan**
    - Pengguna dapat membuka halaman history dan memilih sesi tertentu.
    - Frontend memuat log percakapan dan rekomendasi produk dari backend dan menampilkannya dalam mode read‑only.

## Ringkasan Teknologi

- **Backend**: Python, FastAPI, uvicorn, SpeechBrain, LiveKit Agent, InsightFace/ArcFace (face
  recognition), Supabase Python client.
- **Frontend**: Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui (Radix UI), Supabase JS,
  LiveKit client.
- **Infra**: Docker & docker-compose untuk orkestrasi `backend`, `agent`, dan `frontend`.
  `face_recognition` belum masuk `docker-compose.yml` — jalankan manual untuk saat ini (lihat
  `backend/README.md`).

## Detail Lebih Lanjut

- Cara menjalankan backend dan penjelasan modul lebih detail ada di `backend/README.md`.
- Cara menjalankan frontend dan struktur UI ada di `frontend/README.md`.
