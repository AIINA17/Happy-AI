# Frontend — Voice Shopping Assistant (Next.js)

Folder ini berisi aplikasi web Next.js untuk voice shopping assistant.

## Struktur

- `app/` — route pages (App Router)
    - `page.tsx` — halaman utama chat (setelah login)
    - `login/page.tsx` — halaman login
    - `signup/page.tsx` — halaman signup
    - `history/[id]/page.tsx` — halaman detail riwayat chat per sesi
- `components/` — komponen UI (Sidebar, ChatArea, VoiceEnrollment, VoiceButton, dll.)
- `hooks/useLiveKit.ts` — hook untuk koneksi LiveKit + verifikasi suara
- `lib/supabase.ts` — client Supabase untuk auth di frontend
- `types/` — tipe TypeScript untuk pesan, produk, dan hasil verifikasi

## Menjalankan dengan Docker

Dari root project:

```bash
cd integrate
docker-compose up --build frontend
```

Frontend akan tersedia di http://localhost:3000.

## Menjalankan Secara Lokal (tanpa Docker)

```bash
cd frontend
npm install
# atau pnpm/yarn/bun sesuai preferensi

npm run dev
```

Buka http://localhost:3000 di browser.

Pastikan file `.env` di `frontend/` berisi konfigurasi berikut (contoh):

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_SERVER_URL=http://localhost:8000
NEXT_PUBLIC_LIVEKIT_URL=...
```

## Catatan

- Frontend menggunakan Supabase untuk auth email/password.
- Integrasi LiveKit digunakan untuk percakapan suara + verifikasi biometrik.
