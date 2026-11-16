"""Repeatable Agent-side test matrix for C501 evidence.

This runner covers the parts that do not require a browser or a live Gemini
room: verification gates, verification expiry, and real tool timing against
the configured dummy stores. It never creates an order.

Run from backend/:

    python -m agent.analysis.run_agent_test_matrix

The output JSON contains one record per assertion and can be kept as raw
evidence for Chapter 5. Use ``--live-tools`` to call the configured stores
for search and product detail timing. Those calls are read-only.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

if __package__ in (None, ""):
    BACKEND_DIR = Path(__file__).resolve().parents[2]
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))

from agent import tools


DEFAULT_OUTPUT = Path(__file__).with_name("agent_test_matrix.json")
SENSITIVE_ACTIONS = (
    "login",
    "logout",
    "cek saldo",
    "nambahin ke keranjang",
    "hapus item dari keranjang",
    "checkout",
    "bayar order",
)
GATE_STATUSES = ("UNKNOWN", "REPEAT", "DENIED", "EXPIRED", "VERIFIED")


def _set_state(status: str, *, verified: bool = False, last_verified_at: float | None = None) -> None:
    tools.auth_state["agent_state"] = {
        "user_id": "test-user",
        "voice_status": status,
        "is_voice_verified": verified,
        "last_verified_at": last_verified_at,
        "verify_attempts": 0,
        "lockout_until": None,
    }


def _record(records: list[dict[str, Any]], case: str, expected: bool, actual: bool, detail: str) -> None:
    records.append(
        {
            "case": case,
            "expected": "PASS" if expected else "FAIL",
            "actual": "PASS" if actual else "FAIL",
            "status": "PASS" if expected == actual else "FAIL",
            "detail": detail,
        }
    )


async def run_gate_matrix(records: list[dict[str, Any]]) -> None:
    for status in GATE_STATUSES:
        _set_state(status, verified=status == "VERIFIED", last_verified_at=time.time())
        for action in SENSITIVE_ACTIONS:
            error = tools.require_voice_verification(action)
            allowed = error is None
            expected_allowed = status == "VERIFIED"
            _record(
                records,
                f"gate/{status}/{action}",
                expected_allowed,
                allowed,
                "allowed" if allowed else error or "blocked",
            )


async def run_expiry_test(records: list[dict[str, Any]]) -> None:
    _set_state(
        "VERIFIED",
        verified=True,
        last_verified_at=time.time() - tools.REVERIFY_INTERVAL - 1,
    )
    result = await tools.check_voice_status()
    state = tools.auth_state["agent_state"]
    _record(
        records,
        "expiry/verified-after-reverify-interval",
        True,
        state["voice_status"] == "EXPIRED" and not state["is_voice_verified"],
        result,
    )


async def _timed_call(
    records: list[dict[str, Any]],
    name: str,
    function: Callable[..., Awaitable[str]],
    **kwargs: Any,
) -> None:
    started = time.perf_counter()
    try:
        output = await function(**kwargs)
        error = None
    except Exception as exc:  # noqa: BLE001 - the report must expose tool failures
        output = ""
        error = f"{type(exc).__name__}: {exc}"
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    records.append(
        {
            "case": f"tool/{name}",
            "status": "PASS" if error is None else "FAIL",
            "duration_ms": duration_ms,
            "output_preview": output[:300],
            "error": error,
        }
    )


async def run_read_only_tool_benchmarks(records: list[dict[str, Any]]) -> None:
    _set_state("UNKNOWN")
    await _timed_call(records, "get_user_city", tools.get_user_city)
    await _timed_call(records, "search_product", tools.search_product, query="sepatu")

    cached = tools.auth_state.get("last_search_products") or []
    if cached:
        product = cached[0]
        await _timed_call(
            records,
            "get_product_detail",
            tools.get_product_detail,
            product_id=int(product["id"]),
            source=product["source"],
        )

    await _timed_call(records, "check_login_status", tools.check_login_status)
    for source in ("oren", "hijau"):
        await _timed_call(records, f"get_cart/{source}", tools.get_cart, source=source)


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live-tools",
        action="store_true",
        help="Call read-only tools against the configured dummy stores.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="JSON output path (default: agent/analysis/agent_test_matrix.json).",
    )
    args = parser.parse_args()

    records: list[dict[str, Any]] = []
    await run_gate_matrix(records)
    await run_expiry_test(records)
    if args.live_tools:
        await run_read_only_tool_benchmarks(records)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "python": sys.version,
        "live_tools": args.live_tools,
        "records": records,
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    failed = sum(record["status"] == "FAIL" for record in records)
    print(f"Wrote {len(records)} records to {output_path}")
    print(f"Result: {len(records) - failed} PASS, {failed} FAIL")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
