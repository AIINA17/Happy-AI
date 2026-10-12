# Roadmap Pengembangan HAPPY

Daftar ini disusun dari hasil membaca kode yang sudah ada saat ini
(`backend/voiceverification`, `backend/agent`, `backend/face_recognition`,
`frontend/`). Dikelompokkan per area, tiap item ditandai perkiraan effort
dan alasan kenapa perlu.

> Legend effort: 🟢 kecil (jam–1 hari) · 🟡 sedang (beberapa hari) · 🔴 besar (butuh desain/riset)

---

## 1. Keamanan & Verifikasi Suara

- 🔴 **Manfaatkan modul `face_recognition/` yang saat ini menganggur.** Ada
  implementasi ArcFace lengkap (`arcface_model.py`, `face_service.py`,
  `face_storage.py`) tapi tidak di-import atau dipanggil dari
  `voiceverification/server.py` maupun `agent/`. Kalau memang ini rencana
  multi-factor biometric (suara + wajah), integrasikan sebagai lapisan
  verifikasi tambahan saat enrollment/login. Kalau tidak dipakai lagi,
  sebaiknya dihapus supaya tidak membingungkan kontributor baru.
- 🟡 **Rate limiting & lockout untuk `/verify-voice` dan `/enroll-voice`.**
  Saat ini endpoint ini bisa dipanggil berkali-kali tanpa batas per user —
  membuka celah brute-force terhadap threshold skor speaker atau DoS ke
  model biometrik (yang berat secara komputasi). Tambahkan limit per
  user/IP (mis. `slowapi`) + lockout sementara setelah beberapa kali
  `DENIED` beruntun.
- 🟡 **Audit log untuk keputusan verifikasi.** `decision_engine.py` sudah
  punya alasan tekstual (`"Speaker score too low"`, dst.) tapi tidak
  terlihat disimpan permanen per attempt (hanya `behavior_profile` yang
  diupdate saat `VERIFIED`). Simpan setiap hasil verifikasi (skor, spoof
  prob, decision, timestamp) di tabel terpisah untuk investigasi
  insiden dan untuk melatih ulang threshold di kemudian hari.
- 🟢 **Perbaiki kombinasi CORS `allow_origins=["*"]` + `allow_credentials=True`**
  di `voiceverification/server.py` — kombinasi ini sudah ditandai
  `# ⚠️ restrict in production` oleh kode itu sendiri. Ganti ke daftar
  origin eksplisit (env var) sebelum deploy publik.
