import asyncio
import json
import logging
import time

import requests
from langchain_community.tools import DuckDuckGoSearchRun
from livekit.agents.llm import function_tool


# Base URL untuk e-commerce website
BASE_URL = "https://dummy-ecommerce-tau.vercel.app"

# Interval untuk re-verifikasi (10 menit)
REVERIFY_INTERVAL = 600

# ==================== GLOBAL AUTH STATE ====================
auth_state = {
    # Login state
    "token": None,
    "user_id": None,
    "username": None,
    "is_logged_in": False,

    # Voice verification state
    "voice_score": 0.0,
    "voice_status_detail": "INIT",
    "verify_attempts": 0,
    "voice_feedback_sent": False,
    "force_verify": False,
    "_force_started": False,
    "pending_action": None,
    "pending_params": None,

    # Product cards state
    "last_search_products": [],
    "room_ref": None,

    "agent_state": None,
}


def get_headers():
    """Get headers with auth token if logged in"""
    headers = {"Content-Type": "application/json"}
    if auth_state["token"]:
        headers["Authorization"] = f"Bearer {auth_state['token']}"
    return headers


def require_voice_verification(action_name: str, params=None) -> str | None:
    """Soft gate for sensitive actions. Returns error string or None if OK."""
    state = auth_state.get("agent_state", {})

    # Cek expiry dulu
    if state.get("is_voice_verified"):
        now = time.time()
        last_verified = state.get("last_verified_at")
        if last_verified and (now - last_verified) > REVERIFY_INTERVAL:
            state["is_voice_verified"] = False
            state["voice_status"] = "EXPIRED"

    status = state.get("voice_status", "UNKNOWN")

    if status == "VERIFIED":
        return None

    if status == "EXPIRED":
        return (
            f"Sesi verifikasi suara kamu sudah habis. "
            f"Coba ngobrol sebentar ya biar gue bisa verifikasi ulang sebelum {action_name}."
        )

    if status == "REPEAT":
        return (
            f"Sebentar ya, suara kamu belum cukup jelas. "
            f"Kita lanjut ngobrol dulu bentar sebelum gue {action_name}."
        )

    if status == "DENIED":
        return (
            f"Maaf, suara kamu belum bisa dikenali. "
            f"Kamu tetap bisa browsing dan ngobrol, "
            f"tapi untuk {action_name} fitur ini dibatasi."
        )

    return (
        f"Sebelum gue {action_name}, gue perlu memastikan suara kamu dulu. "
        f"Coba ngobrol sebentar ya."
    )


# ==================== INTERNAL HELPER ====================

async def _send_product_cards_internal(products: list):
    """
    Internal function untuk kirim product cards ke frontend dan DB.
    BUKAN @function_tool — tidak dipanggil langsung oleh LLM.
    """
    from voiceverification.db.connection import get_supabase

    state = auth_state.get("agent_state", {})
    session_id = state.get("conversation_session_id")

    # Save to DB
    if session_id:
        try:
            sb = get_supabase()
            sb.table("product_cards").insert({
                "session_id": str(session_id),
                "products": products,
            }).execute()
            logging.info(f"✅ PRODUCT_CARDS SAVED (session={session_id}, count={len(products)})")
        except Exception as e:
            logging.error(f"❌ Failed to save product cards: {e}")
    else:
        logging.error("❌ PRODUCT_CARDS NOT SAVED: conversation_session_id is None")

    # Send to frontend
    room = auth_state.get("room_ref")
    if room:
        try:
            await asyncio.sleep(2)
            payload = json.dumps({
                "type": "PRODUCT_CARDS",
                "products": products
            }).encode("utf-8")
            await room.local_participant.publish_data(
                payload,
                reliable=True,
                topic="PRODUCT_DATA"
            )
            logging.info("📤 PRODUCT_CARDS SENT REALTIME")
        except Exception as e:
            logging.error(f"❌ Failed realtime PRODUCT_CARDS: {e}")


# ==================== PRODUCT TOOLS ====================

