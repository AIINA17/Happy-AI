# Alur Verifikasi Suara dan Wajah di Happy, Dijelaskan Runtut

Dokumen ini dibuat untuk **mengajari**. Ikuti dari atas ke bawah, sesuai perjalanan sebuah rekaman suara:
dari saat pengguna bicara sampai sistem memutuskan "ini benar dia". Di setiap langkah ada tiga hal:
**apa yang dikerjakan, kenapa langkah itu ada, dan apa hasilnya** yang diteruskan ke langkah berikutnya.

Tidak ada contoh hitungan. Yang ada hanya alasan di balik setiap pilihan.

---

## 0. Gambaran besar

Sistem harus menjawab dua pertanyaan tentang rekaman yang masuk:

1. **Siapa yang bicara?** Apakah sama dengan orang yang dulu mendaftar?
2. **Apakah ini suara asli yang sedang bicara**, bukan rekaman yang diputar ulang?

Komputer tidak bisa "mendengar". Ia hanya bisa membandingkan **angka**. Jadi seluruh proses ini adalah
cara mengubah suara menjadi angka yang **mewakili ciri khas suara seseorang**, lalu membandingkan angka itu.

```text
 Pengguna bicara
       │
  [1] Browser merekam            → file audio
       │
  [2] Server merapikan audio     → deretan angka (gelombang) dalam format standar
       │
  [3] Gelombang → "gambar suara" → tabel angka: waktu × frekuensi (spektrogram mel)
       │
  [4] Jaringan saraf ECAPA       → 192 angka = "sidik jari suara"
       │
  [5] Bandingkan dengan sidik jari yang tersimpan saat pendaftaran  → skor kemiripan
       │             ┌──────── pemeriksaan pendamping: cukup panjang? suara palsu? ────────┐
  [6] Keputusan: VERIFIED / REPEAT / DENIED
       │
  [7] Hasil dikirim ke agent → pengguna boleh melakukan aksi sensitif
```

Pendaftaran suara (enrollment) memakai langkah 1 sampai 4 yang **sama persis**. Bedanya, di langkah 5 sidik jarinya
**disimpan**, bukan dibandingkan. Itu sebabnya dokumen ini menjelaskan langkah 1–4 sekali, lalu menunjukkan dua pemakaiannya.

---

## 1. Pengguna merekam suara (di browser)

### Apa yang terjadi
Mikrofon mengubah getaran udara menjadi sinyal listrik, lalu komputer mengukurnya ribuan kali per detik.
Hasilnya adalah **deretan angka** yang naik-turun mengikuti getaran suara. Ini yang disebut **gelombang suara**.

Browser merekam ke dalam format `webm/opus`, lalu mengirimnya ke server bersama token login pengguna.

### Kapan rekaman dimulai dan berhenti
Saat verifikasi, perekam mendengarkan volume mic:
- **Mulai** saat volume melewati ambang bicara.
- **Berhenti** setelah diam sekitar 0,8 detik, tetapi **hanya jika sudah terkumpul minimal 3 detik ucapan**. Batas maksimum 15 detik.
- Saat pendaftaran, pengguna membaca kalimat selama 10 detik.

### Kenapa minimal 3 detik
Pengenal suara membuat sidik jari dari **seluruh** rekaman sekaligus. Ucapan yang terlalu pendek (misalnya "iya")
hanya memuat sedikit bunyi, jadi sidik jarinya kurang meyakinkan dan dianggap mirip orang lain. Dengan beberapa detik ucapan,
bunyi yang tertangkap lebih beragam sehingga sidik jarinya stabil.

### Kenapa dikompres (opus)
Agar file kecil dan cepat dikirim. Kompresi ini membuang bagian yang hampir tidak terdengar, sehingga tidak merusak ciri suara.

**Hasil langkah ini:** satu file audio dari browser.

---

## 2. Server merapikan audio

### Apa yang dikerjakan
1. **Decode** file `webm/opus` menjadi gelombang mentah memakai `ffmpeg`.
2. Ubah ke format standar: **16.000 pengukuran per detik (16 kHz), satu saluran (mono)**.
3. **Samakan volume** agar kekerasan suara berada di level yang sama.

### Kenapa 16 kHz
Hampir semua informasi pada ucapan manusia ada di bawah 8 kHz. Aturan dasar sampling (Nyquist) mengatakan bahwa
16.000 pengukuran per detik cukup untuk menangkap frekuensi sampai 8 kHz. Lebih tinggi hanya memperbesar data tanpa menambah informasi ucapan.
Selain itu, **model yang dipakai dilatih memakai audio 16 kHz**, jadi inputnya harus sama dengan yang ia kenal.

### Kenapa mono
Mic laptop hanya menangkap satu sumber. Dua saluran hanya menggandakan data yang sama.

