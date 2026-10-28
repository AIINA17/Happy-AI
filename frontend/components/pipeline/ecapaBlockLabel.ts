// Human-readable names for the ECAPA-TDNN sub-modules hooked in
// backend/voiceverification/models/speaker_verifier.py. Shared by
// EcapaMagnitudeChart and EcapaBlockTrace so the two never drift.
const BLOCK_LABELS: Record<string, string> = {
  "mods.compute_features": "Fitur akustik (mel-filterbank)",
  "mods.mean_var_norm": "Normalisasi input",
  "mods.embedding_model.mfa": "Multi-layer feature aggregation",
  "mods.embedding_model.asp": "Attentive statistics pooling",
  "mods.embedding_model.asp_bn": "Normalisasi pooling",
  "mods.embedding_model.fc": "Proyeksi embedding",
  "mods.mean_var_norm_emb": "Normalisasi embedding akhir",
};

export function blockLabel(name: string): string {
  if (BLOCK_LABELS[name]) return BLOCK_LABELS[name];
  const match = name.match(/embedding_model\.blocks\.(\d+)/);
  if (match) return `SE-Res2Block ${Number(match[1]) + 1}`;
  return name;
}
