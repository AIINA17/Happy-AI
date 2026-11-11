# Halaman `/pipeline`, Dijelaskan Komponen per Komponen

Dokumen ini menjelaskan satu halaman frontend saja: `frontend/app/pipeline/page.tsx`
("Diagram Alir Verifikasi Biometrik") — diagram alir interaktif yang dipakai untuk
menunjukkan ke orang lain (dosen, penguji, pengunjung booth) *apa yang sebenarnya
terjadi* di dalam pipeline suara dan wajah, dengan data nyata, bukan ilustrasi semata.

> Dokumen pendamping yang sudah ada:
> [`ARSITEKTUR_DETAIL_KOMPONEN.md`](./ARSITEKTUR_DETAIL_KOMPONEN.md) §5.12 menyebut
> halaman ini dalam satu baris tabel. [`PENJELASAN_PERHITUNGAN_SUARA_WAJAH.md`](./PENJELASAN_PERHITUNGAN_SUARA_WAJAH.md)
> menjelaskan **matematika** di balik ECAPA-TDNN, anti-spoof, dan ArcFace secara
> mendalam. Dokumen ini **tidak mengulang** matematika itu — fokusnya adalah
> bagaimana halaman ini **dibangun sebagai UI**: komponen apa, state apa, data dari
> mana, dan apa yang terjadi saat kamu mengklik sesuatu.

---

## 0. Cara memakai dokumen ini

### 0.1 Label kejujuran

Sama seperti dua dokumen di atas, setiap klaim di sini punya label:

| Label | Arti |
|---|---|
| **[KODE]** | Dibaca langsung dari source code, tanpa dijalankan di browser. |
| **[DUGAAN]** | Kesimpulan wajar dari kode, tapi perilaku persisnya (animasi, timing, urutan render) belum diverifikasi dengan membuka halamannya. |

Hampir seluruh isi dokumen ini berlabel **[KODE]** — dibaca langsung dari
`app/pipeline/page.tsx` dan setiap komponen yang diimpornya. Tidak ada bagian yang
dijalankan ulang (tidak membuka browser, tidak merekam audio sungguhan, tidak
memotret wajah sungguhan) untuk menulis dokumen ini.

### 0.2 Ruang lingkup

Dibahas: `app/pipeline/page.tsx` dan setiap komponen yang **langsung** diimpornya —
`components/pipeline-flow/*` (BlockNode, SidePanel, LiveFaceCapturePanel,
LightThemeScope, faceTypes) dan sebagian `components/pipeline/*` (LiveCapturePanel,
LayerMagnitudeChart, types, blockExplainer, ecapa/antispoofBlockLabel,
ecapa/antispoofBlockExplainer).

Tidak dibahas: halaman `/agent-pipeline` (komponen terpisah, lihat
`app/agent-pipeline/page.tsx` — diagram alir pemanggilan *tool* agent, bukan
biometrik), dan komponen lama di `components/pipeline/*` yang **tidak** diimpor
halaman ini (misalnya `ArchFlowBox.tsx`, `SpectrogramView.tsx`,
`DecisionCascade.tsx`, `EcapaArchitectureDiagram.tsx`) — sisa dari versi
sebelumnya, lihat §1.

---

## 1. Gambaran besar: apa dan untuk siapa

`app/pipeline/page.tsx:1-16` punya komentar pembuka yang menjelaskan sejarahnya
sendiri: halaman ini adalah **v2** dari "pipeline explainer". Versi sebelumnya
menyajikan data dalam daftar kartu yang ditumpuk; v2 menggantinya dengan **diagram
alir satu-canvas** yang bisa digeser/di-*zoom* (lewat `@xyflow/react`) dan menampilkan
topologi arsitektur yang sesungguhnya:

- Audio masuk → bercabang **paralel** ke dua model (speaker verification +
  anti-spoofing) → menyatu di satu *decision engine*.