### Kenapa menyamakan volume
Mic dan jarak bicara pengguna berbeda-beda, sehingga volume rekaman beragam. Penyamaan ini lapisan pengaman.
Catatan jujur: model yang dipakai di langkah berikutnya sebenarnya sudah punya penyama volumenya sendiri,
jadi langkah ini tidak menentukan hasil. Yang sungguh-sungguh menghilangkan pengaruh volume ada di langkah 3.8 (normalisasi rata-rata).

**Hasil langkah ini:** gelombang suara, deretan angka, 16 ribu per detik.

---

## 3. Mengubah gelombang menjadi "gambar suara"

Ini bagian yang paling penting untuk dipahami. Semua keputusan di sini menjawab satu pertanyaan:
**bagaimana membuat angka-angka gelombang itu memperlihatkan siapa yang bicara?**

### 3.1 Kenapa tidak langsung memakai gelombang?
Gelombang hanya menyatakan "seberapa kuat tekanan udara pada tiap saat". Dari situ sulit melihat **nada** dan **warna suara**.
Ciri yang membedakan orang justru ada pada **frekuensi apa saja yang muncul dan seberapa kuat**:

- **Nada dasar (pitch)** dari getaran pita suara.
- **Warna suara (timbre)**, dibentuk oleh rongga mulut, hidung, dan tenggorokan. Bentuknya berbeda pada tiap orang,
  sehingga frekuensi yang diperkuat juga berbeda.

Karena itu gelombang harus diubah menjadi **kandungan frekuensi**.

### 3.2 Dipotong menjadi potongan pendek (frame)
**Apa:** gelombang dipotong menjadi potongan **25 milidetik**, digeser **10 milidetik** tiap potongan, sehingga potongan saling tumpang tindih.

**Kenapa dipotong?** Ucapan berubah sangat cepat: bunyi "a" lalu "k" lalu "u" terjadi dalam sepersekian detik.
Kalau kandungan frekuensi dihitung dari seluruh rekaman sekaligus, kita hanya tahu frekuensi apa saja yang ada
tetapi **tidak tahu kapan**, dan semua bunyi tercampur.

**Kenapa 25 ms?** Dalam rentang sekitar 25 ms, bentuk mulut hampir tidak berubah, sehingga satu potongan
mewakili satu bunyi yang "stabil". Lebih panjang → beberapa bunyi tercampur. Lebih pendek → informasi frekuensinya terlalu kasar
(untuk membedakan frekuensi halus, dibutuhkan potongan yang cukup panjang). 25 ms adalah kompromi yang sudah lazim dipakai.

**Kenapa tumpang tindih (geser 10 ms)?** Supaya tidak ada bagian yang terlewat (alasan lengkapnya ada di 3.3).

### 3.3 Jendela Hamming: kenapa tepi potongan dilunakkan
**Apa:** tiap potongan 25 ms dikalikan sebuah kurva berbentuk lonceng, yaitu **jendela Hamming**: ujung-ujung potongan dikecilkan mendekati nol,
bagian tengah dipertahankan.

**Kenapa?** Perhitungan frekuensi di langkah berikutnya (FFT) menganggap potongan itu **berulang tanpa putus**, seperti kaset yang disambung ujung ke ujung.
Padahal potongan kita dipotong sembarang, sehingga ujung awal dan ujung akhirnya tidak nyambung dan terjadi "lompatan" tiba-tiba.
Lompatan itu terbaca FFT sebagai **frekuensi palsu** yang tidak ada di suara aslinya (disebut *kebocoran spektral*).

Dengan melunakkan tepi hingga mendekati nol, ujung awal dan ujung akhir sama-sama hampir nol sehingga nyambung mulus, dan frekuensi palsu berkurang drastis.

**Kenapa harus tumpang tindih sekarang jelas:** karena tepi tiap potongan dikecilkan, bunyi yang jatuh di tepi satu potongan menjadi lemah.
Potongan berikutnya yang bergeser 10 ms memuat bunyi itu **di bagian tengahnya**, sehingga tidak ada bunyi yang hilang.

**Kenapa Hamming dan bukan jendela lain?** Hamming adalah pilihan standar di pemrosesan suara: meredam kebocoran cukup baik tanpa terlalu melebarkan puncak frekuensi.
Jendela lain (Hann, Blackman) juga bisa; bedanya kecil. Yang penting adalah **memakai jendela yang menghaluskan tepi**, bukan potongan mentah.

### 3.4 FFT: dari "kapan" menjadi "frekuensi apa"
**Apa:** untuk tiap potongan, dihitung **berapa banyak setiap frekuensi** yang menyusunnya. Alatnya adalah transformasi Fourier (cara cepatnya disebut FFT).

**Kenapa bisa?** Gagasan dasarnya: bunyi apa pun bisa disusun dari gelombang sinus murni berbagai frekuensi yang dijumlahkan.
Fourier melakukannya terbalik: diberi bunyi, ia mengatakan **berapa banyak sinus pada tiap frekuensi** yang menyusunnya.