- 🟢 **Sinkronkan `ECOMMERCE_BASE_URL`/`BASE_URL` lewat env var**, bukan
  hardcoded string yang diduplikasi manual di `server.py` dan
  `agent/tools.py` (komentar di kode sudah mengakui ini "kept in sync
  manually"). Satu env var dibaca dua service menghindari drift.

## 2. Autentikasi & Manajemen Akun

- 🟡 **Re-verifikasi berkala, bukan cuma per tool sensitif.** Saat ini
  `require_voice_verification()` dipanggil per-tool (login, logout, cek
  saldo, checkout). Pertimbangkan verifikasi ulang otomatis setelah idle
  timeout tertentu di tengah sesi panjang, untuk kasus HP diletakkan lalu
  dipakai orang lain.
- 🟢 **Password reset & ganti email** — halaman login/signup saat ini
  hanya sign in/sign up (`AuthCard`). Belum ada alur "lupa password" via
  Supabase (`resetPasswordForEmail`).
- 🟢 **Validasi kekuatan password** di form signup (saat ini hanya
  mengandalkan validasi default Supabase).
- 🟡 **UI untuk kelola akun e-commerce yang lebih terlihat.** Berdasarkan
  komentar di `server.py`, linking akun e-commerce sengaja dibuat sebagai
  form HTTP terpisah (bukan spoken ke agent) demi keamanan — itu keputusan
  bagus, tapi pastikan alurnya mudah ditemukan user baru (mis. onboarding
  checklist: "1) Enroll suara 2) Hubungkan akun belanja").

## 3. Pengalaman Voice Agent

- 🟡 **Indikator visual saat agent menunggu verifikasi suara.** Saat
  `START_RECORD` diterima, UI voice mode (`ChatArea` → `VoiceModeView`)
  belum membedakan "sedang verifikasi" vs "sedang chat biasa" secara
  visual selain lewat `verifyStatus` teks — tambahkan state visual khusus
  (warna beda, label "Memverifikasi suara...").
- 🟡 **Fallback kalau `getUserMedia` ditolak / tidak ada mic.** Saat ini
  error mic langsung `console.error` + `alert("Mic access failed")` di
  `VoiceEnrollment`, dan di `useLiveKit` cuma balik ke `IDLE` tanpa pesan
  jelas ke user kenapa gagal connect.
- 🟢 **Interrupt / barge-in.** Belum terlihat mekanisme user memotong
  agent saat sedang bicara (mis. tekan tombol untuk stop TTS). Berguna
  untuk perintah cepat "stop", "ganti topik".
- 🟡 **Multi-bahasa** — prompt (`prompts.py`) sekarang hardcode ke Bahasa
  Indonesia gaul. Kalau target pasar lebih luas, buat prompt & UI
  dinamis per bahasa pengguna.
- 🟢 **Teks konfirmasi produk sebelum checkout diucapkan agent**, bukan
  cuma dikirim sebagai `PRODUCT_CARDS` — supaya user yang sedang tidak
  melihat layar (mode voice-only) tetap tahu detail sebelum bayar.

## 4. Fitur Belanja / E-commerce

- 🟡 **Riwayat transaksi/pesanan** — sejauh ini yang tersimpan di Supabase
  adalah `conversation_sessions`, `conversation_logs`, dan
  `product_cards`, belum ada tabel/endpoint khusus riwayat pembelian yang
  bisa ditampilkan terpisah dari log chat.
- 🔴 **Dukungan multi-toko dummy e-commerce + perbandingan harga** —
  tambah sumber dummy e-commerce kedua di samping
  `dummy-ecommerce-tau.vercel.app` (saat ini hardcoded di beberapa
  tempat) supaya hasil pencarian/rekomendasi lebih luas, dan hasilnya
  ditampilkan sebagai perbandingan harga/produk antar toko ke user.
- 🟢 **Wishlist / simpan produk** — `ProductCards` sekarang murni tampilan
  hasil pencarian sesi berjalan, tidak ada aksi simpan untuk nanti.
- 🟡 **Notifikasi status pesanan** (push/email) setelah checkout lewat
  agent, karena user mungkin menutup tab setelah transaksi selesai.
- 🟢 **Multi-akun e-commerce** — skema `ecommerce_accounts` saat ini satu
  akun per `user_id` (`upsert` overwrite). Kalau ke depannya user mau
  simpan lebih dari satu akun toko, perlu redesain skema.

## 5. Riwayat & Manajemen Sesi

- 🟢 **Search/filter riwayat percakapan** — halaman history baru bisa
  pilih sesi dari daftar (`/logs/sessions`), belum ada pencarian teks di
  dalam log lama.
- 🟢 **Export riwayat** (PDF/teks) untuk kebutuhan audit pribadi user.
- 🟡 **Auto-labeling sesi yang lebih pintar** — saat ini label sesi
  tetap `"New session"`/"New chat" walau percakapan sudah selesai, dan
  cuma bisa diubah manual (`update_conversation_session_label`); perlu
  auto-generate judul dari isi percakapan begitu sesi berakhir (mirip
  judul chat di banyak produk LLM), bukan dibiarkan generik selamanya.

## 6. Reliabilitas Backend & Observability

- 🟡 **Structured logging** — saat ini banyak `print(...)` polos di
  `server.py`/`agent.py` (mis. `print("Verify took:", ...)`,
  `print(f"🔐 Auto-login...")`). Ganti ke `logging` module dengan level
  dan format konsisten supaya bisa diarahkan ke log aggregator.
- 🟡 **Health check lebih dalam** — `/health` saat ini cuma cek
  `BiometricService` sudah ter-load, belum cek konektivitas Supabase atau
  LiveKit.
- 🟡 **Error handling terpusat** — beberapa endpoint (`verify-voice`,
  `enroll-voice`) sudah rapi dengan `try/finally` untuk cleanup file, tapi
  belum ada exception handler global FastAPI untuk mengubah error tak
  terduga jadi respons JSON konsisten (saat ini bisa bocor stack trace
  default FastAPI).
- 🟢 **Cleanup file audio yang lebih defensif** — pola
  `if os.path.exists(wav_path): os.remove(wav_path)` sudah ada di
  beberapa tempat; pastikan konsisten di semua endpoint yang menyimpan
  file sementara.
- 🔴 **Metric & monitoring untuk skor verifikasi** — dashboard sederhana
  (mis. Grafana) untuk distribusi `speaker_score`/`spoof_prob` dari waktu
  ke waktu, supaya threshold di `DecisionConfig` bisa dievaluasi ulang
  dengan data produksi, bukan cuma dataset kalibrasi n=37 yang disebut di
  komentar `decision_engine.py`.

## 7. Testing & CI/CD

- 🟡 **Test untuk lapisan API** — folder `voiceverification/tests/`
  sekarang hanya menguji modul inti (`behavior_profile`,
  `behavior_scoring`, `calibration`, `decision_engine`,
  `trusted_update`). Belum ada test untuk endpoint FastAPI (`server.py`)
  atau `agent/tools.py`.
- 🔴 **Test untuk frontend** — `frontend/package.json` belum punya skrip
  test sama sekali (hanya `dev`, `build`, `start`, `lint`). Tambahkan
  unit test untuk hook (`useLiveKit`) dan komponen kritikal
  (`VoiceEnrollment`, `ChatArea`).
- 🟡 **CI pipeline** — belum ada folder `.github/workflows`. Tambahkan
  pipeline minimal: lint + test backend (pytest) & frontend (eslint,
  build) di setiap PR.
- 🟢 **`.env.example`** — repo hanya punya `.env` asli (sudah benar masuk
  `.gitignore`), tapi tidak ada template `.env.example` untuk
  onboarding kontributor baru tanpa harus menebak-nebak nama variabel.

## 8. Frontend UX Umum

- 🟢 **Aksesibilitas** — pastikan kontrol voice (mic button, toggle
  voice/chat) punya label ARIA yang jelas untuk screen reader, mengingat
  produk ini berbasis suara dan berpotensi dipakai user dengan gangguan
  penglihatan.
- 🟢 **Dark/light mode konsistensi** — cek apakah semua komponen baru
  (mis. `SoundWave`, `ProductCards`) sudah ikut tema, bukan warna hardcode.
- 🟢 **Loading skeleton** untuk daftar sesi & enrollment di Sidebar,
  menggantikan teks "Loading..." polos.
- 🟡 **Mobile responsiveness** — perlu dicek khusus untuk layout 3 kolom
  (`Sidebar` + `ChatArea` + `ProductSidebar`) di layar kecil.

## 9. Housekeeping / Arsitektur

- 🟢 **Putuskan status `face_recognition/`** (lihat poin di bagian 1) —
  ini yang paling mencolok karena modul lengkap tapi orphaned.
- 🟢 **Samakan penamaan folder frontend** — ada sisa referensi ke
  `frontend/web/` (folder lama sebelum di-flatten, lihat commit
  `bc4f8e5 refactor: flatten frontend/web/ into frontend/`) — pastikan
  tidak ada file/script yang masih mengacu ke path lama.
- 🟢 **Dokumentasikan skema database Supabase** (tabel: `speaker_profiles`,
  `behavior_profiles`, `conversation_sessions`, `conversation_logs`,
  `product_cards`, `ecommerce_accounts`) di `backend/README.md` supaya
  kontributor baru tidak perlu reverse-engineer dari kode repo layer.

---

## Rekomendasi Prioritas (kalau harus pilih 5 dulu)

1. 🔴 Putuskan nasib `face_recognition/` (integrasikan atau hapus) — kode
   mati membingungkan dan menambah beban maintenance.
2. 🟡 Rate limiting + audit log di endpoint verifikasi suara — ini
   endpoint keamanan paling kritis di seluruh produk.
3. 🟢 Perbaiki CORS wildcard sebelum ke production.
4. 🟡 Structured logging pengganti `print()` — murah tapi langsung
   membantu debugging & observability.
5. 🟡 CI pipeline minimal (lint + test) — mencegah regresi seiring
   fitur baru ditambah.