- Foto wajah → face recognition → keputusan wajah **sendiri**, terpisah total dari
  cabang suara. Ini bukan penyederhanaan tampilan — di kode backend yang
  sesungguhnya, keputusan wajah memang tidak pernah digabung ke keputusan suara
  (lihat §5.2).

Mengklik blok "Speaker Verification", "Anti-Spoofing", atau "Face Recognition"
**memecah** blok itu menjadi rangkaian sub-tahap aslinya (misalnya ECAPA-TDNN
menjadi 7 blok internal). Mengklik satu sub-tahap membuka panel di sisi kanan berisi
data asli tahap itu — bukan ilustrasi, tapi tensor, bounding box, dan embedding yang
benar-benar ditangkap dari model yang berjalan (lihat §11).

Komentar di baris `app/pipeline/page.tsx:12-16` menegaskan ini secara eksplisit:
seluruh data adalah jejak nyata yang sama yang dipakai versi halaman sebelumnya
(`backend/voiceverification/analysis/capture_pipeline_traces.py` dan
`backend/face_recognition/analysis/capture_face_traces.py`) — v2 hanya mengganti
**cara menampilkannya**, bukan mengganti datanya.

---

## 2. Dua mode: Replay vs Live

Halaman ini punya dua sumber data yang bisa dipilih pengguna, dan keduanya
menghasilkan bentuk data yang **sama** (`PipelineTrace` untuk suara,
`FaceScenario` untuk wajah) — jadi UI di bawahnya tidak perlu tahu mode mana yang
sedang aktif.

| | Replay (default) | Live |
|---|---|---|
| Butuh login? | Tidak | Ya |
| Sumber data | Berkas statis `public/pipeline-demo/traces.json` & `face-traces.json` | `POST /verify-voice/explain` & `POST /face/verify-face/explain` ke backend |
| Kapan dipakai | Default saat halaman dibuka — aman untuk demo booth tanpa bergantung backend hidup | Saat pengguna yang sudah login menekan tombol "Rekam & verifikasi (live)" / "Buka kamera & verifikasi wajah (live)" |
| Mengubah data akun? | Tidak (berkas statis) | Tidak juga — endpoint `/explain` sengaja tidak menyimpan apa pun (§9.3) |

`app/pipeline/page.tsx:364-377` memuat kedua berkas replay sekali saat komponen
pertama kali mount, lewat `fetch("/pipeline-demo/traces.json")` dan
`fetch("/pipeline-demo/face-traces.json")` — keduanya berasal dari
`frontend/public/pipeline-demo/`, jadi disajikan Next.js sebagai berkas statis,
tanpa panggilan ke backend sama sekali untuk mode replay.

Baris `app/pipeline/page.tsx:388-389` menentukan trace mana yang sebenarnya dipakai
untuk dirender:

```ts
const voiceTrace = voiceLive ?? voiceTraces.find((t) => t.scenario_id === voiceScenarioId) ?? null;
const faceScenario = faceLive ?? faceTrace?.scenarios.find((s) => s.scenario_id === faceScenarioId) ?? null;
```

Hasil live (`voiceLive`/`faceLive`) selalu menang kalau ada — begitu pengguna
menekan tombol live dan berhasil, halaman otomatis berpindah ke hasil itu dan
*dropdown* skenario menunjukkan opsi baru "🔴 Hasil live barusan"
(`app/pipeline/page.tsx:439`, `457`).

---

## 3. Peta file & komponen yang dipakai halaman ini

