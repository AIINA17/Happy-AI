#!/usr/bin/env python3
"""Pasang pencatat durasi pada 20 function tool di agent/tools.py (untuk pengujian Bab 5).

Pemakaian (dari folder backend/):
    python apply_timing_patch.py agent/tools.py          # memasang patch
    python apply_timing_patch.py agent/tools.py --undo   # mengembalikan dari cadangan

Yang dilakukan: menambahkan dekorator `timed_tool` dan memasangnya tepat di bawah
setiap `@function_tool`. Dekorator hanya mencetak satu baris ke stdout per
pemanggilan tool dan tidak mengubah perilaku, argumen, atau skema tool:

    ⏱ TOOL <nama> dur=<detik>s status=<ok|ERR:Tipe> | <awal hasil, maks 80 karakter>

Skrip aman dijalankan ulang (idempoten) dan membuat cadangan tools.py.bak.
"""
import pathlib
import re
import shutil
import sys

HELPER = '''
# --- Pencatat durasi tool (pengujian Bab 5); lihat apply_timing_patch.py ---
import functools as _functools


def timed_tool(fn):
    """Catat durasi tiap function tool ke stdout. Tidak mengubah perilaku tool."""
    name = fn.__name__

    @_functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        t0 = time.perf_counter()
        status = "ok"
        result = None
        try:
            result = await fn(*args, **kwargs)
            return result
        except Exception as e:  # dicatat lalu dilempar ulang apa adanya
            status = f"ERR:{type(e).__name__}"
            raise
        finally:
            dur = time.perf_counter() - t0
            head = " ".join(str(result).split())[:80] if result is not None else ""
            print(f"⏱ TOOL {name} dur={dur:.2f}s status={status} | {head}", flush=True)

    return wrapper
# --- akhir pencatat durasi ---
'''

ANCHOR = "from agent.adapters.base import _num\n"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = pathlib.Path(args[0] if args else "agent/tools.py")
    bak = path.with_suffix(path.suffix + ".bak")
    if "--undo" in sys.argv:
        if not bak.exists():
            sys.exit(f"Cadangan {bak} tidak ditemukan.")
        shutil.copyfile(bak, path)
        print(f"Dikembalikan dari {bak}")
        return

    src = path.read_text(encoding="utf-8")
    if "def timed_tool(" in src:
        print("Sudah dipasang; tidak ada perubahan.")
        return
    if ANCHOR not in src:
        sys.exit("Baris jangkar import tidak ditemukan; patch dibatalkan.")

    # pastikan semua tool adalah async def sebelum menyentuh apa pun
    decs = [m.start() for m in re.finditer(r"^@function_tool[ \t]*$", src, flags=re.M)]
    for d in decs:
        nxt = src[d:].split("\n")[1]
        if not nxt.startswith("async def"):
            sys.exit(f"Tool bukan async def ({nxt[:60]!r}); patch dibatalkan.")
    if len(decs) != 20:
        print(f"Peringatan: ditemukan {len(decs)} tool (diharapkan 20).")

    shutil.copyfile(path, bak)
    out = src.replace(ANCHOR, ANCHOR + HELPER, 1)
    out, n = re.subn(r"^@function_tool[ \t]*$", "@function_tool\n@timed_tool", out, flags=re.M)
    path.write_text(out, encoding="utf-8")
    print(f"Selesai: {n} tool dibungkus. Cadangan: {bak}")


if __name__ == "__main__":
    main()
