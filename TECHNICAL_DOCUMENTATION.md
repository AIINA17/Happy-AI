# Dokumentasi Teknis: Repositori Asisten Belanja "Happy"

Dokumen ini memberikan gambaran teknis mendalam tentang arsitektur, logika bisnis, dan alur kerja dari repositori Asisten Belanja Suara "Happy".

## 1. Arsitektur Umum

Sistem ini dibangun di atas arsitektur client-server modern yang dirancang untuk interaksi suara real-time.

- **Frontend**: Aplikasi Next.js (React) yang berfungsi sebagai antarmuka pengguna utama. Frontend bertanggung jawab untuk menangani input suara, menampilkan percakapan, dan berinteraksi dengan layanan backend.
- **Backend**: Server FastAPI (Python) yang menjadi otak dari sistem. Backend mengelola logika bisnis, verifikasi biometrik, dan koneksi dengan layanan pihak ketiga.
- **Real-time Communication**: [LiveKit](https://livekit.io/) digunakan sebagai platform komunikasi real-time. Ini memungkinkan streaming audio dua arah antara pengguna dan agen AI, serta pertukaran data (misalnya, hasil verifikasi, pesan chat).
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL) digunakan untuk menyimpan data persisten seperti profil pengguna, profil suara (embedding), riwayat percakapan, dan sesi.
- **AI Agent**: Agen AI yang dibangun dengan `livekit-agents` dan ditenagai oleh model LLM (misalnya, Google Gemini) berjalan di sisi backend. Agen ini memahami instruksi pengguna, menggunakan _tools_ untuk berinteraksi dengan sistem, dan memberikan respons dalam bentuk suara dan teks.

### Alur Kerja Utama

1.  **Autentikasi**: Pengguna login atau mendaftar melalui antarmuka frontend. Supabase menangani autentikasi dan menghasilkan token JWT.
2.  **Koneksi Real-time**: Setelah login, frontend meminta token LiveKit dari backend. Menggunakan token ini, frontend terhubung ke _room_ LiveKit yang didedikasikan untuk pengguna tersebut.
3.  **Dispatch Agent**: Backend secara otomatis mengirimkan (dispatch) sebuah AI Agent ke _room_ yang sama saat pengguna bergabung.
4.  **Interaksi Suara**:
    - Pengguna berbicara. Frontend menggunakan _Voice Activity Detection_ (VAD) untuk mendeteksi ucapan dan merekamnya.
    - Audio yang direkam dikirim ke endpoint verifikasi di backend.
    - Backend melakukan verifikasi biometrik (speaker verification) dan deteksi spoofing.
    - Hasil verifikasi dikirim kembali ke frontend dan juga ke AI Agent melalui _data channel_ LiveKit.
5.  **Pemrosesan Perintah**:
    - Audio dari pengguna juga di-stream ke AI Agent melalui LiveKit.
    - LLM di dalam agent mentranskripsi audio menjadi teks dan memahami niat pengguna.
    - Berdasarkan instruksi, agent akan memanggil _tools_ yang sesuai (misalnya, `search_product`, `add_to_cart`).
    - _Tools_ ini berinteraksi dengan API e-commerce atau database.
    - Hasil dari _tool_ dikembalikan ke LLM.
6.  **Respons Agen**:
    - LLM menghasilkan respons dalam bentuk teks.
    - Teks ini dikonversi menjadi suara (Text-to-Speech) oleh LLM dan di-stream kembali ke pengguna.
    - Teks respons juga dikirim ke frontend melalui _data channel_ untuk ditampilkan di antarmuka chat.

---

## 2. Modul Backend (`/backend/voiceverification`)

### `server.py`

- **Nama Modul**: `server.py`
- **Logika Utama**:
    - Ini adalah entry point utama untuk server backend, menggunakan framework **FastAPI**.
    - Menyediakan endpoint RESTful untuk berbagai fungsi:
        - `/join-token`: Memberikan token LiveKit kepada pengguna yang terautentikasi untuk bergabung ke _room_. Sekaligus melakukan _dispatch_ agent ke _room_ tersebut.
        - `/verify-voice`: Menerima file audio dari frontend, melakukan verifikasi pembicara dan deteksi spoofing, lalu mengembalikan hasilnya.
        - `/enroll-voice`: Menerima file audio dan label untuk mendaftarkan profil suara baru bagi pengguna.
        - Endpoint CRUD untuk sesi percakapan (`/logs/sessions`), log percakapan, dan profil pendaftaran (`/enrollments`).
    - Menggunakan _lazy initialization_ untuk `BiometricService` untuk memastikan model ML hanya dimuat saat pertama kali dibutuhkan.
    - Mengintegrasikan middleware CORS untuk memungkinkan permintaan dari domain frontend.
- **Ketergantungan**:
    - `fastapi`: Framework web.
    - `livekit`: Untuk API dispatch agent.
    - `auth/auth_utils.py`: Untuk memvalidasi token JWT dan mendapatkan ID pengguna.
    - `services/biometric_service.py`: Untuk melakukan proses verifikasi suara.
    - `db/*.py`: Untuk semua interaksi dengan database Supabase.
    - `models/speaker_verifier.py`: Untuk mengekstrak embedding dari audio.
    - `utils/audio.py`: Untuk menyimpan dan menormalisasi file audio yang diunggah.