```text
app/pipeline/page.tsx                         <- komponen utama (default export)
├─ components/pipeline-flow/
│  ├─ BlockNode.tsx                           <- tipe node kustom untuk @xyflow/react
│  ├─ SidePanel.tsx                           <- LayerBlockPanel + FaceStagePanel
│  ├─ Panel.tsx                               <- drawer generik di sisi kanan (dipakai SidePanel)
│  ├─ LiveFaceCapturePanel.tsx                <- tombol "buka kamera & verifikasi wajah (live)"
│  ├─ LightThemeScope.tsx                     <- override CSS var jadi tema terang
│  ├─ faceTypes.ts                            <- tipe FaceStageData/FaceScenario/FaceTraceFile
│  └─ faceStageExplainer.ts                   <- teks penjelasan 4 tahap wajah
└─ components/pipeline/
   ├─ types.ts                                <- tipe PipelineTrace/LayerBlockOutput (suara)
   ├─ LiveCapturePanel.tsx                     <- tombol "rekam & verifikasi (live)"
   ├─ LayerMagnitudeChart.tsx                  <- grafik magnitude aktivasi di bawah canvas
   ├─ blockExplainer.ts                        <- tipe BlockExplainer (dipakai bersama)
   ├─ ecapaBlockLabel.ts / ecapaBlockExplainer.ts
   └─ antispoofBlockLabel.ts / antispoofBlockExplainer.ts
components/charts/VerificationChartKit.tsx     <- hanya dipakai untuk statusColor()
```

Semua yang di bawah `pipeline-flow/` khusus dibuat untuk v2 halaman ini (diagram
blok + panel wajah); yang di bawah `pipeline/` sebagian adalah peninggalan v1 yang
masih relevan (label/penjelasan blok, grafik magnitude, tombol live) — komponen v1
yang murni visual kartu (lihat §0.2) sudah tidak dipakai lagi oleh halaman ini.

---

## 4. State yang dipegang `PipelinePage`

`app/pipeline/page.tsx:352-360` mendefinisikan delapan `useState`:

| State | Isi | Diisi oleh |
|---|---|---|
| `voiceTraces` | Daftar skenario suara dari replay | `fetch` ke `traces.json` |
| `faceTrace` | Seluruh berkas replay wajah (termasuk daftar skenario) | `fetch` ke `face-traces.json` |
| `voiceScenarioId` / `faceScenarioId` | Skenario replay yang sedang dipilih di dropdown | Default: skenario pertama; diubah lewat `<select>` |
| `view` | `"overview" \| "ecapa" \| "antispoof" \| "face"` — tampilan graph aktif | `onNavigate` saat blok di-klik |
| `panel` | Isi panel kanan yang sedang terbuka (atau `null`) | `handleSelectLayer` / `handleSelectFace` |
| `session` | Sesi Supabase Auth pengguna (atau `null`) | `supabase.auth.getSession()` + listener `onAuthStateChange` |
| `voiceLive` / `faceLive` | Hasil terakhir dari percobaan live (menang atas dropdown replay, lihat §2) | Callback `onResult` dari `LiveCapturePanel` / `LiveFaceCapturePanel` |

`view` adalah satu-satunya *state machine* nyata di halaman ini: ia menentukan
graph mana yang dirender (§5–§6) dan tombol "← Kembali ke overview" hanya muncul
saat `view !== "overview"` (`app/pipeline/page.tsx:421-428`).

---

## 5. Tampilan overview: topologi graph nyata

### 5.1 Node & edge yang dibangun `buildOverviewGraph`

`buildOverviewGraph()` (`app/pipeline/page.tsx:73-174`) membangun 8 node dan 7 edge
setiap kali `voiceTrace` atau `faceScenario` berubah (dibungkus `useMemo` di
`FlowCanvas`, `app/pipeline/page.tsx:278-298`):

```text
Audio Masuk ──┬─→ Speaker Verification (ECAPA-TDNN) ──┐
              │                                        ├─→ Decision Engine ─→ [keputusan suara]
              └─→ Anti-Spoofing (wav2vec2) ────────────┘

Foto Wajah ──→ Face Recognition (InsightFace buffalo_l) ─→ [keputusan wajah]
```

