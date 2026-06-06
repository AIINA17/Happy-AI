
"""CLI test helper that hits the FastAPI endpoints (recommended).

Flow:
- (optional) login to Supabase to obtain an access token
- (optional) enroll voice via POST /enroll-voice
- verify voice via POST /verify-voice

This avoids calling BiometricService directly and matches production behavior.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path
import importlib
from datetime import datetime, timezone

import numpy as np


def _load_env() -> None:
    try:
        dotenv = importlib.import_module("dotenv")
        load_dotenv = getattr(dotenv, "load_dotenv")
    except Exception:
        return

    backend_dir = Path(__file__).resolve().parents[1]
    env_path = backend_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)


def _print(data: str) -> None:
    """Print with Rich if available, else plain print."""
    try:
        from rich import print as rich_print

        rich_print(data)
    except Exception:
        print(data)


def _record_to_wav(duration_s: float, sample_rate: int) -> str:
    try:
        sd = importlib.import_module("sounddevice")
    except Exception as e:
        raise RuntimeError(
            "sounddevice is required for recording. Install it or pass --wav_path."
        ) from e

    n_samples = int(duration_s * sample_rate)
    _print(f"\n[cyan]Recording {duration_s:.1f}s @ {sample_rate}Hz...[/cyan]")
    audio = sd.rec(n_samples, samplerate=sample_rate, channels=1, dtype="float32")
    sd.wait()
    audio = np.asarray(audio).reshape(-1)

    try:
        sf = importlib.import_module("soundfile")
    except Exception as e:
        raise RuntimeError(
            "soundfile is required to write WAV. Install it or provide --wav_path."
        ) from e

    fd, path = tempfile.mkstemp(prefix="vv_test_", suffix=".wav")
    os.close(fd)
    sf.write(path, audio, sample_rate)
    _print("[green]Recording saved.[/green]")
    return path


def _supabase_login(email: str, password: str) -> str:
    """Return Supabase access token using SUPABASE_URL + SUPABASE_KEY."""
    try:
        supabase_mod = importlib.import_module("supabase")
        create_client = getattr(supabase_mod, "create_client")
    except Exception as e:
        raise RuntimeError(
            "supabase package is required for --email/--password login. Install it or pass --token."
        ) from e

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError(
            "Missing SUPABASE_URL/SUPABASE_KEY. Load backend/.env or export env vars."
        )

    client = create_client(supabase_url, supabase_key)
    res = client.auth.sign_in_with_password({"email": email, "password": password})
    session = getattr(res, "session", None)
    if not session or not getattr(session, "access_token", None):
        raise RuntimeError("Login failed: no session/access_token returned")
    return session.access_token


def _request_json(method: str, url: str, *, headers: dict[str, str] | None = None, **kwargs):
    import requests

    resp = requests.request(method, url, headers=headers, timeout=60, **kwargs)
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text}

    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code} from {url}: {data}")
    return data


def _append_jsonl_log(log_file: str, record: dict) -> None:
    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _health(base_url: str) -> None:
    data = _request_json("GET", f"{base_url}/health")
    _print(f"[dim]Health:[/dim] {json.dumps(data, indent=2)}")


def _get_enrollments(base_url: str, token: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    return _request_json("GET", f"{base_url}/enrollments", headers=headers)


def _enroll_voice(base_url: str, token: str, wav_path: str, label: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    with open(wav_path, "rb") as f:
        files = {"audio": (Path(wav_path).name, f, "audio/wav")}
        data = {"label": label}
        return _request_json(
            "POST",
            f"{base_url}/enroll-voice",
            headers=headers,
            files=files,
            data=data,
        )


def _verify_voice(base_url: str, token: str, wav_path: str) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    with open(wav_path, "rb") as f:
        files = {"audio": (Path(wav_path).name, f, "audio/wav")}
        return _request_json(
            "POST",
            f"{base_url}/verify-voice",
            headers=headers,
            files=files,
        )


def main() -> int:
    _load_env()

    parser = argparse.ArgumentParser(
        description="Test voice verification via FastAPI endpoints (/verify-voice)."
    )
    parser.add_argument(
        "--base_url",
        default=os.getenv("SERVER_URL", "http://localhost:8000"),
        help="FastAPI base URL (default: SERVER_URL env var or http://localhost:8000)",
    )

    # Auth options
    parser.add_argument("--token", help="Supabase access token (Authorization Bearer)")
    parser.add_argument("--email", help="Supabase email (for login)")
    parser.add_argument("--password", help="Supabase password (for login)")

    # Audio options
    parser.add_argument("--wav_path", help="Use an existing WAV instead of recording")
    parser.add_argument("--duration", type=float, default=5.0, help="Record seconds")
    parser.add_argument("--sample_rate", type=int, default=16000, help="Sample rate")

    # Optional enrollment
    parser.add_argument(
        "--enroll_first",
        action="store_true",
        help="Enroll first (POST /enroll-voice) before verifying",
    )
    parser.add_argument(
        "--label",
        help="Label for enrollment (required if --enroll_first)",
    )
    parser.add_argument(
        "--keep_wav",
        action="store_true",
        help="Do not delete temporary recorded wav",
    )
    parser.add_argument(
        "--log_file",
        default="verify_voice_test.jsonl",
        help="Append verification summary as JSONL (default: verify_voice_test.jsonl)",
    )

    args = parser.parse_args()

    token = args.token
    if not token:
        if args.email and args.password:
            _print("[dim]Logging in to Supabase...[/dim]")
            token = _supabase_login(args.email, args.password)
        else:
            _print(
                "[red]Missing auth.[/red] Provide --token or (--email and --password)."
            )
            return 2

    base_url = args.base_url.rstrip("/")
    _health(base_url)

    # Show enrollments (helps debug wrong token/user)
    enrollments = _get_enrollments(base_url, token)
    _print(f"\n[bold]Enrollments:[/bold]\n{json.dumps(enrollments, indent=2)}")

    wav_paths_to_cleanup: list[str] = []
    try:
        if args.enroll_first:
            if not args.label:
                _print("[red]--label is required when using --enroll_first[/red]")
                return 2

            enroll_wav = args.wav_path or _record_to_wav(args.duration, args.sample_rate)
            if not args.wav_path:
                wav_paths_to_cleanup.append(enroll_wav)

            _print(f"\n[dim]Enrolling with label '{args.label}'...[/dim]")
            enrolled = _enroll_voice(base_url, token, enroll_wav, args.label)
            _print(f"[green]Enroll OK:[/green]\n{json.dumps(enrolled, indent=2)}")

        # Verification audio
        verify_wav = args.wav_path or _record_to_wav(args.duration, args.sample_rate)
        if not args.wav_path:
            wav_paths_to_cleanup.append(verify_wav)

        _print("\n[dim]Calling POST /verify-voice...[/dim]")
        result = _verify_voice(base_url, token, verify_wav)
        _print(f"\n[bold magenta]Verify result:[/bold magenta]\n{json.dumps(result, indent=2)}")

        # Persist a compact summary in a log file (do NOT log token/password)
        similarity = result.get("score")
        spoof_prob = result.get("spoof_prob")
        liveness_est = None
        if isinstance(spoof_prob, (int, float)):
            liveness_est = float(1.0 - float(spoof_prob))

        log_record = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "base_url": base_url,
            "wav": str(Path(verify_wav).name),
            "verified": result.get("verified"),
            "status": result.get("status"),
            "reason": result.get("reason"),
            "matched_label": result.get("matched_label"),
            "similarity": similarity,
            "spoof_prob": spoof_prob,
            "liveness_est": liveness_est,
        }
        _append_jsonl_log(args.log_file, log_record)
        _print(f"\n[dim]Logged to:[/dim] {args.log_file}")
        return 0

    finally:
        if not args.keep_wav:
            for p in wav_paths_to_cleanup:
                try:
                    os.remove(p)
                except Exception:
                    pass


if __name__ == "__main__":
    raise SystemExit(main())