@function_tool
async def send_product_cards(products: list) -> str:
    """
    Explicitly send product cards to the frontend display.
    Use this when you want to (re)send specific products to the user's screen.
    """
    await _send_product_cards_internal(products[:8])

    sent = products[:8]
    summary = f"✅ {len(sent)} produk berhasil dikirim ke tampilan user:\n\n"
    for i, p in enumerate(sent, 1):
        summary += (
            f"{i}. {p.get('name', 'Unknown')}\n"
            f"   ID: {p.get('id', '-')} | "
            f"Harga: Rp {p.get('price', 0):,} | "
            f"Stok: {p.get('stock', '-')} | "
            f"Kategori: {p.get('category', '-')}\n"
        )
    return summary


@function_tool
async def search_product(
    query: str = "",
    category: str = "",
    min_price: int = 0,
    max_price: int = 0,
    min_rating: float = 0.0,
    sort_by: str = ""
) -> str:
    """
    Search for products in the e-commerce website.
    Fetches all products then filters locally by the given criteria.

    Args:
        query: Search keyword for product name (optional, matches partial name)
        category: Filter by category — one of: "Gadget & Tech", "Lifestyle", "Home & Living", "Lain-lain"
        min_price: Minimum price filter
        max_price: Maximum price filter
        min_rating: Minimum rating filter (0.0-5.0)
        sort_by: Sort results (price_asc, price_desc, rating_desc, newest)
    """
    try:
        # Fetch ALL products (API does not support server-side filtering)
        response = requests.get(
            f"{BASE_URL}/api/products",
            timeout=10
        )

        if response.status_code != 200:
            return "Gagal mencari produk."

        data = response.json()
        products = data.get("data", [])

        if not products:
            return "Tidak ada produk di toko saat ini."

        # ── Client-side filtering ──
        if query:
            q_lower = query.lower()
            products = [
                p for p in products
                if q_lower in (p.get("name") or "").lower()
                or q_lower in (p.get("description") or "").lower()
            ]

        if category:
            cat_lower = category.lower()
            products = [
                p for p in products
                if (p.get("category") or "").lower() == cat_lower
            ]

        if min_price > 0:
            products = [p for p in products if (p.get("price") or 0) >= min_price]

        if max_price > 0:
            products = [p for p in products if (p.get("price") or 0) <= max_price]

        if min_rating > 0:
            products = [p for p in products if (p.get("rating") or 0) >= min_rating]

        # ── Sorting ──
        if sort_by == "price_asc":
            products.sort(key=lambda p: p.get("price") or 0)
        elif sort_by == "price_desc":
            products.sort(key=lambda p: p.get("price") or 0, reverse=True)
        elif sort_by == "rating_desc":
            products.sort(key=lambda p: p.get("rating") or 0, reverse=True)
        elif sort_by == "newest":
            products.sort(key=lambda p: p.get("created_at") or "", reverse=True)

        if not products:
            search_term = query if query else "filter yang diberikan"
            return f"Gak nemu produk untuk '{search_term}'."

        # ✅ Simpan ke memory agar bisa diakses tools lain
        auth_state["last_search_products"] = products[:10]

        # ✅ Kirim ke frontend via internal function (bukan @function_tool)
        await _send_product_cards_internal(products[:8])

        # ✅ Return daftar lengkap ke LLM agar agent tahu semua produk
        search_term = query if query else "semua produk"
        result = f"Ketemu {len(products)} produk untuk '{search_term}'. Gue tampilin {min(len(products), 8)} di layar.\n\n"
        result += "Daftar produk yang ditampilkan:\n"
        for i, p in enumerate(products[:8], 1):
            result += (
                f"{i}. {p.get('name', 'Unknown')}\n"
                f"   ID: {p.get('id', '-')} | "
                f"Harga: Rp {p.get('price', 0):,} | "
                f"Stok: {p.get('stock', 0)} | "
                f"Kategori: {p.get('category', '-')}\n"
            )

        if len(products) > 8:
            result += f"\n(Ada {len(products) - 8} produk lagi yang gak ditampilin.)\n"

        result += "\nUser bisa minta detail atau tambahin ke keranjang dengan sebut nama/nomor produk."
        return result

    except Exception as e:
        logging.error(f"Search product error: {e}")
        return f"Search error: {str(e)}"