Tiap blok yang **bisa diklik** (`clickable: true`) menampilkan `stat` ringkas dari
data nyata — misalnya blok ECAPA menunjukkan `score=0.xxx` langsung dari
`voiceTrace.speaker_verification.score`, dan blok anti-spoof menunjukkan
`fake_prob=0.xxxx`. Blok hasil akhir (`voice-final`, `face-final`) diwarnai lewat
`statusColor()` dari `VerificationChartKit.tsx:13-21` — hijau untuk `VERIFIED`,
kuning untuk `REPEAT`, merah untuk `DENIED`, abu-abu kalau belum ada data.

### 5.2 Kenapa jalur wajah dipisah, bukan digabung ke keputusan suara

Ini bukan pilihan desain UI semata. Komentar di `app/pipeline/page.tsx:6-8`
menyatakan eksplisit: *"face recognition is a separate, independent fallback
path — it is NOT merged into the same decision, because it isn't in the real
code either."* Artinya diagram ini sengaja dibuat **jujur terhadap topologi
backend yang sesungguhnya** (lihat `ARSITEKTUR_DETAIL_KOMPONEN.md` §5.9 untuk
alur fallback wajah di percakapan nyata), bukan disederhanakan demi tampilan yang
lebih "rapi".

---

## 6. Klik blok → pecah ke detail asli

`handleNodeClick` (`app/pipeline/page.tsx:305-326`) adalah satu-satunya tempat
klik node ditangani, dan perilakunya bercabang menurut `view` yang sedang aktif:

- Di `view === "overview"`: klik `ecapa` / `antispoof` / `face-recognition` →
  pindah `view` ke tampilan detail masing-masing (`onNavigate`). Blok lain
  (`audio-input`, `voice-decision`, `voice-final`, dst.) tidak `clickable`, jadi
  klik di sana tidak melakukan apa-apa.
- Di `view === "ecapa"` / `"antispoof"`: klik node sub-tahap (bukan node
  `-final`) → `onSelectLayer(kind, index)` membuka panel kanan untuk blok itu.
- Di `view === "face"`: klik salah satu dari 4 node tahap → `onSelectFace(stage)`
  membuka panel kanan untuk tahap itu.

### 6.1 Detail ECAPA & anti-spoof (`buildLayerDetailGraph`)

`buildLayerDetailGraph()` (`app/pipeline/page.tsx:176-230`) mengubah daftar
`LayerBlockOutput[]` nyata (`voiceTrace.speaker_verification.ecapa_blocks` atau
`...anti_spoof.antispoof_blocks` — lihat `components/pipeline/types.ts:17-25`)
menjadi **rantai sekuensial**: blok 1 → blok 2 → … → blok terakhir → node akhir
("Embedding 192-d" atau "Fake/Real Probability"). Tiap node sub-tahap menampilkan
label manusiawi (lewat `ecapaBlockLabel`/`antispoofBlockLabel`, §7.3), bentuk
tensor `[dim1×dim2×…]`, dan `μ=` (mean) dari statistik blok itu.

### 6.2 Detail wajah (`buildFaceDetailGraph`)

`buildFaceDetailGraph()` (`app/pipeline/page.tsx:232-259`) **berbeda** dari dua
fungsi di atas: urutan 4 tahapnya (`det_10g.onnx` → `2d106det.onnx` →
`norm_crop` → `w600k_r50.onnx`) **ditulis statis di kode frontend**, bukan dibaca
dari array data seperti blok suara. Ini konsisten — pipeline wajah InsightFace
memang selalu 4 tahap yang sama, tidak bervariasi per model seperti jumlah blok
ECAPA — tapi berarti fungsi ini **tidak otomatis mengikuti** kalau urutan tahap di
backend berubah; ia harus diubah manual.

### 6.3 Auto-fit graph tiap ganti tampilan