Hasilnya untuk satu potongan adalah 201 angka, satu untuk tiap frekuensi dari 0 sampai 8.000 Hz dengan jarak 40 Hz.

### 3.5 Diambil kekuatannya saja (kuadrat), fase dibuang
FFT menghasilkan angka kompleks yang memuat **kekuatan** dan **fase** (posisi awal gelombang). Sistem hanya memakai **kekuatan**, dikuadratkan menjadi energi.

**Kenapa fase dibuang?** Fase bergantung pada di mana tepatnya potongan dimulai, bukan pada siapa yang bicara. Menggeser potongan sedikit saja
mengubah fase tetapi tidak mengubah orangnya. Jadi fase hanya menambah gangguan.

**Kenapa dikuadratkan?** Yang kita kaitkan dengan "kekerasan" suara adalah energi, dan energi sebanding dengan kuadrat amplitudo.

**Hasil:** tabel waktu × frekuensi (tiap baris satu potongan 10 ms, tiap kolom satu frekuensi). Ini sudah berupa spektrogram biasa.

### 3.6 Filterbank mel: meringkas frekuensi seperti telinga manusia
**Apa:** 201 frekuensi diringkas menjadi **80 kelompok** memakai **80 saringan berbentuk segitiga** yang saling tumpang tindih.
Tiap saringan menjumlahkan energi frekuensi di sekitarnya. Saringan **rapat dan sempit di frekuensi rendah**, **jarang dan lebar di frekuensi tinggi**.

**Kenapa diringkas?**
1. **Terlalu banyak detail yang tidak berguna.** 201 angka mencatat hal sangat halus, misalnya posisi tiap harmonik nada dasar. Itu lebih terkait nada yang sedang diucapkan daripada **bentuk saluran suara** seseorang.
   Menjumlahkan beberapa frekuensi menghaluskan detail itu sehingga yang tersisa adalah **bentuk besar (selubung) spektrum**, yang mencerminkan bentuk mulut dan tenggorokan.
2. **Ukuran lebih kecil**, jaringan saraf lebih ringan dan lebih tahan terhadap gangguan kecil.

**Kenapa rapat di bawah, jarang di atas (skala mel)?**
- Telinga manusia **sangat peka terhadap beda kecil pada frekuensi rendah** dan **kasar pada frekuensi tinggi**. Beda 100 Hz dan 200 Hz terdengar sebagai selisih besar, beda 7.000 dan 7.100 Hz hampir tidak terasa.
- Informasi pembicara paling banyak di frekuensi rendah dan menengah, sehingga resolusi sebaiknya dihabiskan di sana.
- Skala mel adalah pemetaan frekuensi yang meniru kepekaan ini.

**Hasil:** tabel waktu × **80 pita mel**.

### 3.7 Logaritma (desibel): meniru telinga dan menenangkan angka
**Apa:** tiap angka energi diubah ke skala logaritma (desibel).

**Kenapa?** Ada tiga alasan, dan alasan ketiga adalah yang paling penting:
1. **Telinga manusia mendengar secara logaritmik.** Suara 10 kali lebih bertenaga tidak terdengar 10 kali lebih keras.
2. **Rentang energi sangat lebar.** Bunyi keras dan bunyi pelan bisa berbeda triliunan kali lipat. Tanpa log, hanya bunyi paling keras yang berarti bagi jaringan saraf dan yang lain tampak nol.
3. **Mengubah perkalian menjadi penjumlahan.** Suara yang terekam adalah hasil **perkalian**: suara pengguna × pengaruh mikrofon × pengaruh ruangan × volume.
   Setelah log, perkalian itu menjadi **penjumlahan**, sehingga pengaruh mic/ruangan/volume menjadi **angka tambahan yang sama di seluruh rekaman**.
   Angka tambahan yang tetap bisa dihapus dengan mudah. Itulah langkah berikutnya.

Ada juga **lantai**: nilai yang jauh lebih lemah daripada bagian paling keras dinaikkan ke batas bawah. Kenapa? Bagian yang nyaris senyap hanya berisi derau numerik
dan tidak boleh mendominasi angka-angka berikutnya.

### 3.8 Normalisasi rata-rata (CMN): menghapus pengaruh mic dan volume
**Apa:** untuk tiap pita mel, dihitung rata-ratanya sepanjang rekaman, lalu rata-rata itu **dikurangkan** dari seluruh nilai pita tersebut.

**Kenapa?** Karena (lihat 3.7) pengaruh volume dan karakter mikrofon yang tetap sudah berubah menjadi **angka tambahan konstan per pita**.
Mengurangi rata-rata menghapus angka konstan itu. Yang tersisa adalah **perubahan relatif sepanjang waktu**, yaitu isi ucapan dan ciri suara.
Efeknya: orang yang sama memakai mic berbeda atau berbicara lebih pelan tetap menghasilkan tabel yang mirip.

