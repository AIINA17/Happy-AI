// Standard formulas for each ECAPA-TDNN sub-module type, from the
// published architecture (Desplanques et al. 2020, SE-Net, Res2Net) — the
// *structure* of what that layer type computes in general, not numbers
// fitted to this specific pretrained model's learned weights (those aren't
// exposed by a forward hook). Shown collapsed by default next to each real
// captured block in EcapaBlockTrace.
const BLOCK_FORMULAS: Record<string, string> = {
  "mods.compute_features": "mel[k] = log(Σ |STFT(x)|² · filterbank_k)",
  "mods.mean_var_norm": "z = (x − μ_batch) / σ_batch",
  "mods.embedding_model.mfa": "concat(block₁, block₂, block₃, block₄) sepanjang kanal",
  "mods.embedding_model.asp":
    "αₜ = softmax(wᵀ·tanh(W·xₜ + b)); μ = Σ αₜxₜ; σ = √(Σ αₜ(xₜ−μ)²)",
  "mods.embedding_model.asp_bn": "BatchNorm1d(concat(μ, σ))",
  "mods.embedding_model.fc": "embedding = W · pooled + b",
  "mods.mean_var_norm_emb": "z = (embedding − μ) / σ",
};

const RES2BLOCK_FORMULA =
  "y = x + Conv(Res2-split(x)); gate = σ(FC₂(ReLU(FC₁(avgpool(y))))); output = y · gate";

export function blockFormula(name: string): string | null {
  if (BLOCK_FORMULAS[name]) return BLOCK_FORMULAS[name];
  if (name.startsWith("mods.embedding_model.blocks.")) return RES2BLOCK_FORMULA;
  return null;
}