`app/pipeline/page.tsx:300-303` memanggil `fitView({ duration: 500, padding: 0.25 })`
lewat `setTimeout` 50ms setiap kali `view` atau jumlah node berubah — supaya
canvas otomatis menyesuaikan zoom/posisi ke graph yang baru, tanpa pengguna harus
scroll mencari node pertama secara manual. **[DUGAAN]**: delay 50ms ini kemungkinan
untuk menunggu React selesai me-render node baru sebelum `fitView` membaca
ukurannya; perilaku visual persisnya belum diverifikasi dengan membuka halaman.

---

## 7. Side panel: isi detail satu blok

Panel kanan (`components/pipeline-flow/Panel.tsx`) adalah drawer generik —
posisi *fixed*, lebar penuh di mobile dan 544px (`w-136`) di layar lebih besar,
dengan tombol tutup di kanan atas. Dua isinya:

### 7.1 `LayerBlockPanel` (suara)

Dipakai untuk blok ECAPA & anti-spoof (`components/pipeline-flow/SidePanel.tsx:98-150`).
Isinya, berurutan:

1. **4 statistik tensor** (mean/std/min/max), dihitung dari **seluruh tensor**
   blok itu — bukan dari potongan yang ditampilkan di langkah 2 (komentar
   `SidePanel.tsx:95-97` menegaskan ini secara eksplisit, supaya tidak
   menyesatkan pembaca).
2. **`FeatureStrip`**: 64 nilai mentah pertama dari tensor, digambar sebagai
   grid 8×8 kotak kecil — intensitas warna biru (positif) atau oranye (negatif)
   sebanding dengan besar nilainya relatif terhadap nilai maksimum di 64 angka
   itu.
3. **`ExplainerSections`** (dipakai bersama dengan panel wajah, §7.3): rumus,
   input/output, proses, contoh hitungan, dan kenapa blok ini penting — hanya
   tampil kalau `explainer` tidak `null` (lihat §7.3, blok yang tidak dikenal
   nama-nya dapat `explainer: null`).

### 7.2 `FaceStagePanel` (wajah)

Isinya **berbeda per tahap**, karena tiap tahap pipeline wajah punya bentuk data
yang berbeda total (`SidePanel.tsx:206-328`):

| Tahap | Yang ditampilkan |
|---|---|
| `detection` | Foto asli + kotak bounding box digambar di atasnya (`BBoxOverlay`), `det_score`, koordinat bbox |
| `landmark` | Foto asli + 5 titik kunci digambar sebagai titik (`KpsOverlay`), plus jumlah total landmark 2D-106 |
| `alignment` | Potongan wajah 112×112 yang **sudah diluruskan** — ditegaskan di teksnya sebagai "gambar yang masuk ke model pengenalan, bukan ilustrasi" |
| `recognition` | `embedding_dim` (512) + 16 nilai pertama embedding, ditampilkan sebagai grid angka |

Setiap tahap tetap diakhiri dengan `ExplainerSections` yang sama (§7.3).
`BBoxOverlay` dan `KpsOverlay` (`SidePanel.tsx:152-201`) menghitung posisi
piksel relatif terhadap `image_preview` yang ditampilkan — gambar pratinjau
di-*resize* ke lebar tampilan 220px, jadi koordinat bbox/kps diskalakan dengan
faktor `displayWidth / imgW` sebelum digambar.

### 7.3 Sumber teks penjelasan

`ExplainerSections` (`SidePanel.tsx:15-67`) dipakai identik untuk kedua jenis
panel — ia hanya menerima satu objek `BlockExplainer`
(`components/pipeline/blockExplainer.ts`: `formula`, `input`, `output`,
`process`, `calculation`, `why`). Sumbernya berbeda tergantung jenis blok:

- **Suara**: `ecapaBlockExplainer(name)` / `antispoofBlockExplainer(name)` —
  dicocokkan berdasar nama *module* PyTorch yang di-*hook* (misalnya
  `mods.embedding_model.asp` → "Attentive statistics pooling"). Kalau nama
  blok tidak dikenal, fungsi label (`ecapaBlockLabel`/`antispoofBlockLabel`)
  mengembalikan nama mentahnya apa adanya, dan explainer bisa `null` →
  `ExplainerSections` tidak dirender untuk blok itu.
