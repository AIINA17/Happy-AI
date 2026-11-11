# Penjelasan Perhitungan Suara dan Wajah di Happy: untuk Persiapan Sidang

Dokumen ini menjelaskan **setiap langkah perhitungan** di jalur verifikasi suara dan wajah:
apa inputnya, apa rumusnya, bentuk matriksnya, **kenapa** langkah itu ada, dan apa outputnya.
Semua angka diukur dari kode proyekmu (branch `dev`, commit `e09c00b`), bukan dikutip dari teori.

---

## 0. Cara memakai dokumen ini

### 0.1 Label kejujuran

| Label | Arti |
|---|---|
| **[KODE]** | Dibaca dari source code proyek atau library yang dipakai. |
| **[DIJALANKAN]** | Saya jalankan, hasilnya angka nyata dari mesin ini. |
| **[TEORI]** | Rumus/alasan standar di literatur. Cocok dengan kode, tapi bukan hasil pengukuran di sini. |
| **[DUGAAN]** | Kesimpulan masuk akal yang tidak bisa dibuktikan dari repo. Jangan dipresentasikan sebagai fakta. |

### 0.2 Batas bukti yang harus kamu tahu sebelum sidang

1. **Audio uji adalah suara sintetis** (macOS `say`, suara Damayanti/Samantha/Daniel), bukan suara manusia.
   Itu cukup untuk membuktikan *bentuk tensor, rumus, dan sifat matematis* (misalnya gain tidak mengubah embedding).
   Itu **tidak** cukup untuk membuktikan *akurasi* pada manusia.
2. **Foto uji wajah adalah foto astronaut domain publik** dari library scikit-image, bukan wajah pengguna.
   Cukup untuk bentuk tensor, alignment, dan ketahanan terhadap gangguan gambar. Tidak cukup untuk akurasi.
3. **Akurasi pada manusia** hanya datang dari log eksperimen timmu sendiri (bagian 9.3 untuk suara, 11.2 untuk wajah), dengan 30 percobaan per kondisi.
   Itu kecil. Sebut sebagai "hasil awal", bukan "terbukti".
4. Saya tidak menjalankan browser. Bagian browser (perekam suara, MediaPipe) dibaca dari kode saja.

### 0.3 Peta dua jalur (pegang gambar ini selama sidang)

```text
SUARA (verifikasi = "apakah yang bicara orang yang sama, dan apakah suara hidup?")

 mic ──► webm/opus ──► ffmpeg ──► wav 16 kHz mono ──► normalisasi RMS ─┬──► [A] ECAPA-TDNN ──► vektor 192 ──► cosine ke profil ──► skor suara
 (browser)   (kompresi)  (decode)   (deret angka)       (gain 0,1)      │       Fbank 80 mel + CMN ... ASP ... L2
                                                                        ├──► [B] wav2vec2 ──► P(fake) ───────────────────────────► skor spoof
                                                                        └──► [C] trim + YIN ──► durasi, pitch, "rate" ───────────► skor perilaku
                                                                                                    └────────► decide(): VERIFIED / REPEAT / DENIED

WAJAH (verifikasi = "apakah wajah di kamera orang yang sama?")

 kamera ──► JPEG ──► cv2.imdecode ──► SCRFD (deteksi) ──► 5 titik wajah ──► alignment 112×112 ──► ArcFace ResNet-50 ──► vektor 512 ──► cosine ──► ≥ 0,45 ?
 (browser)  (0,92)    BGR uint8       kotak + 5 titik     transform serupa     (x−127,5)/127,5       L2                          ke profil
                                                                                                                                  └─ liveness: dinilai di browser (MediaPipe)
```

### 0.4 Isi

| Bagian | Isi |
|---|---|
| 1 | Suara sebagai angka: sampel, sampling rate, kenapa 16 kHz |
| 2 | Dari gelombang ke spektrum: frame, jendela Hamming, FFT |
| 3 | Dari spektrum ke Fbank: skala mel, filterbank, log/dB, kenapa semua itu |
| 4 | Normalisasi: RMS di server vs CMN di dalam model (bukti numerik) |
| 5 | ECAPA-TDNN: tiap blok, bentuk matriks, kenapa tiap blok ada |
| 6 | Kenapa panjang ucapan menentukan skor, dan ketahanan terhadap kanal |
| 7 | Anti-spoof wav2vec2 |
| 8 | Durasi, pitch (YIN), profil perilaku |
| 9 | Mesin keputusan dan arti ambang |
| 10 | Wajah: dari JPEG ke vektor 512 |
| 11 | Liveness, ambang wajah, dan bukti dari log timmu |
| 12 | Daftar pertanyaan penguji beserta jawaban |
| 13 | Yang jangan kamu klaim di sidang |
| 14 | Cara mengulang semua pengukuran |

---

## 1. Suara sebagai angka

### 1.1 Apa yang sebenarnya diterima komputer

Suara adalah **perubahan tekanan udara terhadap waktu**. Mikrofon mengubahnya jadi tegangan listrik,
lalu *ADC* (analog-to-digital converter) **mengukur** tegangan itu berulang kali dengan jarak waktu
yang tetap. Hasilnya hanya sebuah **deret angka**:

```text
x[0], x[1], x[2], ... , x[N−1]          tiap x[n] adalah bilangan antara −1,0 dan +1,0 (setelah diskalakan)
```

Di proyekmu, setelah `ffmpeg` mengubah webm → wav, **parameternya 16.000 sampel per detik, 1 kanal (mono)**
[KODE: `ffmpeg -ar 16000 -ac 1`].

**[DIJALANKAN]** klip uji 9,143 detik = **146.292 angka**. Cek: 146.292 / 16.000 = 9,143 detik.

Pada deret itu belum ada "pitch", "vokal", atau "siapa yang bicara". Hanya naik-turun amplitudo.
Semua perhitungan berikutnya adalah cara **mengekstrak informasi pembicara dari deret angka itu**.

### 1.2 Kenapa 16 kHz

- **Teorema Nyquist** [TEORI]: sampling pada `fs` hanya bisa mewakili frekuensi sampai `fs/2`. Pada 16 kHz, batasnya **8 kHz**.
- Hampir semua informasi ucapan (vokal, konsonan, desis "s") ada di bawah 8 kHz. Telepon memakai 8 kHz sampling (batas 4 kHz), itu sebabnya suara telepon terdengar "tipis".
- Model ECAPA dan wav2vec2 **dilatih pada audio 16 kHz**, jadi input harus 16 kHz. Kalau tidak, rentang frekuensi yang dilihat model bergeser dan hasilnya tidak bermakna.
- Lebih tinggi (44,1 kHz) hanya menambah data tanpa menambah informasi ucapan, dan lebih lambat.

### 1.3 Kenapa mono

Pembicaraan di mic laptop hanya satu sumber. Dua kanal hanya menggandakan data yang sama. Pada model, input satu kanal.

### 1.4 Kompresi webm/opus: apa yang hilang

Browser merekam dengan `MediaRecorder` format `audio/webm;codecs=opus` [KODE]. Opus adalah kompresi *lossy*:
ia membuang bagian yang kurang terdengar oleh telinga. Server lalu men-*decode* ulang ke wav.

**[DIJALANKAN]** efek kompresi Opus pada embedding suara yang sama (cosine ke embedding versi bersih):

| Bitrate Opus | Cosine ke versi bersih |
|---|---|
| 64 kbps | 0,9989 |
| 32 kbps | 0,9928 |
| 16 kbps | 0,9778 |
| 8 kbps | 0,7286 |

Artinya: pada bitrate normal (≥ 16 kbps), kompresi hampir tidak mengubah identitas suara di mata ECAPA.
Baru pada 8 kbps (sangat rendah) skor merosot. Bitrate yang dipakai `MediaRecorder` browser biasanya
jauh di atas itu [DUGAAN: tidak diatur eksplisit di kode, jadi mengikuti bawaan browser].

---

## 2. Dari gelombang ke spektrum

### 2.1 Masalah: gelombang tidak memperlihatkan "warna" suara

Dua orang mengucapkan "aaa" pada nada yang sama menghasilkan gelombang berbeda bentuknya, tapi bentuk itu
sulit dibaca langsung. Yang membedakan suara orang adalah **seberapa kuat tiap frekuensi muncul**:

- **Pitch (F0)**: frekuensi dasar getaran pita suara. Laki-laki dewasa kira-kira 85–180 Hz, perempuan dewasa kira-kira 165–255 Hz [TEORI].
- **Formant**: puncak energi pada frekuensi tertentu yang dibentuk oleh rongga mulut dan hidung. Bentuk saluran suara tiap orang berbeda, jadi posisi formant berbeda. Inilah sumber utama "timbre" yang membedakan pembicara.

Untuk melihat energi per frekuensi, dipakai **transformasi Fourier**.

### 2.2 Transformasi Fourier (DFT/FFT)

Gagasan [TEORI]: sinyal apa pun bisa dituliskan sebagai jumlah gelombang sinus dengan frekuensi berbeda.
Fourier mengukur "berapa banyak sinus berfrekuensi f yang ada" pada sinyal. Untuk potongan sinyal sepanjang `N` sampel:

```text
X[k] = Σ_{n=0}^{N−1}  x[n] · w[n] · e^(−j·2π·k·n / N)         k = 0, 1, ..., N/2

frekuensi bin ke-k = k · fs / N
```

`X[k]` adalah bilangan kompleks (punya besar dan fase). `FFT` hanya cara cepat menghitung rumus yang sama.

**[DIJALANKAN]** parameter di proyekmu: `N = n_fft = 400`, `fs = 16000`:

- Jumlah bin = N/2 + 1 = **201** (k = 0 sampai 200).
- Jarak antar bin = 16000 / 400 = **40 Hz**. Jadi bin ke-5 mewakili 200 Hz, bin ke-10 mewakili 400 Hz, bin ke-200 mewakili 8000 Hz.
- Itulah arti "201" pada bentuk tensor `[1, 915, 201]` di bawah.

### 2.3 Kenapa dipotong menjadi frame (25 ms) dan bergeser 10 ms

Fourier pada **seluruh** klip 9 detik hanya memberi tahu frekuensi apa saja yang ada **tanpa tahu kapan**.
Padahal ucapan berubah cepat: "a" lalu "k" lalu "u" dalam sepersekian detik. Jadi sinyal dipotong
**frame pendek** dan Fourier dihitung per frame.

Kenapa 25 ms? [TEORI] Dalam jangka sekitar 20–30 ms, bentuk saluran suara kurang lebih tetap
(*quasi-stationary*), jadi spektrumnya bermakna. Lebih panjang → beberapa fonem bercampur; lebih pendek →
resolusi frekuensi terlalu kasar.

**Trade-off yang tidak bisa dihindari** (prinsip ketidakpastian waktu–frekuensi): resolusi frekuensi = `fs / N`.
Frame 400 sampel memberi 40 Hz. Frame 4.000 sampel memberi 4 Hz tapi mencampur 250 ms ucapan.

Parameter `Fbank` SpeechBrain yang dipakai [KODE: `hyperparams.yaml` + `features.py`]:

| Parameter | Nilai | Arti |
|---|---|---|
| `win_length` | 25 ms = 400 sampel | panjang frame |
| `hop_length` | 10 ms = 160 sampel | frame bergeser tiap 10 ms, jadi **tumpang tindih 60%** |
| `n_fft` | 400 | sama dengan panjang frame (tanpa zero-padding) |
| `center` | True | frame pertama berpusat di sampel 0 (diberi padding nol di tepi) |

**Jumlah frame** = `1 + floor(N / hop)`. **[DIJALANKAN]** `1 + floor(146292 / 160) = 915`, dan `STFT` SpeechBrain memang menghasilkan **915** frame.
Itulah arti angka 915 (atau 572 pada klip 5,71 s yang saya pakai di dokumen arsitektur) di sumbu waktu pada semua tensor berikutnya.

Kenapa tumpang tindih? Tanpa tumpang tindih, ucapan yang jatuh di batas dua frame terpotong dan tertimbang
rendah (karena jendela mengecil di tepi). Tumpang tindih 60% memastikan setiap bagian sinyal berada di tengah jendela setidaknya satu kali.

### 2.4 Jendela Hamming

Setelah dipotong 400 sampel, potongan itu **dikalikan jendela Hamming** sebelum Fourier [KODE: `window_fn=torch.hamming_window`]:

```text
w[n] = 0,54 − 0,46 · cos( 2π · n / N )          n = 0 ... N−1
```

Nilainya kecil (0,08) di tepi dan 1,0 di tengah.

