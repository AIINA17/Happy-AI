// Human-readable names for the wav2vec2 anti-spoof model's hooked
// sub-modules (see backend/voiceverification/core/asvspoof.py).
const BLOCK_LABELS: Record<string, string> = {
  "wav2vec2.feature_extractor.conv_layers.0": "Conv 1D #1 (langsung dari raw waveform)",
  "wav2vec2.feature_extractor.conv_layers.3": "Conv 1D #4 (tengah tumpukan)",
  "wav2vec2.feature_extractor.conv_layers.6": "Conv 1D #7 (terakhir, siap ke transformer)",
  "wav2vec2.feature_projection": "Proyeksi fitur ke hidden size transformer",
  "wav2vec2.encoder.layers.0": "Transformer encoder — layer 1 dari 12",
  "wav2vec2.encoder.layers.5": "Transformer encoder — layer 6 dari 12",
  "wav2vec2.encoder.layers.11": "Transformer encoder — layer 12 (terakhir)",
  "projector": "Proyeksi sebelum klasifikasi",
  "classifier": "Classification head (logits asli/palsu)",
};

export function blockLabel(name: string): string {
  return BLOCK_LABELS[name] ?? name;
}
