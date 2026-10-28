// Standard formulas for each wav2vec2 sub-module type, from the published
// architecture (Baevski et al. 2020 "wav2vec 2.0") — the *structure* of
// what that layer type computes in general, not numbers fitted to this
// specific pretrained model's learned weights (those aren't exposed by a
// forward hook). Shown collapsed by default next to each real captured
// block in ModelBlockTrace.
const BLOCK_FORMULAS: Record<string, string> = {
  "wav2vec2.feature_projection":
    "h = LayerNorm(conv_out); projected = W·h + b (ke hidden size 768)",
  "projector": "y = W · pooled + b",
  "classifier": "logits = W · y + b → softmax → P(asli), P(palsu)",
};

const CONV_FORMULA =
  "y[t,c] = Σ kernel_c[k] · x[stride·t+k] — konvolusi 1D langsung di atas sample mentah (bukan fitur mel)";

const ENCODER_LAYER_FORMULA =
  "Attention(Q,K,V) = softmax(QKᵀ/√d)·V, lalu feed-forward + residual + LayerNorm";

export function blockFormula(name: string): string | null {
  if (BLOCK_FORMULAS[name]) return BLOCK_FORMULAS[name];
  if (name.startsWith("wav2vec2.feature_extractor.conv_layers.")) return CONV_FORMULA;
  if (name.startsWith("wav2vec2.encoder.layers.")) return ENCODER_LAYER_FORMULA;
  return null;
}
