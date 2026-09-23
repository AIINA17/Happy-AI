# Frontend — Voice Shopping Assistant (Next.js)

Folder ini berisi aplikasi web Next.js untuk voice shopping assistant, di-styling dengan
**shadcn/ui** (Radix UI + Tailwind CSS).

## Struktur

- `app/` — route pages (App Router)
    - `page.tsx` — halaman utama chat (setelah login)
    - `login/page.tsx` — halaman login
    - `signup/page.tsx` — halaman signup
    - `history/[id]/page.tsx` — halaman detail riwayat chat per sesi
- `components/` — komponen UI aplikasi (Sidebar, ChatArea, VoiceEnrollment, FaceEnrollment,
  EcommerceAccountLink, VoiceButton, dll.)
- `components/ui/` — komponen dasar shadcn/ui (Button, Dialog, DropdownMenu, dll.) — kode yang
  di-generate lewat `npx shadcn add <komponen>`, sepenuhnya jadi milik project (bukan dependency
  eksternal), boleh diedit langsung
- `hooks/useLiveKit.ts` — hook untuk koneksi LiveKit + verifikasi suara
- `hooks/useVerificationToast.ts` — menampilkan hasil verifikasi suara sebagai toast (sonner)
- `lib/supabase.ts` — client Supabase untuk auth di frontend
- `lib/utils.ts` — helper `cn()` dari shadcn (gabung className Tailwind)
- `types/` — tipe TypeScript untuk pesan, produk, dan hasil verifikasi

## Menjalankan dengan Docker

Dari root project:

```bash
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
NEXT_PUBLIC_FACE_SERVER_URL=http://localhost:8001
```

## Menambah komponen shadcn/ui baru

```bash
npx shadcn@latest add <nama-komponen>
```

File hasilnya masuk ke `components/ui/`. Tema warna (brand color, dark mode) didefinisikan di
`app/globals.css`, di-mapping ke token shadcn (`--primary`, `--background`, dst) — bukan generic
default shadcn, jadi komponen baru otomatis ikut warna brand tanpa perlu diatur ulang.

## Catatan

- Frontend menggunakan Supabase untuk auth email/password.
- Integrasi LiveKit digunakan untuk percakapan suara + verifikasi biometrik.
- Enrollment wajah (`FaceEnrollment`) memanggil service `face_recognition` (port 8001) secara
  langsung — terpisah dari backend `voiceverification` (port 8000).