@function_tool
async def get_product_detail(product_id: int) -> str:
    """
    Get detailed information about a specific product.
    Returns: name, price, category, rating, stock, description, image URL, and product link.
    """
    try:
        response = requests.get(f"{BASE_URL}/api/products/{product_id}", timeout=10)

        if response.status_code == 200:
            data = response.json()
            p = data.get("data", {})

            if not p:
                return f"Produk ID {product_id} gak ditemukan."

            name = p.get('name', 'Unknown')
            price = p.get('price', 0)
            category = p.get('category', '-')
            rating = p.get('rating', 0)
            stock = p.get('stock', 0)
            description = p.get('description', 'Tidak ada deskripsi')
            image_url = p.get('image_url', f"https://picsum.photos/seed/{product_id}/300/300")
            product_link = f"{BASE_URL}/product/{product_id}"

            if stock > 10:
                stock_status = f"✅ Tersedia ({stock} unit)"
            elif stock > 0:
                stock_status = f"⚠️ Stok terbatas ({stock} unit)"
            else:
                stock_status = "❌ Habis"

            return (
                f"📦 Detail Produk:\n"
                f"• Nama: {name}\n"
                f"• Harga: Rp {price:,}\n"
                f"• Kategori: {category}\n"
                f"• Rating: {rating}⭐\n"
                f"• Stok: {stock_status}\n\n"
                f"📝 Deskripsi:\n{description}\n\n"
                f"🖼️ Foto Produk: {image_url}\n"
                f"🔗 Link Produk: {product_link}"
            )

        return "Produk tidak ditemukan."

    except Exception as e:
        logging.error(f"Get product error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def get_product_from_search_index(index: int) -> str:
    """
    Get product ID from the last search results by index (1-based).
    Example: User says 'add product number 2 to cart', use this to get product ID.
    """
    if not auth_state["last_search_products"]:
        return "Gak ada hasil pencarian sebelumnya. Coba cari produk dulu."

    if index < 1 or index > len(auth_state["last_search_products"]):
        return f"Index {index} gak valid. Hasil pencarian cuma ada {len(auth_state['last_search_products'])} produk."

    product = auth_state["last_search_products"][index - 1]
    product_id = product.get("id")
    product_name = product.get("name")
    product_price = product.get("price", 0)

    return f"Produk nomor {index}: {product_name} (ID: {product_id}, Harga: Rp {product_price:,})"


# ==================== GENERAL TOOLS ====================

@function_tool
async def get_weather(city: str) -> str:
    """Get current weather for a given city."""
    try:
        response = requests.get(f"https://wttr.in/{city}?format=3", timeout=10)
        if response.status_code == 200:
            logging.info(f"Weather for {city}: {response.text.strip()}")
            return response.text.strip()
        else:
            return f"Could not retrieve weather for {city}."
    except Exception as e:
        logging.error(f"Error retrieving weather for {city}: {e}")
        return f"Weather service error for {city}."


@function_tool
async def web_search(query: str) -> str:
    """Search the internet for information."""
    try:
        return DuckDuckGoSearchRun().run(query)
    except Exception as e:
        logging.error(e)
        return "Search error."


# ==================== AUTH TOOLS ====================

@function_tool
async def login(username: str, password: str) -> str:
    """Login to the e-commerce website."""
    global auth_state
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/token",
            json={"username": username, "password": password},
            headers={"Content-Type": "application/json"},
            timeout=10
        )

        logging.info(f"Login response: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                auth_state["token"] = data.get("token")
                auth_state["user_id"] = data.get("user", {}).get("id")
                auth_state["username"] = data.get("user", {}).get("username")
                auth_state["is_logged_in"] = True
                return f"Login berhasil! Selamat datang {auth_state['username']}."

        return "Login gagal. Username atau password salah."

    except Exception as e:
        logging.error(f"Login error: {e}")
        return f"Login error: {str(e)}"


@function_tool
async def register(username: str, password: str) -> str:
    """Register a new account on the e-commerce website."""
    try:
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={"username": username, "password": password},
            headers={"Content-Type": "application/json"},
            timeout=10
        )

        if response.status_code in [200, 201]:
            return f"Registrasi berhasil! Silakan login dengan username: {username}"
        else:
            return "Registrasi gagal. Username mungkin sudah dipakai."

    except Exception as e:
        logging.error(f"Register error: {e}")
        return f"Registration error: {str(e)}"