### `agent/agent.py`

- **Nama Modul**: `agent/agent.py`
- **Logika Utama**:
    - Mendefinisikan `ShoppingAgent`, sebuah kelas yang mewarisi dari `livekit.agents.Agent`.
    - Agen ini diinisialisasi dengan instruksi (`AGENT_INSTRUCTION`) dan daftar _tools_ yang dapat digunakannya.
    - Fungsi `connect` adalah _event handler_ utama yang dipanggil saat agent berhasil terhubung ke sebuah _room_ LiveKit.
    - Di dalam `connect`, agent mengelola _state_ untuk setiap _room_, termasuk status verifikasi suara, ID sesi percakapan, dan ID pengguna.
    - Menggunakan `AgentSession` untuk memulai loop percakapan dengan LLM (Google Gemini).
    - **Event Listeners**:
        - `@room.on("disconnected")`: Membersihkan state saat koneksi terputus.
        - `@room.on("data_received")`: Mendengarkan pesan dari frontend, terutama hasil verifikasi suara (`VOICE_RESULT`), dan memperbarui _state_ agent.
        - `@session.on("conversation_item_added")`: Dipicu setiap kali ada item baru dalam percakapan (baik dari pengguna maupun dari agent). Fungsi ini menyimpan log percakapan ke database dan mengirim pesan teks ke frontend.
    - Menerapkan logika untuk memulai verifikasi suara secara proaktif jika pengguna mencoba melakukan aksi sensitif tanpa terverifikasi.
- **Ketergantungan**:
    - `livekit.agents`: Framework untuk membangun agen AI.
    - `agent/prompts.py`: Menyediakan instruksi awal untuk LLM.
    - `agent/tools.py`: Menyediakan daftar fungsi (_tools_) yang bisa dipanggil oleh LLM.
    - `db/conversation_logs.py`, `db/conversation_sessions.py`: Untuk menyimpan data percakapan.

### `agent/tools.py`

- **Nama Modul**: `agent/tools.py`
- **Logika Utama**:
    - Berisi kumpulan fungsi Python yang didekorasi dengan `@function_tool`. Dekorator ini membuat fungsi tersebut dapat "dilihat" dan dipanggil oleh LLM.
    - Setiap _tool_ merepresentasikan sebuah aksi yang dapat dilakukan agent, seperti:
        - **Interaksi E-commerce**: `search_product`, `get_product_detail`, `add_to_cart`, `checkout`, `get_order_history`, dll. Fungsi-fungsi ini melakukan request HTTP ke API e-commerce dummy.
        - **Autentikasi**: `login`, `register`, `logout`, `check_login_status`.
        - **Informasi Umum**: `get_weather`, `web_search` (menggunakan DuckDuckGo).
        - **Verifikasi Suara**: `check_voice_status`.
    - Mengelola _global state_ (`auth_state`) yang menyimpan informasi login, status verifikasi, dan hasil pencarian produk terakhir. **Catatan**: Ini adalah state per-agent, bukan per-user secara global.
    - Implementasi `require_voice_verification`: Sebuah _gatekeeper_ yang dipanggil oleh _tools_ sensitif (seperti `checkout` atau `pay_order`) untuk memastikan suara pengguna telah terverifikasi sebelum melanjutkan.
- **Ketergantungan**:
    - `livekit.agents.llm`: Untuk dekorator `function_tool`.
    - `requests`: Untuk melakukan panggilan HTTP ke API eksternal.
    - `langchain_community.tools`: Untuk `DuckDuckGoSearchRun`.
    - `db/*.py`: Untuk menyimpan `product_cards` ke database.

### `agent/prompts.py`

- **Nama Modul**: `prompts.py`
- **Logika Utama**:
    - Berisi string instruksi (prompt) yang sangat detail yang diberikan kepada LLM saat inisialisasi.
    - `AGENT_INSTRUCTION`: Mendefinisikan kepribadian agent ("Happy"), gaya bahasa (kasual, bahasa gaul), tanggung jawab, aturan penggunaan _tools_, cara menangani link, aturan keamanan, dan batasan. Ini adalah "konstitusi" yang mengatur perilaku agent.
    - `SESSION_INSTRUCTION`: Prompt yang lebih singkat yang digunakan untuk memulai percakapan, mengingatkan agent tentang aturan-aturan kunci dan memberikan kalimat sapaan pertama.
- **Ketergantungan**: Tidak ada. File ini hanya berisi data teks.

---

## 3. Modul Frontend (`/frontend/web`)

### `app/page.tsx`