**Kenapa?** [TEORI] Fourier mengasumsikan potongan itu **berulang tanpa putus**. Potongan ucapan yang dipotong
mendadak punya "lompatan" di tepi, yang oleh Fourier dibaca sebagai energi palsu di banyak frekuensi
(*spectral leakage*). Jendela yang menghaluskan tepi mengurangi kebocoran itu.

### 2.5 Besar kuadrat: kenapa fasenya dibuang

`X[k]` kompleks. Kode memakai `spectral_magnitude` yang menghitung **|X[k]|²** (daya):

```text
P[k] = Re(X[k])² + Im(X[k])²              (di SpeechBrain 0.5.16: power=1 pada fungsi ini berarti "daya", yaitu kuadrat besar)
```

- **Kuadrat** karena yang kita kaitkan dengan "kekerasan" adalah **energi**, yang sebanding dengan amplitudo kuadrat.
- **Fase dibuang** karena fase bergantung pada posisi tepat frame dalam gelombang, bukan pada siapa yang bicara. Telinga manusia juga hampir tidak peka pada fase absolut, dan model pengenal pembicara tidak memerlukannya.

**[DIJALANKAN]** saya menulis ulang tahap ini sendiri dengan NumPy (padding konstan, Hamming periodik,
`np.fft.rfft`) dan membandingkannya dengan SpeechBrain: selisih maksimum relatif **2,8 × 10⁻⁷**, yaitu hanya
kesalahan pembulatan float32. Jadi penjelasan di atas memang apa yang dikerjakan kode, bukan perkiraan.

**Output tahap ini:** tensor daya `[1, 915, 201]` = (batch, waktu, frekuensi).

---

## 3. Dari spektrum ke Fbank: skala mel, filterbank, log

### 3.1 Masalah: 201 bin terlalu banyak dan terlalu "linear"

201 angka per frame memuat banyak detail halus yang tidak relevan (misalnya posisi tiap harmonik), dan
memperlakukan 7.000 Hz sama pentingnya dengan 700 Hz. Telinga manusia tidak begitu: ia **peka terhadap
perbedaan kecil pada frekuensi rendah** dan **kasar pada frekuensi tinggi**. Beda 100 Hz → 200 Hz terdengar
besar (satu oktaf), beda 7.000 Hz → 7.100 Hz hampir tidak terdengar.

### 3.2 Skala mel

Skala mel [TEORI] adalah pemetaan frekuensi ke "tinggi nada yang dirasakan":

```text
mel(f) = 2595 · log10( 1 + f / 700 )          f dalam Hz          (rumus ini ada di kode: `_to_mel`)
mel(0) = 0,   mel(8000) ≈ 2840
```

Pada frekuensi rendah kurvanya hampir linear; pada frekuensi tinggi melandai seperti logaritma.

### 3.3 Filterbank segitiga: 80 "penampung energi"

Kode membuat **80 filter segitiga** yang pusatnya **berjarak sama pada skala mel** (bukan pada Hz),
dari 0 sampai 8000 Hz. Tiap filter menjumlahkan daya bin-bin di sekitar pusatnya, dengan bobot
segitiga (puncak 1,0 di pusat, turun ke 0 di pusat filter tetangga).

**[DIJALANKAN]** geometri filterbank sebenarnya:

| Filter | Pusat (Hz) | Setengah lebar (Hz) | Bin FFT yang terlibat | Jumlah bobot kolom |
|---|---|---|---|---|
| 0 | 22,1 | 22,1 | **1** | 0,192 |
| 1 | 44,9 | 22,8 | – | – |
| 7 | 197,8 | 27,5 | – | – |
| 14 | 416,3 | 34,2 | – | – |
| 40 | 1806,5 | 76,8 | 4 | 1,916 |
| 78 | 7475,2 | 250,4 | – | – |
| 79 | 7733,5 | 258,3 | **13** | 6,445 |

Ringkasan penyebarannya:

- **28 filter** berada di bawah 1 kHz, **43 filter** di bawah 2 kHz, hanya **19 filter** di 4–8 kHz.
- Pada frekuensi rendah satu filter hanya selebar ±22 Hz (lebih sempit dari jarak bin FFT 40 Hz!), pada frekuensi tinggi ±258 Hz.

**Kenapa ini menguntungkan?**

1. **Resolusi dipakai di tempat informasi pembicara berada.** Pitch dan formant rendah (di bawah 3 kHz) mendapat banyak filter; desis frekuensi tinggi cukup diwakili beberapa filter.
2. **Dimensi turun**: dari 201 ke 80 angka per frame, dengan kehilangan informasi yang paling kecil dampaknya.
3. **Harmonik halus diratakan.** Filter di frekuensi tinggi menjumlahkan banyak bin sehingga struktur harmonik halus (yang lebih terkait pitch daripada saluran suara) hilang, yang tersisa **selubung spektrum** (*spectral envelope*) yang mencerminkan bentuk saluran suara.

**Catatan penting:** jumlah bobot kolom naik dari 0,19 (filter 0) ke 6,4 (filter 79). Filter di SpeechBrain ini
**tidak dinormalisasi per luas**, sehingga pita tinggi secara sistematis berenergi lebih besar. Efeknya konstan per pita,
dan itu persis jenis offset yang **dihapus oleh CMN** di bagian 4.2. Jadi tidak jadi masalah.

**Output tahap ini:** matriks bobot filter `[201, 80]`; hasil kali `daya [915, 201] × bobot [201, 80] = energi mel [915, 80]`.

### 3.4 Logaritma (desibel): kenapa dan bagaimana

Energi mel kemudian diubah ke **desibel**:

```text
Fbank[t, m] = 10 · log10( max( E[t, m], 1e-10 ) )              (multiplier = 10 karena input adalah daya)
```

Kemudian seluruh klip dikoreksi dengan **lantai relatif**: nilai di bawah `maks_klip − 80 dB` dinaikkan ke batas itu (`top_db = 80`) [KODE: `_amplitude_to_DB`].

**Kenapa log?** Ada tiga alasan yang semuanya penting:

1. **Persepsi.** Telinga merasakan kekerasan secara logaritmik. Suara 10× lebih besar dayanya terdengar kira-kira "dua kali" lebih keras, bukan 10 kali.
2. **Rentang dinamis.** Energi mentah pada klip saya berkisar dari 4×10⁻¹¹ sampai 416 (selisih 10¹³). Tanpa log, hanya frame paling keras yang berarti dan sisanya tampak nol bagi jaringan saraf. Dalam dB, rentang itu menjadi sekitar −100 sampai +26.
3. **Perkalian menjadi penjumlahan** [TEORI, ini yang paling penting untuk pengenalan pembicara]. Model sumber-filter ucapan: spektrum ucapan = spektrum sumber suara × respon saluran suara × **respon kanal rekaman (mic, ruangan, gain)**. Di domain log, perkalian-perkalian itu menjadi **penjumlahan**. Kanal rekaman yang konstan menjadi sebuah **offset konstan** pada tiap pita, dan offset konstan itu bisa dihapus dengan sederhana (bagian 4.2). Inilah alasan utama fitur log-mel dipakai di hampir semua sistem pengenal suara.

**Kenapa ada lantai `top_db = 80` dan `amin = 1e-10`?**

- `amin = 1e-10` mencegah `log10(0)` (tak terhingga) pada keheningan digital. Nilainya jadi −100 dB.
- `top_db = 80` memotong semua yang lebih lemah dari 80 dB di bawah puncak. Yang di bawah itu hanya noise numerik. Tanpa lantai, dasar yang sangat dalam akan mendominasi statistik dan membuat fitur tidak stabil.

**[DIJALANKAN]** pada klip uji: nilai minimum sebelum lantai −100 dB, maksimum +26,19 dB, sehingga lantai relatif = −53,81 dB.
**10,6%** dari seluruh sel (frame × pita) terkena lantai ini. Frame terakhir (hening digital, total daya 0,000018) seluruh 80 pitanya sama persis, −53,8 dB.

### 3.5 Satu frame, dibaca dari awal sampai akhir [DIJALANKAN]

Frame ke-627 (detik 6,27), frame paling keras pada klip:

| Tahap | Hasil |
|---|---|
| Total daya semua bin | 1.054,15 |
| 5 bin terkuat | 440, 400, 200, 240, 160 Hz |
| 5 pita mel terkuat | 14, 7, 15, 13, 8 |
| Nilai dB pita 0 / 20 / 40 / 60 / 79 | −17,8 / +8,1 / −22,9 / −21,5 / −34,4 |

Cek makna: pita 7 berpusat 197,8 Hz dan pita 14 berpusat 416,3 Hz (pusat pita k berada di mel `35,06·(k+1)`, lihat tabel 3.3).
Jadi frame ini mengandung energi di **sekitar 200 Hz dan 400–440 Hz**, yaitu **frekuensi dasar suara (±200 Hz) dan harmonik keduanya**.
Hasil itu cocok dengan pitch YIN klip ini (212 Hz, bagian 8.2). Artinya matriks Fbank memang membawa informasi nada dan timbre.

**Output tahap ini:** Fbank `[1, 915, 80]`: 915 frame waktu × 80 pita mel, nilai dalam dB.
Inilah "gambar" suara yang dilihat jaringan saraf. Sumbu x waktu (tiap kolom = 10 ms), sumbu y frekuensi mel.
Inilah juga yang kamu lihat pada halaman `/pipeline` dan spektrogram di `/analysis`.

---

## 4. Normalisasi: dua tingkat, dan mana yang sebenarnya bekerja

Ada **dua** normalisasi di jalur suara, dan penting membedakannya.

### 4.1 Normalisasi RMS di server (`normalize_audio`)

**Apa:** menggeser gain agar RMS (akar rata-rata kuadrat amplitudo) menjadi 0,1:

```text
RMS = sqrt( (1/N) · Σ x[n]² )
x'[n] = clip( x[n] · (0,1 / RMS), −1, +1 )
```

**Alasan di kode** [KODE: komentar `utils/audio.py`]: volume mikrofon berbeda antar perangkat; tanpa penyamaan, klip dari mic pelan
akan "bergeser" fitur-fiturnya dibanding saat enrollment.

**[DIJALANKAN]** pada klip uji: RMS 0,1840 → 0,1000 (gain 0,543), amplitudo puncak 0,757 → 0,411.

### 4.2 CMN di dalam ECAPA (`mean_var_norm`)

Di dalam pipeline ECAPA, langsung setelah Fbank ada tahap `mean_var_norm` dengan `norm_type: sentence` dan `std_norm: False` [KODE: `hyperparams.yaml`].
Artinya, **untuk tiap klip**, **rata-rata tiap pita (sepanjang waktu) dikurangkan**:

```text
Fbank'[t, m] = Fbank[t, m] − (1/T) · Σ_t Fbank[t, m]          (tidak dibagi simpangan baku)
```

Ini adalah **Cepstral Mean Normalization (CMN)** di literatur [TEORI], di sini diterapkan langsung pada log-mel (bukan pada cepstrum).

**Kenapa ini penting?** Karena pada domain dB, perubahan gain adalah **penambahan konstanta ke seluruh matriks**:

```text
x → g·x          ⟹   Fbank_dB → Fbank_dB + 20·log10(g)          (konstan untuk semua frame dan semua pita)
```

dan **respon kanal tetap (mic, ruangan yang tidak berubah)** menjadi **offset konstan per pita**. CMN mengurangi rata-rata tiap pita, sehingga **offset itu hilang**.
Yang tersisa adalah **perubahan relatif sepanjang waktu**, yaitu informasi ucapan itu sendiri.

**[DIJALANKAN]** bukti numerik. Klip yang sama dikalikan gain `g`, lalu diukur rata-rata Fbank dan cosine embedding terhadap embedding klip yang sudah dinormalisasi RMS:

| Gain g | Puncak setelah gain | Rata-rata Fbank (dB) | Pergeseran terukur | `20·log10(g)` | Cosine embedding |
|---|---|---|---|---|---|
| 0,02 | 0,02 | −54,14 | −33,98 | −33,98 | **1,0000** |
| 0,1 | 0,08 | −40,16 | −20,00 | −20,00 | **1,0000** |
| 0,3 | 0,23 | −30,61 | −10,45 | −10,46 | **1,0000** |
| 1 | 0,76 | −20,16 | 0 | 0 | **1,0000** |
| 3 | **1,00 (terpotong)** | −8,21 | +11,95 | +9,54 | **0,7793** |
| 10 | **1,00 (terpotong)** | +1,63 | +21,79 | +20,00 | **0,5400** |

