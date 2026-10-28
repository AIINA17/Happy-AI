# Expo Plan: From Voice to Trust

## 1. Ringkasan

Membangun halaman khusus expo yang memvisualisasikan bagaimana audio pengguna diproses
menjadi keputusan biometrik:

```text
Audio Input
    ↓
Pre-processing
    ↓
ECAPA-TDNN Speaker Verification
    ↓
Anti-Spoofing Detection
    ↓
Behavior Analysis
    ↓
Decision Engine
    ↓
VERIFIED / REPEAT / DENIED
```

Halaman ini tidak dimaksudkan sebagai pengganti halaman chat utama. Halaman ini adalah
**exhibit mode** untuk menunjukkan kompleksitas engineering sistem kepada juri.

Usulan route:

```text
/expo/voice-pipeline
```

Judul halaman:

> **From Voice to Trust**

Subtitle:

> Visualizing how raw audio becomes a secure authorization decision.

---

## 2. Tujuan

### Tujuan utama

1. Memperlihatkan setiap tahap pemrosesan suara secara visual.
2. Menjelaskan perbedaan antara speaker verification dan anti-spoofing.
3. Menunjukkan alasan teknis di balik keputusan `VERIFIED`, `REPEAT`, atau `DENIED`.
4. Membuktikan bahwa agent hanya dapat bertindak setelah melewati decision engine.
5. Menyediakan mode demo yang mudah dipahami juri tanpa harus membaca kode.

### Bukan tujuan

- Membuat model biometrik baru.
- Menampilkan embedding mentah atau data sensitif kepada pengunjung.
- Mengubah policy keamanan tanpa validasi.
- Mengganti alur login, chat, atau voice enrollment yang sudah berjalan.

---

## 3. Pesan utama untuk expo

> Sistem ini bukan hanya memahami apa yang dikatakan pengguna. Sistem juga memeriksa
> siapa yang berbicara, apakah audio tersebut asli, apakah polanya wajar, dan apakah
> agent diizinkan untuk menjalankan aksi.

Kalimat penutup demo:

> **LLM tidak memiliki hak akses penuh. Agent hanya dapat bertindak setelah decision
> engine memberikan izin.**

---

## 4. Arsitektur yang divisualisasikan

### 4.1 Alur tingkat tinggi

```text
┌──────────────┐
│ Audio Input  │
└──────┬───────┘
       ↓
┌──────────────┐
│ Preprocess   │  mono, trim silence, resample, duration check
└──────┬───────┘
       ↓
┌──────────────────────┐
│ ECAPA-TDNN           │
│ Speaker Verification │  "Siapa yang berbicara?"
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ Anti-Spoofing         │
│ Deepfake/Replay Model │  "Apakah audio asli?"
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ Behavior Analysis     │  pitch, speech rate, history
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ Decision Engine       │  threshold + policy + reason
└──────┬───────────────┘
       ↓
┌──────────────────────┐
│ Agent Authorization   │  ALLOWED / BLOCKED
└──────────────────────┘
```

### 4.2 Arsitektur ECAPA-TDNN

Tampilan teknis yang disederhanakan:

```text
Audio waveform
      ↓
Acoustic features
      ↓
TDNN feature layers
      ↓
Channel attention
      ↓
Statistics pooling
      ↓
Speaker embedding
      ↓
Cosine similarity with enrolled profile
```

Informasi yang ditampilkan:

- Nama model: `ECAPA-TDNN`
- Profile yang menjadi best match
- Speaker similarity score
- Threshold `accept`
- Threshold `repeat`
- Status: `MATCHED`, `UNCERTAIN`, atau `NOT MATCHED`

### 4.3 Arsitektur anti-spoofing

```text
Audio waveform
      ↓
Wav2Vec2 feature extraction
      ↓
Deepfake/replay classifier
      ↓
Real probability / fake probability
```

Informasi yang ditampilkan:

- Nama model: `Deepfake-audio-detection-V2`
- `real_prob`
- `fake_prob`
- Replay warning threshold
- Replay deny threshold
- Status: `LIVE AUDIO`, `SUSPICIOUS`, atau `SPOOF DETECTED`

