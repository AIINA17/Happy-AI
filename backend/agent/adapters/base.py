import asyncio
import logging

import requests


def _num(value, default=0):
    """Safely coerce API values (price, rating, balance, total, ...) to a number.

    Supabase/Postgres numeric columns often come back as strings over the
    REST API (e.g. "price": "13999000"), which breaks both arithmetic and
    the ',' thousands-separator format spec if used directly.
    """
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class EcommerceAdapter:
    """Adapts one dummy e-commerce deployment's REST API to the shape the
    shopping agent's tools need, so tools.py can call the same methods
    regardless of which store it's talking to.

    Every registered source so far shares the exact same API contract
    (same /api/products, /api/auth/*, /api/cart, /api/orders routes and
    response envelope) — only base_url and whether image_url is absolute
    differ, so one parametrized class covers all of them. A source with a
    genuinely different API shape can subclass this and override just the
    methods that differ.
    """

    def __init__(
        self,
        source: str,
        label: str,
        base_url: str,
        wallet_name: str,
        order_detail_path: str,
        accepted_payment_methods: list[str] | None = None,
    ):
        self.source = source
        self.label = label
        self.base_url = base_url.rstrip("/")
        # This store's own branded e-wallet payment method name (e.g.
        # "ShopKuPay" vs "TokoKuPay") — passed as `payment_method` to
        # checkout() verbatim, so it must match what this store's API
        # actually registers as its wallet.
        self.wallet_name = wallet_name
        # Order-DETAIL page path segment — differs per store's own frontend
        # routing (confirmed live: Oren is plural "orders/{id}", Hijau is
        # singular "order/{id}"; the other one 404s). The order-LIST page
        # (orders_link, no id) is plural "orders" on both, so that one
        # method stays hardcoded.
        self.order_detail_path = order_detail_path
        # Whitelist of payment-method strings this store's checkout API
        # actually accepts (see ecommerce_sources.py). Both stores' APIs
        # silently accept-but-never-pay if we send a method not in their
        # own set — e.g. ShopeePay to Hijau, or BCA_VA (Hijau's format) to
        # Oren (Oren wants VA_BCA). The checkout tool validates against
        # this list before sending. Default empty = allow anything (for
        # backward-compat if a newer source doesn't declare a list yet).
        self.accepted_payment_methods = list(accepted_payment_methods or [])

    def is_payment_method_accepted(self, method: str) -> bool:
        """Case-insensitive whitelist check. Returns True if the list is
        empty (unconstrained adapter). Normalization matches both stores'
        server-side normalizers: upper-case + spaces-to-underscores."""
        if not self.accepted_payment_methods:
            return True
        norm = method.upper().replace(" ", "_")
        return any(
            m.upper().replace(" ", "_") == norm
            for m in self.accepted_payment_methods
        )

    # ---------------------------------------------------------------- utils

    def _headers(self, token: str | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def _resolve_image_url(self, image_url: str | None, product_id) -> str:
        if not image_url:
            return f"https://picsum.photos/seed/{self.source}-{product_id}/300/300"
        if image_url.startswith("http://") or image_url.startswith("https://"):
            return image_url
        return f"{self.base_url}{image_url}"

    def _normalize_product(self, p: dict) -> dict:
        p = dict(p)
        p["price"] = _num(p.get("price"))
        p["rating"] = _num(p.get("rating"))
        p["image_url"] = self._resolve_image_url(p.get("image_url"), p.get("id"))
        p["source"] = self.source
        p["source_label"] = self.label
        p["link"] = self.product_link(p.get("id"))

        # Some sources (e.g. Toko Hijau) don't nest store info under a
        # "store" object like Toko Oren does — they return flat
        # shop_name/shop_city fields instead. Normalize both shapes to the
        # same "store" dict so downstream code (search_product filtering,
        # product cards, ...) doesn't need to know which source it's from.
        if not p.get("store") and (p.get("shop_name") or p.get("shop_city")):
            p["store"] = {
                "name": p.get("shop_name"),
                "city": p.get("shop_city"),
                "address": None,
            }

        return p

    def product_link(self, product_id) -> str:
        return f"{self.base_url}/product/{product_id}"

    def cart_link(self) -> str:
        return f"{self.base_url}/cart"

    def order_link(self, order_id) -> str:
        return f"{self.base_url}/{self.order_detail_path}/{order_id}"

    def orders_link(self) -> str:
        return f"{self.base_url}/orders"

    # ------------------------------------------------------------- products

    async def search_products(self) -> list[dict]:
        """Fetch and normalize all products. Raises on HTTP/network failure
        so callers can tell a reachable-but-empty store apart from a down one."""
        response = await asyncio.to_thread(
            requests.get, f"{self.base_url}/api/products", timeout=10
        )
        response.raise_for_status()
        data = response.json().get("data", [])
        return [self._normalize_product(p) for p in data]

    async def get_product(self, product_id: int) -> dict | None:
        response = await asyncio.to_thread(
            requests.get, f"{self.base_url}/api/products/{product_id}", timeout=10
        )
        if response.status_code != 200:
            return None
        p = response.json().get("data")
        return self._normalize_product(p) if p else None

    # ----------------------------------------------------------------- auth

    async def register(self, username: str, password: str) -> requests.Response:
        return await asyncio.to_thread(
            requests.post,
            f"{self.base_url}/api/auth/register",
            json={"username": username, "password": password},
            timeout=10,
        )

    async def login(self, username: str, password: str) -> dict:
        """Returns {"success": True, "token", "user_id", "username"} or
        {"success": False, "error": str}."""
        try:
            response = await asyncio.to_thread(
                requests.post,
                f"{self.base_url}/api/auth/token",
                json={"username": username, "password": password},
                headers=self._headers(),
                timeout=10,
            )
        except Exception as e:
            return {"success": False, "error": str(e)}

        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                user = data.get("user", {})
                return {
                    "success": True,
                    "token": data.get("token"),
                    "user_id": user.get("id"),
                    "username": user.get("username"),
                }

        return {"success": False, "error": "invalid_credentials"}

    async def get_user(self, token: str) -> dict | None:
        response = await asyncio.to_thread(
            requests.get,
            f"{self.base_url}/api/user",
            headers=self._headers(token),
            timeout=10,
        )
        if response.status_code != 200:
            return None
        user = response.json().get("data", {})
        user["balance"] = _num(user.get("balance"))
        return user

    # ----------------------------------------------------------------- cart

    async def add_to_cart(self, token: str, product_id: int, quantity: int) -> dict:
        response = await asyncio.to_thread(
            requests.post,
            f"{self.base_url}/api/cart",
            json={"product_id": product_id, "quantity": quantity},
            headers=self._headers(token),
            timeout=10,
        )
        if response.status_code == 200:
            data = response.json()
            return {"success": bool(data.get("success")), "message": data.get("message", "")}
        return {"success": False, "message": ""}

    async def get_cart(self, token: str) -> list[dict]:
        response = await asyncio.to_thread(
            requests.get,
            f"{self.base_url}/api/cart",
            headers=self._headers(token),
            timeout=10,
        )
        if response.status_code != 200:
            raise RuntimeError(f"get_cart failed: {response.status_code}")

        items = response.json().get("data", [])
        for item in items:
            # Some sources (e.g. Toko Hijau) nest the product under a
            # singular "product" key instead of "products" like Toko Oren.
            # Normalize to "products" (and write it back onto the item) so
            # callers — get_cart/checkout in tools.py — don't need to know
            # which source they're talking to. Without this, Hijau cart
            # items silently got product_id=None/price=0, which checkout
            # then sent to /api/orders, where it's rejected outright.
            product = item.get("products") or item.get("product") or {}
            product["price"] = _num(product.get("price"))
            item["products"] = product
        return items

    async def remove_from_cart(self, token: str, cart_id: int) -> bool:
        response = await asyncio.to_thread(
            requests.delete,
            f"{self.base_url}/api/cart?cart_id={cart_id}",
            headers=self._headers(token),
            timeout=10,
        )
        return response.status_code == 200

    # ------------------------------------------------------------- checkout

    async def checkout(self, token: str, payment_method: str, items: list[dict]) -> dict:
        response = await asyncio.to_thread(
            requests.post,
            f"{self.base_url}/api/orders",
            json={"payment_method": payment_method, "items": items},
            headers=self._headers(token),
            timeout=10,
        )
        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                return {"success": True, "order": data.get("data", {})}
            return {"success": False, "message": data.get("message", "Unknown error")}
        return {"success": False, "message": f"status {response.status_code}"}

    # --------------------------------------------------------------- orders

    async def get_order_history(self, token: str) -> list[dict]:
        response = await asyncio.to_thread(
            requests.get,
            f"{self.base_url}/api/orders",
            headers=self._headers(token),
            timeout=10,
        )
        if response.status_code != 200:
            raise RuntimeError(f"get_order_history failed: {response.status_code}")
        return response.json().get("data", [])

    async def get_order_detail(self, token: str, order_id: int) -> dict | None:
        response = await asyncio.to_thread(
            requests.get,
            f"{self.base_url}/api/orders/{order_id}",
            headers=self._headers(token),
            timeout=10,
        )
        if response.status_code != 200:
            return None
        return response.json().get("data")

    async def pay_order(self, token: str, order_id: int) -> dict:
        response = await asyncio.to_thread(
            requests.post,
            f"{self.base_url}/api/orders/{order_id}/pay",
            headers=self._headers(token),
            timeout=10,
        )
        if response.status_code == 200:
            data = response.json()
            return {"success": bool(data.get("success"))}
        return {"success": False}