Pembacaan:

1. Selama sinyal tidak terpotong, **pergeseran rata-rata Fbank sama persis dengan `20·log10(g)`**, dan embedding **tidak berubah sama sekali** (cosine 1,0000 sampai 4 desimal), bahkan untuk gain 50 kali lebih kecil.
2. Yang merusak embedding bukan gain, tetapi **pemotongan (clipping)**: pada g = 3 dan 10 puncak melewati ±1,0, bentuk gelombangnya berubah (bukan sekadar membesar), dan cosine jatuh ke 0,78 dan 0,54.
3. **Kesimpulan jujur yang harus kamu pegang:** pada ECAPA, **yang membuat skor tidak bergantung pada volume mic adalah CMN di dalam model, bukan normalisasi RMS di server.** Normalisasi RMS di server **secara praktis tidak mengubah skor** pada kondisi normal.
   Ia bahkan punya risiko kecil: bila `puncak / RMS` lebih dari 10 (20 dB), pengalian gain akan memotong puncak. Pada ucapan normal rasio itu sekitar 4 (klip uji: 0,757/0,184 = 4,1), jadi aman.

   Pernyataan di komentar kode ("tanpa ini fitur bergeser") benar untuk *fitur Fbank mentah*, tetapi **tidak** untuk *embedding*, karena CMN sudah menghapus pergeserannya.

### 4.3 Normalisasi di wav2vec2 (`do_normalize`)

`preprocessor_config.json` model anti-spoof berisi `"do_normalize": true`. Artinya sebelum masuk jaringan, tiap klip diubah menjadi **rata-rata 0 dan simpangan baku 1** (z-score di domain sinyal mentah).

**[DIJALANKAN]** sebelum: rata-rata −0,00005, std 0,1010. Sesudah: rata-rata −9,9 × 10⁻⁹, std **1,0000**.
Akibatnya anti-spoof juga **tidak peka gain**: `fake_prob` identik (0,999966) untuk gain 0,02, 0,1, 0,5, 1,0 dan 3,0.

### 4.4 Ringkasan: siapa yang menormalisasi apa

| Tahap | Di mana | Apa yang dihapus | Efektif? |
|---|---|---|---|
| RMS → 0,1 | server (`normalize_audio`) | gain global | **Tidak berpengaruh pada skor** (CMN & `do_normalize` sudah menghapusnya); hanya berisiko clipping |
| `Fbank` dB | dalam ECAPA | perkalian → penjumlahan | Ya (mengubah gain jadi offset) |
| CMN per klip | dalam ECAPA | offset per pita (gain, respon kanal tetap) | **Ya, inilah penormal utama** |
| `do_normalize` | dalam wav2vec2 | gain global | Ya |
| L2 pada embedding | server | panjang vektor | Ya, agar cosine = dot (bagian 5.8) |

**Yang TIDAK dihapus oleh satupun normalisasi di atas:** gangguan **non-linier dan tidak konstan**, seperti
*noise suppression* dan *auto gain control* browser (yang mengubah sinyal secara dinamis), derau tambahan,
dan reverb. Itulah mengapa perbedaan kondisi enrollment vs verifikasi tetap penting (bagian 6.3).

---

## 5. ECAPA-TDNN: dari Fbank ke vektor 192 angka

### 5.1 Tujuan model, dalam satu kalimat

**Input:** matriks Fbank `[T, 80]` (T frame, panjang bervariasi). **Output:** satu vektor `[192]` yang
"sidik jari suara", dengan sifat: dua klip dari orang yang sama menghasilkan vektor yang **arahnya berdekatan**,
dua orang berbeda menghasilkan vektor yang **arahnya berjauhan**, **berapa pun panjang klip dan apa pun kalimatnya**
(text-independent).

**Bagaimana modelnya belajar** [DUGAAN/TEORI: berdasarkan model card dan paper ECAPA; tidak saya verifikasi ulang]:
dilatih pada VoxCeleb (rekaman banyak pembicara) dengan tugas **mengklasifikasikan siapa pembicaranya**.
Berkas `classifier.ckpt` memang memiliki **7.205 keluaran** (`out_n_neurons: 7205`, [KODE]), jumlah pembicara data latih.
Setelah dilatih, lapisan klasifikasi dibuang; yang dipakai adalah **lapisan sebelum klasifikasi**, yaitu embedding 192-D.
Proyekmu memang hanya memakai `embedding_model` (20,77 juta parameter [DIJALANKAN]); `classifier` (1,38 juta parameter) tidak pernah dipanggil.

Ide dasarnya: agar jaringan bisa menebak 7.205 orang, ia harus mengompres semua ciri khas suara tiap orang
ke dalam 192 angka; ciri itulah yang kita pakai untuk membandingkan orang yang **tidak ada** di data latih
(pengguna Happy).

### 5.2 Rangkaian blok, dengan bentuk matriks nyata

Notasi: `T` = jumlah frame. Pada pengukuran di bawah, klip uji berdurasi 5,71 s sehingga `T = 572`.
Semua angka bentuk, rata-rata, dan simpangan baku dari **[DIJALANKAN]** (satu giliran verifikasi nyata).

| # | Modul (nama di SpeechBrain) | Bentuk keluaran | rata-rata / std | Parameter |
|---|---|---|---|---|
| 0 | `compute_features` (Fbank, bagian 2–3) | `[1, 572, 80]` | −24,19 / 18,93 | 0 (tetap, bukan hasil belajar) |
| 1 | `mean_var_norm` (CMN, bagian 4.2) | `[1, 572, 80]` | 0,00 / 15,04 | 0 |
| – | `transpose` ke `[batch, kanal, waktu]` | `[1, 80, 572]` | | |
| 2 | `blocks.0` = TDNN (kernel 5, dilasi 1) | `[1, 1024, 572]` | +0,060 / 0,354 | 412.672 |
| 3 | `blocks.1` = SE-Res2Net (kernel 3, dilasi 2) | `[1, 1024, 572]` | +0,053 / 0,470 | 2.713.344 |
| 4 | `blocks.2` = SE-Res2Net (kernel 3, dilasi 3) | `[1, 1024, 572]` | +0,056 / 0,656 | 2.713.344 |
| 5 | `blocks.3` = SE-Res2Net (kernel 3, dilasi 4) | `[1, 1024, 572]` | +0,061 / 1,011 | 2.713.344 |
| 6 | gabung keluaran blok 1+2+3 (`torch.cat`) | `[1, 3072, 572]` | | 0 |
| 7 | `mfa` = TDNN kernel 1 (3072 → 3072) | `[1, 3072, 572]` | +0,003 / 0,513 | 9.446.400 |
| 8 | `asp` (Attentive Statistics Pooling) | `[1, 6144, 1]` | +0,171 / 0,483 | 1.576.320 |
| 9 | `asp_bn` (BatchNorm) | `[1, 6144, 1]` | +0,253 / 0,676 | (ikut) |
| 10 | `fc` (Conv1d kernel 1: 6144 → 192) | `[1, 192, 1]` | −0,492 / 21,457 | 1.179.840 |
| 11 | `mean_var_norm_emb` (kurang vektor rata-rata global) | `[192]` | | |
| 12 | L2 di kode kita | `[192]`, norma 1,000000 | | |

Perhatikan **sumbu waktu**: sampai langkah 7 ia tetap 572; di langkah 8 ia menjadi **1**. Itulah momen durasi hilang.

### 5.3 Konvolusi 1-D atas waktu, kanal = pita mel

Setelah Fbank, matriks `[T, 80]` diperlakukan seperti sinyal 1-D dengan **80 kanal** dan panjang T. Sebuah lapisan
konvolusi 1-D (`Conv1d`) dengan `kernel_size = k` menghitung, untuk tiap posisi waktu `t`, jumlah berbobot dari
`k` frame berdekatan pada **semua** kanal masuk:

```text
y[o, t] = b[o] + Σ_{c=1}^{C_in}  Σ_{j=0}^{k−1}  W[o, c, j] · x[c, t + (j − (k−1)/2)·d]          d = dilasi
```

- **Kenapa konvolusi (bukan lapisan penuh):** bobot yang sama dipakai di tiap waktu, jadi model tidak peduli *kapan* suatu pola terjadi, hanya *apa*. Itulah yang diinginkan: pola pembicara berlaku di sepanjang klip.
- **Kenapa 1024 kanal:** tiap kanal belajar "detektor" satu pola spektro-temporal. Lebih banyak kanal, lebih banyak pola yang bisa dibedakan.
- **Kenapa kernel 5 di blok pertama:** menggabungkan 5 frame (50 ms) agar model melihat perubahan spektrum cepat, bukan hanya frame tunggal.
- **Dilasi (`d`)**: kernel dilebarkan dengan melompati frame. Kernel 3 dengan dilasi 4 melihat frame `t−4, t, t+4`. Ini memperluas jangkauan waktu tanpa menambah parameter.
- **Padding "same"**: panjang T tidak berubah (terbukti: 572 → 572).
- **TDNN block** = `Conv1d` → `ReLU` → `BatchNorm` [KODE]. ReLU memberi non-linearitas (tanpa itu tumpukan konvolusi hanya sama dengan satu konvolusi besar); BatchNorm menstabilkan skala aktivasi antar lapisan.

**Jangkauan waktu total (*receptive field*)** [KODE, dihitung dari `kernel` dan `dilasi`]: satu keluaran pada waktu `t` bergantung pada frame di sekitarnya.
Blok 0: ±2 frame. Blok 1–3 memakai Res2Net dengan rantai hingga 7 konvolusi (bagian 5.4), tiap konvolusi menambah `±d` frame: blok 1: 7×2 = ±14, blok 2: 7×3 = ±21, blok 3: 7×4 = ±28.
Total: 2 + 14 + 21 + 28 = **±65 frame, yaitu 131 frame ≈ 1,31 detik** konteks lokal. Setiap vektor tersembunyi di akhir tumpukan sudah "mengetahui" sekitar 1,3 detik ucapan di sekitarnya.

### 5.4 Blok SE-Res2Net (blok 1, 2, 3): apa yang ada di dalamnya

Tiap blok berstruktur (dari kode `SERes2NetBlock`):

```text
x ──► TDNN (kernel 1) ──► Res2Net ──► TDNN (kernel 1) ──► SE ──► (+) ──► keluaran
│                                                                  ▲
└──────────────────────── shortcut (residual) ─────────────────────┘
```

**a. Res2Net (multi-skala dalam satu blok).** Kanal 1024 dipotong menjadi **8 bagian × 128 kanal**. Bagian pertama dilewatkan apa adanya.
Bagian ke-2 diproses konvolusi kernel 3. Bagian ke-3 **ditambah keluaran bagian ke-2** lalu dikonvolusi, dan seterusnya (bertingkat):

```text
y1 = x1
y2 = conv(x2)
y3 = conv(x3 + y2)
...
y8 = conv(x8 + y7)          (7 konvolusi kecil 128→128, kernel 3)
keluaran = gabung(y1 ... y8)
```

Kenapa? Bagian yang lebih akhir secara tidak langsung melewati lebih banyak konvolusi, sehingga **melihat konteks waktu yang lebih lebar**. Satu blok jadi menangkap pola pada beberapa skala waktu sekaligus, dengan parameter jauh lebih sedikit daripada konvolusi penuh 1024 → 1024.

**b. SE (Squeeze-and-Excitation): pembobotan kanal.**

```text
s  = rata-rata sepanjang waktu untuk tiap kanal                 [1024]      ("squeeze": rangkum seluruh klip)
s' = ReLU( W1 · s )                                              [128]       (bottleneck)
a  = sigmoid( W2 · s' )                                          [1024]      (bobot 0..1 per kanal)
keluaran = a ⊙ x                                                  (kalikan tiap kanal dengan bobotnya)
```

Kenapa? Tidak semua kanal sama berguna untuk klip tertentu. SE menilai klip secara keseluruhan lalu
**menaikkan kanal yang relevan dan meredam yang tidak**. Itulah arti "Channel Attention" pada nama ECAPA.

**c. Koneksi residual (`+ shortcut`).** Keluaran blok ditambah masukannya. Tanpa ini, jaringan dalam sulit dilatih
karena gradien menghilang; dengan ini, tiap blok hanya perlu belajar "koreksi" terhadap masukannya.

### 5.5 MFA (Multi-layer Feature Aggregation)

Keluaran **blok 1, 2, dan 3** (masing-masing `[1024, T]`) **ditumpuk di sumbu kanal** menjadi `[3072, T]`, lalu dilewatkan TDNN kernel 1 (3072 → 3072).