Catatan edukatif di UI:

> Speaker verification menentukan identitas suara. Anti-spoofing memeriksa keaslian
> audio. Keduanya adalah pemeriksaan yang berbeda dan harus digabungkan.

---

## 5. Rancangan halaman

### 5.1 Header dan final decision card

Bagian paling atas harus langsung menunjukkan hasil:

```text
FINAL DECISION

VERIFIED

Identity confidence       0.7565
Anti-spoof confidence      0.0001
Behavior confidence        0.8200
Processing time              842 ms
Agent permission          ALLOWED
```

Warna:

- `VERIFIED`: hijau
- `REPEAT`: kuning
- `DENIED`: merah

Tampilkan juga alasan keputusan, misalnya:

```text
Speaker verified successfully
```

atau:

```text
Replay attack detected
```

### 5.2 Pipeline visualization

Setiap node pipeline ditampilkan sebagai kartu yang tersambung garis atau panah.
Node berubah state selama demo:

| State | Visual |
|---|---|
| `IDLE` | Abu-abu |
| `PROCESSING` | Animasi/loading |
| `PASSED` | Hijau |
| `WARNING` | Kuning |
| `FAILED` | Merah |
| `SKIPPED` | Abu-abu transparan |

Setiap kartu minimal memuat:

- Nama tahap
- Status
- Model/operasi
- Satu atau dua metrik utama
- Durasi tahap
- Tombol detail teknis

### 5.3 Audio input card

Tampilkan:

- Waveform
- Tombol play/pause
- Durasi audio
- Sample rate
- Channel
- Status validasi audio

Checklist preprocessing:

```text
✓ Convert to mono
✓ Resample to 16 kHz
✓ Trim silence
✓ Validate minimum speech duration
```

### 5.4 Speaker verification card

Contoh tampilan:

```text
MODEL: ECAPA-TDNN
PROFILE: enroll1

Speaker score: 0.7565
Accept threshold: 0.45
Repeat threshold: 0.30

Status: MATCHED
```

Tambahkan meter skor dengan penanda threshold `repeat` dan `accept`.

### 5.5 Anti-spoofing card

Contoh tampilan:

```text
MODEL: Deepfake-audio-detection-V2

Real probability: 99.99%
Fake probability: 0.01%
Replay deny threshold: 0.85

Status: LIVE AUDIO
```

Gunakan dua progress bar agar perbedaan real/fake terlihat tanpa membaca angka detail.

### 5.6 Behavior analysis card

Tampilkan hanya jika data tersedia:

```text
Pitch score:          0.84
Speech-rate score:    0.79
Behavior score:       0.82
Historical samples:     12
Status:              NORMAL
```

Jika profile belum memiliki cukup data, tampilkan:

```text
Behavior analysis: NOT USED
Reason: insufficient historical samples
```

Jangan menganggap data yang tidak tersedia sebagai nilai gagal.

### 5.7 Decision trace card

Tampilkan rule yang benar-benar digunakan:

```text
Speaker score 0.7565 >= 0.45       PASS
Replay prob.  0.0001 < 0.50        PASS
Behavior score 0.82 >= 0.15        PASS
------------------------------------------
Decision: VERIFIED
```

Contoh `REPEAT`:

```text
Speaker score 0.3541 >= 0.30        PASS
Speaker score 0.3541 < 0.45         UNCERTAIN
Replay prob.  0.0000                PASS
------------------------------------------
Decision: REPEAT
```

Contoh `DENIED` karena replay:

```text
Speaker score 0.9000 >= 0.45        PASS
Replay prob.  0.9998 >= 0.85        FAIL
------------------------------------------
Decision: DENIED
```

### 5.8 Agent authorization card

Hubungkan hasil verifikasi dengan dampaknya:

```text
VERIFIED → Agent permission: ALLOWED
REPEAT   → Agent permission: WAITING FOR RETRY
DENIED   → Agent permission: BLOCKED
```

Pesan ini harus terlihat jelas agar juri memahami bahwa verifikasi mengontrol aksi agent,
bukan hanya menampilkan skor.

---

## 6. Mode demo expo

Sediakan tiga input demo:

