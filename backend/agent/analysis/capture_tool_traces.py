"""Capture a small set of REAL shopping-agent tool calls for the
/pipeline-agent explainer page's replay mode — same spirit as
voiceverification/analysis/capture_pipeline_traces.py: call the actual
`@function_tool` functions directly (bypassing LiveKit/Gemini, which need a
live voice session), against the REAL deployed dummy e-commerce backends
(see ecommerce_sources.py) so results are genuinely measured, not invented.

What's real vs. illustrative in the output, to be upfront about it:
- tool name, arguments, the exact code path taken (voice gate pass/fail,
  login check), the returned string, and timing: 100% real, captured from
  an actual call.
- `user_utterance`: a plausible EXAMPLE of what a user might say to trigger
  that tool — written by this script's author, not a transcript of a real
  voice session (this project has no live session to capture one from
  offline). Clearly labeled as an example in the output schema.

Login/checkout success can't be captured here: logging in reads a user's
own encrypted stored credentials from Supabase, which only exist for a
real signed-in account — there's no universal demo account. So the
voice-gated scenarios below show the real DENIED and real "needs login"
paths, which exercise the full, real code path short of actually owning
an account — see AGENT_SCENARIOS_NOTE below for why that's still the
most honest and informative thing to show.

Run from backend/ or backend/agent/ (sys.path is fixed up below):
    python agent/analysis/capture_tool_traces.py

Writes tool_traces.json next to this script. Copy that file to
frontend/public/pipeline-demo/tool-traces.json to serve it statically.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import sys
import time
from pathlib import Path

import requests

ANALYSIS_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_DIR = os.path.dirname(ANALYSIS_DIR)
BACKEND_DIR = os.path.dirname(AGENT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from agent import tools as agent_tools  # noqa: E402

DEFAULT_OUT = Path(ANALYSIS_DIR) / "tool_traces.json"

# Data-channel events a tool is documented to trigger as a side effect, from
# reading the real code (tools.py's _send_product_cards_internal /
# _send_review_cards_internal, topic="PRODUCT_DATA"). This offline script
# has no live LiveKit room to actually publish through, so these are facts
# about what the code does in general — not something captured from this
# particular run — and are labeled as such in the output schema.
FRONTEND_EVENTS = {
    "search_product": {
        "type": "PRODUCT_CARDS",
        "topic": "PRODUCT_DATA",
        "note": "Side-effect lewat _send_product_cards_internal (tools.py) — mengirim hingga 5 kartu produk ke frontend, plus simpan ke tabel product_cards.",
    },
    "send_product_cards": {
        "type": "PRODUCT_CARDS",
        "topic": "PRODUCT_DATA",
        "note": "Mengirim ulang kartu produk yang diminta eksplisit ke frontend.",
    },
    "send_review_cards": {
        "type": "REVIEW_CARDS",
        "topic": "PRODUCT_DATA",
        "note": "Mengirim hingga 10 kartu review produk ke frontend, plus simpan ke tabel review_cards.",
    },
}


def _summarize_body(data) -> str:
    if isinstance(data, list):
        return f"[list, {len(data)} item]"
    if isinstance(data, dict):
        keys = ", ".join(list(data.keys())[:6])
        return f"{{...{len(data)} field: {keys}}}"
    return str(data)[:100]


class _HttpCapture:
    """Temporarily wraps requests.get/post/put/delete to record real
    method/url/status/timing for whatever HTTP calls happen inside the
    `with` block — e.g. the adapter's calls to the live dummy e-commerce
    backends. Restores the originals on exit either way."""

    METHODS = ("get", "post", "put", "delete")

    def __init__(self):
        self.calls: list[dict] = []
        self._originals: dict[str, object] = {}

    def _wrap(self, method_name: str, original):
        def wrapper(url, *args, **kwargs):
            start = time.perf_counter()
            response = original(url, *args, **kwargs)
            duration_ms = round((time.perf_counter() - start) * 1000, 1)
            try:
                body = response.json()
                preview = _summarize_body(body)
            except Exception:
                preview = None
            self.calls.append({
                "method": method_name.upper(),
                "url": url,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "response_preview": preview,
            })
            return response
        return wrapper

    def __enter__(self):
        for m in self.METHODS:
            self._originals[m] = getattr(requests, m)
            setattr(requests, m, self._wrap(m, self._originals[m]))
        return self

    def __exit__(self, *exc):
        for m, original in self._originals.items():
            setattr(requests, m, original)
        return False

AGENT_SCENARIOS_NOTE = (
    "Login butuh kredensial akun e-commerce milik user sendiri yang "
    "tersimpan terenkripsi di Supabase — tidak ada akun demo universal, "
    "jadi skenario ini tidak bisa menunjukkan checkout yang benar-benar "
    "sukses. Yang ditunjukkan: gerbang verifikasi suara (lolos/ditolak) "
    "dan pengecekan login — keduanya jalur kode asli, bukan disimulasikan."
)


def _set_voice_status(status: str, *, verified: bool = False):
    agent_tools.auth_state["agent_state"] = {
        "user_city": "Yogyakarta",
        "is_voice_verified": verified,
        "voice_status": status,
        "last_verified_at": time.time() if verified else None,
        "verify_attempts": 0,
        "lockout_until": None,
    }


async def _call(name: str, fn, *, title, user_utterance, policy_note, gated, **kwargs):
    voice_state_before = dict(agent_tools.auth_state.get("agent_state") or {})

    with _HttpCapture() as http:
        start = time.perf_counter()
        output = await fn(**kwargs)
        duration_ms = round((time.perf_counter() - start) * 1000, 1)

    # __wrapped__ is the real undecorated function (function_tool wraps it)
    # — grab its real signature so the page shows the actual parameter list.
    raw_fn = getattr(fn, "__wrapped__", fn)
    try:
        signature = str(inspect.signature(raw_fn))
    except (TypeError, ValueError):
        signature = "(...)"

    voice_gate = None
    if gated:
        voice_gate = {
            "status_before": voice_state_before.get("voice_status", "UNKNOWN"),
            "passed": voice_state_before.get("voice_status") == "VERIFIED",
        }

    record = {
        "step": name,
        "title": title,
        "user_utterance": user_utterance,
        "policy_note": policy_note,
        "tool": {
            "name": name,
            "signature": f"{name}{signature}",
            "gated": gated,
        },
        "arguments": kwargs,
        "voice_gate": voice_gate,
        "http_calls": http.calls,
        "frontend_event": FRONTEND_EVENTS.get(name),
        "result": {
            "output": output,
            "duration_ms": duration_ms,
        },
    }
    http_note = f" | {len(http.calls)} HTTP call" if http.calls else ""
    print(f"{name:22s} -> {duration_ms:7.1f}ms{http_note} | {output[:60]!r}")
    return record


async def main() -> int:
    traces: list[dict] = []

    # 1. Non-gated: real GPS-derived city lookup.
    _set_voice_status("UNKNOWN", verified=False)
    traces.append(await _call(
        "get_user_city", agent_tools.get_user_city,
        title="Cek lokasi user",
        user_utterance="Eh gue lagi di mana ya menurut lo?",
        policy_note="Agent pakai lokasi GPS user untuk filter toko terdekat saat search (lihat 'GPS-based city-awareness' di prompts.py).",
        gated=False,
    ))

    # 2. Non-gated: real search against the live dummy store backends.
    search_result = await _call(
        "search_product", agent_tools.search_product,
        title="Cari produk",
        user_utterance="Carikan sepatu dong, yang murah aja",
        policy_note="'Always use tools when real-time data is required... never guess prices, stock, or search results' (TOOL USAGE RULES, prompts.py).",
        gated=False,
        query="sepatu",
    )
    traces.append(search_result)

    # Pull a real product_id/source out of search_product's own cache
    # (auth_state["last_search_products"]) so get_product_detail below is
    # called on something that actually exists.
    cached = agent_tools.auth_state.get("last_search_products") or []
    if cached:
        pick = cached[0]
        product_id, source = pick.get("id"), pick.get("source")
    else:
        product_id, source = 1, "oren"

    # 3. Non-gated: real product detail lookup.
    traces.append(await _call(
        "get_product_detail", agent_tools.get_product_detail,
        title="Lihat detail produk",
        user_utterance="Yang nomor satu itu detailnya gimana?",
        policy_note="Shopping flow step 2: 'Briefly explain the results... clearly mention price and important details' (prompts.py).",
        gated=False,
        product_id=product_id, source=source,
    ))

    # 4. Gated, NOT verified: real denial from require_voice_verification.
    _set_voice_status("UNKNOWN", verified=False)
    traces.append(await _call(
        "add_to_cart", agent_tools.add_to_cart,
        title="Coba tambah ke keranjang (belum terverifikasi)",
        user_utterance="Oke gas, masukin keranjang ya",
        policy_note="'You MUST NOT call any ...cart, or payment tools unless voice verification has been explicitly confirmed' (VOICE VERIFICATION RULE, prompts.py).",
        gated=True,
        product_id=product_id, source=source, quantity=1,
    ))

    # 5. Gated, VERIFIED: gate passes, but blocked by the separate login
    # check (a second, independent security layer — not the same gate).
    _set_voice_status("VERIFIED", verified=True)
    traces.append(await _call(
        "add_to_cart", agent_tools.add_to_cart,
        title="Tambah ke keranjang (sudah terverifikasi)",
        user_utterance="Oke gas, masukin keranjang ya",
        policy_note="Setelah gerbang suara lolos, add_to_cart masih mengecek status login akun toko secara terpisah — dua lapis keamanan berbeda.",
        gated=True,
        product_id=product_id, source=source, quantity=1,
    ))

    # 6. Non-gated: real cart check (reflects the same login state).
    traces.append(await _call(
        "get_cart", agent_tools.get_cart,
        title="Lihat isi keranjang",
        user_utterance="Keranjang gue isinya apa aja sih sekarang?",
        policy_note="'Show cart and ask which items to checkout' (shopping flow, prompts.py).",
        gated=False,
        source=source,
    ))

    # 7. Gated, VERIFIED: the most sensitive action, same login block.
    traces.append(await _call(
        "checkout", agent_tools.checkout,
        title="Checkout",
        user_utterance="Udah, checkout aja semuanya, bayar pake GoPay",
        policy_note="'Never checkout without clear confirmation... always confirm payment method before checkout' (CONFIRMATION & SAFETY RULES, prompts.py).",
        gated=True,
        source=source, payment_method="GoPay",
    ))

    out_path = DEFAULT_OUT
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(
        {"note": AGENT_SCENARIOS_NOTE, "steps": traces}, indent=2, ensure_ascii=False
    ))
    print(f"\nWrote {len(traces)} tool-call trace(s) to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
