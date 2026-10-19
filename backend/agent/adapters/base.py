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

    def __init__(self, source: str, label: str, base_url: str):
        self.source = source
        self.label = label
        self.base_url = base_url.rstrip("/")

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
        return f"{self.base_url}/orders/{order_id}"

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
            product = item.get("products") or {}
            product["price"] = _num(product.get("price"))
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