**Batasnya:** cara ini hanya menghapus pengaruh yang **tetap**. Gangguan yang berubah-ubah (derau latar, peredam derau otomatis browser, gema) tidak ikut terhapus.

### Hasil langkah 3
Sebuah **tabel angka** dengan **satu baris tiap 10 ms** dan **80 kolom (pita mel)**. Bayangkan sebagai gambar: sumbu datar adalah waktu,
sumbu tegak adalah frekuensi, terang-gelap adalah kekuatan. Itulah "gambar suara" yang akan "dilihat" jaringan saraf.

---

## 4. Jaringan ECAPA-TDNN: dari gambar suara menjadi sidik jari 192 angka

### Tugas dan cara belajarnya
**Tugas:** menerima "gambar suara" yang panjangnya berbeda-beda, lalu menghasilkan **192 angka tetap** yang disebut **embedding** (sidik jari suara).
Aturan mainnya: rekaman dari **orang yang sama** harus menghasilkan angka yang **mirip**, rekaman dari **orang berbeda** harus **berbeda**, apa pun kalimatnya.

**Bagaimana ia belajar?** Model ini sudah dilatih oleh peneliti lain pada rekaman dari **ribuan pembicara**. Latihannya: diberi rekaman, tebak siapa pembicaranya.
Agar bisa menebak ribuan orang, jaringan terpaksa menemukan **ciri-ciri suara yang paling membedakan orang**, dan memadatkannya ke 192 angka tepat sebelum tahap menebak.
Angka-angka itulah yang kita ambil. Tahap menebak dibuang dan tidak dipakai.

Ciri yang dipelajari bersifat umum. Karena itu model bisa mengenali **orang yang belum pernah ia lihat** (pengguna Happy) tanpa dilatih ulang.

### Isi jaringan, berurutan

**a. Konvolusi atas waktu (TDNN).**
Satu bunyi tidak berarti banyak; yang membedakan adalah **bagaimana bunyi berubah dari satu ke yang berikutnya**.
Blok ini melihat **beberapa potongan berurutan sekaligus** (misalnya 5 potongan) untuk menemukan pola peralihan bunyi.
Aturan yang sama dipakai di sepanjang rekaman, jadi model tidak peduli *kapan* pola itu muncul, hanya *apakah* pola itu muncul.
**Dilasi**: kernel boleh melompati potongan sehingga jangkauan waktunya makin lebar tanpa menambah banyak perhitungan. Setelah beberapa blok, tiap titik sudah "mengetahui" sekitar satu detik ucapan di sekitarnya.

**b. Res2Net: melihat beberapa skala sekaligus.**
Informasi dipecah menjadi beberapa bagian, lalu diproses **bertingkat** (hasil bagian sebelumnya ditambahkan ke bagian berikutnya).
Bagian yang lebih akhir secara tidak langsung melewati lebih banyak penyaringan sehingga **melihat rentang waktu lebih lebar**.
Jadi satu blok menangkap pola cepat dan pola lambat sekaligus, dengan jumlah parameter yang jauh lebih hemat.

**c. SE (Squeeze-and-Excitation): memilih ciri yang penting.**
Jaringan punya ratusan "detektor pola" (disebut kanal). Tidak semuanya berguna untuk rekaman tertentu.
Blok SE merangkum seluruh rekaman, lalu **menaikkan bobot detektor yang relevan dan meredam yang tidak**. Inilah arti *Channel Attention* pada nama ECAPA.

**d. Koneksi residual.**
Masukan blok ditambahkan lagi ke keluarannya. Jaringan yang dalam sulit dilatih karena sinyal belajar melemah di lapisan-lapisan dalam.
Jalan pintas ini membuat tiap blok hanya perlu belajar "koreksi kecil" dari masukannya.

**e. MFA (menggabung beberapa lapisan).**
Keluaran blok-blok tengah digabung. Lapisan awal menyimpan detail halus suara, lapisan akhir menyimpan pola yang lebih abstrak.
Untuk mengenali pembicara keduanya berguna, jadi diambil semua, bukan hanya lapisan terakhir.

**f. ASP (Attentive Statistics Pooling): meringkas seluruh rekaman menjadi satu.**
Sampai tahap ini kita masih punya satu hasil **untuk setiap potongan waktu**. Tujuan akhir adalah **satu vektor untuk seluruh rekaman**. Caranya:
- **Perhatian (attention):** jaringan menilai potongan mana yang paling informatif (misalnya bunyi vokal bersuara) dan memberinya bobot lebih tinggi. Jeda dan desis diberi bobot rendah.
- **Rata-rata dan variasi:** yang diringkas bukan hanya rata-ratanya, tetapi juga **seberapa bervariasi** tiap ciri sepanjang rekaman (gaya bicara, dinamika). Keduanya digabung.

