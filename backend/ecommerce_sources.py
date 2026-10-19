"""Registry of dummy e-commerce sources the shopping agent searches/transacts on.

Single source of truth shared by agent/adapters (search/cart/checkout) and
voiceverification/server.py (account linking) — both run with backend/ as
their sys.path root (see their uvicorn/CLI invocation in backend/README.md),
so both import this the same way: `from ecommerce_sources import ...`.

To wire in a new dummy e-commerce source: add one entry here. Nothing else
needs its base_url hardcoded.
"""

ECOMMERCE_SOURCES = {
    "oren": {
        "label": "Toko Oren",
        "base_url": "https://dummy-ecommerce-tau.vercel.app",
    },
    "hijau": {
        "label": "Toko Hijau",
        "base_url": "https://ecommerce-hijau.vercel.app",
    },
}

DEFAULT_SOURCE = "oren"