@function_tool
async def logout() -> str:
    """Logout from the e-commerce website."""
    global auth_state
    auth_state["token"] = None
    auth_state["user_id"] = None
    auth_state["username"] = None
    auth_state["is_logged_in"] = False
    return "Berhasil logout."


@function_tool
async def check_login_status() -> str:
    """Check if user is currently logged in."""
    if auth_state["is_logged_in"]:
        return f"Lo udah login sebagai {auth_state['username']}."
    return "Lo belum login. Login dulu ya buat belanja."


@function_tool
async def check_voice_status() -> str:
    """Check current voice verification status."""
    state = auth_state.get("agent_state", {})

    # Cek expiry
    if state.get("is_voice_verified"):
        now = time.time()
        last_verified = state.get("last_verified_at")
        if last_verified and (now - last_verified) > REVERIFY_INTERVAL:
            state["is_voice_verified"] = False
            state["voice_status"] = "EXPIRED"

    status = state.get("voice_status", "UNKNOWN")

    if status == "VERIFIED":
        elapsed = int(time.time() - (state.get("last_verified_at") or 0))
        remaining = REVERIFY_INTERVAL - elapsed
        return f"✅ Suara lo udah terverifikasi. Verifikasi aktif {remaining} detik lagi."
    elif status == "EXPIRED":
        return "⚠️ Verifikasi suara lo udah expired. Coba ngomong lagi buat verifikasi ulang."
    elif status == "DENIED":
        return "❌ Verifikasi suara gagal. Coba ngomong lagi dengan jelas."
    elif status == "REPEAT":
        return "⚠️ Suara lo kurang jelas. Coba ngomong lagi dengan lebih jelas."
    else:
        return "⚠️ Suara lo belum diverifikasi. Gue perlu dengar suara lo dulu."


# ==================== USER TOOLS ====================