Dua akibat penting dari tahap ini:
1. Tidak peduli rekaman 3 detik atau 15 detik, hasilnya **selalu berukuran sama**, sehingga bisa dibandingkan.
2. Tidak peduli **kalimat apa** yang diucapkan. Yang diringkas adalah ciri suara, bukan isi kata. Itulah sebabnya pengguna tidak harus mengucapkan kalimat yang sama saat mendaftar dan saat verifikasi (disebut *text-independent*).

Namun, rekaman yang sangat pendek memberi ringkasan yang kurang stabil (sedikit bunyi yang dirangkum), dan itu alasan syarat minimal 3 detik di langkah 1.

**g. Lapisan akhir ke 192 angka.**
Hasil ringkasan dipadatkan menjadi **192 angka**. Kenapa 192? Itu ukuran rancangan ECAPA: cukup kecil agar hanya ciri penting yang tersisa
(tidak mengingat derau), cukup besar untuk membedakan banyak orang.

### Langkah terakhir: dibuat "panjangnya satu" (L2)
Vektor 192 angka dibagi dengan panjangnya sendiri sehingga panjangnya menjadi tepat 1.

**Kenapa?** Yang kita pedulikan hanya **arah** vektor (model dilatih agar arahlah yang membedakan orang), bukan panjangnya.
Dengan panjang yang sudah disamakan, perbandingan nanti menjadi perkalian sederhana.

### Hasil langkah 4
**Sidik jari suara: 192 angka dengan panjang 1.**

---

## 5. Dua pemakaian sidik jari: mendaftar dan memverifikasi

### 5.1 Pendaftaran (sekali, atau sampai 3 kali)
1. Pengguna membaca satu kalimat tertentu selama 10 detik.
2. Rekaman melewati langkah 1–4 yang sama.
3. Sidik jari **disimpan** di database dengan sebuah label. Pengguna bisa menyimpan **maksimal 3** profil (misalnya suara biasa, suara serak, suara di tempat ramai).
4. Audio mentah **dihapus**. Yang tersimpan hanya 192 angka (plus gambar spektrogram untuk halaman analisis).

**Kenapa boleh lebih dari satu profil?** Suara satu orang berubah menurut kondisi. Beberapa profil memberi beberapa "patokan" yang berbeda.

### 5.2 Verifikasi (tiap kali sistem perlu memastikan)
Sidik jari rekaman baru dibandingkan dengan **setiap profil** yang tersimpan, dan **diambil skor tertinggi**.

**Kenapa dibandingkan dengan arah, yaitu cosine similarity?**
Cosine mengukur **seberapa searah** dua vektor: 1 berarti searah sempurna, 0 berarti tidak berhubungan, negatif berarti berlawanan.
Karena panjang kedua vektor sudah 1, hitungannya cukup perkalian titik biasa. Model dilatih agar arah vektor yang membedakan orang,
sehingga cosine adalah ukuran yang sejalan dengan cara model dilatih.

**Hasil:** satu angka, **skor suara**. Makin dekat ke 1, makin yakin orangnya sama.

---

## 6. Pemeriksaan pendamping

Skor suara saja belum cukup. Ada tiga pemeriksaan lain yang berjalan pada rekaman yang sama.

### 6.1 Apakah ucapannya cukup panjang?
Panjang ucapan sebenarnya (setelah jeda di awal dan akhir dibuang) dicek. Terlalu pendek → langsung diminta mengulang.
**Kenapa:** alasannya sama dengan di langkah 1, ringkasan dari sedikit bunyi tidak bisa dipercaya.

### 6.2 Apakah ini suara asli, bukan rekaman yang diputar ulang? (anti-spoofing)
**Masalahnya:** pengenal suara hanya menilai *suara siapa*. Orang jahat bisa merekam suara pemilik lalu memutarnya ke mic, dan suaranya memang suara pemilik.

**Solusi:** model kedua, **wav2vec2**, yang hanya menjawab satu hal: *"ini suara manusia hidup, atau suara palsu/rekaman?"* Keluarannya berupa kemungkinan palsu antara 0 dan 1.

**Bagaimana kerjanya, ringkas:**
1. **Gelombang mentah** langsung dimasukkan (tidak lewat spektrogram mel). Alasannya: jejak pemalsuan seperti kompresi, karakter speaker, dan gema bisa tersamarkan bila dipaksa lewat ringkasan mel yang dirancang untuk mengenali *pembicara*.
2. **Lapisan konvolusi** mengubah gelombang menjadi deret ciri, satu tiap 20 ms. Berbeda dari mel, ciri ini **dipelajari** model, bukan dirancang manusia.
3. **Transformer** memungkinkan setiap potongan "memperhatikan" semua potongan lain. Jejak rekaman ulang seperti gema ruangan muncul **di seluruh rekaman**, jadi butuh pandangan menyeluruh, bukan hanya lokal.
4. Hasil dirangkum menjadi dua nilai (palsu, asli), diubah menjadi kemungkinan.