- **Wajah**: `faceStageExplainer(stage)` — hanya 4 kemungkinan (`detection`,
  `landmark`, `alignment`, `recognition`), jadi selalu ada, tidak pernah
  `null`. Komentar di `faceStageExplainer.ts:3-6` mencatat angka-angka contohnya
  diambil dari pengukuran nyata proyek ini sendiri (lihat
  `PENJELASAN_PERHITUNGAN_SUARA_WAJAH.md` §10), bukan angka buku teks.

---

## 8. Grafik pendukung di bawah canvas

### 8.1 `LayerMagnitudeChart`

Saat `view` adalah `"ecapa"` atau `"antispoof"`, sebuah kartu kecil mengambang
di kiri-bawah canvas (`app/pipeline/page.tsx:510-525`) menampilkan
`LayerMagnitudeChart` — grafik SVG manual (bukan library charting) yang
menggambar, untuk tiap blok berurutan:

- Pita min–max (opacity rendah) dan pita mean±std (opacity lebih tinggi), dari
  statistik blok yang sama dengan panel di §7.1.
- Satu garis mean yang menyambungkan semua blok.
- *Hover* di atas satu blok menampilkan tooltip dengan label, mean, std,
  min, max blok itu.

Ini memberi gambaran "bagaimana besar aktivasi berubah sepanjang jaringan" tanpa
perlu membuka satu-satu panel tiap blok.

### 8.2 Catatan liveness untuk tampilan wajah

Saat `view === "face"`, kartu serupa (`app/pipeline/page.tsx:527-534`) menampilkan
`faceTrace.liveness_note` — teks dari berkas replay yang mengingatkan bahwa
pipeline wajah yang digambar di sini **tidak termasuk** pengecekan liveness
(lihat §12).

---

## 9. Mode Live: rekam & verifikasi sungguhan

Blok "Coba Live" di header (`app/pipeline/page.tsx:467-495`) hanya menampilkan dua
tombol live kalau **dua syarat** terpenuhi: `apiBaseUrl` terkonfigurasi
(`NEXT_PUBLIC_SERVER_URL`) **dan** `session` ada (pengguna sudah login). Kalau
salah satu tidak terpenuhi, pesan penjelas ditampilkan sebagai gantinya — bukan
tombol yang disabled tanpa penjelasan.

### 9.1 Live suara

`LiveCapturePanel` (`components/pipeline/LiveCapturePanel.tsx`):
1. Tombol "Rekam & verifikasi (live)" memulai `MediaRecorder` pada stream
   mikrofon (`audio/webm;codecs=opus`), maksimum **8 detik**
   (`MAX_RECORD_SEC`) — berhenti otomatis lewat `setTimeout`, atau manual lewat
   tombol "Stop rekam".
2. Saat berhenti, blob webm di-`POST` sebagai `FormData` (field `audio`) ke
   `${apiBaseUrl}/verify-voice/explain`, dengan header `Authorization: Bearer
   <access_token>`.
3. Respons (bentuknya `PipelineTrace`, sama seperti satu entri `traces.json`)
   diteruskan ke `onResult`, yang di `page.tsx:480-483` mengisi `voiceLive` dan
   memaksa `view` balik ke `"overview"` — supaya pengguna langsung melihat hasil
   barunya di diagram utama.

### 9.2 Live wajah

`LiveFaceCapturePanel` (`components/pipeline-flow/LiveFaceCapturePanel.tsx`)
mirip tapi pakai kamera, bukan mikrofon:
1. Tombol "Buka kamera & verifikasi wajah (live)" meminta `getUserMedia({video:
   {facingMode: "user", ...}})`, menampilkan preview `<video>` + tombol "Ambil
   foto" / "Batal".
2. "Ambil foto" menggambar frame video ke `<canvas>` lalu `canvas.toBlob(...,
   "image/jpeg", 0.9)`.