Kenapa tidak hanya memakai keluaran blok terakhir? Lapisan awal menyimpan detail akustik halus (timbre, kualitas suara), lapisan akhir
menyimpan pola yang lebih abstrak. Untuk mengenali **pembicara**, kedua level berguna, jadi digabung. Ini salah satu perbaikan utama ECAPA dibanding pendahulunya (x-vector).

### 5.6 ASP (Attentive Statistics Pooling): di sini panjang klip hilang

Sampai langkah 7 kita punya `[3072, T]`: satu vektor 3072-D **per frame**. Tujuan akhirnya **satu vektor per klip**. Cara paling sederhana adalah rata-rata semua frame.
ASP lebih cerdas, memakai **atensi** dan **statistik orde dua**:

```text
1. Statistik global klip:     μ[c] = rata-rata_t h[c,t],     σ[c] = simpangan_baku_t h[c,t]          (masing-masing [3072])
2. Input atensi:              tumpuk [ h[:,t] ; μ ; σ ]  untuk tiap t  →  [9216, T]                    ("global context")
3. Skor atensi:               e[c,t] = V · tanh( W · [h; μ; σ] + b )                                   (W: 9216→128, V: 128→3072)
4. Bobot:                     α[c,t] = softmax_t( e[c,t] )                                             (jumlah α sepanjang waktu = 1, per kanal)
5. Statistik berbobot:        μ̃[c] = Σ_t α[c,t]·h[c,t]
                              σ̃[c] = sqrt( Σ_t α[c,t]·(h[c,t] − μ̃[c])² )
6. Keluaran:                  [ μ̃ ; σ̃ ]  → 3072 + 3072 = 6144
```

- **Kenapa atensi:** tidak semua frame sama informatifnya. Frame vokal bersuara kaya informasi pembicara; frame hening atau desis kurang. Atensi **memberi bobot tinggi pada frame informatif**, tiap kanal belajar bobotnya sendiri.
- **Kenapa simpangan baku:** rata-rata memberi "ciri rata-rata" suara; simpangan baku memberi **seberapa bervariasi** ciri itu (gaya bicara, dinamika). Keduanya melengkapi.
- **Kenapa panjang klip hilang:** jumlah α sepanjang waktu selalu 1, jadi keluaran berukuran tetap **tak peduli T**. Klip 3 detik dan 30 detik sama-sama menjadi `[6144]`.

Dua konsekuensi penting untuk sidang:

1. Model **tidak memerlukan kalimat yang sama** saat enrollment dan verifikasi. Bukti [DIJALANKAN]: suara Damayanti yang sama membaca **kalimat berbeda** memberi cosine **0,9198**, sedangkan suara **berbeda** (Samantha dan Daniel) membaca kalimat **yang sama** memberi **0,3639** dan **±0,14–0,16** (0,1404 pada jalan pertama, 0,1556 setelah klip dibuat ulang: keluaran `say` tidak persis sama tiap kali). Jadi skor mengikuti *siapa*, bukan *apa yang diucapkan*.
2. Statistik yang dihitung dari **sedikit frame lebih berisik**. Itu dasar bagian 6.1.

### 5.7 BatchNorm, FC, dan normalisasi embedding

- `asp_bn`: BatchNorm atas 6144 angka (menyetel skala).
- `fc`: lapisan penuh (konvolusi kernel 1 pada panjang 1) **6144 → 192** (1.179.840 parameter). Ini memadatkan statistik 6144-D menjadi 192-D yang memuat ciri pembicara. Kenapa 192? Itu pilihan arsitektur ECAPA: cukup kecil agar tidak mengingat noise, cukup besar untuk membedakan ribuan orang [TEORI].
- `mean_var_norm_emb` (`norm_type: global`, `std_norm: False`): mengurangi **vektor rata-rata global dari data latih** (tersimpan di `mean_var_norm_emb.ckpt`), memusatkan embedding.
- **L2 di kode kita:** `emb = emb / ‖emb‖`.

**[DIJALANKAN]** norma embedding mentah **314,12**; setelah L2 tepat **1,000000**. Simpangan baku elemen setelah L2 = **0,0722** = 1/√192 (karena vektor satuan dengan rata-rata ≈ 0 dan 192 elemen).

### 5.8 Kenapa cosine similarity, dan kenapa L2

```text
cosine(a, b) = (a · b) / (‖a‖ · ‖b‖)                  rentang −1 sampai +1
bila ‖a‖ = ‖b‖ = 1:        cosine(a, b) = a · b       (dot product biasa)
‖a − b‖² = 2 − 2·cosine(a, b)                          (jarak Euklides kuadrat setara dengan cosine)
```

Kenapa **arah**, bukan panjang? Pada pelatihan klasifikasi berbasis margin sudut (AAM-softmax, [DUGAAN/TEORI: recipe SpeechBrain]) yang dioptimalkan adalah **sudut** antara embedding dan pusat kelas.
Panjang vektor tidak dilatih bermakna. Karena itu perbandingan yang konsisten dengan pelatihan adalah sudut, yaitu cosine.

Kenapa L2 di server? Agar cosine tinggal `np.dot(a, b)`: murah dan sederhana. Embedding disimpan sudah ternormalisasi.

Arti skala skor (rentang praktis):

| Cosine | Arti kasar |
|---|---|
| mendekati 1 | arah hampir identik (klip yang sama, atau orang sama pada kondisi bagus) |
| 0,5–0,9 | kemungkinan orang sama, dengan variasi sesi/kanal/panjang |
| sekitar 0 | tak berkorelasi (orang berbeda) |
| negatif | berlawanan arah; mungkin pada impostor atau spoof (log timmu mencatat minimum −0,12) |

Catatan: docstring `compare_embeddings` di kode menulis "0 to 1". Itu keliru; rentang sebenarnya −1 sampai 1.

### 5.9 Apa yang disimpan di database

Tiap enrollment menyimpan **192 angka float32** (sebagai daftar JSON) di `speaker_profiles`, plus label. Maksimal 3 per pengguna. Saat verifikasi, skor dihitung terhadap **tiap** profil dan diambil **yang tertinggi** (`argmax`), bukan rata-rata.
Satu profil dihasilkan dari **satu** rekaman 10 detik [KODE: `RECORDING_DURATION = 10`, membaca salah satu dari 3 kalimat tetap]. Jadi satu profil = satu titik di ruang 192-D.

---

## 6. Kenapa panjang ucapan dan kondisi rekaman menentukan skor

### 6.1 Panjang ucapan [DIJALANKAN]

Eksperimen: ambil N detik pertama dari klip 9,14 s yang sama, bandingkan embedding-nya dengan embedding klip penuh.

| Panjang | Frame (T) | Cosine ke klip penuh |
|---|---|---|
| 0,4 s | 41 | 0,4198 |
| 0,8 s | 81 | 0,5905 |
| 1,0 s | 101 | 0,4341 |
| 1,5 s | 151 | 0,7345 |
| 2,0 s | 201 | 0,8407 |
| 3,0 s | 301 | 0,8979 |
| 4,0 s | 401 | 0,9588 |
| 5,0 s | 501 | 0,9717 |

Membaca tabel ini dengan benar:

1. **Tren umum naik dengan panjang**: skor 0,42 pada 0,4 detik menjadi 0,97 pada 5 detik, padahal **pembicara dan kalimatnya sama persis**. Penyebabnya ada pada bagian 5.6: statistik ASP dihitung dari sedikit frame, sehingga bergantung pada fonem apa yang kebetulan masuk.
2. **Tidak monoton** (1,0 s lebih rendah dari 0,8 s): 1 detik pertama kebetulan mengandung fonem berbeda dengan 0,8 detik pertama. Ini satu klip, bukan statistik. Jangan klaim "tepat 3 detik = 0,90"; klaim "tren naik, stabil di atas ±3 detik".
3. Inilah dasar `MIN_SPEECH_MS = 3000` di perekam browser dan `MIN_SPEECH_SEC = 1,0` di backend [KODE]: ucapan singkat seperti "iya" menghasilkan skor rendah **walau pemilik suaranya benar**, dan skor rendah berarti `DENIED`/`REPEAT`.

### 6.2 Kondisi kanal [DIJALANKAN]

Suara yang sama, dirusak dengan berbagai cara, lalu dibandingkan dengan versi bersih (setelah RMS dinormalisasi lagi):

| Gangguan | Cosine ke versi bersih |
|---|---|
| Opus 32 kbps | 0,9928 |
| Opus 16 kbps | 0,9778 |
| Reverb ruangan (sekitar 0,2 s) | 0,8970 |
| Derau putih, SNR 30 dB | 0,9065 |
| Derau putih, SNR 20 dB | 0,8078 |
| Low-pass 3.400 Hz (mirip telepon) | 0,8329 |
| Derau putih, SNR 10 dB | 0,6838 |
| Low-pass 2.000 Hz | 0,6582 |
| Derau putih, SNR 0 dB | 0,5796 |

Pembacaan:

- Ambang penerimaan di sistemmu adalah **0,45**, jadi **suara yang sama pada ruangan bergema atau derau 10–20 dB masih di atas ambang**, tetapi **sudah turun jauh dari 1,0**. Itu mengurangi margin terhadap ambang, dan margin itulah yang hilang saat pengguna sah ditolak.
- Derau merusak lebih parah daripada kompresi. Perekam suara di tempat bising atau mic jauh adalah penyebab utama skor rendah, bukan pembicara yang "berbeda".
- Ini hanya **satu klip sintetis**; angka persisnya akan berbeda pada manusia. Yang bisa dipegang adalah **urutan pengaruhnya**: Opus normal (hampir tak ada) < reverb dan derau ringan < band sempit dan derau sedang < derau berat.

### 6.3 Perbedaan kondisi enrollment dan verifikasi [KODE]

Kode frontend menunjukkan perbedaan yang tidak kecil:

| | Enrollment (`VoiceEnrollment.tsx`) | Verifikasi (`useLiveKit.ts`) |
|---|---|---|
| Cara ambil mic | `getUserMedia({ audio: true })` | memakai track mic yang sudah di-publish ke LiveKit |
| Echo cancellation / noise suppression / auto gain | **bawaan browser (biasanya aktif)** | **dimatikan sementara** lewat `applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })` |
| Durasi | 10 detik tetap, membaca kalimat | berhenti saat diam 800 ms, setelah minimal 3 detik ucapan, maksimal 15 detik |

Alasan menonaktifkan pemrosesan saat verifikasi tercatat di komentar kode: pemrosesan browser membuat model anti-spoof salah menandai suara asli
sebagai replay. Tapi akibatnya **enrollment direkam dengan pemrosesan, verifikasi tanpa**: dua kanal yang berbeda.

CMN (bagian 4.2) hanya menghapus perbedaan yang **konstan** (gain, respons frekuensi tetap). *Noise suppression* dan AGC bersifat **dinamis dan non-linier** sehingga tidak terhapus.
**[DUGAAN]** Ini bisa menjadi salah satu penyebab skor pengguna sah lebih rendah dari idealnya; besarnya efek tidak bisa saya buktikan tanpa rekaman manusia dari kedua kondisi.
**Eksperimen yang akan membuktikannya:** enroll dan verifikasi dengan konfigurasi mic yang sama, lalu bandingkan distribusi skor.

---

## 7. Anti-spoof: wav2vec2

### 7.1 Apa yang dijawab model ini

Satu pertanyaan saja: **"Apakah rekaman ini suara manusia hidup, atau palsu (replay dari speaker, suara sintetis, voice conversion)?"** Ia **tidak** tahu siapa pembicaranya.
Output: `P(fake)` antara 0 dan 1.

### 7.2 Langkah demi langkah

**Langkah 0: trim hening** (`librosa.effects.trim(top_db=25)`).
Hitung RMS per jendela 2048 sampel (geser 512), ubah ke dB relatif terhadap jendela terkeras, buang jendela di awal/akhir yang lebih lemah dari −25 dB.
Hanya hening di **ujung** yang dibuang, bukan jeda di tengah. **[DIJALANKAN]** 146.292 → 143.360 sampel (8,96 detik).
Kenapa? Hening tidak membawa informasi spoof dan hanya menambah panjang.

**Langkah 1: normalisasi z-score** (`do_normalize`). Dijelaskan di bagian 4.3. Hasil: rata-rata 0, std 1.