Model ini sudah dilatih lebih dulu pada banyak suara tanpa label, lalu disetel khusus untuk membedakan asli dan palsu.

**Peran di sistem, dan batasnya:** pada pengujian di kanal nyata (browser + LiveKit), keluaran model ini kurang stabil: sering condong ke "palsu" atau "asli" secara ekstrem,
dan pengguna sah kadang dianggap palsu. Karena itu di sistem ini anti-spoof **hanya meminta pengulangan, tidak langsung menolak**. Sebut sebagai **lapisan tambahan**, bukan jaminan.

### 6.3 Pemeriksaan kebiasaan bicara (profil perilaku)
Dari rekaman diambil **nada dasar rata-rata** (pitch) dan **durasi**, lalu dibandingkan dengan kebiasaan pengguna.

**Cara mengukur nada dasar (algoritma YIN):** suara bersuara adalah getaran berulang. YIN menggeser rekaman terhadap dirinya sendiri dan mencari
jarak geser di mana rekaman paling mirip dengan dirinya. Jarak itu adalah periode getaran. Nada dasar = 1 / periode.

**Kenapa dibandingkan lewat z-score:** menyatakan "seberapa jauh dari kebiasaan pengguna, dihitung dalam satuan variasi pengguna itu sendiri".
Satuan ini membuat pitch (Hz) dan durasi (detik) bisa digabung.

**Status jujur:** dalam implementasi saat ini pemeriksaan ini **belum berperan**. Ia baru aktif setelah ada cukup riwayat sampel, dan profil tidak pernah mencapai jumlah itu.
Jangan dipresentasikan sebagai penguat keamanan. "Durasi" juga lebih menggambarkan aturan perekam daripada kebiasaan bicara.

---

## 7. Keputusan akhir

Semua hasil dikumpulkan dan diperiksa **berurutan**:

| Urutan | Pemeriksaan | Jika gagal |
|---|---|---|
| 1 | Ucapan cukup panjang? | **REPEAT**: coba ucapkan kalimat lebih panjang |
| 2 | Skor suara masih di atas batas minimal (0,35)? | **DENIED**: suara tidak cocok |
| 3 | Kemungkinan palsu rendah? | **REPEAT**: ulangi (dicurigai rekaman) |
| 4 | Skor suara ≥ 0,45? | skor 0,35–0,45 → **REPEAT**: belum yakin |
| 5 | Semua lolos | **VERIFIED** |

### Kenapa ada tiga hasil, bukan dua
Pengguna sah kadang mendapat skor "abu-abu" karena tempat bising atau ucapan singkat, bukan karena orangnya berbeda.
Daripada langsung menolak, sistem meminta **mengulang** (REPEAT). Penolakan tegas (DENIED) hanya untuk skor yang jelas rendah.

### Kenapa ambang 0,45 dan 0,35
Angkanya **dipilih dari distribusi skor pada data eksperimen tim**, bukan dari rumus. Pemilik suara umumnya berskor lebih tinggi, orang lain lebih rendah, tetapi sebarannya
**sedikit saling menimpa** di kisaran 0,35. Itu sebabnya ada **pita abu-abu 0,35–0,45** (REPEAT), bukan satu garis.
Ambang 0,45 sengaja dibuat ketat: untuk aksi sensitif, **lebih baik meminta pengguna mengulang daripada menerima orang lain**. Akibatnya sebagian pengguna sah memang perlu mengulang.

---

## 8. Setelah itu: bagaimana hasilnya dipakai sampai pengguna benar-benar terverifikasi

1. **Kapan verifikasi dipicu?** Agent (asisten suara) meminta browser merekam **setiap kali pengguna selesai bicara, selama belum terverifikasi**.
   Jadi pengguna tidak perlu mengucapkan kata sandi khusus; ucapan biasa dalam percakapan diperiksa.
2. Browser mengirim rekaman ke server dan langkah 2–7 berjalan.
3. **Server sendiri yang memberi tahu agent hasilnya** melalui jalur data LiveKit. Browser tidak diberi wewenang melaporkan hasilnya.
   **Kenapa:** kalau browser yang melaporkan, pengguna yang curang bisa berpura-pura melaporkan "VERIFIED". Agent hanya menerima kabar yang datang dari server.
4. Agent mencatat statusnya. Jika **VERIFIED**, gerbang aksi sensitif (misalnya checkout, akun toko) terbuka.
5. Status berlaku **10 menit**, setelah itu pengguna harus diverifikasi ulang.
6. Jika hasilnya REPEAT atau DENIED, percobaan dihitung gagal. **Tiga kegagalan berturut-turut** → agent beralih ke **verifikasi wajah** sebagai cadangan.
   (Catatan: REPEAT juga dihitung sebagai gagal, jadi tiga kali "belum yakin" cukup untuk beralih ke wajah.)