3. Blob JPEG dikirim sebagai `FormData` (field `image`) ke
   `${apiBaseUrl}/face/verify-face/explain` dengan header `Authorization`
   yang sama.
4. Respons (bentuk `FaceScenario`) mengisi `faceLive` dan juga memaksa `view`
   balik ke `"overview"`.

Komentar `LiveFaceCapturePanel.tsx:9-12` mencatat eksplisit: jalur live ini
**tidak** punya tantangan liveness (kedip/gerak kepala) seperti
`FaceLivenessCapture.tsx` yang dipakai di alur produksi sungguhan — ini memang
demo pengenalan-saja, konsisten dengan apa yang `/face/verify-face/explain`
dukung di backend.

### 9.3 Yang sengaja TIDAK terjadi di endpoint `/explain`

Komentar di `backend/voiceverification/server.py:459-468` dan
`backend/face_recognition/main.py:218-227` menyatakan dengan eksplisit alasan
kedua endpoint `/explain` ada secara terpisah dari endpoint verifikasi normal
(`/verify-voice`, `/verify-face`): **tidak menyimpan apa pun** — tidak ada
update profil perilaku, tidak ada baris log verifikasi baru, tidak ada publish
ke room LiveKit, tidak ada event ke agent belanja. Alasannya: percobaan di
booth/demo oleh siapa saja yang login tidak boleh mencemari riwayat akun
presenter yang sesungguhnya atau memicu aksi agent yang tidak diinginkan. Autentikasi
tetap wajib (`Authorization: Bearer <token>`) karena endpoint ini membaca
embedding enrollment **akun pengguna yang sebenarnya**.

---

## 10. Autentikasi di halaman ini: kenapa tidak redirect

`app/pipeline/page.tsx:379-386` mengambil sesi Supabase di `useEffect`, tapi
**tidak** melakukan redirect ke `/login` kalau sesinya `null` — berbeda dari
kebanyakan halaman lain di aplikasi ini. Komentar di baris yang sama
menjelaskan kenapa: *"Replay mode never needs a login — only the live-capture
buttons do, and only when actually used. No redirect on missing session: a
judge reading this page shouldn't get bounced to /login."* Ini halaman yang
sengaja dirancang agar siapa pun (termasuk penguji yang tidak punya akun) tetap
bisa membuka dan memahami seluruh diagram replay tanpa harus login — login
hanya relevan kalau mereka ingin mencoba live.

---

## 11. Dari mana data replay berasal

Kedua berkas statis di `frontend/public/pipeline-demo/` dibuat **offline**,
sebelumnya, oleh dua skrip analisis di backend — **tidak** dibuat saat halaman
dibuka:

### 11.1 `traces.json` ← `backend/voiceverification/analysis/capture_pipeline_traces.py`

Docstring skrip ini (baris 1-19) menjelaskan: skrip memanggil `BiometricService`
secara langsung dan offline (tanpa FastAPI/Supabase/LiveKit) pada berkas WAV
lokal di `dataset/{enroll,genuine,impostor,spoof}/` (di-gitignore, harus
disediakan sendiri). Hasilnya di-dump ke `pipeline_traces.json`, lalu disalin
manual ke `public/pipeline-demo/traces.json`. Skrip ini juga eksplisit mencatat
bahwa skenario `spoof_sample` **tidak diasumsikan** masuk ke keputusan tertentu
— narasi demo harus mengikuti apa yang benar-benar terukur, bukan sebaliknya.

### 11.2 `face-traces.json` ← `backend/face_recognition/analysis/capture_face_traces.py`

