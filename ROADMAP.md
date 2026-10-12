# Roadmap Pengembangan HAPPY

Daftar ini disusun dari hasil membaca kode yang sudah ada saat ini
(`backend/voiceverification`, `backend/agent`, `backend/face_recognition`,
`frontend/`). Dikelompokkan per area, tiap item ditandai perkiraan effort
dan alasan kenapa perlu. Diperbarui berkala seiring temuan dari testing
manual dan audit kode — update terakhir: 2026-10-12.

> Legend effort: 🟢 kecil (jam–1 hari) · 🟡 sedang (beberapa hari) · 🔴 besar (butuh desain/riset) · ✅ selesai

---

## 1. Keamanan & Verifikasi Suara

- 🔴 **Manfaatkan modul `face_recognition/` yang saat ini menganggur.** Ada
  implementasi ArcFace lengkap (`arcface_model.py`, `face_service.py`,
  `face_storage.py`) tapi tidak di-import atau dipanggil dari
  `voiceverification/server.py` maupun `agent/`. Kalau memang ini rencana
  multi-factor biometric (suara + wajah), integrasikan sebagai lapisan
  verifikasi tambahan saat enrollment/login. Kalau tidak dipakai lagi,
  sebaiknya dihapus supaya tidak membingungkan kontributor baru.
  _(Update: endpoint `/face/verify-face` & `/face/verification-metrics`
  sudah ada dan logging-nya sudah tersambung ke dashboard analysis, tapi
  belum dipanggil otomatis dari flow login/verifikasi suara — masih
  router berdiri sendiri, bukan multi-factor sungguhan.)_
- 🟡 **Rate limiting & lockout untuk `/verify-voice` dan `/enroll-voice`.**
  Saat ini endpoint ini bisa dipanggil berkali-kali tanpa batas per user —
  membuka celah brute-force terhadap threshold skor speaker atau DoS ke
  model biometrik (yang berat secara komputasi). Tambahkan limit per
  user/IP (mis. `slowapi`) + lockout sementara setelah beberapa kali
  `DENIED` beruntun. _(Dicek ulang 2026-10-12: masih belum ada sama sekali
  — nol kode rate limiting di `server.py`.)_
- ✅ **Audit log untuk keputusan verifikasi.** _Selesai_ — setiap hasil
  `/verify-voice` (skor, spoof prob, decision, reason) sekarang disimpan
  ke tabel `voice_verification_logs` (lihat
  `voiceverification/db/voice_verification_logs.py`), dan hasil
  `/face/verify-face` ke `face_verification_logs`. Keduanya bisa dilihat
  per-user lewat endpoint `/verification-metrics` &
  `/face/verification-metrics`.
- 🟡 **Validasi kualitas sampel saat enrollment** — cek SNR/durasi/level
  noise audio di `/enroll-voice` sebelum diterima sebagai profil. Saat ini
  sampel jelek bisa ikut terdaftar dan jadi sumber false-reject yang sulit
  didiagnosis belakangan, apalagi sekarang kita punya data produksi
  (`voice_verification_logs`) untuk mulai mengkorelasikannya.
- 🟡 **Threshold `DecisionConfig` bisa dikonfigurasi tanpa redeploy** —
  sekarang hardcoded di `decision_engine.py`. Dengan data produksi yang
  mulai terkumpul lewat dashboard `/analysis`, langkah lanjutannya adalah
  baca threshold dari env var/tabel config, supaya hasil evaluasi ulang
  bisa langsung dipakai tanpa deploy ulang kode.
- 🟡 **Alerting otomatis dari log verifikasi** — begitu `spoof_prob` user
  tertentu berulang kali mendekati `replay_deny`, atau `DENIED` beruntun,
  kirim notifikasi (email/webhook) sebagai sinyal percobaan serangan.
  Lanjutan alami dari `voice_verification_logs`/`face_verification_logs`
  yang sudah ada datanya, tinggal job yang membaca & memicu alert.