**Langkah 2: CNN pengekstrak fitur dari gelombang mentah.** Berbeda dari ECAPA, **tidak ada Fbank buatan tangan**. Jaringan belajar sendiri fitur dari sampel mentah dengan **7 lapis konvolusi 1-D** [KODE: `config.json`]:

| Lapis | Kernel | Stride | Kanal |
|---|---|---|---|
| 1 | 10 | 5 | 512 |
| 2–5 | 3 | 2 | 512 |
| 6–7 | 2 | 2 | 512 |

Panjang keluaran tiap lapis: `L_baru = floor((L − kernel) / stride) + 1`.
Totalnya: satu frame keluaran mewakili **400 sampel (25 ms)** dan bergeser **320 sampel (20 ms)**.
**[DIJALANKAN]** untuk 143.360 sampel: hasil rumus = **447 frame**. Pada klip lain 89.085 sampel menjadi 278 frame (dibuktikan pada tracing sebelumnya). Fungsinya sama dengan Fbank (membuat deret frame berukuran tetap),
tetapi **dipelajari dari data**, bukan ditentukan manusia (mel, 80 pita). Alasan memakai gelombang mentah: artefak spoof (kompresi, respon speaker, derau mikro) bisa **hilang** bila dipaksa lewat Fbank.

**Langkah 3: proyeksi fitur.** 512 → **768** kanal (`feature_projection`), bentuk `[1, T', 768]`, `T'` = 447 di contoh ini.

**Langkah 4: Transformer (12 lapis).**
Embedding posisi relatif dipelajari dengan konvolusi besar (kernel 128, 16 grup), lalu **12 lapis Transformer**, tiap lapis: self-attention **12 kepala** (tiap kepala 64 dimensi), lalu jaringan maju 768 → 3072 → 768 dengan GELU.

```text
Attention(Q, K, V) = softmax( Q·Kᵀ / √d_k ) · V          (tiap frame "melihat" semua frame lain, bobotnya dipelajari)
```

Kenapa Transformer? Artefak replay seperti **gema ruangan dan karakter speaker** muncul **di seluruh klip**, bukan hanya lokal; self-attention bisa menghubungkan frame yang berjauhan.

**Langkah 5: kepala klasifikasi.**
Proyeksi `768 → 256` (`projector`), **rata-rata sepanjang waktu** (mean pooling) menjadi `[256]`, lalu lapisan `256 → 2` dan **softmax** → `{fake, real}`.

```text
P(fake) = e^{z_fake} / (e^{z_fake} + e^{z_real})
```

Total 94,57 juta parameter [DIJALANKAN], sekitar 4,5 kali ECAPA.

**Asal model:** `MelodyMachine/Deepfake-audio-detection-V2`, arsitektur `Wav2Vec2ForSequenceClassification`. wav2vec2 pada dasarnya dilatih **tanpa label** pada ribuan jam suara
(menebak bagian yang disembunyikan, [TEORI]) lalu **disetel** (fine-tune) untuk membedakan asli vs palsu. [DUGAAN: detail data fine-tuning model ini tidak saya verifikasi; baca model card Hugging Face sebelum sidang.]

### 7.3 Perilaku nyata yang saya ukur, dan artinya [DIJALANKAN]

Semua pada suara sintetis macOS, jadi ini mengukur **stabilitas model**, bukan akurasi deteksi manusia asli vs palsu.

| Perlakuan | `fake_prob` |
|---|---|
| Klip A (Damayanti, kalimat "carikan produk laptop gaming...") | **0,99997** (dianggap palsu) |
| Klip B (Damayanti, kalimat lain) | **0,00006** (dianggap asli) |
| Samantha dan Daniel membaca kalimat klip A | **0,00002** (dianggap asli) |
| Klip A, hanya 0,4 s / 1 s / 2 s pertama | **0,00002** (asli) |
| Klip A, 4 s pertama | **0,99997** (palsu) |
| Klip A + derau putih SNR 30 / 20 / 10 / 0 dB | **0,00002** (asli) |
| Klip A di-Opus 32 / 16 / 8 / 6 kbps | **0,99997** (palsu, tidak berubah) |
| Klip A dengan gain 0,02 sampai 3,0 | **0,99997** (tidak berubah) |
| Simulasi replay (band-pass 150–6000 Hz + reverb + derau) dari klip A | **0,0029** (dianggap asli) |

Pelajaran:

1. **Keluarannya nyaris biner.** Hampir selalu 0,00002 atau 0,99997. Ambang 0,50 dan 0,85 hampir tidak bisa dibedakan.
2. **Sensitif pada isi dan panjang klip.** Suara yang sama membaca kalimat berbeda, atau klip yang dipotong pada titik berbeda, bisa membalik hasil.
3. **Mudah dibalik oleh derau tipis** (SNR 30 dB membalik klip A dari "palsu" menjadi "asli"), tapi **tidak** oleh kompresi atau gain.
4. **Simulasi replay sederhana tidak terdeteksi** (0,0029). Ini satu simulasi buatan, bukan replay nyata lewat speaker dan mic, tetapi cukup untuk tidak mengklaim model ini sebagai pelindung replay yang andal.
5. Cocok dengan temuan timmu sendiri di komentar `decision_engine.py`: pada kanal produksi browser + LiveKit, pengguna sah sering mendapat `fake_prob ≥ 0,95`. Karena itu `replay_deny` kini hanya menghasilkan `REPEAT`, **bukan `DENIED`**.

**Cara menjawab penguji:** "Anti-spoof saya perlakukan sebagai lapisan tambahan yang lunak. Pengukuran saya menunjukkan keluarannya nyaris biner dan tidak stabil pada kanal produksi,
jadi keputusan utama bertumpu pada skor speaker, dan anti-spoof hanya meminta pengguna mengulang. Pertahanan yang sebenarnya terhadap replay lebih kuat bila digabung dengan tantangan acak (misalnya meminta mengucapkan kata acak)."

---

## 8. Durasi ucapan, pitch (YIN), dan profil perilaku

### 8.1 Durasi ucapan (`speech_sec`)

```text
speech_sec = panjang( trim(y, top_db=25) ) / 16000
```

Dipakai sebagai **pagar**: `speech_sec < 1,0` → `REPEAT` ("terlalu singkat"), tanpa menjalankan pipeline lain.
**[DIJALANKAN]** klip uji: 146.292 → 143.360 sampel = 8,96 detik ucapan.

### 8.2 Pitch dengan YIN

**Pitch (F0)** = frekuensi getaran pita suara. YIN [TEORI, de Cheveigné & Kawahara 2002] mencarinya di domain waktu:

```text
1. Untuk tiap frame, hitung fungsi selisih:    d(τ) = Σ_j ( x[j] − x[j+τ] )²
   (bila sinyal periodik dengan periode P, maka d(P) ≈ 0)

2. Normalisasi kumulatif (CMNDF):              d'(τ) = d(τ) / ( (1/τ) · Σ_{k=1}^{τ} d(k) )         d'(0) = 1
   (mencegah memilih τ kecil yang trivial)

3. Pilih τ pertama yang membuat d'(τ) < 0,1 (trough_threshold) → interpolasi parabola

4. F0 = fs / τ
```

Parameter di proyek [KODE + `librosa 0.11`]: `fmin = 50`, `fmax = 300`, `sr = 16000`, `frame_length = 2048` (128 ms), `hop = 512` (32 ms).
Rentang lag yang dicari: `τ` dari `16000/300 = 53` sampai `16000/50 = 320` sampel.

**[DIJALANKAN]** pada klip uji: **286 frame**, rata-rata **212,5 Hz**, median 212,7, simpangan baku 27,1. Hanya 2% frame menempel di batas 300 Hz.
Sebagai pembanding, `pyin` (versi yang menandai bersuara/tak bersuara, `fmax = 400`) memberi median 213,1 Hz dan 98% frame bersuara.
Pada rekaman manusia dengan jeda dan napas, angkanya akan lebih berisik daripada TTS yang sangat teratur.

Dua catatan jujur:

1. `yin` **tidak** membedakan bingkai bersuara dan hening. Kode mengambil `np.nanmean` seluruh frame, termasuk frame hening/desis, jadi "pitch" adalah **perkiraan kasar**, bukan F0 bersih.
2. `fmax = 300` bisa terlalu rendah untuk sebagian suara perempuan atau nada tinggi pada intonasi; batas itu bisa memotong estimasi. Itu keterbatasan pilihan parameter, bukan kesalahan YIN.

### 8.3 "Rate"

`rate = jumlah_sampel / 16000`: **durasi klip dalam detik** (termasuk hening). Itu **bukan** laju bicara (kata per detik).
Pada verifikasi, durasinya ditentukan oleh aturan perekam browser (minimum 3 detik ucapan, hentikan setelah diam 800 ms, maksimum 15 detik) dan kalimat yang diucapkan, bukan kebiasaan bicara.
Jadi fitur ini lemah sebagai ciri pembicara; sebut sebagai **proksi kasar**.

### 8.4 Profil perilaku: rata-rata dan simpangan baku berjalan (Welford)

Satu pembaruan per sampel baru `x`:

```text
n   ← n + 1
δ   ← x − mean
mean ← mean + δ / n
M2  ← M2 + δ · (x − mean_baru)
std ← sqrt( M2 / n )
```

Kenapa Welford, bukan menyimpan semua sampel? Bisa diperbarui **satu per satu** tanpa menyimpan riwayat, dan **stabil secara numerik** (rumus naif `E[x²] − E[x]²` kehilangan presisi).
Variabel `var_pitch`/`var_rate` di kode sebenarnya adalah `M2`, bukan varians.

### 8.5 Skor perilaku: z-score dan kernel Gaussian

```text
z_pitch = (pitch_baru − mean_pitch) / max(std_pitch, 1e-6)
z_rate  = (rate_baru  − mean_rate ) / max(std_rate , 1e-6)

skor_pitch = exp( −0,5 · z_pitch² )          skor_rate = exp( −0,5 · z_rate² )
behavior_score = 0,5 · ( skor_pitch + skor_rate )          rentang 0..1
```

**Kenapa z-score:** menyatakan seberapa jauh nilai baru dari kebiasaan pengguna **dalam satuan simpangan bakunya sendiri**. Pitch (Hz) dan rate (detik) berbeda satuan; z-score menyamakannya.
**Kenapa `exp(−0,5·z²)`:** bentuk kurva Gaussian. Skor 1,0 di titik rata-rata, turun mulus ke 0 bila menjauh.

| z | skor |
|---|---|
| 0 | 1,000 |
| 1 | 0,607 |
| 2 | 0,135 |
| 3 | 0,011 |

Ambang `behavior_repeat = 0,15`: komentar kode menjelaskan bahwa pada z = 2 satu suku sudah turun ke 0,135, sehingga **pitch dan rate sekaligus harus sekitar 2 simpangan baku menyimpang** agar aturan ini aktif [KODE: komentar `decision_engine.py`]. Itu sengaja longgar.

**Kelemahan nyata [DIJALANKAN, bagian 6.5 dokumen arsitektur]:** profil dari enrollment punya `n_samples = 1`, sehingga `std = 1e-6`. Pitch yang berbeda hanya 0,001 Hz sudah memberi z = 1000, dan skor ≈ 0. Pada kondisi itu gerbang perilaku tidak dipakai (butuh `n_samples ≥ 5`), dan karena profil tidak pernah tumbuh melewati 1, gerbang itu **tidak pernah aktif**.

---

## 9. Mesin keputusan dan arti ambang

### 9.1 Urutan keputusan (setelah pagar durasi)

```text
speech_sec < 1,0 ?                         → REPEAT   "terlalu singkat"
skor_suara < 0,35 ?                        → DENIED   "Speaker score too low"
P(fake) ≥ 0,85 ?                           → REPEAT   "Replay attack detected, please repeat"
P(fake) ≥ 0,50 ?                           → REPEAT   "Potential replay attack detected"
skor_suara ≥ 0,45 ?                        → (jika perilaku ok / dilewati)  VERIFIED
                                              (jika n≥5 dan perilaku < 0,15) → REPEAT
selain itu (0,35 ≤ skor < 0,45)            → REPEAT   "Uncertain verification, please repeat"
```

**[DIJALANKAN]** hasil sebenarnya per rentang skor (replay = 0): `< 0,35` → DENIED; `0,35–0,449` → REPEAT; `≥ 0,45` → VERIFIED.
Cabang "Speaker verification failed" tidak pernah tercapai.

### 9.2 Kenapa ada tiga hasil (bukan dua)

