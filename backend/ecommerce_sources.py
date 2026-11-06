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
        # Each store's own e-wallet is branded (and validated server-side)
        # under its own name — Toko Oren is "ShopKu", so its wallet is
        # ShopKuPay. Sending the wrong name doesn't error, it just silently
        # leaves the order "pending" instead of instantly "paid" (confirmed
        # against the real API), so this must match exactly.
        "wallet_name": "ShopKuPay",
        # Order-DETAIL page path segment, e.g. {base_url}/{this}/{order_id}.
        # Confirmed against the real site: Oren's is plural "orders" (the
        # list page at {base_url}/orders is plural on both stores either
        # way — only the per-order detail page differs).
        "order_detail_path": "order",
        # Payment methods this store's checkout API actually accepts
        # (source: DummyEcommerce/components/order/PaymentMethodPicker.tsx).
        # Oren and Hijau's lists are DIFFERENT — not just "same set with
        # one wallet renamed". Sending a method from the wrong store's
        # list doesn't error, it silently leaves the order pending (see
        # the DummyEcommerce/app/api/orders/route.ts normalizer that
        # upper-cases + strips spaces but does no whitelist check), which
        # is exactly how "Happy offered ShopeePay to Hijau and Hijau
        # accepted the order but it never got paid" happens. Keep this
        # list in sync with the picker UI.
        "accepted_payment_methods": [
            "ShopKuPay",
            "GoPay",
            "OVO",
            "DANA",
            "VA_BCA",
            "VA_BRI",
            "VA_Mandiri",
            "ShopeePay",
        ],
    },
    "hijau": {
        "label": "Toko Hijau",
        "base_url": "https://ecommerce-hijau.vercel.app",
        # Toko Hijau is branded "TokoKu", so its wallet is TokoKuPay — NOT
        # ShopKuPay.
        "wallet_name": "TokoKuPay",
        # Toko Hijau's order-detail page is singular "order/{id}", unlike
        # Oren's "orders/{id}" — confirmed live: {base_url}/orders/{id} is a
        # genuine 404 there, {base_url}/order/{id} is the real route
        # (redirects to login with the right callbackUrl). Sending the
        # plural link made every "lihat pesanan" link to Hijau a dead link.
        "order_detail_path": "order",
        # Source of truth: DummyEcommerceHijau/lib/constants.ts
        # PAYMENT_METHODS. Hijau's set is both SMALLER than Oren's AND uses
        # a different naming convention for VAs (BCA_VA, MANDIRI_VA — not
        # VA_BCA, VA_Mandiri). It has NO GoPay/OVO/DANA/ShopeePay/BRI, and
        # it DOES have COD. The Hijau API normalizes to UPPER + replaces
        # spaces with _ (so "TokoKuPay" and "TOKOKUPAY" both work).
        "accepted_payment_methods": [
            "TokoKuPay",
            "BCA_VA",
            "MANDIRI_VA",
            "COD",
        ],
    },
}

DEFAULT_SOURCE = "oren"
