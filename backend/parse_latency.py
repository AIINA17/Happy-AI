#!/usr/bin/env python3
"""Olah log agen menjadi statistik pengujian (U-15, U-18, U-20, U-21).

Pemakaian:
    python parse_latency.py logs/agent_*.log
    python parse_latency.py logs/agent_*.log --latex     # keluarkan baris tabel LaTeX

Membaca baris yang dicetak agen:
    ⏱ TURN #N | last-speech->first-audio=X.XXs (with tools|no tools) | est. felt=...
    ⏱ Gemini ttft=X.XXs total=Y.YYs
    ⏱ TOOL <nama> dur=X.XXs status=ok | ...        (setelah apply_timing_patch.py)
dan menghitung kejadian pemulihan/timeout. Nilai "pengukuran" (last-speech->first-audio)
dilaporkan terpisah dari estimasi jaringan (+0,5 s), jangan digabung.
"""
import math
import re
import statistics
import sys
from collections import defaultdict

ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
TURN = re.compile(r"TURN #\d+ \| last-speech->first-audio=([\d.]+)s \((with tools|no tools)\)")
TTFT = re.compile(r"Gemini ttft=([\d.]+)s total=([\d.]+)s")
TOOL = re.compile(r"TOOL (\w+) dur=([\d.]+)s status=(\S+)")
EVENTS = {
    "Pemulihan senyap (generate_reply)": "Recovery generate_reply dispatched",
    "Giliran berakhir tanpa jawaban": "Turn ended without a reply",
    "Timeout verifikasi suara": "Verification timed out",
    "Timeout verifikasi wajah": "Face verification timed out",
    "Hasil suara diterima": "Voice result:",
    "Hasil wajah diterima": "Face result:",
}


def stats(xs):
    xs = sorted(xs)
    n = len(xs)
    p90 = xs[max(0, math.ceil(0.9 * n) - 1)]
    return n, statistics.mean(xs), statistics.median(xs), p90, xs[0], xs[-1]


def fmt(name, xs, latex):
    n, mean, med, p90, lo, hi = stats(xs)
    if latex:
        return f"{name} & {n} & {mean:.2f} & {med:.2f} & {p90:.2f} & {lo:.2f} & {hi:.2f} \\\\ \\hline"
    return f"{name:<34}{n:>4}  mean={mean:.2f}  median={med:.2f}  p90={p90:.2f}  min={lo:.2f}  max={hi:.2f}"


def main():
    latex = "--latex" in sys.argv
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not files:
        sys.exit(__doc__)

    groups = defaultdict(list)
    tools = defaultdict(list)
    tool_err = defaultdict(int)
    events = defaultdict(int)

    for f in files:
        with open(f, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = ANSI.sub("", line)
                m = TURN.search(line)
                if m:
                    v = float(m.group(1))
                    groups["Respons percakapan (semua)"].append(v)
                    groups["Respons percakapan (" + m.group(2) + ")"].append(v)
                    continue
                m = TTFT.search(line)
                if m:
                    groups["TTFT Gemini"].append(float(m.group(1)))
                    groups["Durasi total respons Gemini"].append(float(m.group(2)))
                    continue
                m = TOOL.search(line)
                if m:
                    tools[m.group(1)].append(float(m.group(2)))
                    if not m.group(3).startswith("ok"):
                        tool_err[m.group(1)] += 1
                    continue
                for label, needle in EVENTS.items():
                    if needle in line:
                        events[label] += 1

    if latex:
        print("% Nama & n & rata-rata & median & P90 & min & maks (detik)")
    else:
        print("== Latensi percakapan dan model (detik) ==")
    for name in sorted(groups):
        print(fmt(name, groups[name], latex))
    if tools:
        print("" if latex else "\n== Durasi per tool (detik) ==")
        for name in sorted(tools):
            extra = f"  [galat: {tool_err[name]}]" if tool_err[name] and not latex else ""
            print(fmt(name, tools[name], latex) + extra)
    if events and not latex:
        print("\n== Kejadian ==")
        for label, c in events.items():
            print(f"{label:<36}{c}")
    if not groups and not tools:
        print("Tidak ada baris ⏱ yang ditemukan; periksa path log.", file=sys.stderr)


if __name__ == "__main__":
    main()
