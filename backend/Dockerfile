FROM pytorch/pytorch:2.1.0-cuda11.8-cudnn8-runtime  

WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    ffmpeg \
    libsndfile1 \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock.txt .

RUN pip install --no-cache-dir -r requirements.lock.txt

# insightface only declares a generic "onnxruntime" dependency, so the bulk
# install above can land either the CPU-only `onnxruntime` or `onnxruntime-gpu`
# wheel last (pip's internal install order isn't controlled by file order,
# and both wheels write to the same onnxruntime/ import path) — reinstalling
# onnxruntime-gpu by itself here guarantees its files win, so insightface
# actually gets CUDAExecutionProvider instead of silently falling back to CPU.
RUN pip install --no-cache-dir --no-deps --force-reinstall onnxruntime-gpu==1.23.2

COPY . .

# Bake the pretrained models into the image layer instead of downloading
# them on every container start — avoids slow cold starts and a hard
# dependency on Hugging Face being reachable at boot time.
RUN python -c "from voiceverification.models.speaker_verifier import SpeakerVerifier; SpeakerVerifier(device='cpu')" \
&& python -c "from voiceverification.core.asvspoof import warm_up; warm_up()"

CMD ["uvicorn", "voiceverification.server:app", "--host", "0.0.0.0", "--port", "8000"]
