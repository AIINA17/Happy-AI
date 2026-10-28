"""Shared forward-hook tensor summary helper for the /pipeline explainer
page. Used by both models/speaker_verifier.py (ECAPA-TDNN) and
core/asvspoof.py (wav2vec2 anti-spoof classifier) so their per-block trace
output has an identical, interchangeable shape on the frontend.
"""

from __future__ import annotations

import torch


def tensor_summary(name: str, value: object) -> dict | None:
    """Compact, JSON-safe summary of one block's output tensor — shape plus
    summary stats and a short preview, never the full activation (could be
    hundreds of thousands of floats)."""
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