- **Nama Modul**: `app/page.tsx`
- **Logika Utama**:
    - Ini adalah halaman utama aplikasi setelah pengguna login.
    - Bertanggung jawab untuk manajemen _state_ utama di sisi klien.
    - **Manajemen Autentikasi**: Menggunakan `useEffect` dan `supabase.auth.onAuthStateChange` untuk memantau status login pengguna. Jika pengguna tidak login, mereka akan dialihkan ke halaman `/login`.
    - **Manajemen State**: Menggunakan `useState` untuk mengelola:
        - `session`: Objek sesi dari Supabase.
        - `messages`: Array dari pesan chat.
        - `products`: Array produk yang akan ditampilkan di sidebar.
        - `verificationResult`: Status hasil verifikasi suara untuk menampilkan _toast notification_.
    - **Komposisi UI**: Merender komponen utama `Sidebar` dan `ChatArea`, dan memberikan _state_ dan _handler_ yang relevan sebagai _props_.
    - **Event Handlers**: Menyediakan fungsi untuk menangani logout, memulai chat baru, dan memilih sesi riwayat.
- **Ketergantungan**:
    - `next/navigation`: Untuk routing.
    - `@supabase/supabase-js`: Untuk interaksi dengan Supabase.
    - `components/ChatArea.tsx`: Komponen utama untuk area chat.
    - `components/Sidebar.tsx`: Komponen sidebar.
    - `components/VerificationToast.tsx`: Untuk menampilkan notifikasi hasil verifikasi.
    - `types/index.ts`: Untuk definisi tipe data `Message` dan `Product`.

### `components/ChatArea.tsx`

- **Nama Modul**: `ChatArea.tsx`
- **Logika Utama**:
    - Komponen ini mengatur tata letak utama dari area interaksi, yang dapat beralih antara mode "suara" dan mode "chat".
    - **Mode View**:
        - `VoiceModeView`: Tampilan default yang menunjukkan maskot dan animasi gelombang suara saat agent berbicara.
        - `ChatModeView`: Tampilan yang menunjukkan gelembung-gelembung pesan percakapan.
        - `HistoryModeView`: Tampilan khusus saat melihat riwayat percakapan.
    - Merender `LiveKitControls` yang berisi tombol mikrofon utama dan logika koneksi.
    - Merender `ProductSidebar` yang akan muncul jika ada data produk yang diterima dari agent.
    - Menggunakan `useRef` (`messagesEndRef`) untuk secara otomatis menggulir ke pesan terbaru.
- **Ketergantungan**:
    - `components/LiveKitControls.tsx`: Untuk tombol interaksi utama.
    - `components/MessageBubble.tsx`: Untuk menampilkan setiap pesan.
    - `components/ProductCards.tsx`: Untuk menampilkan kartu produk.
    - `components/SoundWave.tsx`, `components/TypingIndicator.tsx`: Komponen UI pendukung.

### `hooks/useLiveKit.ts`

- **Nama Modul**: `useLiveKit.ts`
- **Logika Utama**:
    - Ini adalah _custom hook_ yang mengenkapsulasi semua logika kompleks terkait LiveKit.
    - **Manajemen Koneksi**:
        - `joinRoom`: Fungsi untuk mengambil token dari backend dan menghubungkan ke _room_ LiveKit.
        - `leaveRoom`: Fungsi untuk memutuskan koneksi dari _room_.
        - `toggleRoom`: Fungsi yang dipanggil oleh tombol utama untuk join atau leave.
    - **Manajemen State UI**: Mengelola `uiState` (`IDLE`, `CONNECTING`, `RECORDING`, dll.) yang menentukan tampilan dan perilaku tombol mikrofon dan teks status di `LiveKitControls`.
    - **Event Handling LiveKit**:
        - `RoomEvent.Connected`, `RoomEvent.Disconnected`: Mengubah `uiState`.
        - `RoomEvent.DataReceived`: Menerima data dari agent (pesan chat, perintah, kartu produk) dan memanggil _callback_ yang sesuai (`onMessage`, `onProductCards`).
        - `RoomEvent.TrackSubscribed`, `RoomEvent.ActiveSpeakersChanged`: Mendeteksi kapan agent mulai atau berhenti berbicara untuk menampilkan animasi gelombang suara.
    - **Perekaman Audio & VAD**:
        - `startVADRecordingRef`: Fungsi ini menggunakan `MediaRecorder` dan `AnalyserNode` dari Web Audio API untuk mengimplementasikan _Voice Activity Detection_ (VAD).
        - Perekaman dimulai hanya ketika level suara (`rms`) melebihi ambang batas (`START`).
        - Perekaman berhenti secara otomatis setelah periode hening (`SILENCE_MS`).
    - **Pengiriman Verifikasi**:
        - `sendForVerificationRef`: Setelah perekaman berhenti, fungsi ini mengambil audio yang direkam (sebagai `Blob`) dan mengirimkannya ke endpoint `/verify-voice` di backend menggunakan `fetch`.
        - Hasil verifikasi kemudian dikirim ke agent melalui `room.localParticipant.publishData` dengan topik `VOICE_RESULT`.
- **Ketergantungan**:
    - `livekit-client`: SDK klien LiveKit.
    - `@/lib/supabase`: Untuk mendapatkan token akses saat mengirim request ke backend.
    - `@/types`: Untuk definisi tipe.