```text
[ Genuine Voice ]
[ Impostor Voice ]
[ Replay / Spoof Voice ]
```

### 6.1 Genuine voice

Expected flow:

```text
Audio received
    ↓
Speaker score tinggi
    ↓
Fake probability rendah
    ↓
Behavior normal
    ↓
VERIFIED
    ↓
Agent permission: ALLOWED
```

### 6.2 Impostor voice

Expected flow:

```text
Audio received
    ↓
Speaker score rendah
    ↓
DENIED
    ↓
Agent permission: BLOCKED
```

### 6.3 Replay/spoof voice

Expected flow:

```text
Audio received
    ↓
Speaker score dapat terlihat mirip
    ↓
Fake probability tinggi
    ↓
DENIED
    ↓
Reason: Replay attack detected
```

### 6.4 Short or unclear audio

Expected flow:

```text
Audio duration terlalu pendek
    ↓
Speaker embedding tidak stabil
    ↓
REPEAT
    ↓
User diminta mengucapkan satu kalimat penuh
```

Skenario ini menunjukkan bahwa sistem tidak asal menolak input yang tidak cukup.

---

## 7. Kontrak data backend–frontend

Response verifikasi perlu menyediakan data pipeline secara eksplisit. Jangan membuat
frontend menebak alasan keputusan dari beberapa field terpisah.

Usulan bentuk response:

```json
{
  "decision": "VERIFIED",
  "verified": true,
  "reason": "Speaker verified successfully",
  "total_latency_ms": 842,
  "agent_permission": "ALLOWED",
  "pipeline": {
    "audio_input": {
      "duration_sec": 10.0,
      "sample_rate": 16000,
      "channels": 1
    },
    "preprocessing": {
      "status": "completed",
      "speech_duration_sec": 9.8
    },
    "speaker_verification": {
      "model": "ECAPA-TDNN",
      "speaker_score": 0.7565,
      "best_match_label": "enroll1",
      "thresholds": {
        "absolute_minimum": 0.35,
        "repeat": 0.30,
        "accept": 0.45
      },
      "status": "matched"
    },
    "anti_spoofing": {
      "model": "Deepfake-audio-detection-V2",
      "real_prob": 0.9999,
      "fake_prob": 0.0001,
      "thresholds": {
        "warning": 0.50,
        "deny": 0.85
      },
      "status": "live"
    },
    "behavior_analysis": {
      "available": true,
      "behavior_score": 0.82,
      "historical_samples": 12,
      "status": "normal"
    },
    "decision_engine": {
      "status": "passed",
      "rules": [
        {
          "label": "Speaker score meets accept threshold",
          "status": "passed"
        },
        {
          "label": "Replay probability below warning threshold",
          "status": "passed"
        }
      ]
    }
  }
}
```

### Catatan kontrak

- Nilai threshold harus berasal dari backend, bukan di-hardcode ulang di frontend.
- Field optional seperti behavior profile harus memiliki `available` atau `null` yang
  eksplisit.
- Data sensitif seperti embedding mentah tidak dikirim ke halaman expo.
- Error backend harus ditampilkan sebagai error nyata, bukan diubah menjadi status sukses.

---

## 8. Rencana perubahan teknis

### Fase 1 — Audit dan kontrak data

- [ ] Petakan endpoint verifikasi yang digunakan frontend.
- [ ] Inventaris field response yang sudah tersedia.
- [ ] Tentukan field pipeline yang masih perlu ditambahkan.
- [ ] Tentukan format error dan status tahap.
- [ ] Pastikan threshold diambil dari konfigurasi decision engine.

Output:

- Kontrak JSON pipeline.
- Daftar perubahan backend.
- Daftar tipe TypeScript yang diperlukan.

### Fase 2 — Instrumentasi backend

- [ ] Tambahkan pengukuran waktu per tahap.
- [ ] Pisahkan metadata audio, preprocessing, speaker verification,
  anti-spoofing, behavior, dan decision engine.
- [ ] Tambahkan rule trace yang menjelaskan alasan keputusan.
- [ ] Tambahkan status `agent_permission`.
- [ ] Pertahankan response lama jika masih digunakan oleh halaman lain,
  atau lakukan perubahan kompatibel.