Docstring skrip ini (baris 1-29) menjelaskan: memanggil `ArcFaceModel.app.get()`
yang sama persis dengan yang dipakai `face_recognition/main.py` di produksi,
pada foto lokal nyata — setiap tahap (`det_10g.onnx`, `2d106det.onnx`,
`norm_crop`, `w600k_r50.onnx`) diambil langsung dari objek `Face` milik
InsightFace sendiri, bukan instrumentasi tambahan. Skrip ini juga mencatat
**celah yang disengaja dan jujur**: tidak ada pengecekan liveness pada gambar
statis di jalur ini — liveness hanya berjalan lewat tantangan kedip/gerak
kepala pada kamera live browser (`liveness_challenge.py`), terpisah dari
pipeline yang digambar di halaman ini.

### 11.3 Apa yang nyata, apa yang ilustratif — sekali lagi, lebih spesifik untuk halaman ini

Semua yang dirender halaman ini (statistik blok, embedding, bounding box,
skor, keputusan) berasal dari jejak nyata ini. Yang **tidak** ditampilkan oleh
halaman ini sama sekali adalah "contoh kerja" ilustratif
(`ecapa_worked_example`, `antispoof_worked_example` di tipe `PipelineTrace`,
`components/pipeline/types.ts:34-42`) — field itu ada di data trace, tapi
`app/pipeline/page.tsx` tidak pernah membacanya. Kalau kamu melihat contoh
perhitungan dengan bobot ilustratif (bukan model terlatih), itu ada di dokumen
lain atau komponen lain (`LayerWorkedExample.tsx`), bukan di halaman `/pipeline`.

---

## 12. Keterbatasan & catatan jujur

- **Urutan tahap wajah di-hardcode di frontend** (§6.2) — kalau pipeline
  InsightFace di backend berubah urutan/jumlah tahapnya, `buildFaceDetailGraph`
  harus diubah manual; ia tidak membaca urutan dari data seperti blok suara.
- **Tidak ada liveness check di jalur ini**, baik replay maupun live (§9.2,
  §11.2) — ini bukan bug di halaman ini, tapi batas keamanan yang nyata dan
  terdokumentasi di pipeline pengenalan wajah murni. Pesan ini sudah
  ditampilkan ke pengguna lewat `liveness_note` (§8.2), jadi halaman ini jujur
  soal batasannya sendiri.
- **Keputusan wajah tidak pernah memengaruhi keputusan suara di diagram ini**
  (§5.2) — kalau kamu berharap melihat satu "keputusan akhir gabungan", itu
  tidak ada di sini karena memang tidak ada di kode backend yang sesungguhnya.
- **Mode live memanggil backend sungguhan** (§9) — kalau `NEXT_PUBLIC_SERVER_URL`
  salah atau backend sedang mati, tombol live akan menampilkan notifikasi error
  ("Tidak bisa menghubungi backend") lewat `useNotification()`, bukan gagal diam-diam.

---

## 13. Kamus singkat

Istilah umum (embedding, cosine similarity, ECAPA-TDNN, dst.) sudah dijelaskan di
`ARSITEKTUR_DETAIL_KOMPONEN.md` §0.3 dan `ALUR_SUARA_DAN_WAJAH_RUNTUT.md` §12 — tidak
diulang di sini. Istilah yang khusus relevan untuk membaca halaman ini:

| Istilah | Arti singkat |
|---|---|
| **Replay mode** | Menampilkan trace yang sudah direkam sebelumnya dari berkas statis — tidak butuh backend hidup. |
| **Live mode** | Merekam suara/foto sungguhan dari perangkat pengguna saat ini, dikirim ke endpoint `/explain` backend. |
| **`/explain` endpoint** | Versi endpoint verifikasi yang mengembalikan data breakdown lengkap (tensor per blok, dsb.) dan **tidak menyimpan** hasilnya ke mana pun. |
| **`view`** | State yang menentukan graph mana yang sedang digambar: `overview`, `ecapa`, `antispoof`, atau `face`. |
| **Node "pecah" (`buildLayerDetailGraph`/`buildFaceDetailGraph`)** | Mengubah satu blok ringkas di overview menjadi rantai sub-tahap aslinya. |
