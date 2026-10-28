"""Turns face_verification_test_log.csv (produced by test_face_conditions.py)
into report-ready charts: a condition x status count matrix, a similarity
distribution per condition against the verification threshold, and a
per-condition accuracy summary.

Run from backend/face_recognition/, after collecting some real test data:
    python plot_test_results.py
Writes PNGs into test_results_plots/ next to the CSV.

The "spoof" condition has no ground truth to grade against (see
test_face_conditions.py's module docstring: this pipeline has no
server-side liveness check on a static image) — its bars/points are drawn
with a hatch pattern and labeled "ungraded" rather than counted as
correct/wrong.

Colors follow this session's validated reference palette: the first three
categorical slots (blue/orange/aqua) for the three conditions, and the fixed
status palette (good/critical) for the verification threshold — both used
as-is from the dataviz skill's reference instance.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import Counter
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap

TEST_FILE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(TEST_FILE_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

CONDITIONS = ("genuine", "impostor", "spoof")
STATUSES = ("VERIFIED", "DENIED", "ERROR")
EXPECTED_VERIFIED = {"genuine": True, "impostor": False}  # spoof: ungraded

CONDITION_COLOR = {"genuine": "#2a78d6", "impostor": "#eb6834", "spoof": "#1baf7a"}
STATUS_COLOR = {"good": "#0ca30c", "critical": "#d03b3b"}
SEQUENTIAL_BLUE = ["#fcfcfb", "#cde2fb", "#9ec5f4", "#5598e7", "#2a78d6", "#184f95"]

INK_PRIMARY = "#0b0b0b"
INK_SECONDARY = "#52514e"
GRIDLINE = "#e1e0d9"
SURFACE = "#fcfcfb"


def _load_rows(csv_path: Path) -> list[dict]:
    if not csv_path.exists():
        raise SystemExit(f"No log file at {csv_path} — run test_face_conditions.py first.")
    with csv_path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _style_axes(ax) -> None:
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    for spine in ("left", "bottom"):
        ax.spines[spine].set_color(GRIDLINE)
    ax.tick_params(colors=INK_SECONDARY)
    ax.yaxis.label.set_color(INK_SECONDARY)
    ax.xaxis.label.set_color(INK_SECONDARY)
    ax.title.set_color(INK_PRIMARY)


def plot_confusion_matrix(rows: list[dict], out_path: Path) -> None:
    counts = {c: Counter() for c in CONDITIONS}
    for row in rows:
        if row["condition"] in counts and row["status"] in STATUSES:
            counts[row["condition"]][row["status"]] += 1

    matrix = np.array([[counts[c][s] for s in STATUSES] for c in CONDITIONS])
    vmax = max(int(matrix.max()), 1)

    fig, ax = plt.subplots(figsize=(6, 4), facecolor=SURFACE)
    ax.set_facecolor(SURFACE)
    cmap = LinearSegmentedColormap.from_list("seq_blue", SEQUENTIAL_BLUE)
    im = ax.imshow(matrix, cmap=cmap, vmin=0, vmax=vmax, aspect="auto")

    ax.set_xticks(range(len(STATUSES)))
    ax.set_xticklabels(STATUSES, color=INK_SECONDARY)
    ax.set_yticks(range(len(CONDITIONS)))
    ax.set_yticklabels([c.capitalize() for c in CONDITIONS], color=INK_SECONDARY)
    ax.set_title("Hasil verifikasi wajah per kondisi", color=INK_PRIMARY)

    for i in range(len(CONDITIONS)):
        for j in range(len(STATUSES)):
            value = int(matrix[i, j])
            text_color = INK_PRIMARY if value < vmax * 0.6 else "#ffffff"
            ax.text(j, i, str(value), ha="center", va="center", color=text_color, fontsize=12)

    for spine in ax.spines.values():
        spine.set_visible(False)
    fig.colorbar(im, ax=ax, label="Jumlah file", fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"✅ Saved {out_path}")


def plot_similarity_distribution(rows: list[dict], out_path: Path) -> None:
    thresholds = sorted(
        {float(r["threshold"]) for r in rows if r.get("threshold")}
    )

    fig, ax = plt.subplots(figsize=(6, 4.5), facecolor=SURFACE)
    ax.set_facecolor(SURFACE)

    rng = np.random.default_rng(0)
    any_points = False
    for i, condition in enumerate(CONDITIONS):
        values = [
            float(r["similarity"])
            for r in rows
            if r["condition"] == condition and r.get("similarity")
        ]
        if not values:
            continue
        any_points = True
        jitter = rng.uniform(-0.12, 0.12, size=len(values))
        ax.scatter(
            np.full(len(values), i) + jitter,
            values,
            color=CONDITION_COLOR[condition],
            edgecolors="white",
            linewidths=0.5,
            s=45,
            zorder=3,
            label=condition.capitalize(),
        )

    if not any_points:
        print(f"⚠️  No similarity values to plot — skipping {out_path.name}")
        plt.close(fig)
        return

    for value in thresholds:
        ax.axhline(value, color=STATUS_COLOR["critical"], linestyle="--", linewidth=1.2, zorder=1)
        ax.text(
            len(CONDITIONS) - 0.52,
            value,
            f" Threshold ({value:.2f})",
            color=STATUS_COLOR["critical"],
            va="center",
            fontsize=9,
            zorder=4,
            bbox=dict(facecolor=SURFACE, edgecolor="none", pad=1.5),
        )

    ax.set_xticks(range(len(CONDITIONS)))
    ax.set_xticklabels([c.capitalize() for c in CONDITIONS])
    ax.set_ylabel("similarity (cosine)")
    ax.set_title("Skor kemiripan wajah (similarity) per kondisi")
    ax.grid(axis="y", color=GRIDLINE, linewidth=0.8, zorder=0)
    ax.set_xlim(-0.6, len(CONDITIONS) + 0.4)
    _style_axes(ax)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"✅ Saved {out_path}")


def plot_accuracy_summary(rows: list[dict], out_path: Path) -> None:
    present = [c for c in CONDITIONS if any(r["condition"] == c for r in rows)]
    if not present:
        print(f"⚠️  No rows to summarize — skipping {out_path.name}")
        return

    fig, ax = plt.subplots(figsize=(5.5, 4), facecolor=SURFACE)
    ax.set_facecolor(SURFACE)

    for i, condition in enumerate(present):
        condition_rows = [r for r in rows if r["condition"] == condition]
        if condition in EXPECTED_VERIFIED:
            n_hit = sum(
                1
                for r in condition_rows
                if (r["status"] == "VERIFIED") == EXPECTED_VERIFIED[condition]
            )
            label = f"{n_hit / len(condition_rows):.0%}"
            hatch = None
        else:
            n_hit = sum(1 for r in condition_rows if r["status"] == "VERIFIED")
            label = f"{n_hit / len(condition_rows):.0%} verified*"
            hatch = "//"

        bar = ax.bar(
            i,
            100 * n_hit / len(condition_rows),
            color=CONDITION_COLOR[condition],
            width=0.55,
            hatch=hatch,
            edgecolor=SURFACE,
        )
        ax.text(
            bar[0].get_x() + bar[0].get_width() / 2,
            bar[0].get_height() + 2,
            label,
            ha="center",
            color=INK_PRIMARY,
            fontsize=10,
        )

    ax.set_xticks(range(len(present)))
    ax.set_xticklabels([c.capitalize() for c in present])
    ax.set_ylabel("%")
    ax.set_ylim(0, 110)
    ax.set_title("Akurasi per kondisi\n(*spoof: ungraded, tidak ada liveness check di jalur ini)")
    ax.grid(axis="y", color=GRIDLINE, linewidth=0.8, zorder=0)
    _style_axes(ax)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"✅ Saved {out_path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Plot condition x status charts from face_verification_test_log.csv"
    )
    parser.add_argument(
        "--log_file", default=str(Path(TEST_FILE_DIR) / "face_verification_test_log.csv")
    )
    parser.add_argument(
        "--output_dir", default=str(Path(TEST_FILE_DIR) / "test_results_plots")
    )
    args = parser.parse_args()

    rows = _load_rows(Path(args.log_file))
    if not rows:
        raise SystemExit("Log file is empty — run test_face_conditions.py first.")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    plot_confusion_matrix(rows, output_dir / "confusion_matrix.png")
    plot_similarity_distribution(rows, output_dir / "similarity_distribution.png")
    plot_accuracy_summary(rows, output_dir / "accuracy_summary.png")

    print(f"\nTotal {len(rows)} baris diproses dari {args.log_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
