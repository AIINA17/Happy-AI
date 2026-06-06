### Ringkasan Proyek: Asisten Suara "Happy"

- **Tujuan Utama**
    - Fungsi utama sistem adalah menyediakan platform asisten virtual berbasis suara bernama "Happy" yang mampu melakukan interaksi percakapan secara natural.
    - Sistem ini dirancang untuk memfasilitasi tugas-tugas asisten pribadi dan transaksi e-commerce, seperti pencarian produk, manajemen keranjang, dan proses checkout.
    - Salah satu pilar utama proyek adalah implementasi sistem keamanan biometrik, yaitu verifikasi pembicara (speaker verification), untuk mengotorisasi tindakan-tindakan sensitif seperti pembayaran dan akses data pribadi, sehingga meningkatkan keamanan akun pengguna.

- **Tech Stack (Tumpukan Teknologi)**
    - **Bahasa Pemrograman**:
        - Frontend: **TypeScript**
        - Backend: **Python**
    - **Framework**:
        - Frontend: **Next.js** (dengan React) untuk membangun antarmuka pengguna yang interaktif dan server-side rendering.
        - Backend: **FastAPI** untuk membangun API yang cepat, modern, dan asinkron.
        - Agen AI: **LiveKit Agents Framework** untuk orkestrasi agen percakapan.
    - **Database**: **Supabase** (berbasis PostgreSQL) digunakan untuk autentikasi pengguna, manajemen sesi, dan penyimpanan data persisten seperti profil pengguna, riwayat percakapan, dan _embedding_ suara.
    - **Komunikasi Real-time**: **LiveKit** sebagai platform WebRTC untuk streaming audio dua arah antara klien dan server, serta untuk pengiriman pesan data secara real-time.
    - **Machine Learning**: **PyTorch** sebagai fondasi untuk model verifikasi pembicara dan deteksi spoofing.

- **Arsitektur Folder**
    - **`/backend`**: Berisi seluruh logika sisi server.
        - `voiceverification/agent/`: Mendefinisikan logika AI Agent, termasuk _tools_ (kemampuan) yang bisa digunakan dan _prompts_ (instruksi) yang membentuk perilakunya.
        - `voiceverification/core/`: Implementasi algoritma inti untuk biometrik, seperti deteksi spoofing, analisis pitch, dan mesin keputusan.
        - `voiceverification/db/`: Lapisan abstraksi untuk berinteraksi dengan tabel-tabel di Supabase.
        - `voiceverification/services/`: Layanan tingkat tinggi yang mengoordinasikan beberapa modul inti, contohnya `BiometricService`.
        - `voiceverification/server.py`: Titik masuk utama (entry point) dari server FastAPI yang mendefinisikan semua endpoint RESTful.
    - **`/frontend`**: Berisi seluruh kode antarmuka pengguna.
        - `web/app/`: Mengikuti struktur App Router dari Next.js, di mana setiap folder merepresentasikan sebuah rute (misal: `/login`, `/history/[id]`).
        - `web/components/`: Kumpulan komponen React yang dapat digunakan kembali, seperti `ChatArea.tsx`, `Sidebar.tsx`, dan `VoiceButton.tsx`.
        - `web/hooks/`: Berisi _custom React hooks_ untuk mengenkapsulasi logika yang kompleks, terutama `useLiveKit.ts` yang menangani semua interaksi dengan LiveKit.
        - `web/lib/`: Modul pustaka dan konfigurasi, seperti inisialisasi klien Supabase.

- **Alur Kerja (Workflow)**
    1.  **Inisiasi Sesi**: Pengguna melakukan login melalui antarmuka frontend. Setelah berhasil, frontend meminta token koneksi LiveKit dari backend.
    2.  **Koneksi Real-time**: Menggunakan token tersebut, frontend terhubung ke sebuah _room_ di server LiveKit. Secara simultan, backend mengirimkan (dispatch) sebuah AI Agent untuk bergabung ke _room_ yang sama.
    3.  **Input Suara & VAD**: Pengguna berbicara. Frontend menggunakan _Voice Activity Detection_ (VAD) untuk mendeteksi ucapan dan merekamnya menjadi segmen audio.
    4.  **Verifikasi Biometrik**: Segmen audio dikirim ke endpoint `/verify-voice` di backend. Backend menjalankan model verifikasi pembicara dan deteksi spoofing. Hasilnya (misal: `VERIFIED`, `DENIED`) dikirim kembali ke agent melalui _data channel_ LiveKit.
    5.  **Pemrosesan Perintah oleh Agent**: Audio pengguna juga di-stream secara langsung ke AI Agent. LLM (Large Language Model) di dalam agent mentranskripsi ucapan menjadi teks dan memahami niat pengguna.
    6.  **Eksekusi Tools**: Berdasarkan niat pengguna, agent memanggil _tools_ yang relevan (misal: `search_product` atau `checkout`). Jika _tool_ tersebut bersifat sensitif, ia akan memeriksa status verifikasi suara terlebih dahulu.
    7.  **Generasi Respons**: Hasil eksekusi _tool_ dikembalikan ke LLM, yang kemudian menyusun respons dalam bentuk teks. Teks ini dikonversi menjadi audio (TTS) dan di-stream kembali ke pengguna, serta dikirim sebagai pesan teks untuk ditampilkan di UI.

- **Fitur Kunci dan File Terkait**
    - **Autentikasi Pengguna**: Login, registrasi, dan manajemen sesi.
        - _File_: `frontend/web/app/login/page.tsx`, `frontend/web/lib/supabase.ts`, `backend/voiceverification/auth/auth_utils.py`.
    - **Interaksi Suara Real-time**: Komunikasi dua arah antara pengguna dan agent.
        - _File_: `frontend/web/hooks/useLiveKit.ts`, `backend/voiceverification/agent/agent.py`.
    - **Verifikasi Biometrik Suara**: Mengamankan aksi sensitif dengan verifikasi suara.
        - _File_: `backend/voiceverification/services/biometric_service.py`, `backend/voiceverification/core/decision_engine.py`, `frontend/web/hooks/useLiveKit.ts` (pada fungsi `sendForVerificationRef`).
    - **Pendaftaran Suara (Enrollment)**: Kemampuan pengguna untuk mendaftarkan beberapa profil suara dengan label berbeda.
        - _File_: `backend/voiceverification/server.py` (endpoint `/enroll-voice`), `frontend/web/components/VoiceEnrollment.tsx`.
    - **Fungsionalitas E-commerce**: Pencarian produk, detail produk, keranjang belanja, checkout, dan riwayat pesanan.
        - _File_: `backend/voiceverification/agent/tools.py` (fungsi `search_product`, `add_to_cart`, `checkout`, dll).
    - **Riwayat Percakapan**: Pengguna dapat melihat kembali sesi percakapan sebelumnya.
        - _File_: `frontend/web/app/history/[id]/page.tsx`, `backend/voiceverification/db/conversation_logs.py`.

- **Integrasi Eksternal**
    - **LiveKit**: Platform utama untuk WebRTC dan komunikasi data real-time.
    - **Supabase**: Digunakan sebagai _Backend-as-a-Service_ (BaaS) untuk autentikasi dan database PostgreSQL.
    - **Google Gemini**: Model LLM yang digunakan oleh AI Agent untuk pemahaman bahasa dan generasi respons.
    - **DuckDuckGo Search API**: Digunakan oleh agent melalui `langchain` untuk fitur pencarian informasi di web.
    - **Dummy E-commerce API**: Sebuah API eksternal yang disimulasikan untuk menyediakan data produk, keranjang, dan pesanan.