7. Jika verifikasi wajah pun gagal, ada jeda 60 detik sebelum boleh mencoba lagi.

---

## 9. Jalur wajah, berurutan

Dipakai sebagai cadangan. Pendaftaran wajah memakai langkah yang sama, lalu menyimpan sidik jarinya.

### 9.1 Kamera mengambil gambar
Browser mengambil **satu gambar** (JPEG kualitas tinggi) dari kamera. Saat pendaftaran, gambar baru diambil setelah **wajah terdeteksi stabil 1,5 detik**,
untuk menghindari gambar buram saat bergerak.

### 9.2 Liveness: memastikan ada orang hidup (saat verifikasi)
**Masalahnya:** foto pemilik di layar bisa mengelabui pengenalan wajah.
**Solusi:** server memilih satu tantangan **acak**: berkedip, membuka mulut, atau menengok. Browser menilai gerakan itu memakai MediaPipe, yang mengukur seberapa jauh mata menutup,
mulut membuka, atau hidung bergeser.

**Kenapa harus "diam dulu, lalu bergerak":** foto diam memberi angka yang tidak pernah berubah. Dengan mewajibkan **perubahan** (terbuka → tertutup), foto statis tidak lolos.
**Kenapa tantangan dipilih acak oleh server:** agar penyerang tidak bisa menyiapkan satu video gerakan saja.

**Batas yang harus diakui:** gerakan dinilai **di browser**, bukan oleh server, sehingga klien yang dimodifikasi dapat melewatinya. Video rekaman orang sah yang berkedip juga bisa lolos.
Sebut sebagai "pertahanan awal terhadap foto statis", bukan "anti-pemalsuan yang aman".

### 9.3 Server mendeteksi wajah (SCRFD)
Gambar dimasukkan ke detektor wajah yang menghasilkan **kotak wajah** dan **5 titik kunci** (dua mata, ujung hidung, dua sudut mulut).
**Kenapa harus dideteksi dulu:** gambar penuh berisi latar dan orang lain; pengenalan harus bekerja hanya pada wajah.
Aturan sistem: **harus tepat satu wajah**. Nol atau lebih dari satu ditolak, agar jelas wajah siapa yang diperiksa.

Gambar diperkecil dengan mempertahankan rasio (agar wajah tidak melar) dan nilai piksel dinormalisasi supaya sesuai skala yang dikenal jaringan.

### 9.4 Alignment: wajah diluruskan ke pose standar
5 titik kunci dipakai untuk **memutar, memperkecil/memperbesar, dan menggeser** gambar sehingga mata dan mulut jatuh di posisi standar pada kanvas **112×112**.

**Kenapa:** wajah di kamera bisa miring, dekat, jauh, atau bergeser. Daripada menyuruh jaringan menangani semua variasi itu, kita **hilangkan variasinya di awal**.
Jaringan pengenal dilatih dengan wajah yang sudah diluruskan seperti ini.

**Kenapa hanya memutar, menskala, menggeser (tidak melar bebas):** yang membedakan wajah orang adalah **proporsi** (jarak antar mata, lebar mulut).
Putar-skala-geser tidak mengubah proporsi itu. Mengubah bentuk secara bebas justru akan memaksa semua wajah mirip dan menghapus identitas.

### 9.5 Normalisasi piksel
Nilai piksel (0–255) diubah menjadi rentang **−1 sampai +1**, urutan warna disesuaikan (BGR → RGB). **Kenapa:** itulah skala masukan saat jaringan dilatih.
Menyimpang membuat jaringan bekerja di luar kebiasaannya.

### 9.6 Jaringan ArcFace ResNet-50: gambar menjadi sidik jari 512 angka
Jaringan konvolusi 2-D dengan 50 lapisan. Lapisan awal menangkap tepi dan tekstur, lapisan tengah menangkap bagian wajah (mata, hidung), lapisan akhir menggabungkannya menjadi
representasi seluruh wajah. Hasil akhirnya **512 angka**.

**Kenapa ResNet:** sama seperti di ECAPA, koneksi residual memungkinkan jaringan yang dalam dilatih dengan baik.

**Kenapa ArcFace:** pelatihannya menambahkan **syarat jarak sudut minimal** antar orang: wajah orang yang sama harus berkumpul rapat, orang berbeda harus menjauh dengan jarak sudut tertentu.
Karena yang dilatih adalah **sudut**, perbandingannya memakai cosine, sama seperti suara. Panjang vektor lagi-lagi dibuat 1.

### 9.7 Keputusan wajah
Sidik jari wajah baru dibandingkan (cosine) dengan sidik jari yang disimpan. Skor **≥ 0,45** → VERIFIED, selain itu DENIED. **Tidak ada pita REPEAT** dan hanya satu profil per pengguna.
Hasilnya dikirim ke agent oleh server, dengan cara yang sama seperti suara, dan membuka gerbang aksi sensitif yang sama.