Pengguna sah sering kali memberi skor "abu-abu" karena kanal atau panjang klip, bukan karena berbeda orang. Tiga hasil memungkinkan sistem **meminta ulang** daripada langsung menolak.
`REPEAT` = "belum yakin, coba lagi", `DENIED` = "skor terlalu rendah untuk orang yang sama".

### 9.3 Kenapa ambang 0,45 dan 0,35? Bukti dari timmu

Angka ambang **tidak diturunkan dari rumus**, dan kode tidak mencatat alasannya. Ia dipilih secara empiris. Data pendukung dari log timmu sendiri
(`docs/ARSITEKTUR_HAPPY_SAAT_INI.md` bagian 8, 30 percobaan per kondisi):

| Kondisi | `speaker_score` minimum | maksimum | rata-rata |
|---|---|---|---|
| Genuine (pemilik) | 0,3541 | 1,0000 | 0,5677 |
| Impostor (orang lain) | 0,0448 | 0,3553 | 0,2062 |
| Spoof | −0,1222 | 0,3071 | 0,0784 |

Hasil yang tercatat di log timmu: genuine **25/30 VERIFIED**, 5 REPEAT; impostor **0/30 VERIFIED** (27 DENIED, 3 REPEAT); spoof 30/30 DENIED.
EER (titik FAR = FRR) di sweep skor: **3,33%** pada ambang ≈ **0,3547**.

Cara membacanya di sidang:

- **FAR** (*False Acceptance Rate*) = impostor yang diterima / seluruh impostor. **FRR** (*False Rejection Rate*) = pemilik yang ditolak / seluruh pemilik. Menaikkan ambang → FAR turun, FRR naik; menurunkannya sebaliknya.
- **EER** = titik di mana keduanya sama; ukuran kualitas model yang tidak bergantung pada ambang tertentu.
- Ambang operasional **0,45 lebih ketat daripada ambang EER (0,355)**: dengan itu FAR = 0% tetapi FRR = 16,7% (5 dari 30 genuine harus mengulang).
  Alasan wajar: untuk akses ke aksi sensitif (checkout, akun toko), **lebih baik meminta pengguna mengulang daripada menerima impostor**.
- Impostor maksimum (0,3553) dan genuine minimum (0,3541) **saling menimpa tipis**. Itu alasan ada pita REPEAT 0,35–0,45 dan bukan satu garis.
- **Batasan:** 30 percobaan per kondisi dan beberapa pembicara saja. Hasilnya indikatif, tidak cukup untuk klaim akurasi umum.

---

## 10. Wajah: dari JPEG ke vektor 512 angka

Peta ringkas (angka tensor nyata dari foto uji **[DIJALANKAN]**, foto astronaut 512×512):

```text
kamera 640×480 ──► JPEG q=0,92 ──► server: cv2.imdecode ──► [H,W,3] BGR uint8
   ──► SCRFD det_10g: letterbox 640×640, (x−127,5)/128, RGB   ──► kotak (89,6 × 119,7 px), skor 0,83, 5 titik
   ──► transform serupa (skala 0,88, rotasi −3,2°)              ──► potongan 112×112
   ──► (x−127,5)/127,5 → [−1, +1], RGB                           ──► tensor [1,3,112,112]
   ──► ArcFace ResNet-50 (w600k_r50)                             ──► vektor [512], norma mentah 19,65
   ──► bagi norma (L2)                                           ──► vektor satuan, simpangan baku 0,0442
   ──► dot dengan profil                                          ──► cosine; ≥ 0,45 → VERIFIED
```

### 10.1 Di browser: kamera dan pemilihan frame

- Kamera: `getUserMedia({ video: { width: ideal 640, height: ideal 480, facingMode: "user" } })` [KODE].
- **Saat enrollment**, `FaceDetector` MediaPipe (model BlazeFace *short-range*, ringan) berjalan tiap frame. Syaratnya **wajah harus terdeteksi terus-menerus selama 1,5 detik** (`STABILITY_DURATION_MS = 1500`). Jika wajah hilang sedetik, penghitung diulang dari nol.
  Setelah stabil, **satu frame** disalin ke `canvas` pada resolusi asli video dan di-*encode* JPEG kualitas 0,92.
  Alasan menunggu stabil: menghindari gambar buram saat bergerak. Alasan JPEG 0,92: kompresi sangat ringan sehingga detail wajah tidak banyak hilang.
- **Tidak ada pengecekan kualitas lain** (ketajaman, pose, cahaya) pada enrollment. Jadi satu frame buruk yang lolos jadi profil.
  Embedding wajah hanya **satu per pengguna**; mendaftar ulang menimpa profil lama.

### 10.2 Di server: dekode

`cv2.imdecode` mengubah byte JPEG menjadi array NumPy `[tinggi, lebar, 3]`, tipe `uint8`, urutan kanal **BGR** (kebiasaan OpenCV, bukan RGB).
Gambar yang tidak terbaca → `ValueError` → HTTP 400.

### 10.3 Deteksi wajah: SCRFD (`det_10g.onnx`)

**Tujuan:** menemukan wajah dan **5 titik kunci** (mata kiri, mata kanan, ujung hidung, sudut mulut kiri, sudut mulut kanan). Model ini 4,23 juta parameter.

**Langkah (dari kode InsightFace, [KODE] + [DIJALANKAN]):**

1. **Letterbox ke 640×640.** Gambar diperkecil dengan **mempertahankan rasio aspek**, ditempel di pojok kiri-atas kanvas hitam 640×640. Skala `det_scale` disimpan untuk mengembalikan koordinat nanti.
   Kenapa mempertahankan rasio? Meregangkan gambar mengubah bentuk wajah dan merusak deteksi.
2. **Normalisasi piksel:** `(piksel − 127,5) / 128` dan urutan kanal ditukar BGR → RGB (`swapRB=True`). Hasil: nilai kira-kira −1 sampai +1, tensor `[1, 3, 640, 640]`.
   Kenapa menormalisasi? Jaringan dilatih dengan masukan berpusat di nol dan berskala kecil; masukan 0–255 mentah membuat aktivasi tidak stabil.
3. **Jaringan menghasilkan 9 keluaran** = 3 skala × (skor, kotak, titik kunci). Skalanya "stride" 8, 16, dan 32 piksel, untuk wajah kecil, sedang, dan besar (*feature pyramid*).
   Tiap posisi grid punya **2 jangkar** (*anchor*). Jumlah jangkar: `(640/8)²·2 + (640/16)²·2 + (640/32)²·2 = 12.800 + 3.200 + 800 = 16.800`.
   (Keluaran pertama berbentuk `[12800, 1]` [DIJALANKAN], sesuai hitungan.)
4. **Dekode:** untuk tiap jangkar, jaringan memprediksi **jarak** dari titik jangkar ke sisi kotak (kiri, atas, kanan, bawah), dikali stride; dan 10 angka untuk 5 titik kunci (juga relatif ke jangkar).
5. **Saring:** buang jangkar dengan skor < **0,5** (`det_thresh`).
6. **NMS** (*Non-Maximum Suppression*, ambang IoU **0,4**): banyak jangkar menunjuk wajah yang sama; ambil yang skornya tertinggi, buang yang tumpang tindih >40% dengannya.
7. Bagi koordinat dengan `det_scale` → kembali ke koordinat gambar asli.

**[DIJALANKAN]** foto uji: 1 wajah, kotak `[180,9; 59,4; 270,5; 179,1]` (89,6 × 119,7 piksel), **skor 0,8304**.
Titik kunci (x, y): mata kiri (204,3; 100,9), mata kanan (247,2; 102,9), hidung (224,1; 128,7), mulut kiri (202,7; 139,1), mulut kanan (244,8; 141,1).

**Aturan proyekmu:** `len(faces) == 0` → "Tidak ada wajah"; `len(faces) > 1` → "lebih dari satu wajah". Hanya tepat satu wajah yang diterima [KODE].

**Catatan:** setelah deteksi, library menjalankan **tiga model tambahan** pada tiap wajah (`landmark_3d_68`, `landmark_2d_106`, `genderage`) yang hasilnya **tidak dipakai** proyekmu.
**[DIJALANKAN]** pada CPU, JPEG 640×480: semua modul median **315 ms**, hanya deteksi+pengenalan (`allowed_modules=["detection","recognition"]`) **282 ms**, embedding identik. Penghematannya kecil (≈10%), jadi ini optimasi opsional.

### 10.4 Alignment: kenapa wajah "diluruskan"

Jaringan pengenal dilatih dengan wajah yang **sudah diluruskan ke pose standar**. Wajah di kamera bisa miring, dekat, jauh, bergeser. Daripada menuntut jaringan menangani semua variasi itu (butuh kapasitas lebih), kita
**menghilangkan variasi rotasi, skala, dan posisi di awal**.

**Cara:** cari **transformasi serupa** (*similarity transform*) yang membuat 5 titik kunci wajah sedekat mungkin dengan 5 titik **templat** ArcFace di kanvas 112×112:

```text
templat ArcFace (112×112):
  mata kiri  (38,29; 51,70)     mata kanan (73,53; 51,50)     hidung (56,03; 71,74)
  mulut kiri (41,55; 92,37)     mulut kanan (70,73; 92,20)

transformasi:   [x'; y'] = s·R(θ)·[x; y] + [tx; ty]            (4 derajat kebebasan: skala s, rotasi θ, geser tx, ty)

dalam bentuk matriks 2×3:   M = [[ a, −b, tx ], [ b, a, ty ]]       a = s·cosθ,   b = s·sinθ

dicari dengan kuadrat terkecil atas 5 pasang titik (skimage.transform.SimilarityTransform.estimate)
```

**[DIJALANKAN]**

```text
M = [[ 0,8797, 0,0493, −147,6194],
     [−0,0493, 0,8797,  −24,8190]]
skala = sqrt(0,8797² + 0,0493²) = 0,8811       rotasi = −3,21°       geser = (−147,6; −24,8)
```

Artinya: wajah perlu **diperkecil ke 88%**, **diputar 3,2°**, dan digeser sekian piksel agar mata cocok dengan templat.
Kemudian `cv2.warpAffine(img, M, (112, 112))` mengambil potongan 112×112 dari gambar asli (area di luar gambar menjadi hitam).

**Kenapa transformasi *serupa* (kaku), bukan *affine penuh* atau *warping* non-kaku?** Karena yang membedakan orang justru **proporsi wajah**: jarak antar mata, lebar mulut, tinggi hidung. Transformasi kaku (hanya skala seragam, putar, geser)
**tidak mengubah proporsi** itu. Transformasi yang lebih bebas akan "memaksa" semua wajah mirip templat dan menghapus identitas.

**Bukti [DIJALANKAN]:** setelah `M`, titik kunci mendarat di (37,1; 53,9), (75,0; 53,5), (55,8; 77,4), (37,6; 87,5), (74,7; 87,2) vs templat (38,3; 51,7), (73,5; 51,5), (56,0; 71,7), (41,5; 92,4), (70,7; 92,2).
Selisih sampai ±5 piksel pada hidung dan mulut: **tidak cocok persis, dan memang tidak seharusnya**, karena proporsi wajah orang ini berbeda dari templat rata-rata. Selisih itulah bagian dari identitas.

### 10.5 Normalisasi piksel untuk ArcFace

`cv2.dnn.blobFromImages(..., scalefactor=1/127,5, mean=127,5, swapRB=True)` menghasilkan:

```text
nilai' = (nilai_piksel − 127,5) / 127,5          rentang [0, 255] → [−1, +1]
BGR → RGB, susunan [N, C, H, W] = [1, 3, 112, 112]
```

**[DIJALANKAN]** minimum −1,0, maksimum +1,0, rata-rata 0,0495.

Kenapa dipusatkan di 0 dan dibatasi [−1, +1]? Alasan yang sama seperti normalisasi lain: bobot jaringan dilatih dengan masukan berskala itu; menyimpang membuat aktivasi menjadi tak terkalibrasi.
Kenapa 112×112? Itu ukuran masukan yang dipakai saat pelatihan (`w600k_r50.onnx`, input `[N, 3, 112, 112]` [DIJALANKAN]); lebih besar tidak menambah informasi yang bisa dipakai jaringan.

### 10.6 Jaringan pengenal: ArcFace ResNet-50

**[DIJALANKAN]** inspeksi graf ONNX (`w600k_r50.onnx`):

- **53 lapisan konvolusi**, 25 aktivasi PReLU, 26 BatchNorm, **24 koneksi residual** (penjumlahan lompatan), 43,6 juta parameter.
- Urutan akhir: `Add → BatchNorm → Flatten → Gemm (lapisan penuh) → BatchNorm`. Keluaran: `[1, 512]`.
- 24 blok residual = 3 + 4 + 14 + 3, susunan standar **ResNet-50** gaya ArcFace ("IResNet-50") [TEORI].

