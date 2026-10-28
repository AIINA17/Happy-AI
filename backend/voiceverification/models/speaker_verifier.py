import numpy as np
import torch
from numpy.linalg import norm

from speechbrain.pretrained import SpeakerRecognition

# Named sub-modules of speechbrain's ECAPA-TDNN worth capturing for the
# /pipeline explainer page: the acoustic front-end, each SE-Res2Block, the
# multi-layer feature aggregation, attentive statistics pooling (+ its
# batchnorm), and the final embedding projection. Hooking these forward
# passes doesn't change the model's behavior — it only reads the tensors it
# already produces.
_ECAPA_TRACE_MODULES = (
    "mods.compute_features",
    "mods.mean_var_norm",
    "mods.embedding_model.mfa",
    "mods.embedding_model.asp",
    "mods.embedding_model.asp_bn",
    "mods.embedding_model.fc",
    "mods.mean_var_norm_emb",
)


def _is_traced_block(name: str) -> bool:
    if name in _ECAPA_TRACE_MODULES:
        return True
    # mods.embedding_model.blocks.<i> — the SE-Res2Blocks themselves, not
    # their internal sub-layers (those are one dot deeper).
    return name.startswith("mods.embedding_model.blocks.") and name.count(".") == 3


def _tensor_summary(name: str, value: object) -> dict | None:
    """Compact, JSON-safe summary of one block's output tensor — shape plus
    summary stats and a short preview, never the full activation (could be
    e.g. 1024x1001 floats)."""
    if not isinstance(value, torch.Tensor):
        return None

    tensor = value.detach().float().cpu()
    flat = tensor.reshape(-1)
    if flat.numel() == 0:
        return {"name": name, "shape": list(tensor.shape), "preview": []}

    return {
        "name": name,
        "shape": list(tensor.shape),
        "mean": float(tensor.mean()),
        "std": float(tensor.std(unbiased=False)),
        "min": float(tensor.min()),
        "max": float(tensor.max()),
        "preview": [float(v) for v in flat[:64].tolist()],
    }


class SpeakerVerifier:
    def __init__(self, device="cpu"):
        self.model = SpeakerRecognition.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="pretrained_models/spkrec-ecapa-voxceleb",
            run_opts={"device": device},
        )
        self.device = device

    def extract_embedding(self, wav_path, capture_trace: bool = False):
        """
        Extract speaker embedding from wav. With capture_trace=True, also
        return a list of per-block tensor summaries captured via forward
        hooks on the real ECAPA-TDNN forward pass (see _ECAPA_TRACE_MODULES)
        — for the /pipeline explainer page, not used by the decision logic.
        """
        self.model.eval()
        block_traces: list[dict] = []
        hooks = []

        if capture_trace:
            def _capture(name):
                def _hook(_module, _inputs, output):
                    summary = _tensor_summary(name, output)
                    if summary is not None:
                        block_traces.append(summary)
                return _hook

            for name, module in self.model.named_modules():
                if _is_traced_block(name):
                    hooks.append(module.register_forward_hook(_capture(name)))

        try:
            with torch.no_grad():
                waveform = self.model.load_audio(wav_path)
                if waveform.dim() == 1:
                    waveform = waveform.unsqueeze(0)
                emb = self.model.encode_batch(waveform)
        finally:
            for hook in hooks:
                hook.remove()

        emb = emb.squeeze().cpu().numpy()
        emb = emb / np.linalg.norm(emb)

        if capture_trace:
            return emb, block_traces
        return emb
    
    def compare_embeddings(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """
        Cosine similarity between two embeddings (0 to 1)
        """
        score = np.dot(emb1, emb2)
        return float(score)


    def verify(self, live, enroll):
        score, _ = self.model.verify_files(live, enroll)
        return float(score.item())