**Kenapa wajah terlihat lebih "mudah" daripada suara:** pada data eksperimen tim, skor pemilik dan orang lain pada wajah terpisah **jauh**, sedangkan pada suara sedikit saling menimpa.
Wajah juga tidak bergantung pada panjang ucapan. Tetapi wajah rentan terhadap gambar buram, resolusi rendah, dan wajah tertutup.

---

## 10. Ringkasan satu halaman: kenapa komponen ini dipakai

| Komponen | Dipakai karena |
|---|---|
| 16 kHz mono | informasi ucapan ada di bawah 8 kHz; model dilatih dengan format itu |
| Potongan 25 ms, geser 10 ms | bunyi stabil dalam ±25 ms; tumpang tindih agar tidak ada bunyi yang terlewat |
| Jendela Hamming | menghaluskan tepi potongan agar FFT tidak menghasilkan frekuensi palsu |
| FFT | mengubah "kapan" menjadi "frekuensi apa saja"; frekuensi membawa nada dan warna suara |
| Kuadrat, fase dibuang | energi mewakili kekerasan; fase hanya bergantung posisi potongan, bukan pembicara |
| Filterbank mel (80) | meniru kepekaan telinga, meringkas detail halus menjadi bentuk besar spektrum, memperkecil data |
| Logaritma | meniru telinga, merapatkan rentang energi, mengubah perkalian (mic, ruangan, volume) menjadi penjumlahan |
| Normalisasi rata-rata (CMN) | menghapus pengaruh tetap dari mic dan volume |
| ECAPA-TDNN | mengubah gambar suara menjadi sidik jari tetap tanpa peduli panjang dan kalimat |
| Attention pooling | meringkas seluruh rekaman dengan fokus pada bagian informatif |
| L2 dan cosine | model dilatih agar arah vektor yang membedakan orang |
| Beberapa profil (maks 3) | suara satu orang berubah menurut kondisi |
| wav2vec2 | menilai "suara hidup atau palsu", hal yang tidak dijawab pengenal pembicara |
| Pita REPEAT | pengguna sah sering di zona abu-abu; lebih baik diminta mengulang daripada ditolak |
| Hasil dikirim server ke agent | agar browser tidak bisa memalsukan status terverifikasi |
| SCRFD + alignment | mengisolasi wajah dan menghilangkan variasi pose, ukuran, posisi |
| ArcFace | pelatihan sudut membuat cosine ukuran yang tepat untuk wajah |
| Liveness acak | menahan foto statis |

---

## 11. Batasan yang sebaiknya kamu sampaikan sendiri

Menyebut batasan lebih dahulu membuat penjelasanmu lebih dipercaya.

1. **Model dipakai jadi, tidak dilatih sendiri.** ECAPA dan ArcFace adalah model pretrained; kontribusi tim ada pada integrasi, aturan keputusan, dan evaluasi.
2. **Anti-spoof bukan jaminan.** Keluarannya kurang stabil di kanal nyata, jadi hanya meminta pengulangan.
3. **Liveness dinilai di browser.** Cukup menahan foto statis, tidak menahan video rekaman.
4. **Evaluasi masih kecil.** Sekitar 30 percobaan per kondisi pada data tim; sebut "hasil awal".
5. **Kondisi mic saat mendaftar dan saat verifikasi berbeda.** Saat mendaftar, pemrosesan bawaan browser aktif; saat verifikasi dimatikan.
   Normalisasi rata-rata tidak menghapus pengaruh pemrosesan dinamis seperti itu, sehingga ini kemungkinan ikut menurunkan skor pengguna sah (dugaan, belum diuji).
6. **Profil perilaku belum berperan** dalam keputusan.
7. **Ambang dipilih secara empiris**, bukan dari kalibrasi statistik formal.

---

## 12. Kamus singkat

| Istilah | Arti |
|---|---|
| Gelombang | deretan angka hasil pengukuran suara |
| Frame / potongan | bagian pendek (25 ms) dari gelombang |
| FFT | cara menghitung frekuensi penyusun suatu potongan |
| Spektrogram | tabel waktu × frekuensi |
| Mel | skala frekuensi yang meniru telinga manusia |
| Embedding / sidik jari | deretan angka tetap yang mewakili suara atau wajah |
| Cosine similarity | ukuran seberapa searah dua vektor (−1 sampai 1) |
| Konvolusi | penyaring kecil yang digeser untuk mencari pola |
| Attention | mekanisme memberi bobot lebih pada bagian yang penting |
| Residual | jalan pintas yang menambahkan masukan ke keluaran blok |
| Pretrained | sudah dilatih sebelumnya oleh pihak lain |
| Text-independent | tidak bergantung pada kalimat yang diucapkan |
| Liveness | pemeriksaan bahwa yang di depan kamera orang hidup |
| FAR / FRR | salah-terima / salah-tolak |
| EER | titik di mana FAR sama dengan FRR |