@function_tool
async def get_shopkupay_balance() -> str:
    """Get user's ShopKuPay balance/saldo."""
    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu buat cek saldo ShopKuPay."

    try:
        response = requests.get(
            f"{BASE_URL}/api/user",
            headers=get_headers(),
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            user = data.get("data", {})
            balance = user.get("balance", 0)
            return f"Saldo ShopKuPay lo: Rp {balance:,}"

        return "Gagal mengambil data saldo."

    except Exception as e:
        logging.error(f"Get balance error: {e}")
        return f"Error: {str(e)}"


# ==================== CART TOOLS ====================

@function_tool
async def add_to_cart(product_id: int, quantity: int = 1) -> str:
    """Add a product to the shopping cart. Requires login first."""
    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu sebelum bisa nambahin ke keranjang."

    try:
        response = requests.post(
            f"{BASE_URL}/api/cart",
            json={"product_id": product_id, "quantity": quantity},
            headers=get_headers(),
            timeout=10
        )

        logging.info(f"Add to cart response: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                return f"Berhasil ditambahin ke keranjang! {data.get('message', '')}"

        return "Gagal nambahin ke keranjang."

    except Exception as e:
        logging.error(f"Add to cart error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def get_cart() -> str:
    """Get current items in the shopping cart with cart link."""
    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu buat liat keranjang."

    try:
        response = requests.get(
            f"{BASE_URL}/api/cart",
            headers=get_headers(),
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            items = data.get("data", [])

            if not items:
                return "Keranjang lo kosong."

            result = f"🛒 Keranjang lo ({len(items)} item):\n\n"
            total = 0

            for item in items:
                product = item.get("products", {})
                subtotal = product.get("price", 0) * item.get("quantity", 1)
                total += subtotal

                result += f"• {product.get('name', 'Unknown')}\n"
                result += f"  {item.get('quantity')}x Rp {product.get('price', 0):,} = Rp {subtotal:,}\n"
                result += f"  (Cart ID: {item.get('id')})\n\n"

            result += f"💰 Total: Rp {total:,}\n\n"
            result += f"🔗 Link Keranjang: {BASE_URL}/cart"
            return result

        return "Gagal mengambil data keranjang."

    except Exception as e:
        logging.error(f"Get cart error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def remove_from_cart(cart_id: int) -> str:
    """Remove an item from the cart using cart_id."""
    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu."

    try:
        response = requests.delete(
            f"{BASE_URL}/api/cart?cart_id={cart_id}",
            headers=get_headers(),
            timeout=10
        )

        if response.status_code == 200:
            return "Item berhasil dihapus dari keranjang!"
        return "Gagal menghapus item."

    except Exception as e:
        logging.error(f"Remove from cart error: {e}")
        return f"Error: {str(e)}"


# ==================== CHECKOUT TOOLS (PROTECTED) ====================

@function_tool
async def checkout(payment_method: str = "GoPay") -> str:
    """
    Complete the purchase and create an order from cart items.
    Payment methods: VA_BCA, VA_BRI, VA_Mandiri, GoPay, OVO, ShopeePay, DANA, ShopKuPay

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("checkout", {"payment_method": payment_method})
    if voice_error:
        return voice_error

    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu sebelum checkout."

    try:
        cart_response = requests.get(
            f"{BASE_URL}/api/cart",
            headers=get_headers(),
            timeout=10
        )

        if cart_response.status_code != 200:
            return "Gagal mengambil data keranjang."

        cart_data = cart_response.json()
        cart_items = cart_data.get("data", [])

        if not cart_items:
            return "Keranjang kosong. Gak ada yang bisa di-checkout."

        total = sum(
            item.get("products", {}).get("price", 0) * item.get("quantity", 1)
            for item in cart_items
        )

        if payment_method == "ShopKuPay":
            user_response = requests.get(
                f"{BASE_URL}/api/user",
                headers=get_headers(),
                timeout=10
            )
            if user_response.status_code == 200:
                user_data = user_response.json()
                balance = user_data.get("data", {}).get("balance", 0)
                if balance < total:
                    return f"Saldo ShopKuPay tidak cukup. Saldo: Rp {balance:,}, Total: Rp {total:,}"

        items = []
        for item in cart_items:
            product = item.get("products", {})
            items.append({
                "product_id": product.get("id"),
                "quantity": item.get("quantity"),
                "price": product.get("price"),
                "name": product.get("name"),
            })

        response = requests.post(
            f"{BASE_URL}/api/orders",
            json={"payment_method": payment_method, "items": items},
            headers=get_headers(),
            timeout=10
        )

        logging.info(f"Checkout response: {response.status_code} - {response.text}")

        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                order = data.get("data", {})

                for item in cart_items:
                    requests.delete(
                        f"{BASE_URL}/api/cart?cart_id={item.get('id')}",
                        headers=get_headers(),
                        timeout=5
                    )

                return (
                    f"🎉 Pesanan berhasil dibuat!\n\n"
                    f"📦 Order ID: {order.get('id')}\n"
                    f"💳 Metode Bayar: {payment_method}\n"
                    f"💰 Total: Rp {order.get('total', 0):,}\n"
                    f"📋 Status: {order.get('status', 'pending')}\n\n"
                    f"🔗 Link Pesanan: {BASE_URL}/orders/{order.get('id')}\n"
                    f"🔗 Semua Pesanan: {BASE_URL}/orders"
                )
            else:
                return f"Checkout gagal: {data.get('message', 'Unknown error')}"

        return f"Checkout gagal dengan status {response.status_code}"

    except Exception as e:
        logging.error(f"Checkout error: {e}")
        return f"Checkout error: {str(e)}"


# ==================== ORDER TOOLS ====================

@function_tool
async def get_order_history() -> str:
    """Get order history with links."""
    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu buat liat riwayat pesanan."

    try:
        response = requests.get(
            f"{BASE_URL}/api/orders",
            headers=get_headers(),
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            orders = data.get("data", [])

            if not orders:
                return "Belum ada pesanan."

            result = f"📋 Riwayat pesanan ({len(orders)}):\n\n"
            for order in orders[:10]:
                status_label = {
                    "pending": "⏳ Menunggu Pembayaran",
                    "paid": "✅ Dibayar",
                    "shipped": "🚚 Dikirim",
                    "completed": "✔️ Selesai",
                    "cancelled": "❌ Dibatalkan"
                }.get(order.get('status'), order.get('status'))

                result += f"• Order #{order.get('id')}\n"
                result += f"  Total: Rp {order.get('total', 0):,}\n"
                result += f"  Status: {status_label}\n"
                result += f"  Metode Bayar: {order.get('payment_method', '-')}\n"
                result += f"  🔗 Link: {BASE_URL}/orders/{order.get('id')}\n\n"

            result += f"🔗 Lihat Semua Pesanan: {BASE_URL}/orders"
            return result

        return "Gagal mengambil riwayat pesanan."

    except Exception as e:
        logging.error(f"Get orders error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def get_order_detail(order_id: int) -> str:
    """Get detailed information about a specific order by order ID."""
    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu buat liat detail pesanan."

    try:
        response = requests.get(
            f"{BASE_URL}/api/orders/{order_id}",
            headers=get_headers(),
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            order = data.get("data", {})

            if not order:
                return f"Order #{order_id} gak ditemukan."

            status_label = {
                "pending": "⏳ Menunggu Pembayaran",
                "paid": "✅ Dibayar",
                "shipped": "🚚 Dikirim",
                "completed": "✔️ Selesai",
                "cancelled": "❌ Dibatalkan"
            }.get(order.get('status'), order.get('status'))

            result = f"📦 Detail Order #{order.get('id')}:\n\n"
            result += f"📋 Status: {status_label}\n"
            result += f"💳 Metode Bayar: {order.get('payment_method', '-')}\n"
            result += f"💰 Total: Rp {order.get('total', 0):,}\n\n"
            result += "🛍️ Produk yang dipesan:\n"

            items = order.get("order_items", [])
            for item in items:
                subtotal = item.get('price_at_purchase', 0) * item.get('quantity', 1)
                result += f"• {item.get('name_snapshot', 'Unknown')}\n"
                result += f"  {item.get('quantity')}x Rp {item.get('price_at_purchase', 0):,} = Rp {subtotal:,}\n"

            result += f"\n🔗 Link Pesanan: {BASE_URL}/orders/{order_id}"

            if order.get('status') == 'pending':
                result += f"\n\n⚠️ Pesanan ini belum dibayar. Mau bayar sekarang?"

            return result

        return f"Order #{order_id} tidak ditemukan."

    except Exception as e:
        logging.error(f"Get order detail error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def pay_order(order_id: int) -> str:
    """
    Pay for a pending order. Only works for orders with 'pending' status.

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("bayar order")
    if voice_error:
        return voice_error

    if not auth_state["is_logged_in"]:
        return "Lo harus login dulu sebelum bayar."

    try:
        check_response = requests.get(
            f"{BASE_URL}/api/orders/{order_id}",
            headers=get_headers(),
            timeout=10
        )

        if check_response.status_code != 200:
            return f"Order #{order_id} gak ditemukan."

        order_data = check_response.json().get("data", {})

        if order_data.get("status") != "pending":
            status_label = {
                "paid": "sudah dibayar",
                "shipped": "sudah dikirim",
                "completed": "sudah selesai",
                "cancelled": "sudah dibatalkan"
            }.get(order_data.get('status'), order_data.get('status'))
            return f"Order #{order_id} {status_label}, gak bisa dibayar lagi."

        response = requests.post(
            f"{BASE_URL}/api/orders/{order_id}/pay",
            headers=get_headers(),
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                return f"🎉 Pembayaran berhasil!\nOrder #{order_id} sudah dibayar.\nTotal: Rp {order_data.get('total', 0):,}"

        return "Pembayaran gagal. Coba lagi nanti."

    except Exception as e:
        logging.error(f"Pay order error: {e}")
        return f"Error: {str(e)}"