Cara kerjanya secara konsep [TEORI]: konvolusi 2-D menggeser filter kecil (3×3) di atas gambar. Lapisan awal mendeteksi tepi dan tekstur, lapisan tengah mendeteksi bagian (mata, hidung),
lapisan akhir menggabungkan menjadi representasi seluruh wajah. Setiap tahap menurunkan resolusi spasial dan menaikkan jumlah kanal, hingga satu `Flatten` + lapisan penuh meringkas semuanya menjadi **512 angka**.
Koneksi residual (`+`) memungkinkan 50 lapisan dilatih tanpa gradien menghilang, sama seperti di ECAPA.

**Nama berkas `w600k_r50`** menunjukkan: dilatih pada dataset **WebFace600K**, arsitektur ResNet-50 [DUGAAN dari penamaan; detail data tidak diverifikasi].

### 10.7 Fungsi kerugian ArcFace: kenapa cosine dan kenapa embedding bermakna

Jaringan dilatih mengklasifikasikan identitas, dengan fungsi kerugian **Additive Angular Margin** [TEORI]:

```text
L = −log(  e^{ s·cos(θ_y + m) }  /  ( e^{ s·cos(θ_y + m) } + Σ_{j≠y} e^{ s·cos θ_j } )  )
```

- `θ_y` = sudut antara embedding dan pusat kelas identitas yang benar; `m` = margin sudut tambahan; `s` = faktor skala.
- Menambahkan `m` pada sudut yang benar berarti jaringan harus membuat embedding **lebih dekat ke pusat kelasnya** dengan jarak minimum daripada ke kelas lain.
  Hasilnya: embedding orang yang sama **menggumpal** (sudut kecil) dan orang berbeda **menjauh** (sudut besar).
- Karena yang dilatih adalah **sudut**, ukuran yang konsisten untuk membandingkan adalah **cosine** (atau sudutnya), bukan jarak Euklides atau panjang vektor.

Setelah pelatihan, lapisan klasifikasi dibuang. Embedding dipakai untuk mengenali orang yang **tidak ada** di data latih, sama seperti ECAPA.

### 10.8 Embedding: normalisasi dan perbandingan

```text
e_mentah   ∈ R^512           norma 19,65 [DIJALANKAN]
e = e_mentah / ‖e_mentah‖    norma 1,000000, rata-rata −0,00135, std 0,04417 (= 1/√512 ≈ 0,0442 ✓)

cosine(e_uji, e_profil) = e_uji · e_profil          (rentang −1..1)
VERIFIED  jika  cosine ≥ 0,45       selain itu DENIED          (tidak ada tingkat REPEAT)
```

`FaceRecognitionService.cosine_similarity` menormalkan **lagi** sebelum dot (idempoten, tidak berbahaya) [KODE].
Hanya **satu** profil wajah per pengguna, tidak ada "ambil yang terbaik dari beberapa".

### 10.9 Ketahanan terhadap gangguan gambar [DIJALANKAN]

Foto uji yang sama diubah dengan berbagai cara, lalu cosine terhadap embedding foto asli. **Ambang sistem = 0,45.** Ini mengukur sensitivitas model, **bukan** akurasi pada wajah pengguna sebenarnya.

| Gangguan | Cosine | Di atas 0,45? |
|---|---|---|
| Diproses ulang tanpa perubahan | 1,0000 | ya |
| Rotasi 10° / 25° / 45° | 0,9925 / 0,9934 / 0,9794 | ya |
| Dibalik kiri-kanan | 0,9619 | ya |
| Grayscale | 0,9808 | ya |
| Terang ×0,5 / ×0,25 | 0,9827 / 0,9643 | ya |
| Terang ×1,6 (banyak piksel jenuh) | 0,8634 | ya |
| JPEG kualitas 50 / 20 | 0,9728 / 0,9084 | ya |
| Diperkecil ke 256 px | 0,9629 | ya |
| Derau Gauss sd 10 / 30 / 60 | 0,9609 / 0,8057 / 0,6776 | ya |
| "Foto dari foto" (blur + kontras turun + derau + JPEG 40) | 0,7796 | ya |
| Bagian bawah wajah ditutup (seperti masker) | 0,6835 | ya |
| Area mata ditutup | 0,7134 | ya |
| Rotasi 90° | 0,8393 | ya |
| JPEG kualitas 5 | 0,6129 | ya |
| **Blur Gauss σ = 2,5** (kernel 5) | **0,7391** | ya |
| Diperkecil ke 128 px | 0,6918 | ya |
| **Blur Gauss σ = 7,5** (kernel 15) | **0,2039** | **tidak** |
| **Diperkecil ke 61 px** | **0,2572** | **tidak** |

Yang bisa disimpulkan:

1. Model sangat tahan terhadap **rotasi, pencahayaan, balik, warna**: sesuai desain (alignment dan pelatihan dengan augmentasi).
2. Yang merusak adalah **hilangnya detail**: blur berat dan resolusi sangat rendah. Webcam buram, wajah jauh dari kamera, atau gerak saat diambil adalah risiko nyata.
3. Wajah tertutup sebagian (masker, area mata) menurunkan skor ke ±0,7 tetapi masih di atas 0,45 **pada satu foto ini**; jangan menggeneralisasi.
4. Pengamatan tambahan: potongan wajah yang dipotong **ketat** (hanya kotak wajah, tanpa konteks) **tidak terdeteksi** sama sekali (deteksi butuh sedikit ruang di sekitar wajah). Pastikan yang dikirim adalah frame penuh, seperti yang dilakukan kode kamu.

---

## 11. Liveness wajah, dan bukti ambang wajah

### 11.1 Liveness: tujuan dan batasnya

Pengenalan wajah saja bisa dikelabui dengan **foto** pengguna sah. *Liveness* mencoba memastikan yang di depan kamera adalah **orang hidup yang melakukan gerakan acak yang diminta**.

**Alur [KODE]:**

1. Browser meminta tantangan ke server: `POST /face/liveness-challenge`. Server memilih acak **satu** dari `blink` (kedip), `mouth` (buka mulut), `turn` (tengok) dan mengeluarkan token acak sekali pakai (`secrets.token_urlsafe(24)`), berlaku **25 detik**, terikat ke `user_id`.
   Memilih acak di server bertujuan agar penyerang yang memutar video tidak bisa menyiapkan satu gerakan saja.
2. Browser menjalankan `FaceLandmarker` MediaPipe pada video: model ini mengeluarkan **ratusan titik landmark wajah** dan **52 skor blendshape** (seberapa jauh ekspresi tertentu aktif, misalnya `eyeBlinkLeft`, `jawOpen`) per frame [TEORI untuk jumlah pastinya].
   Maksimal 5 wajah dilacak; **penilaian hanya berjalan bila tepat 1 wajah** terlihat.
3. Aturan penilaian:

