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

def save_audio(audio: UploadFile, debug_capture_dir: str | None = None) -> str:
    # ⚠️ Jangan percaya filename
    raw_ext = ".webm"
    raw_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}{raw_ext}")
    wav_path = raw_path.replace(".webm", ".wav")

    with open(raw_path, "wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)

    # Diagnostic-only: preserve the exact bytes the browser uploaded (before
    # ffmpeg ever touches them) so a false-positive "replay attack" verdict
    # can be compared against the clean dataset/ samples offline. Caller
    # gates this (see server.py's VOICE_DEBUG_CAPTURE_DIR) — None by default.
    if debug_capture_dir:
        os.makedirs(debug_capture_dir, exist_ok=True)
        shutil.copy(
            raw_path,
            os.path.join(debug_capture_dir, f"{os.path.basename(raw_path).removesuffix('.webm')}_raw.webm"),
        )

    webm_to_wav(raw_path, wav_path)
    os.remove(raw_path)

    return wav_path

def normalize_audio(path):
    y, sr = librosa.load(path, sr=16000, mono=True)

    rms = float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0
    if rms > 1e-6:
        gain = TARGET_RMS / rms
        y = np.clip(y * gain, -1.0, 1.0)

    sf.write(path, y, 16000)
    return rms


def audio_is_essentially_silent(path: str, rms_floor: float = 0.003) -> bool:
    """True when the uploaded take has basically no speech in it — a near-
    silent recording (muted mic, user didn't actually speak, or VAD got
    tripped by room hum). On input like that ECAPA still returns some
    embedding but it's effectively random, which is what makes verification
    score ~0% ('verifikasi sampe 0%' bug). Call this BEFORE extracting an
    embedding to reject the take cleanly with a 'speak louder / try again'
    message instead of handing the user a confusing DENIED verdict.

    rms_floor=0.003 is comfortably below normal mic-recorded speech (which
    sits around 0.01-0.1 before TARGET_RMS gain) but well above digital-
    silence noise."""
    y, _ = librosa.load(path, sr=16000, mono=True)
    if len(y) == 0:
        return True
    rms = float(np.sqrt(np.mean(y ** 2)))
    return rms < rms_floor