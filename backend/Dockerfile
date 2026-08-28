FROM python:3.10-slim

WORKDIR /app

# install system deps untuk audio
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock.txt .

RUN pip install --no-cache-dir -r requirements.lock.txt

COPY . .

WORKDIR /app/voiceverification

# Bake the pretrained models into the image layer instead of downloading
# them on every container start — avoids slow cold starts and a hard
# dependency on Hugging Face being reachable at boot time.
RUN python -c "from models.speaker_verifier import SpeakerVerifier; SpeakerVerifier(device='cpu')" \
 && python -c "from core.asvspoof import warm_up; warm_up()"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