- 🟢 **Perbaiki kombinasi CORS `allow_origins=["*"]` + `allow_credentials=True`**
  di `voiceverification/server.py` — kombinasi ini sudah ditandai
  `# ⚠️ restrict in production` oleh kode itu sendiri. Ganti ke daftar
  origin eksplisit (env var) sebelum deploy publik.
- 🟢 **Sinkronkan `ECOMMERCE_BASE_URL`/`BASE_URL` lewat env var**, bukan
  hardcoded string yang diduplikasi manual di `server.py` dan
  `agent/tools.py` (komentar di kode sudah mengakui ini "kept in sync
  manually"). Satu env var dibaca dua service menghindari drift.

## 2. Autentikasi & Manajemen Akun

- ✅ **Re-verifikasi berkala, bukan cuma per tool sensitif.** _Selesai_ —
  `require_voice_verification()` di `agent/tools.py` sekarang mengecek
  expiry via `REVERIFY_INTERVAL` (600 detik) & `last_verified_at`, jadi
  status verifikasi otomatis expired di tengah sesi panjang, bukan cuma
  gate per-tool statis.
- 🟡 **Kontrol data biometrik oleh user sendiri** — belum ada cara
  self-service untuk user menghapus profil suara/wajah dan riwayat
  verifikasinya sendiri (sekarang cuma bisa lewat admin/DB langsung).
  Penting karena data biometrik sensitif dan sekarang makin banyak yang
  tersimpan (embedding + log verifikasi per attempt).
- 🟡 **Manajemen sesi/device aktif** — mengingat produk ini mengotorisasi
  aksi sensitif (checkout, cek saldo) lewat suara, user perlu cara melihat
  & mencabut akses room/device yang sedang aktif, bukan hanya sesi yang
  sedang dipakai saat itu.
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
- ✅ **Teks konfirmasi produk sebelum checkout diucapkan agent**,
  bukan cuma dikirim sebagai `PRODUCT_CARDS`. _Selesai_ — `checkout()` di
  `agent/tools.py` sekarang return teks ringkasan order (ID, total,
  status) yang otomatis ikut diucapkan agent, terpisah dari
  `PRODUCT_CARDS` yang cuma dipakai untuk hasil pencarian produk.

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

- 🔴 **[Baru, prioritas tinggi] Semua tool di `agent/tools.py` melakukan
  HTTP call blocking (`requests.get/post/delete`) langsung di dalam
  `async def`.** Ditemukan 2026-10-12 saat testing: LiveKit Agents
  meng-`await` tool langsung di event loop utama (lihat
  `livekit/agents/voice/generation.py`, tidak ada thread/proses
  terpisah), jadi setiap kali tool seperti `add_to_cart` atau `checkout`
  memanggil API e-commerce dummy, **seluruh agent (audio, STT, TTS, data
  channel) freeze** selama request itu berlangsung — ini sumber keluhan
  "agent diam lama" saat user minta tambah ke keranjang. `checkout()`
  paling parah: 5–8+ pemanggilan blocking berurutan, termasuk loop
  `requests.delete` satu per satu untuk tiap item cart (`tools.py:728`)
  tanpa paralel. Fix: bungkus tiap call dengan `asyncio.to_thread(...)`
  atau migrasi ke `httpx.AsyncClient`; untuk loop delete di `checkout()`,
  paralelkan dengan `asyncio.gather` setelah dipindah ke thread.
- 🟡 **Structured logging** — saat ini banyak `print(...)` polos di
  `server.py`/`agent.py` (mis. `print("Verify took:", ...)`,
  `print(f"🔐 Auto-login...")`). Ganti ke `logging` module dengan level
  dan format konsisten supaya bisa diarahkan ke log aggregator — ini juga
  akan membantu menangkap masalah seperti item blocking-call di atas lebih
  cepat lain kali.
- 🟢 **Health check lebih dalam** — `/health` saat ini cuma cek
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
- ✅ **Metric & monitoring untuk skor verifikasi.** _Selesai_ — dashboard
  `/analysis` (frontend) sekarang menampilkan distribusi
  `speaker_score`/`spoof_prob` dari waktu ke waktu (plus similarity untuk
  face) terhadap threshold `DecisionConfig` yang berlaku, dibangun di atas
  `voice_verification_logs`/`face_verification_logs`. Threshold masih
  hardcoded di kode (lihat item "Threshold `DecisionConfig` bisa
  dikonfigurasi" di bagian 1) — dashboard-nya sudah ada, tapi belum ada
  mekanisme untuk langsung menerapkan hasil evaluasi ulang itu ke
  produksi.
- 🟢 **Formalisasi akses ke `/analysis`** — saat ini "hidden by
  obscurity" (cuma bisa diakses lewat URL langsung, tidak ada link).
  Kalau mau dipakai beneran untuk evaluasi produksi, perlu role/claim
  admin yang proper, bukan cuma mengandalkan tidak ada yang tahu URL-nya.

## 7. Testing & CI/CD

- 🟡 **Test untuk lapisan API** — folder `voiceverification/tests/`
  sekarang hanya menguji modul inti (`behavior_profile`,
  `behavior_scoring`, `calibration`, `decision_engine`,
  `trusted_update`). Belum ada test untuk endpoint FastAPI (`server.py`)
  atau `agent/tools.py` — test untuk `agent/tools.py` juga akan membantu
  mencegah regresi blocking-call seperti temuan di bagian 6.
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
  penglihatan. _Dicek ulang 2026-10-12: `VoiceButton.tsx` &
  `LiveKitControls.tsx` masih belum punya `aria-label`._
- 🟢 **Dark/light mode konsistensi** — cek apakah semua komponen baru
  (mis. `SoundWave`, `ProductCards`) sudah ikut tema, bukan warna hardcode.
- 🟢 **Loading skeleton** untuk daftar sesi & enrollment di Sidebar,
  menggantikan teks "Loading..." polos.
- 🟡 **Mobile responsiveness** — perlu dicek khusus untuk layout 3 kolom
  (`Sidebar` + `ChatArea` + `ProductSidebar`) di layar kecil.

## 9. Housekeeping / Arsitektur

- 🟢 **Putuskan status `face_recognition/`** (lihat poin di bagian 1) —
  ini yang paling mencolok karena modul lengkap tapi orphaned.
- ✅ **Samakan penamaan folder frontend.** _Selesai_ — dicek ulang
  2026-10-12, nol referensi tersisa ke path lama `frontend/web/` di luar
  `node_modules`/`.next`.
- 🟡 **Dokumentasikan skema database Supabase** (tabel: `speaker_profiles`,
  `behavior_profiles`, `conversation_sessions`, `conversation_logs`,
  `product_cards`, `ecommerce_accounts`, `voice_verification_logs`,
  `face_verification_logs`) di `backend/README.md` supaya kontributor
  baru tidak perlu reverse-engineer dari kode repo layer.
  _(`backend/README.md` sudah menyebut nama tabel/module, tapi belum
  skema kolom per tabel.)_

---

## Rekomendasi Prioritas (kalau harus pilih 5 dulu)

1. 🔴 **Fix blocking HTTP call di `agent/tools.py`** (bagian 6) — bug baru
   ditemukan, merusak pengalaman inti produk: agent freeze total setiap
   kali user minta add to cart/checkout, paling parah di `checkout()`.
2. 🟡 Rate limiting + lockout di endpoint verifikasi suara — masih nol
   kode, endpoint keamanan paling kritis di seluruh produk.
3. 🟢 Perbaiki CORS wildcard sebelum ke production.
4. 🟡 Structured logging pengganti `print()` — murah tapi langsung
   membantu debugging & observability, termasuk mendeteksi masalah
   seperti #1 lebih cepat.
5. 🟡 CI pipeline minimal (lint + test) — mencegah regresi seiring
   fitur baru ditambah.

_Catatan: audit log verifikasi dan dashboard metric/monitoring (dua item
yang dulunya di top-5 versi sebelumnya) sudah selesai dikerjakan — lihat
status ✅ di bagian 1 dan 6._
