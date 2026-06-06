import os
import shutil
import uuid
import librosa
import soundfile as sf

from fastapi import UploadFile
from voiceverification.utils.ffmpeg import webm_to_wav

UPLOAD_DIR = "tmp_audio"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def save_audio(audio: UploadFile) -> str:
    """Persist uploaded audio to a 16kHz mono WAV and return its path.

    If the upload is already WAV, we store it as-is (normalization happens later).
    Otherwise we store a raw temp file and use ffmpeg to convert.

    NOTE: We intentionally do not trust the client filename/extension.
    """

    content_type = (getattr(audio, "content_type", None) or "").lower().strip()
    wav_types = {
        "audio/wav",
        "audio/x-wav",
        "audio/wave",
        "audio/vnd.wave",
    }

    wav_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.wav")

    # If the client explicitly sends WAV, skip ffmpeg (keeps local dev simple).
    if content_type in wav_types:
        with open(wav_path, "wb") as buffer:
            shutil.copyfileobj(audio.file, buffer)
        return wav_path

    # Fallback: assume a webm-like container and convert via ffmpeg.
    raw_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.webm")
    with open(raw_path, "wb") as buffer:
        shutil.copyfileobj(audio.file, buffer)

    try:
        webm_to_wav(raw_path, wav_path)
    finally:
        if os.path.exists(raw_path):
            os.remove(raw_path)

    return wav_path

def normalize_audio(path):
    y, sr = librosa.load(path, sr=16000, mono=True)
    sf.write(path, y, 16000)