| Tantangan | Sinyal | Lolos bila |
|---|---|---|
| `blink` | `min(eyeBlinkLeft, eyeBlinkRight)` | pernah **< 0,15** (mata terbuka), **lalu** naik **> 0,5** (menutup) |
| `mouth` | `jawOpen` | pernah **< 0,15**, **lalu** **> 0,5** |
| `turn` | `(x_hidung_maks − x_hidung_min) / lebar_wajah` (landmark #1 = ujung hidung) | **> 0,45** |

   Batas waktu 15 detik (`LIVENESS_TIMEOUT_MS`).

4. Setelah lolos, satu frame diambil (JPEG 0,92) dan dikirim ke `POST /face/verify-face` bersama `liveness_token`. Server menghabiskan token (sekali pakai, harus cocok pengguna dan belum kedaluwarsa) lalu menjalankan perbandingan wajah.

**Kenapa aturannya begitu:**

- **"rendah lalu tinggi"** (bukan hanya "tinggi"): foto statis punya skor blendshape yang tidak pernah berubah. Mewajibkan *transisi* memaksa ada gerakan nyata di antara dua frame. Ini ditulis eksplisit di komentar kode.
- **`min` kedua mata** untuk kedip: kedua mata harus menutup bersamaan; mengurangi positif palsu dari satu mata yang berfluktuasi karena derau.
- **Menengok dibagi lebar wajah:** menormalkan agar tidak bergantung seberapa dekat wajah dari kamera.

**Batas yang harus kamu akui (bukan disembunyikan):**

1. Penilaian gerakan terjadi **di browser**. Server hanya memeriksa bahwa token valid; server **tidak bisa memastikan** gerakannya benar-benar terjadi. Klien yang dimodifikasi dapat melewatinya.
2. Parameter `liveness_token` bersifat **opsional** di server: tanpa token, pemeriksaan liveness dilewati dan perbandingan wajah tetap jalan dan tetap mengirim hasil ke agent (komentar kode: untuk tombol uji manual).
3. Tantangan gerakan 2-D **tidak mengalahkan video rekaman** orang sah yang berkedip, dan tidak mendeteksi topeng 3-D [TEORI]. Itu batas semua liveness berbasis kamera RGB aktif tanpa sensor kedalaman.
4. Jangan menyebutnya "anti-spoofing wajah yang aman". Sebut: "tantangan liveness aktif di sisi klien sebagai pertahanan awal terhadap foto statis".

### 11.2 Ambang wajah 0,45: bukti dari log timmu

Dari `docs/ARSITEKTUR_HAPPY_SAAT_INI.md` bagian 8.2 (30 genuine, 30 impostor):

| Kondisi | `similarity` minimum | maksimum | rata-rata |
|---|---|---|---|
| Genuine | 0,6082 | 1,0000 | 0,7129 |
| Impostor | −0,1739 | 0,2141 | 0,0495 |

- Genuine 30/30 diterima, impostor 30/30 ditolak. **EER 0%** pada ambang analisis ≈ **0,4112**.
- Ada celah lebar antara impostor tertinggi (**0,2141**) dan genuine terendah (**0,6082**); ambang 0,45 berada di tengahnya. Ini kontras dengan suara, yang genuine dan impostornya saling menimpa tipis (bagian 9.3).
- Maksimum genuine **1,0000** berarti sebagian "genuine" kemungkinan membandingkan gambar yang **identik** dengan gambar enrollment (cosine tepat 1) [DUGAAN]. Itu menaikkan rata-rata 0,71 sedikit; yang lebih jujur sebagai batas bawah adalah **minimum 0,6082**.
- **Batasan:** 30 percobaan per kondisi, jumlah orang kecil, kondisi pencahayaan seragam. Tulis sebagai "hasil awal pada data timku".

### 11.3 Perbandingan suara dan wajah (pegangan untuk ditanya "kenapa dua?")

| | Suara | Wajah |
|---|---|---|
| Dimensi embedding | 192 | 512 |
| Model | ECAPA-TDNN (20,8 juta param.) | IResNet-50 + SCRFD |
| Ukuran masukan | Fbank `[T, 80]` (panjang bervariasi) | gambar `[112,112,3]` tetap |
| Ambang terima | 0,45 (ada pita REPEAT 0,35–0,45) | 0,45 (tanpa REPEAT) |
| Celah genuine–impostor di log | **tipis** (0,3541 vs 0,3553) | **lebar** (0,2141 vs 0,6082) |
| Kerentanan utama | derau, durasi pendek, kanal mic | blur / resolusi rendah |
| Perlindungan anti-pemalsuan | anti-spoof wav2vec2 (lunak, tidak stabil) | liveness klien (tidak diverifikasi server) |
| Peran di sistem | verifikasi utama, dipicu pasif tiap giliran bicara | **fallback** setelah 3 kali gagal suara |

---

## 12. Daftar pertanyaan penguji dan jawaban

Format: jawaban singkat yang bisa diucapkan, lalu bagian rujukan di dokumen ini.

**Tentang suara**

1. **"Bagaimana kamu yakin suara orang itu berbeda?"**
   Setiap suara diubah menjadi vektor 192 angka oleh jaringan ECAPA-TDNN yang sudah dilatih mengenali ribuan pembicara. Dua klip dari orang yang sama menghasilkan vektor yang arahnya berdekatan, dua orang berbeda berjauhan. Kemiripan diukur dengan cosine. Pada data timku, pemilik berskor rata-rata 0,57 dan orang lain 0,21 (bagian 9.3). Bukti tambahan: suara yang sama dengan kalimat berbeda 0,92, suara berbeda dengan kalimat sama 0,36 dan ±0,15 (bagian 5.6).

2. **"Kenapa suara diubah jadi frekuensi/spektrogram, kenapa tidak langsung gelombang?"**
   Gelombang hanya amplitudo terhadap waktu. Yang membedakan pembicara adalah **komposisi frekuensinya** (pitch dan formant yang dibentuk bentuk saluran suaranya). Fourier mengubahnya jadi energi per frekuensi (bagian 2).

3. **"Kenapa dipotong per 25 ms?"**
   Dalam ±25 ms bentuk saluran suara hampir konstan, jadi spektrum bermakna. Lebih panjang mencampur fonem, lebih pendek resolusi frekuensinya kasar (resolusi = fs/N = 40 Hz). Digeser 10 ms agar tak ada bagian yang terlewat (bagian 2.3).

4. **"Kenapa pakai skala mel?"**
   Telinga manusia peka pada beda frekuensi rendah dan kasar pada frekuensi tinggi. Informasi pembicara paling banyak di bawah 3 kHz. 80 filter mel memberi 43 filter di bawah 2 kHz dan hanya 19 di atas 4 kHz (bagian 3.3).

5. **"Kenapa logaritma?"**
   Tiga alasan: persepsi kekerasan logaritmik, rentang energi mentah mencapai 10¹³, dan pada domain log, pengaruh mikrofon/ruangan yang tetap berubah dari perkalian menjadi penjumlahan konstan sehingga mudah dihapus (bagian 3.4).

6. **"Kenapa dinormalisasi?"**
   Ada dua jenis. Normalisasi **rata-rata per pita (CMN)** di dalam ECAPA menghapus pengaruh volume dan respons mic tetap: saya buktikan embedding tidak berubah (cosine 1,0000) walau volume diubah 50 kali (bagian 4.2). Normalisasi **L2** pada vektor membuat cosine cukup dot product. Normalisasi RMS di server sendiri ternyata tidak mengubah skor (bagian 4.4).

7. **"Kenapa 16 kHz?"**
   Ucapan membawa informasi sampai ±8 kHz, Nyquist untuk 16 kHz. Model dilatih pada 16 kHz, jadi input harus sama (bagian 1.2).

8. **"Kenapa cosine, bukan jarak Euklides?"**
   Setelah L2 keduanya setara (`‖a−b‖² = 2−2cos`), dan model dilatih dengan margin sudut sehingga arah adalah yang bermakna (bagian 5.8).

9. **"Kenapa tidak pakai satu kalimat tetap? Apakah ini text-independent?"**
   Ya, text-independent: pooling atensi merangkum seluruh klip tanpa peduli isinya. Terbukti: kalimat berbeda tetap 0,92 (bagian 5.6).

10. **"Kenapa ucapan pendek ditolak?"**
    Statistik pooling dari sedikit frame berisik. Pada klip yang sama skor naik dari 0,42 (0,4 s) ke 0,90 (3 s) dan 0,97 (5 s) (bagian 6.1). Karena itu perekam menunggu minimal 3 detik ucapan.

11. **"Bagaimana kamu menentukan ambang 0,45?"**
    Secara empiris dari distribusi skor: pemilik 0,35–1,0 (rata-rata 0,57), orang lain 0,04–0,36 (rata-rata 0,21). 0,45 lebih ketat dari titik EER (0,355) agar FAR 0%, dengan konsekuensi 5 dari 30 pemilik diminta mengulang. Itu pilihan keamanan (bagian 9.3). Saya tidak mengklaim ini hasil kalibrasi formal.

12. **"Apa itu EER, FAR, FRR?"** Bagian 9.3.

13. **"Bagaimana dengan suara direkam lalu diputar ulang?"**
    Ada model wav2vec2 anti-spoof, tetapi pengukuran saya menunjukkan keluarannya nyaris biner dan tidak stabil pada kanal browser, sehingga hanya meminta pengulangan (REPEAT), bukan menolak. Saya menyebutnya lapisan tambahan, bukan jaminan (bagian 7.3). Perlindungan terhadap replay yang lebih kuat adalah tantangan acak (mengucapkan kata acak) [usulan, belum diimplementasikan].

14. **"Kenapa pakai model pretrained, bukan melatih sendiri?"**
    Melatih pengenal pembicara butuh ribuan pembicara; tim tidak punya data sebanyak itu. ECAPA sudah dilatih pada 7.205 pembicara. Yang kami lakukan adalah memakainya sebagai pengekstrak ciri lalu mengevaluasinya pada data kami (30 genuine, 30 impostor).

15. **"Bagaimana kalau suara berubah (pilek, bising, mic lain)?"**
    Skor turun (derau 10 dB: 0,68; reverb: 0,90; band telepon: 0,83 relatif ke versi bersih). Karena itu ada pita REPEAT, maksimal 3 profil enrollment (diambil yang terbaik), dan fallback wajah setelah 3 kegagalan (bagian 6.2).

16. **"Apa itu behavior profile, dan apakah berpengaruh?"**
    Pitch (YIN) dan durasi dibandingkan dengan kebiasaan pengguna lewat z-score. Secara jujur: dalam implementasi saat ini gerbang itu tidak aktif karena butuh ≥5 sampel dan profil tidak pernah tumbuh dari 1 (bagian 8.5). Tidak ikut menentukan keputusan.

17. **"Apa yang disimpan tentang suara pengguna?"**
    Vektor 192 angka per profil (maksimal 3) dan gambar spektrogram PNG di Storage privat. Audio mentah dihapus setelah diproses. Vektor 192 angka tidak dapat diubah kembali menjadi suara secara langsung, tetapi tetap data biometrik yang sensitif.

**Tentang wajah**

18. **"Bagaimana sistem tahu wajahnya sama?"**
    Foto → deteksi (SCRFD) → 5 titik kunci → diluruskan ke 112×112 → jaringan ArcFace ResNet-50 → vektor 512 angka → cosine ke profil; lolos jika ≥ 0,45 (bagian 10).

19. **"Kenapa wajah harus diluruskan (alignment)?"**
    Menghilangkan variasi rotasi, skala, posisi sebelum jaringan, sehingga jaringan fokus pada identitas. Dengan transformasi kaku agar proporsi wajah (yang membedakan orang) tidak rusak (bagian 10.4).

20. **"Kenapa piksel dikurangi 127,5 dan dibagi 127,5?"**
    Memusatkan nilai di nol dan membatasi pada [−1, +1] sesuai skala masukan saat jaringan dilatih (bagian 10.5).

21. **"Apa itu ArcFace?"**
    Fungsi kerugian dengan margin sudut tambahan yang membuat wajah orang yang sama menggumpal dan orang berbeda menjauh pada sudut. Karena itu perbandingannya cosine (bagian 10.7).

22. **"Bagaimana kalau pakai foto orang lain?"**
    Ada tantangan liveness acak (kedip/buka mulut/tengok) di browser yang menolak gambar statis. Batasnya: dinilai di klien dan tidak mengalahkan video rekaman (bagian 11.1). Saya tidak mengklaimnya kebal.

23. **"Bagaimana dengan masker/kacamata/cahaya?"**
    Pada satu foto uji, menutup separuh bawah wajah menurunkan skor ke 0,68, pencahayaan ×0,25 ke 0,96, tapi blur berat menjatuhkan ke 0,20 (bagian 10.9). Itu satu foto; bukan statistik populasi.

24. **"Kenapa suara lebih sulit daripada wajah di data kalian?"**
    Pada log kami, celah antara genuine dan impostor wajah lebar (0,21 vs 0,61), sedangkan suara tipis (0,3553 vs 0,3541). Suara lebih peka terhadap panjang ucapan dan kondisi kanal (bagian 11.3).

**Tentang sistem**

25. **"Kenapa wajah hanya sebagai fallback?"**
    Suara bisa dijalankan pasif tanpa mengganggu percakapan (tiap giliran bicara). Wajah butuh kamera dan interaksi, jadi dipakai ketika suara gagal tiga kali.

26. **"Apa kelemahan sistemmu?"**
    Jawab jujur: sampel evaluasi kecil; anti-spoof tidak stabil; liveness dinilai di klien; kondisi mic enrollment dan verifikasi berbeda; gerbang perilaku belum aktif; beberapa endpoint wajah tanpa autentikasi (lihat dokumen arsitektur, temuan T-01 sampai T-16).

27. **"Berapa akurasinya?"**
    "Pada 30 percobaan per kondisi: suara EER 3,3%, FAR 0% dan FRR 16,7% pada ambang operasional; wajah FAR 0% dan FRR 0%. Ukuran sampel kecil, jadi saya menganggapnya hasil awal." Jangan mengatakan "akurasi 100%".

---

## 13. Yang jangan kamu klaim di sidang

1. **"Normalisasi RMS membuat skor stabil antar mic."** Tidak: CMN di dalam model yang melakukannya; RMS di server tidak mengubah skor (bagian 4).
2. **"Anti-spoof kami mendeteksi replay."** Tidak terbukti. Keluarannya nyaris biner dan dibalik oleh derau tipis; simulasi replay lolos (bagian 7.3).
3. **"Liveness wajah kami aman dari foto/video."** Penilaian di klien; token bisa dilewati; video rekaman lolos (bagian 11.1).
4. **"Akurasi 100%."** Sampel 30 per kondisi, dengan sebagian genuine kemungkinan gambar identik.
5. **"Profil perilaku meningkatkan keamanan."** Dalam implementasi sekarang tidak aktif (bagian 8.5).
6. **"Kami melatih model pengenal suara/wajah."** Tidak: ECAPA dan ArcFace adalah model pretrained yang kami pakai dan evaluasi.
7. **"Rate = kecepatan bicara."** Itu durasi klip (bagian 8.3).
8. **"Skor cosine 0..1."** Rentangnya −1..1.
9. **"Hasil uji sintetis membuktikan akurasi."** Uji saya memakai suara TTS dan foto astronaut; hanya sah untuk bentuk, rumus, dan sensitivitas.
10. **"Ambang 0,45 berasal dari teori."** Empiris dari distribusi data tim.

---

## 14. Cara mengulang semua pengukuran di dokumen ini

Skrip ada di folder `docs/bukti_sidang/` (lihat `README_BUKTI.md` di dalamnya). Ringkas:

```bash
cd backend
source .venv/bin/activate
cd ../docs/bukti_sidang
bash buat_sampel.sh                        # membuat klip uji TTS (macOS)
python audio_math.py                       # bagian 2–6, 8 (front-end, normalisasi, ECAPA, durasi, kanal, YIN)
python w2v_face_math.py                    # bagian 7 dan 10 (wav2vec2, wajah)
```

Nilai bisa sedikit berbeda antar mesin (urutan pecahan desimal), tetapi pola yang dibahas di sini (gain tidak mengubah embedding selama tidak clip,
skor naik dengan durasi, blur berat mematahkan pengenalan wajah, dan seterusnya) akan sama. Jalankan sebelum sidang agar angkanya ada di layarmu sendiri.

---

## 15. Daftar simbol dan istilah

| Simbol/istilah | Arti |
|---|---|
| `x[n]` | sampel audio ke-n |
| `fs` | sampling rate (16.000 Hz) |
| `N`, `T` | jumlah sampel / jumlah frame |
| `X[k]`, `P[k]` | spektrum kompleks / daya pada bin k |
| `E[t, m]` | energi pita mel m pada frame t |
| dB | `10·log10(daya)` |
| CMN | pengurangan rata-rata per pita sepanjang klip |
| TDNN | konvolusi 1-D atas waktu |
| Res2Net | pemotongan kanal menjadi bagian-bagian yang diproses bertingkat |
| SE | pembobotan kanal berdasarkan ringkasan klip |
| ASP | pooling atensi (rata-rata + simpangan baku berbobot) |
| L2 | pembagian vektor dengan norma Euklidesnya |
| cosine | `a·b / (‖a‖‖b‖)` |
| FAR/FRR/EER | salah-terima / salah-tolak / titik keduanya sama |
| SCRFD | detektor wajah ringan (kotak + 5 titik) |
| NMS | membuang kotak tumpang tindih |
| ArcFace | pelatihan dengan margin sudut tambahan |
| IResNet-50 | ResNet 50 lapis versi ArcFace |
| Blendshape | skor 0..1 aktivitas ekspresi wajah (kedip, buka mulut) |
| Liveness | pemeriksaan bahwa wajah yang tampil adalah orang hidup |
| Welford | rata-rata/varians berjalan |
| z-score | `(x − rata-rata) / simpangan baku` |

*Akhir dokumen.*