- [ ] Pastikan error model atau file audio tetap muncul sebagai error yang jelas.

Target lokasi yang perlu ditinjau:

- `backend/voiceverification/services/biometric_service.py`
- `backend/voiceverification/core/decision_engine.py`
- `backend/voiceverification/core/asvspoof.py`
- `backend/voiceverification/server.py`

### Fase 3 — Tipe dan komponen frontend

- [ ] Buat tipe `VerificationPipelineResult`.
- [ ] Buat komponen `PipelineNode`.
- [ ] Buat komponen `AudioInputStage`.
- [ ] Buat komponen `SpeakerVerificationStage`.
- [ ] Buat komponen `AntiSpoofingStage`.
- [ ] Buat komponen `BehaviorAnalysisStage`.
- [ ] Buat komponen `DecisionTrace`.
- [ ] Buat komponen `AgentAuthorization`.
- [ ] Buat komponen `FinalDecisionCard`.

### Fase 4 — Halaman expo

- [ ] Buat route `/expo/voice-pipeline`.
- [ ] Tambahkan mode `IDLE`, `PROCESSING`, dan `RESULT`.
- [ ] Implementasikan animasi perubahan state antar-node.
- [ ] Tambahkan audio player dan waveform.
- [ ] Tambahkan meter speaker score.
- [ ] Tambahkan meter real/fake probability.
- [ ] Tambahkan decision trace.
- [ ] Tambahkan tombol reset demo.
- [ ] Tambahkan layout responsif untuk layar expo.

### Fase 5 — Demo fixtures

- [ ] Hubungkan satu genuine sample.
- [ ] Hubungkan satu impostor sample.
- [ ] Hubungkan satu spoof/replay sample.
- [ ] Pastikan fixture hanya digunakan untuk mode demo dan tidak dianggap sebagai
  hasil produksi.
- [ ] Tampilkan label kondisi input secara transparan.
- [ ] Pastikan setiap fixture menghasilkan result yang konsisten.

Sumber sample yang dapat dipakai untuk pengujian awal berada di:

- `backend/audio_cache/`
- `backend/voiceverification/dataset/`
- `backend/voiceverification/voice_verification_test_log.csv`

### Fase 6 — Validasi

- [ ] Uji genuine voice menghasilkan `VERIFIED` atau hasil yang sesuai log.
- [ ] Uji impostor menghasilkan `DENIED`.
- [ ] Uji spoof/replay menghasilkan `DENIED` atau policy result yang sesuai.
- [ ] Uji suara terlalu pendek menghasilkan `REPEAT`.
- [ ] Uji behavior profile yang belum cukup data.
- [ ] Uji kegagalan backend dan model loading.
- [ ] Uji tampilan di resolusi monitor expo.
- [ ] Jalankan lint dan build frontend.
- [ ] Jalankan test decision engine dan test biometrik yang relevan.

---

## 9. Metrik yang ditampilkan

### Metrik per request

- Total processing time
- Audio duration
- Speech duration
- Speaker score
- Best match label
- Real probability
- Fake probability
- Behavior score
- Historical sample count
- Final decision

### Metrik evaluasi dataset

Gunakan data pada `voice_verification_test_log.csv` sebagai hasil pengujian internal.
Tampilkan label yang jujur, misalnya:

> Internal evaluation on project test samples

Metrik yang disarankan:

- Genuine acceptance rate
- Impostor rejection rate
- Spoof rejection rate
- False accept
- False reject
- Repeat rate

Jangan menyebut hasil tersebut sebagai jaminan keamanan produksi atau akurasi universal.

---

## 10. Prinsip UX dan visual

1. Hasil akhir harus terlihat dalam waktu kurang dari beberapa detik.
2. Juri harus dapat memahami alur tanpa membaca kode.
3. Detail teknis tersedia melalui panel expand, bukan memenuhi layar utama.
4. Status tiap tahap harus konsisten menggunakan warna dan ikon.
5. Jalur yang gagal harus tetap memperlihatkan tahap mana yang menyebabkan kegagalan.
6. Jangan menampilkan embedding mentah, token, credential, atau data pribadi.
7. Hindari klaim “100% aman”.
8. Gunakan istilah:
   - `speaker similarity`, bukan identitas absolut;
   - `fake/replay probability`, bukan kepastian deepfake;
   - `policy decision`, bukan keputusan yang tidak dapat salah.

