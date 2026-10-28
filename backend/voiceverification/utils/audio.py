import os
import shutil
import uuid
import librosa
import numpy as np
import soundfile as sf

from fastapi import UploadFile
from voiceverification.utils.ffmpeg import webm_to_wav

# Target RMS level for gain normalization. Mic input volume varies a lot
# device to device; without this, a quiet mic's live sample can end up
# systematically lower-energy than what was used at enrollment (or vice
# versa), which shifts every feature computed downstream (speaker
# embedding, spoof-detector spectral features) versus what the models saw
# during their own training/calibration.
TARGET_RMS = 0.1

UPLOAD_DIR = "tmp_audio"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def save_audio(audio: UploadFile) -> str:
    # ⚠️ Jangan percaya filename
    raw_ext = ".webm"
    raw_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{raw_ext}")
    wav_path = raw_path.replace(".webm", ".wav")

    with open(raw_path, "wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)

    webm_to_wav(raw_path, wav_path)
    os.remove(raw_path)

    return wav_path

def normalize_audio(path):
    y, sr = librosa.load(path, sr=16000, mono=True)

    # ---------- SILENCE TRIM ----------
    # ECAPA-TDNN produces a utterance-level embedding by averaging frame-
    # level outputs. Long silences at the head/tail of the clip pull that
    # average towards "nothing", washing out the speaker's identity and
    # making same-speaker cosine scores drift down into impostor
    # territory (0.4-0.5 instead of 0.7-0.9). We trim here so BOTH
    # enrollment and verification see speech-only audio before the
    # embedding is extracted.
    #
    # top_db=25 is a conservative gate (anything >25 dB below the max is
    # treated as silence). Loud enough to not clip actual speech, quiet
    # enough to catch typical room noise. Match _speech_duration in
    # biometric_service.py so both agree on what "speech" means.
    if len(y) > 0:
        try:
            y_trim, _ = librosa.effects.trim(y, top_db=25)
            # Only use the trimmed version if there's still real audio
            # left (don't accidentally throw away everything on a silent
            # file).
            if len(y_trim) > sr * 0.3:
                y = y_trim
        except Exception:
            # librosa trimming shouldn't fail, but if it does, fall back
            # to the raw signal — a slightly worse embedding is better
            # than a hard crash on upload.
            pass

    # ---------- RMS NORMALIZE ----------
    rms = float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0
    if rms > 1e-6:
        gain = TARGET_RMS / rms
        y = np.clip(y * gain, -1.0, 1.0)

    sf.write(path, y, 16000)