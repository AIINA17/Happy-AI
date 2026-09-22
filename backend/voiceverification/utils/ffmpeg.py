import subprocess
import os

def ensure_ffmpeg():
    if os.system("which ffmpeg > /dev/null") != 0:
        raise RuntimeError("ffmpeg not installed")

def webm_to_wav(src: str, dst: str):
    ensure_ffmpeg()

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                src,
                "-ar",
                "16000",  # sample rate
                "-ac",
                "1",  # mono
                "-f",
                "wav",
                dst,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or "").strip()
        # Keep message short-ish, ffmpeg can be very verbose
        if len(stderr) > 800:
            stderr = stderr[-800:]
        raise RuntimeError(f"ffmpeg failed converting audio: {stderr}") from e