---

## 11. Kriteria selesai

Fitur dianggap siap untuk expo jika:

- [ ] Halaman `/expo/voice-pipeline` dapat dibuka dan memiliki empty state yang jelas.
- [ ] Satu audio dapat divisualisasikan dari input hingga keputusan akhir.
- [ ] ECAPA-TDNN dan anti-spoofing tampil sebagai tahap terpisah.
- [ ] Speaker score, spoof score, behavior score, dan threshold terlihat.
- [ ] Decision trace menjelaskan alasan `VERIFIED`, `REPEAT`, atau `DENIED`.
- [ ] Permission agent terlihat sebagai konsekuensi keputusan.
- [ ] Genuine, impostor, replay, dan short-audio scenario dapat didemokan.
- [ ] Error backend ditampilkan secara eksplisit.
- [ ] Tidak ada data rahasia yang dikirim ke atau ditampilkan pada halaman expo.
- [ ] Lint dan build frontend berhasil.
- [ ] Test decision engine yang relevan berhasil.
- [ ] Demo dapat dijalankan tanpa perlu membuka source code.

---

## 12. Alur presentasi lima menit

### Menit 0–1: Masalah

Jelaskan bahwa voice assistant dapat disalahgunakan melalui impersonation atau replay
attack. Speech-to-text saja tidak cukup untuk mengamankan transaksi.

### Menit 1–2: Pipeline

Tunjukkan:

```text
Audio → ECAPA-TDNN → Anti-Spoofing → Behavior → Decision Engine → Agent
```

Jelaskan bahwa dua model menjawab pertanyaan berbeda:

- Siapa yang berbicara?
- Apakah audio tersebut asli?

### Menit 2–3: Genuine voice

Tampilkan pipeline sampai:

```text
VERIFIED → Agent permission: ALLOWED
```

### Menit 3–4: Impostor dan replay

Tampilkan satu impostor atau replay sample:

```text
DENIED → Agent permission: BLOCKED
```

Biarkan juri melihat node yang gagal.

### Menit 4–5: Engineering evidence

Tampilkan:

- Decision trace
- Processing latency
- Threshold
- Test metrics
- Audit/logging
- Service architecture

Penutup:

> “Kami tidak hanya membuat agent yang bisa berbelanja. Kami membuat sistem yang
> menentukan kapan agent boleh dipercaya untuk bertindak.”

---

## 13. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Model cold start lama | Demo terasa macet | Warm-up model sebelum expo |
| Backend tidak tersedia | Pipeline tidak bisa berjalan | Sediakan health status dan fixture mode yang jelas |
| Hasil sample tidak konsisten | Juri meragukan sistem | Uji semua fixture sebelum expo |
| Threshold terlihat seperti angka arbitrer | Nilai akademik berkurang | Tampilkan sumber threshold dan hasil evaluasi |
| Terlalu banyak detail teknis | Juri bingung | Gunakan progressive disclosure |
| Audio pengunjung terlalu pendek/noisy | Banyak hasil repeat | Tampilkan instruksi pengucapan dan fallback demo |
| Data sensitif terlihat | Risiko privasi | Masking dan jangan kirim embedding mentah |
| Klaim performa berlebihan | Klaim tidak valid | Labeli metrik sebagai internal evaluation |

---

## 14. Definition of Done untuk expo

Halaman dinyatakan selesai apabila seorang juri yang belum membaca repository dapat
menjawab tiga pertanyaan berikut hanya dari tampilan demo:

1. **Bagaimana suara diproses?**
2. **Mengapa sistem memilih verified, repeat, atau denied?**
3. **Apa dampak keputusan tersebut terhadap agent?**

Jika ketiga pertanyaan tersebut terjawab dengan jelas, halaman ini telah berhasil
menampilkan sisi kompleks engineering proyek, bukan hanya sisi UI chatbot.
