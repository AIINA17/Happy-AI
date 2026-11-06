import asyncio
import json
import logging
import time

from langchain_community.tools import DuckDuckGoSearchRun
from livekit.agents.llm import function_tool
import requests

from agent.adapters import ADAPTERS, get_adapter, list_sources
from agent.adapters.base import _num

# Interval untuk re-verifikasi (10 menit)
REVERIFY_INTERVAL = 600


# ==================== GLOBAL AUTH STATE ====================
auth_state = {
    # Login state — one slot per registered e-commerce source (see
    # backend/ecommerce_sources.py), since each store has its own account
    # and cart.
    "accounts": {
        source: {"token": None, "user_id": None, "username": None, "is_logged_in": False}
        for source in list_sources()
    },

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

    # Lockout check (voice + face gagal berkali kali)
    lockout_until = state.get("lockout_until")
    if lockout_until:
        now = time.time()
        if now >= lockout_until:
            state["verify_attempts"] = 0
            state["lockout_until"] = None
            lockout_until = None
        else:
            remaining = int(lockout_until - now)
            return (
                f"Maaf, verifikasi gagal beberapa kali. "
                f"Coba lagi sekitar {remaining} detik lagi sebelum {action_name}."
            )

    # Verification itself is triggered from the start of the conversation
    # (agent.py kicks it off right after the greeting, then retries on every
    # user turn until it succeeds) — this gate only ever reads the result
    # that's already been tested by the time a sensitive tool gets called.

    if status == "EXPIRED":
        return (
            f"Sesi verifikasi suara kamu sudah habis. "
            f"Gue lagi dengerin ulang sekarang, coba ngomong satu kalimat penuh "
            f"sebelum gue {action_name}."
        )

    if status == "REPEAT":
        return (
            f"Sebentar ya, suara kamu belum cukup jelas. "
            f"Gue lagi dengerin lagi sekarang, coba ngomong satu kalimat penuh "
            f"sebelum gue {action_name}."
        )

    if status == "DENIED":
        return (
            f"Maaf, suara kamu belum bisa dikenali. "
            f"Kamu tetap bisa browsing dan ngobrol, "
            f"tapi untuk {action_name} fitur ini dibatasi."
        )

    return (
        f"Sebelum gue {action_name}, gue perlu memastikan suara kamu dulu. "
        f"Coba ngomong satu kalimat penuh ya, biar langsung keproses."
    )


def _resolve_account(source: str):
    """Validate a 'source' argument against the registry.

    Returns (adapter, account_state, None) on success, or
    (None, None, error_message) if `source` is missing/unknown — the error
    message is meant to be returned straight to the LLM.
    """
    source = (source or "").strip()
    if not source:
        names = ", ".join(f'"{s}" ({a.label})' for s, a in ADAPTERS.items())
        return None, None, f"Sebutin toko mana dulu ya — pilihannya: {names}."

    adapter = get_adapter(source)
    if not adapter:
        names = ", ".join(f'"{s}"' for s in list_sources())
        return None, None, f"Toko '{source}' gak dikenal. Pilihannya: {names}."

    return adapter, auth_state["accounts"][source], None


# ==================== INTERNAL HELPER ====================

def _is_valid_card_product(p) -> bool:
    """A product is renderable as a card only if it has the fields the
    frontend actually displays (name, price, source). We've seen Gemini
    hand-craft stub products like {"id": 74, "name": "..."} with no price
    — those render as blank cards with "RpNaN" and "Link tidak tersedia",
    which looks broken to the user. Enforce minimum shape so bad cards
    never reach the carousel."""
    if not isinstance(p, dict):
        return False
    if not p.get("name"):
        return False
    # Price must be a positive real number. _num() returns 0 on garbage,
    # so a 0-price product is just as suspicious as NaN.
    try:
        price = float(p.get("price"))
    except (TypeError, ValueError):
        return False
    if price <= 0:
        return False
    if not p.get("source"):
        return False
    return True


async def _send_product_cards_internal(products: list):
    """
    Internal function untuk kirim product cards ke frontend dan DB.
    BUKAN @function_tool — tidak dipanggil langsung oleh LLM.
    """
    from voiceverification.db.connection import get_supabase

    state = auth_state.get("agent_state", {})
    session_id = state.get("conversation_session_id")

    # Shape validation — drop anything the carousel can't render. See
    # _is_valid_card_product docstring for the "RpNaN / Link tidak tersedia"
    # bug this prevents.
    before = len(products)
    products = [p for p in products if _is_valid_card_product(p)]
    dropped = before - len(products)
    if dropped:
        logging.warning(
            f"⚠️ PRODUCT_CARDS dropped {dropped}/{before} invalid product(s) "
            "(missing name/price/source — would have rendered as blank card)"
        )

    if not products:
        logging.error("❌ PRODUCT_CARDS CALLED WITH EMPTY LIST — skipping")
        return

    # Save to DB
    if session_id:
        try:
            sb = get_supabase()
            await asyncio.to_thread(
                lambda: sb.table("product_cards").insert({
                    "session_id": str(session_id),
                    "products": products,
                }).execute()
            )
            logging.info(f"✅ PRODUCT_CARDS SAVED (session={session_id}, count={len(products)})")
        except Exception as e:
            logging.error(f"❌ Failed to save product cards: {e}")
    else:
        logging.error("❌ PRODUCT_CARDS NOT SAVED: conversation_session_id is None")

    # Send to frontend
    room = auth_state.get("room_ref")
    if not room:
        # Loud failure — this used to be a silent skip, which is how
        # "Happy ngomong biasa tanpa nampilin kartu" happened without any
        # log trail. If room_ref is None here, the agent entrypoint
        # (agent.py:485 `auth_state["room_ref"] = room`) never ran or got
        # cleared — check the agent startup logs.
        logging.error(
            f"❌ PRODUCT_CARDS NOT SENT: room_ref is None "
            f"(products count={len(products)}, session={session_id})"
        )
        return

    try:
        # Small delay so the agent's spoken "nih kartunya..." lands before
        # the cards animate in. 2 seconds is intentional; don't shorten
        # without checking the voice/UI timing.
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
        logging.info(
            f"📤 PRODUCT_CARDS SENT REALTIME (count={len(products)})"
        )
    except Exception as e:
        logging.error(f"❌ Failed realtime PRODUCT_CARDS: {e}")

async def _send_review_cards_internal(product_name: str, reviews: list):
    """
    Internal function untuk kirim review cards ke frontend dan DB.
    Mirip _send_product_cards_internal, tapi untuk reviews.
    """
    from voiceverification.db.connection import get_supabase

    state = auth_state.get("agent_state", {})
    session_id = state.get("conversation_session_id")

    # Save to DB
    if session_id:
        try:
            sb = get_supabase()
            await asyncio.to_thread(
                lambda: sb.table("review_cards").insert({
                    "session_id": str(session_id),
                    "product_name": product_name,
                    "reviews": reviews,
                }).execute()
            )
            logging.info(f"✅ REVIEW_CARDS SAVED (session={session_id}, count={len(reviews)})")
        except Exception as e:
            logging.error(f"❌ Failed to save review cards: {e}")
    else:
        logging.error("❌ REVIEW_CARDS NOT SAVED: conversation_session_id is None")

    room = auth_state.get("room_ref")
    if not room:
        logging.error("❌ REVIEW_CARDS NOT SENT: room_ref is None")
        return

    try:
        await asyncio.sleep(0.5)
        payload = json.dumps({
            "type": "REVIEW_CARDS",
            "product_name": product_name,
            "reviews": reviews,
        }).encode("utf-8")
        await room.local_participant.publish_data(
            payload,
            reliable=True,
            topic="PRODUCT_DATA"
        )
        logging.info(f"📤 REVIEW_CARDS SENT ({len(reviews)} reviews for '{product_name}')")
    except Exception as e:
        logging.error(f"❌ Failed to send REVIEW_CARDS: {e}")


async def _send_link_card_internal(label: str, url: str | None):
    """
    Internal function untuk kirim satu clickable link card ke frontend.
    BUKAN @function_tool — tidak dipanggil langsung oleh LLM.

    The model is told (see prompts.py's LINK HANDLING RULES) to never read
    URLs out loud and to just say the link is in the chat — this is what
    actually puts it there, since Gemini's spoken/transcribed reply text
    (sent as the plain AGENT_MESSAGE chat bubble) never contains the raw
    URL for it to be parsed out of.
    """
    if not url:
        return

    room = auth_state.get("room_ref")
    if not room:
        logging.error("❌ LINK_CARD NOT SENT: room_ref is None")
        return

    try:
        payload = json.dumps({
            "type": "LINK_CARD",
            "label": label,
            "url": url,
        }).encode("utf-8")
        await room.local_participant.publish_data(
            payload,
            reliable=True,
            topic="PRODUCT_DATA"
        )
        logging.info(f"📤 LINK_CARD SENT ({label}: {url})")
    except Exception as e:
        logging.error(f"❌ Failed to send LINK_CARD: {e}")


# ==================== USER CONTEXT TOOLS ====================

# GPS reverse-geocoding (Nominatim) returns the nearest named feature,
# which for Indonesian users is often a sub-district (kecamatan) or
# village (kelurahan) rather than the city. E.g. a user physically in
# Yogyakarta might get back "Ngemplak" or "Sinduadi" (kelurahan in
# Sleman) — toko-toko are tagged at CITY level ("Yogyakarta") so filter
# by "Ngemplak" never matches anything. This map rolls sub-areas up to
# the nearest "metropolitan city" that toko inventory actually uses.
#
# Keys are lowercase, matched as substring. Values are the canonical
# city used in store listings. Add more entries as new areas appear.
SUB_AREA_TO_CITY: dict[str, str] = {
    # =========================================================
    # YOGYAKARTA METRO — DIY (Daerah Istimewa Yogyakarta)
    # Covers all 5 kabupaten/kota in DIY:
    # Kota Yogyakarta, Sleman, Bantul, Kulon Progo, Gunungkidul.
    # Any kecamatan from these regions rolls up to "Yogyakarta"
    # because that's the city string used in store listings.
    # =========================================================

    # ---- Kabupaten Sleman (termasuk "depok sleman" yg DISAMBIGUASI) ----
    "sleman": "Yogyakarta",
    "ngemplak": "Yogyakarta",
    "sinduadi": "Yogyakarta",
    "mlati": "Yogyakarta",
    "gamping": "Yogyakarta",
    "godean": "Yogyakarta",
    "kalasan": "Yogyakarta",
    "ngaglik": "Yogyakarta",
    "pakem": "Yogyakarta",
    "prambanan": "Yogyakarta",
    "tempel": "Yogyakarta",
    "turi": "Yogyakarta",
    "cangkringan": "Yogyakarta",
    "minggir": "Yogyakarta",
    "moyudan": "Yogyakarta",
    "seyegan": "Yogyakarta",
    "berbah": "Yogyakarta",
    "depok sleman": "Yogyakarta",
    "sleman depok": "Yogyakarta",
    "condong catur": "Yogyakarta",
    "maguwoharjo": "Yogyakarta",
    "caturtunggal": "Yogyakarta",

    # ---- Kabupaten Bantul ----
    "bantul": "Yogyakarta",
    "sewon": "Yogyakarta",
    "kasihan": "Yogyakarta",
    "piyungan": "Yogyakarta",
    "banguntapan": "Yogyakarta",
    "imogiri": "Yogyakarta",
    "pandak": "Yogyakarta",
    "kretek": "Yogyakarta",
    "dlingo": "Yogyakarta",
    "pleret": "Yogyakarta",
    "sedayu": "Yogyakarta",
    "sanden": "Yogyakarta",
    "srandakan": "Yogyakarta",
    "pundong": "Yogyakarta",
    "bambanglipuro": "Yogyakarta",

    # ---- Kabupaten Kulon Progo ----
    "wates": "Yogyakarta",
    "nanggulan": "Yogyakarta",
    "pengasih": "Yogyakarta",
    "sentolo": "Yogyakarta",
    "kalibawang": "Yogyakarta",
    "samigaluh": "Yogyakarta",
    "girimulyo": "Yogyakarta",
    "lendah": "Yogyakarta",
    "panjatan": "Yogyakarta",
    "galur": "Yogyakarta",
    "temon": "Yogyakarta",
    "kokap": "Yogyakarta",
    "kulon progo": "Yogyakarta",

    # ---- Kabupaten Gunungkidul ----
    "wonosari": "Yogyakarta",
    "semin": "Yogyakarta",
    "playen": "Yogyakarta",
    "patuk": "Yogyakarta",
    "nglipar": "Yogyakarta",
    "ngawen": "Yogyakarta",
    "gedangsari": "Yogyakarta",
    "saptosari": "Yogyakarta",
    "tanjungsari": "Yogyakarta",
    "panggang": "Yogyakarta",
    "girisubo": "Yogyakarta",
    "rongkop": "Yogyakarta",
    "tepus": "Yogyakarta",
    "semanu": "Yogyakarta",
    "karangmojo": "Yogyakarta",
    "ponjong": "Yogyakarta",
    "paliyan": "Yogyakarta",
    "purwosari": "Yogyakarta",
    "gunungkidul": "Yogyakarta",
    "gunung kidul": "Yogyakarta",

    # ---- Kota Yogyakarta (14 kecamatan) ----
    "danurejan": "Yogyakarta",
    "gondokusuman": "Yogyakarta",
    "kraton": "Yogyakarta",
    "keraton": "Yogyakarta",
    "mergangsan": "Yogyakarta",
    "mantrijeron": "Yogyakarta",
    "umbulharjo": "Yogyakarta",
    "pakualaman": "Yogyakarta",
    "wirobrajan": "Yogyakarta",
    "kotagede": "Yogyakarta",
    "tegalrejo": "Yogyakarta",
    "gedongtengen": "Yogyakarta",
    "ngampilan": "Yogyakarta",
    "gondomanan": "Yogyakarta",
    "jetis": "Yogyakarta",
    "malioboro": "Yogyakarta",
    "tugu": "Yogyakarta",
    "alun alun": "Yogyakarta",
    "alun-alun": "Yogyakarta",

    # ---- Umum / alias Yogya ----
    "jogja": "Yogyakarta",
    "diy": "Yogyakarta",
    "yogya": "Yogyakarta",

    # =========================================================
    # JAKARTA & JABODETABEK
    # Store cities di Hijau: Jakarta Pusat/Barat/Timur/Selatan,
    # Tangerang, Bekasi, Depok. Di Oren: Jakarta Selatan.
    # Sub-areas satelit rolled up ke kota terdekat.
    # =========================================================

    # Jakarta Utara (gak ada di toko manapun → rolled up ke Jakarta Pusat)
    "jakarta utara": "Jakarta Pusat",
    "kelapa gading": "Jakarta Pusat",
    "sunter": "Jakarta Pusat",
    "ancol": "Jakarta Pusat",

    # Bogor metro
    "bogor": "Depok",
    "cibinong": "Depok",
    "gunung putri": "Depok",
    "cileungsi": "Depok",

    # Tangerang Selatan / BSD area → mapped ke Tangerang
    "tangsel": "Tangerang",
    "tangerang selatan": "Tangerang",
    "bsd": "Tangerang",
    "serpong": "Tangerang",
    "ciputat": "Tangerang",
    "pamulang": "Tangerang",

    # Bekasi area
    "cikarang": "Bekasi",
    "bekasi timur": "Bekasi",
    "bekasi barat": "Bekasi",
    "bekasi utara": "Bekasi",
    "bekasi selatan": "Bekasi",

    # =========================================================
    # BANDUNG METRO (store city: "Bandung")
    # =========================================================
    "cimahi": "Bandung",
    "bandung barat": "Bandung",
    "padalarang": "Bandung",
    "lembang": "Bandung",
    "cileunyi": "Bandung",
    "soreang": "Bandung",
    "cicalengka": "Bandung",
    "dago": "Bandung",
    "ciwidey": "Bandung",

    # =========================================================
    # SURABAYA METRO (store city: "Surabaya")
    # =========================================================
    "sidoarjo": "Surabaya",
    "gresik": "Surabaya",
    "waru": "Surabaya",
    "taman sidoarjo": "Surabaya",
    "gedangan": "Surabaya",
    "buduran": "Surabaya",

    # =========================================================
    # SEMARANG METRO (store city: "Semarang")
    # =========================================================
    "ungaran": "Semarang",
    "demak": "Semarang",
    "kendal": "Semarang",
    "semarang barat": "Semarang",
    "semarang timur": "Semarang",
    "semarang tengah": "Semarang",

    # =========================================================
    # MALANG METRO (store city: "Malang")
    # =========================================================
    "batu": "Malang",
    "kepanjen": "Malang",
    "singosari": "Malang",
    "kota batu": "Malang",

    # =========================================================
    # MEDAN METRO (store city: "Medan")
    # =========================================================
    "binjai": "Medan",
    "deli serdang": "Medan",
    "medan kota": "Medan",

    # =========================================================
    # MAKASSAR METRO (store city: "Makassar")
    # =========================================================
    "ujung pandang": "Makassar",
    "maros": "Makassar",
    "sungguminasa": "Makassar",
    "gowa": "Makassar",

    # =========================================================
    # DENPASAR / BALI (store city: "Denpasar")
    # =========================================================
    "bali": "Denpasar",
    "kuta": "Denpasar",
    "sanur": "Denpasar",
    "canggu": "Denpasar",
    "seminyak": "Denpasar",
    "ubud": "Denpasar",
    "jimbaran": "Denpasar",
    "badung": "Denpasar",
    "nusa dua": "Denpasar",
}


def _normalize_city(raw: str | None) -> str | None:
    """Collapse a sub-area name into its nearest metropolitan city.

    Returns the input unchanged if no mapping matches, so already-correct
    city names ("Yogyakarta", "Jakarta") just pass through.
    """
    if not raw:
        return raw
    key = raw.strip().lower()
    for sub_area, city in SUB_AREA_TO_CITY.items():
        if sub_area in key:
            return city
    return raw


@function_tool
async def get_user_city() -> str:
    """
    Get the user's current city, auto-detected from their browser's GPS.

    Returns the city name if GPS permission was granted when they loaded
    the app (e.g. "Yogyakarta", "Jakarta"). Sub-area detections from GPS
    (kecamatan/kelurahan like "Ngemplak" or "Sinduadi") are automatically
    rolled up to the nearest metropolitan city so a filter by city actually
    matches the store listings.

    Use this to:
    - Prioritize stores in the user's city when recommending products
    - Suggest nearby stores (lower shipping cost)
    - Decide whether to filter by city or just show all

    If this returns "unknown", ask the user manually what city they're in,
    then remember it for the rest of the conversation.
    """
    state = auth_state.get("agent_state") or {}
    raw_city = state.get("user_city")
    city = _normalize_city(raw_city)

    if city:
        # If we rolled up a sub-area, mention it so Happy can disambiguate
        # ("GPS says you're in Ngemplak which is part of Yogya area").
        if city != raw_city and raw_city:
            return (
                f"User's detected city: {city} "
                f"(GPS sub-area: {raw_city}, mapped to nearest metro area)"
            )
        return f"User's detected city: {city}"

    return (
        "User's city is unknown (they denied GPS permission or GPS failed). "
        "Ask them manually what city they're in."
    )

# ==================== PRODUCT TOOLS ====================

def _coerce_product(p):
    """Normalize a product item into a dict.

    Gemini (currently) sometimes passes products as JSON-string elements
    instead of dicts (see production log: 'arguments' showed
    `["\"{\\\"id\\\":13,...}\"",...]`). When that happens the raw code
    does p.get('name') and crashes with AttributeError: 'str' object has
    no attribute 'get', which (a) empties the card payload on the
    frontend ("Rp 0", no name) and (b) makes Happy stall out because the
    tool errored. This coercion makes send_product_cards tolerant of
    either shape.
    """
    if isinstance(p, dict):
        return p
    if isinstance(p, str):
        try:
            parsed = json.loads(p)
            if isinstance(parsed, dict):
                return parsed
        except (ValueError, TypeError):
            pass
    # Unknown shape — return a stub so downstream code sees empty dict
    # instead of blowing up. Caller will treat as "unknown product".
    return {}


@function_tool
async def send_product_cards(products: list) -> str:
    """
    Explicitly send product cards to the frontend display.
    Automatically trims to a maximum of 5 products for the voice-first
    carousel UI (showing more overwhelms the user when they're listening).
    Pass the products you consider the best matches first. After sending
    cards, only confirm that they are visible; do not read every card aloud.

    Use this ONLY to re-show / narrow products from the most recent
    search_product() results — e.g. "yang Toko Hijau aja", "yang
    rating tertinggi dulu". Do NOT hand-craft product dicts here (name
    + id + partial fields): the carousel renders them as blank cards
    with 'RpNaN'. If you want different products, run search_product()
    again with the right query.
    """
    # Normalize every item to a dict regardless of whether Gemini sent dict
    # or JSON-string. See _coerce_product's docstring for why this matters.
    normalized = [_coerce_product(p) for p in products]
    # Drop any that failed to coerce (empty dict) so we don't send junk
    # cards to the carousel.
    normalized = [p for p in normalized if p]

    # Cross-reference with the most recent search_product() results. If a
    # product in the LLM's payload isn't in that cache, it was either
    # hand-crafted from memory or carried over from a before-filter session
    # — drop it. This is what stopped "search 'laptop gaming' still shows
    # Under Armour" (the LLM was reusing a stale uncached list).
    cached = auth_state.get("last_search_products") or []
    cached_keys = {
        (str(p.get("source")), str(p.get("id")))
        for p in cached
        if p.get("id") is not None
    }
    if cached_keys:
        filtered = []
        dropped_names = []
        for p in normalized:
            key = (str(p.get("source")), str(p.get("id")))
            if key in cached_keys:
                filtered.append(p)
            else:
                dropped_names.append(p.get("name") or "?")
        if dropped_names:
            logging.warning(
                f"⚠️ send_product_cards dropped {len(dropped_names)} product(s) "
                f"not in last_search_products cache: {dropped_names}"
            )
        normalized = filtered

    if not normalized:
        # Never publish an empty PRODUCT_CARDS payload — the frontend
        # replaces whatever cards are currently shown with whatever array
        # arrives, so an empty list silently wipes the carousel (user
        # report: asked for laptops, then "yang di atas 25 juta", cards
        # vanished with no explanation). Leave the existing cards alone
        # and tell the LLM to explain instead of calling this with [].
        return (
            "SEND_PRODUCT_CARDS_SKIPPED: list produk kosong, TIDAK dikirim ke "
            "frontend — kartu yang sedang tampil di layar user TETAP ada, "
            "jangan dianggap sudah diganti.\n"
            "Beri tahu user bahwa gak ada produk yang cocok dengan filter "
            "itu, dan tawarkan alternatif (longgarin budget atau filter lain)."
        )

    await _send_product_cards_internal(normalized[:5])

    sent = normalized[:5]
    summary = (
        f"PRODUCT_CARDS_SENT_INTERNAL: {len(sent)} produk berhasil dikirim "
        "ke tampilan user. Jangan bacakan detail kartu satu per satu.\n"
    )
    for i, p in enumerate(sent, 1):
        summary += (
            f"{i}. {p.get('name', 'Unknown')} — "
            f"ID: {p.get('id', '-')} | source=\"{p.get('source')}\"\n"
        )
    summary += (
        "Respons suara wajib singkat: beri tahu user kartunya sudah tampil "
        "dan tawarkan detail satu produk."
    )
    return summary


# ──────────────────────────────────────────────────────────────────────
# Query-intent rules used by search_product() to drop cross-category
# contamination. Dummy seed data is noisy: a laptop bag's description
# mentions "laptop", an earbuds description mentions "iPhone/Samsung", a
# charger's keywords mention "smartphone" etc — without these guards a
# search for "laptop" surfaces Ransel Laptop TravelPack, a search for "hp"
# surfaces chargers, and so on. Each rule maps:
#   - triggers: substrings in the user's query that fire this intent
#   - allowed_categories: whitelist of categories the result MUST be in
#   - name_excludes: accessory words that disqualify a product-name hit
#     even inside the allowed category
# Keep the trigger list intent-specific (not brand-specific) so a search
# like "samsung" still returns both phones and TVs.
_INTENT_RULES: list[dict] = [
    {
        "triggers": {
            "laptop", "notebook", "macbook", "thinkpad", "ideapad",
            "ultrabook", "chromebook", "komputer",
        },
        "allowed_categories": {"gadget & tech"},
        "name_excludes": {
            "tas", "ransel", "backpack", "sleeve", "pouch",
            "case", "stand", "cooler", "pad",
        },
    },
    {
        "triggers": {
            "handphone", "smartphone", "ponsel",
            "iphone", "galaxy", "redmi", "poco", "oppo", "vivo", "realme",
        },
        "allowed_categories": {"gadget & tech"},
        "name_excludes": {
            "case", "charger", "cable", "kabel", "holder", "stand",
            "power bank", "powerbank",
            "earphone", "earbuds", "headset", "headphone",
            "smartwatch", "tablet", "ipad", "ring light", "tripod",
        },
    },
    # Standalone "hp" is tricky because it matches too easily inside words
    # ("shop", "hpv" etc.), so require a word boundary via space/edges.
    {
        "triggers": {" hp ", " hp", "hp "},
        "allowed_categories": {"gadget & tech"},
        "name_excludes": {
            "case", "charger", "cable", "kabel", "holder", "stand",
            "power bank", "powerbank",
            "earphone", "earbuds", "headset", "headphone",
            "smartwatch", "tablet", "ipad", "ring light", "tripod",
        },
    },
    {
        "triggers": {"sepatu", "sneakers", "running shoes"},
        "allowed_categories": {"lifestyle"},
        "name_excludes": {"rak sepatu", "pembersih sepatu"},
    },
    {
        "triggers": {"headset", "headphone", "earphone", "earbuds"},
        "allowed_categories": {"gadget & tech"},
        "name_excludes": set(),
    },
    {
        "triggers": {"televisi", " tv ", " tv", "tv "},
        "allowed_categories": {"gadget & tech"},
        "name_excludes": set(),
    },
]


def _match_query_intent(q_lower: str) -> dict | None:
    """Return the first matching intent rule, or None. Pad the query with
    spaces so word-boundary triggers (e.g. ' hp ') can match at edges too."""
    padded = f" {q_lower} "
    for rule in _INTENT_RULES:
        for trig in rule["triggers"]:
            if trig in padded or trig.strip() == q_lower.strip():
                return rule
    return None


@function_tool
async def search_product(
    query: str = "",
    category: str = "",
    city: str = "",
    min_price: int = 0,
    max_price: int = 0,
    min_rating: float = 0.0,
    sort_by: str = ""
) -> str:
    """
    Search for products across ALL registered e-commerce stores at once, so
    the results can be compared store-to-store (price, rating, etc).
    Fetches all products from every store then filters locally by the given
    criteria.

    Every product in the results carries a "source" code (e.g. "oren",
    "hijau") — pass that same source back into get_product_detail,
    add_to_cart, checkout and the other per-store tools.

    Args:
        query: Search keyword for product name (optional, matches partial name)
        category: Filter by category — one of: "Gadget & Tech", "Lifestyle", "Home & Living", "Lain-lain"
        city: Filter by store city (e.g., "Jakarta", "Bandung", "Yogyakarta"). Case-insensitive.
        min_price: Minimum price filter
        max_price: Maximum price filter
        min_rating: Minimum rating filter (0.0-5.0)
        sort_by: Sort results (price_asc, price_desc, rating_desc, newest)
    """
    results = await asyncio.gather(
        *[adapter.search_products() for adapter in ADAPTERS.values()],
        return_exceptions=True
    )

    products = []
    failed_sources = []
    for adapter, result in zip(ADAPTERS.values(), results):
        if isinstance(result, Exception):
            logging.error(f"Search product error ({adapter.source}): {result}")
            failed_sources.append(adapter.label)
            continue
        products.extend(result)

    if not products:
        if failed_sources:
            return f"Gagal mengakses toko: {', '.join(failed_sources)}."
        return "Tidak ada produk di toko manapun saat ini."

    if query:
        q_lower = query.lower()

        # STEP 1 — Permissive substring match across name, keywords,
        # description.
        #
        # We DO need description matching because some stores (e.g. Oren)
        # have no `keywords` field and their product NAMES are brand-model
        # strings ("Acer Nitro 5 i5 8GB RTX 3050") with no generic category
        # word in them — so a user who says "laptop" would never match any
        # Oren laptop if we only looked at name/keywords.
        #
        # Description matching is intentionally noisy; we clean it up in the
        # intent filter below (laptop bags' descriptions mention "laptop",
        # charger descriptions mention "handphone", etc. — these get dropped
        # by the category + name-exclude rules).
        products = [
            p for p in products
            if q_lower in (p.get("name") or "").lower()
            or q_lower in (p.get("keywords") or "").lower()
            or q_lower in (p.get("description") or "").lower()
        ]

        # STEP 2 — Intent-based filtering.
        # When the user says "laptop" they mean the computer, not a laptop
        # bag, laptop stand, laptop cooler. Each rule: triggers that detect
        # the intent, whitelisted categories (result MUST be in one of
        # these), and name-excludes (accessory words that disqualify a
        # product name even inside the allowed category).
        intent = _match_query_intent(q_lower)
        if intent:
            allowed_cats = intent["allowed_categories"]
            name_excludes = intent["name_excludes"]
            products = [
                p for p in products
                if (p.get("category") or "").lower() in allowed_cats
                and not any(
                    ex in (p.get("name") or "").lower()
                    for ex in name_excludes
                )
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

    if city:
        city_lower = city.lower()
        products = [
            p for p in products
            if (p.get("store") or {}).get("city", "").lower() == city_lower
        ]

    # ── Sorting ──
    # Sort within each store's own bucket first, then interleave round-robin
    # across stores — never sort the merged list flat. Stores in this dummy
    # data can have systematically different rating/price distributions for
    # the same kind of product (e.g. one store's laptops all rate below 4.0
    # while another's all rate above 4.5), so a flat sort/truncate to top-8
    # can silently wipe one store out of the display entirely, defeating the
    # point of searching multiple stores for comparison.
    sort_key = None
    sort_reverse = False
    if sort_by == "price_asc":
        sort_key = lambda p: p.get("price") or 0
    elif sort_by == "price_desc":
        sort_key = lambda p: p.get("price") or 0
        sort_reverse = True
    elif sort_by == "rating_desc":
        sort_key = lambda p: p.get("rating") or 0
        sort_reverse = True
    elif sort_by == "newest":
        sort_key = lambda p: p.get("created_at") or ""
        sort_reverse = True

    buckets = {source: [] for source in ADAPTERS}
    for p in products:
        buckets.setdefault(p.get("source"), []).append(p)
    if sort_key:
        for source in buckets:
            buckets[source].sort(key=sort_key, reverse=sort_reverse)
    interleaved = []
    while any(buckets.values()):
        for source in buckets:
            if buckets[source]:
                interleaved.append(buckets[source].pop(0))
    products = interleaved

    if not products:
        search_term = query if query else "filter yang diberikan"
        return f"Gak nemu produk untuk '{search_term}'."

    # ✅ Simpan ke memory agar bisa diakses tools lain
    auth_state["last_search_products"] = products[:10]

    # ✅ Kirim ke frontend via internal function (bukan @function_tool)
    await _send_product_cards_internal(products[:5])

    # Return only compact selection context. The cards already contain the
    # prices, ratings, stock, and store details; reading all of those fields
    # in the voice response defeats the browse-first flow.
    search_term = query if query else "semua produk"
    result = (
        f"SEARCH_RESULT_INTERNAL: Ketemu {len(products)} produk untuk "
        f"'{search_term}' dari {len(ADAPTERS)} toko. "
        f"{min(len(products), 5)} kartu sudah ditampilkan di layar.\n"
        "Jangan bacakan daftar ini atau atribut produknya ke user. "
        "Gunakan konteks ini hanya untuk memilih produk saat user meminta "
        "nomor/nama tertentu.\n\n"
    )
    result += "Konteks internal hasil kartu (nomor, nama, ID, source):\n"
    for i, p in enumerate(products[:5], 1):
        result += (
            f"{i}. {p.get('name', 'Unknown')} — "
            f"ID: {p.get('id', '-')} | source=\"{p.get('source')}\"\n"
        )

    if len(products) > 5:
        result += f"\n(Ada {len(products) - 5} produk lain yang tidak ditampilkan.)\n"

    if failed_sources:
        result += f"\n⚠️ Toko yang gagal diakses: {', '.join(failed_sources)}.\n"

    result += (
        "\nRespons suara wajib singkat: beri tahu user hasilnya sudah ditampilkan "
        "dan tawarkan detail satu produk berdasarkan nomor/nama."
    )
    return result

@function_tool
async def send_review_cards(product_id: int, source: str) -> str:
    """
    Fetch reviews for a product and display them as cards in the chat.

    Use this when the user asks about reviews, ratings, or wants to see
    what other buyers said about a product (e.g. "review-nya gimana?",
    "mana review-nya?", "orang bilang gimana soal ini?").

    Args:
        product_id: the product's ID
        source: store code the product belongs to (from search_product results), e.g. "oren" or "hijau"

    After calling this, briefly summarize the overall sentiment in your
    voice response (e.g. "nih review-nya, mostly positif soal kamera, tapi
    beberapa complain soal baterai"). The actual review cards will appear
    automatically in the chat.
    """
    adapter, _, error = _resolve_account(source)
    if error:
        return error

    try:
        p = await adapter.get_product(product_id)
        if not p:
            return f"Produk ID {product_id} gak ditemukan di {adapter.label}."

        product_name = p.get("name", "Produk ini")
        reviews = p.get("reviews") or []

        if not reviews:
            return f"Produk '{product_name}' belum ada review-nya."

        # Kirim ke frontend
        await _send_review_cards_internal(product_name, reviews[:10])

        # Return summary buat LLM
        avg_rating = sum(r.get("rating", 0) for r in reviews) / len(reviews)
        summary = (
            f"✅ Review cards sent for '{product_name}'.\n"
            f"Total reviews: {len(reviews)}\n"
            f"Average rating: {avg_rating:.1f}⭐\n\n"
            f"Sample reviews:\n"
        )
        for r in reviews[:3]:
            summary += (
                f"• {r.get('reviewer_name', 'Anonim')} "
                f"({r.get('rating', 0)}⭐): {r.get('comment', '')}\n"
            )
        return summary

    except Exception as e:
        logging.error(f"Send review cards error: {e}")
        return f"Error: {str(e)}"

@function_tool
async def get_product_detail(product_id: int, source: str) -> str:

    adapter, _, error = _resolve_account(source)
    if error:
        return error

    try:
        p = await adapter.get_product(product_id)

        if not p:
            return f"Produk ID {product_id} gak ditemukan di {adapter.label}."

        stock = p.get('stock', 0)
        if stock > 10:
            stock_status = f"✅ Tersedia ({stock} unit)"
        elif stock > 0:
            stock_status = f"⚠️ Stok terbatas ({stock} unit)"
        else:
            stock_status = "❌ Habis"

        store = p.get("store") or {}
        store_section = ""
        if store:
            store_section = (
                f"\n🏪 Toko:\n"
                f"• Nama: {store.get('name', '-')}\n"
                f"• Kota: {store.get('city', '-')}\n"
                f"• Alamat: {store.get('address', '-')}\n"
            )

        reviews = p.get("reviews") or []
        reviews_section = ""
        if reviews:
            reviews_section = f"\n💬 Review Pembeli ({len(reviews)} total):\n"
            for r in reviews[:5]:
                reviews_section += (
                    f"• {r.get('reviewer_name', 'Anonim')} "
                    f"({r.get('rating', 0)}⭐): "
                    f"{r.get('comment', '')}\n"
                )
            if len(reviews) > 5:
                reviews_section += f"(ada {len(reviews) - 5} review lagi)\n"

        # Per user policy: don't push a LINK_CARD to the chat area for
        # product browsing. Product cards (right panel) already carry the
        # "Lihat di Toko" button, so a separate chat link is redundant.
        # LINK_CARDs in the chat are reserved for post-checkout order
        # confirmation and review cards.

        return (
            f"📦 Detail Produk ({adapter.label}):\n"
            f"• Nama: {p.get('name', 'Unknown')}\n"
            f"• Harga: Rp {p.get('price', 0):,.0f}\n"
            f"• Kategori: {p.get('category', '-')}\n"
            f"• Rating: {p.get('rating', 0)}⭐\n"
            f"• Stok: {stock_status}\n\n"
            f"📝 Deskripsi:\n{p.get('description', 'Tidak ada deskripsi')}\n"
            f"{store_section}"
            f"{reviews_section}\n"
            f"🖼️ Foto Produk: {p.get('image_url')}\n"
            f"🔗 Link Produk: {p.get('link')}"
        )

    except Exception as e:
        logging.error(f"Get product error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def get_product_from_search_index(index: int) -> str:
    """
    Get product ID and source from the last search results by index (1-based).
    Example: User says 'add product number 2 to cart', use this to get the
    product ID + source, then pass both into add_to_cart.
    """
    if not auth_state["last_search_products"]:
        return "Gak ada hasil pencarian sebelumnya. Coba cari produk dulu."

    if index < 1 or index > len(auth_state["last_search_products"]):
        return f"Index {index} gak valid. Hasil pencarian cuma ada {len(auth_state['last_search_products'])} produk."

    product = auth_state["last_search_products"][index - 1]
    return (
        f"Produk nomor {index}: {product.get('name')} "
        f"(ID: {product.get('id')}, source: \"{product.get('source')}\" / {product.get('source_label')}, "
        f"Harga: Rp {_num(product.get('price')):,.0f})"
    )


# ==================== GENERAL TOOLS ====================

@function_tool
async def get_weather(city: str) -> str:
    """Get current weather for a given city."""
    try:
        response = await asyncio.to_thread(
            requests.get,
            f"https://wttr.in/{city}?format=3",
            timeout=10
        )

        if response.status_code == 200:
            logging.info(f"Weather for {city}: {response.text.strip()}")
            return response.text.strip()
        else:
            return f"Could not retrieve weather for {city}."
    except Exception as e:
        logging.error(f"Error retrieving weather for {city}: {e}")
        return f"Weather service error for {city}."


WEB_SEARCH_TIMEOUT_SEC = 15.0


@function_tool
async def web_search(query: str) -> str:
    """Search the internet for information."""
    try:
        # Every other outbound call in this file (adapters/base.py, wttr.in)
        # sets requests' own timeout=10 — this one didn't, and
        # DuckDuckGoSearchRun is a known offender for hanging or getting
        # rate-limited for a long time with no error, which silently
        # blocked the whole turn (and the realtime model's "thinking"
        # state) for minutes. asyncio.wait_for can't kill the underlying
        # thread, but it unblocks the conversation instead of waiting on it.
        return await asyncio.wait_for(
            asyncio.to_thread(DuckDuckGoSearchRun().run, query),
            timeout=WEB_SEARCH_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        logging.error(f"web_search timed out after {WEB_SEARCH_TIMEOUT_SEC}s: {query!r}")
        return "Pencarian web-nya kelamaan, coba lagi ya atau tanya hal lain dulu."
    except Exception as e:
        logging.error(e)
        return "Search error."


# ==================== AUTH TOOLS ====================

async def login_with_stored_credentials(source: str = "") -> str:
    """
    Log in to one (or every) linked e-commerce account using the caller's own
    stored credentials (db/ecommerce_repo.py), never credentials typed/spoken
    in conversation.

    Shared by the login() tool and by agent.py's auto-login-after-voice-
    verification hook, so both paths behave identically. An empty `source`
    means "try every registered store the user has linked an account to".
    """
    state = auth_state.get("agent_state") or {}
    user_id = state.get("user_id")

    if not user_id:
        return "Gue belum tau siapa lo — coba mulai ulang percakapannya."

    from db.ecommerce_repo import load_ecommerce_account

    if source:
        adapter = get_adapter(source)
        if not adapter:
            names = ", ".join(f'"{s}"' for s in list_sources())
            return f"Toko '{source}' gak dikenal. Pilihannya: {names}."
        targets = [source]
    else:
        targets = list_sources()

    results = []
    any_linked = False

    for src in targets:
        adapter = get_adapter(src)
        account = load_ecommerce_account(user_id, src)
        if account is None:
            continue
        any_linked = True

        login_result = await adapter.login(account["username"], account["password"])
        acc_state = auth_state["accounts"][src]
        if login_result["success"]:
            acc_state["token"] = login_result["token"]
            acc_state["user_id"] = login_result["user_id"]
            acc_state["username"] = login_result["username"]
            acc_state["is_logged_in"] = True
            results.append(f"✅ {adapter.label}: login berhasil sebagai {acc_state['username']}")
        else:
            acc_state["is_logged_in"] = False
            results.append(f"❌ {adapter.label}: login gagal — akun yang lo hubungkan sepertinya udah gak valid lagi")

    if not any_linked:
        if source:
            adapter = get_adapter(source)
            return (
                f"Lo belum nyambungin akun {adapter.label}. "
                f"Buka menu akun di aplikasi buat daftarin username & password dulu ya."
            )
        return (
            "Lo belum nyambungin akun e-commerce manapun. "
            "Buka menu akun di aplikasi buat daftarin username & password dulu ya."
        )

    return "\n".join(results)


@function_tool
async def login(source: str = "") -> str:
    """
    Log in to the user's own linked e-commerce account(s).

    Args:
        source: store code to log into, e.g. "oren" or "hijau". Leave empty
            to log into every store the user has linked an account to.

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("login")
    if voice_error:
        return voice_error

    return await login_with_stored_credentials(source)


@function_tool
async def logout(source: str = "") -> str:
    """
    Logout from one (or all) e-commerce store(s).

    Args:
        source: store code to log out of, e.g. "oren" or "hijau". Leave empty
            to log out of every store.

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("logout")
    if voice_error:
        return voice_error

    targets = [source] if source else list_sources()
    logged_out = []
    for src in targets:
        if src not in auth_state["accounts"]:
            continue
        auth_state["accounts"][src] = {
            "token": None, "user_id": None, "username": None, "is_logged_in": False
        }
        adapter = get_adapter(src)
        logged_out.append(adapter.label if adapter else src)

    if not logged_out:
        return "Gak ada akun yang lagi login."
    return f"Berhasil logout dari {', '.join(logged_out)}."


@function_tool
async def check_login_status(source: str = "") -> str:
    """
    Check if the user is currently logged in.

    Args:
        source: store code to check, e.g. "oren" or "hijau". Leave empty to
            check every store.
    """
    targets = [source] if source else list_sources()
    lines = []
    for src in targets:
        adapter = get_adapter(src)
        if not adapter:
            continue
        acc = auth_state["accounts"].get(src, {})
        if acc.get("is_logged_in"):
            lines.append(f"✅ {adapter.label}: login sebagai {acc.get('username')}")
        else:
            lines.append(f"⚪ {adapter.label}: belum login")

    return "\n".join(lines) if lines else "Belum ada status login."


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
async def get_shopkupay_balance(source: str) -> str:
    """
    Get user's e-wallet balance/saldo on a specific store. Each store brands
    its own wallet differently: Toko Oren's is called "ShopKuPay", Toko
    Hijau's is called "TokoKuPay" — use the right name for the store you're
    talking about when you tell the result back to the user.

    Args:
        source: store code, e.g. "oren" or "hijau"

    ⚠️ This action requires voice verification for security.
    """
    adapter, account, error = _resolve_account(source)
    if error:
        return error

    voice_error = require_voice_verification(f"cek saldo {adapter.wallet_name}")
    if voice_error:
        return voice_error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label} buat cek saldo {adapter.wallet_name}."

    try:
        user = await adapter.get_user(account["token"])
        if user is None:
            return "Gagal mengambil data saldo."
        return f"Saldo {adapter.wallet_name} lo di {adapter.label}: Rp {user.get('balance', 0):,.0f}"

    except Exception as e:
        logging.error(f"Get balance error: {e}")
        return f"Error: {str(e)}"


# ==================== CART TOOLS ====================

@function_tool
async def add_to_cart(product_id: int, source: str, quantity: int = 1) -> str:
    """
    Add a product to the shopping cart of a specific store. Requires login
    to that store first.

    Args:
        product_id: the product's ID
        source: store code the product belongs to, e.g. "oren" or "hijau"
        quantity: how many units to add

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("nambahin ke keranjang")
    if voice_error:
        return voice_error

    adapter, account, error = _resolve_account(source)
    if error:
        return error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label} sebelum bisa nambahin ke keranjang."

    try:
        result = await adapter.add_to_cart(account["token"], product_id, quantity)
        if result["success"]:
            return f"Berhasil ditambahin ke keranjang {adapter.label}! {result.get('message', '')}"
        return f"Gagal nambahin ke keranjang {adapter.label}."

    except Exception as e:
        logging.error(f"Add to cart error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def get_cart(source: str) -> str:
    """
    Get current items in the shopping cart of a specific store, with cart link.

    Args:
        source: store code, e.g. "oren" or "hijau"
    """
    adapter, account, error = _resolve_account(source)
    if error:
        return error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label} buat liat keranjang."

    try:
        items = await adapter.get_cart(account["token"])

        if not items:
            return f"Keranjang lo di {adapter.label} kosong."

        result = f"🛒 Keranjang lo di {adapter.label} ({len(items)} item):\n\n"
        total = 0

        for item in items:
            product = item.get("products", {})
            price = _num(product.get("price"))
            subtotal = price * item.get("quantity", 1)
            total += subtotal

            result += f"• {product.get('name', 'Unknown')}\n"
            result += f"  {item.get('quantity')}x Rp {price:,.0f} = Rp {subtotal:,.0f}\n"
            result += f"  (Cart ID: {item.get('id')})\n\n"

        result += f"💰 Total: Rp {total:,.0f}\n"
        # Per user policy: no cart-link LINK_CARD in chat. LINK_CARDs are
        # reserved for post-checkout order confirmation and review cards.

        return result

    except Exception as e:
        logging.error(f"Get cart error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def remove_from_cart(cart_id: int, source: str) -> str:
    """
    Remove an item from a specific store's cart using cart_id.

    Args:
        cart_id: the cart entry's ID (from get_cart results)
        source: store code, e.g. "oren" or "hijau"

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("hapus item dari keranjang")
    if voice_error:
        return voice_error

    adapter, account, error = _resolve_account(source)
    if error:
        return error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label}."

    try:
        ok = await adapter.remove_from_cart(account["token"], cart_id)
        if ok:
            return "Item berhasil dihapus dari keranjang!"
        return "Gagal menghapus item."

    except Exception as e:
        logging.error(f"Remove from cart error: {e}")
        return f"Error: {str(e)}"


# ==================== CHECKOUT TOOLS (PROTECTED) ====================

@function_tool
async def checkout(source: str, payment_method: str = "") -> str:
    """
    Complete the purchase and create an order from a specific store's cart items.

    Payment methods ARE NOT THE SAME between stores — each store's API
    silently accepts an unknown method and leaves the order permanently
    unpaid (no error returned). So you MUST pick a method from the correct
    store's list:

      source="oren" (Toko Oren) accepts:
        ShopKuPay, GoPay, OVO, DANA, VA_BCA, VA_BRI, VA_Mandiri, ShopeePay

      source="hijau" (Toko Hijau) accepts:
        TokoKuPay, BCA_VA, MANDIRI_VA, COD

    Note the DIFFERENT NAMING for VAs between stores (Oren: VA_BCA,
    VA_Mandiri; Hijau: BCA_VA, MANDIRI_VA) and that these methods only
    exist in ONE store:
      - ShopKuPay, GoPay, OVO, DANA, ShopeePay, VA_BRI → Oren only
      - TokoKuPay, COD → Hijau only

    If the user asks for a method not available in the target store, tell
    them it's unavailable and offer the alternatives from that store's
    list. Do NOT silently substitute.

    Args:
        source: store code to checkout on, "oren" or "hijau"
        payment_method: one of the methods from the correct store's list

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("checkout", {"payment_method": payment_method})
    if voice_error:
        return voice_error

    adapter, account, error = _resolve_account(source)
    if error:
        return error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label} sebelum checkout."

    # Whitelist check BEFORE touching the real API so a mismatched method
    # never reaches the store's permissive normalizer (which would accept
    # it and silently leave the order unpaid — exactly how "Hijau accepted
    # a ShopeePay order that never got paid" happens).
    if not payment_method:
        return (
            f"Pilih metode bayar dulu buat {adapter.label}. Yang tersedia: "
            f"{', '.join(adapter.accepted_payment_methods)}."
        )
    if not adapter.is_payment_method_accepted(payment_method):
        return (
            f"❌ {adapter.label} gak nerima '{payment_method}'. "
            f"Yang tersedia di toko ini: "
            f"{', '.join(adapter.accepted_payment_methods)}. Pilih salah satu."
        )

    try:
        cart_items = await adapter.get_cart(account["token"])

        if not cart_items:
            return f"Keranjang {adapter.label} kosong. Gak ada yang bisa di-checkout."

        total = sum(
            _num(item.get("products", {}).get("price")) * item.get("quantity", 1)
            for item in cart_items
        )

        if payment_method == adapter.wallet_name:
            user = await adapter.get_user(account["token"])
            if user is not None:
                balance = _num(user.get("balance"))
                if balance < total:
                    return f"Saldo {adapter.wallet_name} tidak cukup. Saldo: Rp {balance:,.0f}, Total: Rp {total:,.0f}"

        items = []
        for item in cart_items:
            product = item.get("products", {})
            items.append({
                "product_id": product.get("id"),
                "quantity": item.get("quantity"),
                "price": _num(product.get("price")),
                "name": product.get("name"),
            })

        result = await adapter.checkout(account["token"], payment_method, items)

        if not result["success"]:
            return f"Checkout gagal: {result.get('message', 'Unknown error')}"

        order = result["order"]

        await asyncio.gather(*[
            adapter.remove_from_cart(account["token"], item.get("id"))
            for item in cart_items
        ])

        await _send_link_card_internal(
            f"Pesanan #{order.get('id')} — {adapter.label}",
            adapter.order_link(order.get('id')),
        )

        return (
            f"🎉 Pesanan berhasil dibuat di {adapter.label}!\n\n"
            f"📦 Order ID: {order.get('id')}\n"
            f"💳 Metode Bayar: {payment_method}\n"
            f"💰 Total: Rp {_num(order.get('total')):,.0f}\n"
            f"📋 Status: {order.get('status', 'pending')}\n\n"
            f"🔗 Link Pesanan: {adapter.order_link(order.get('id'))}\n"
            f"🔗 Semua Pesanan: {adapter.orders_link()}"
        )

    except Exception as e:
        logging.error(f"Checkout error: {e}")
        return f"Checkout error: {str(e)}"


# ==================== ORDER TOOLS ====================

@function_tool
async def get_order_history(source: str) -> str:
    """
    Get order history with links, for a specific store.

    Args:
        source: store code, e.g. "oren" or "hijau"
    """
    adapter, account, error = _resolve_account(source)
    if error:
        return error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label} buat liat riwayat pesanan."

    try:
        orders = await adapter.get_order_history(account["token"])

        if not orders:
            return f"Belum ada pesanan di {adapter.label}."

        result = f"📋 Riwayat pesanan di {adapter.label} ({len(orders)}):\n\n"
        for order in orders[:10]:
            status_label = {
                "pending": "⏳ Menunggu Pembayaran",
                "paid": "✅ Dibayar",
                "shipped": "🚚 Dikirim",
                "completed": "✔️ Selesai",
                "cancelled": "❌ Dibatalkan"
            }.get(order.get('status'), order.get('status'))

            result += f"• Order #{order.get('id')}\n"
            result += f"  Total: Rp {_num(order.get('total')):,.0f}\n"
            result += f"  Status: {status_label}\n"
            result += f"  Metode Bayar: {order.get('payment_method', '-')}\n"
            result += f"  🔗 Link: {adapter.order_link(order.get('id'))}\n\n"

        # Per user policy: no orders-list LINK_CARD in chat. LINK_CARDs
        # are reserved for post-checkout order confirmation (checkout())
        # and per-order detail (get_order_detail()), plus review cards.

        return result

    except Exception as e:
        logging.error(f"Get orders error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def get_order_detail(order_id: int, source: str) -> str:
    """
    Get detailed information about a specific order by order ID, on a
    specific store.

    Args:
        order_id: the order's ID
        source: store code, e.g. "oren" or "hijau"
    """
    adapter, account, error = _resolve_account(source)
    if error:
        return error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label} buat liat detail pesanan."

    try:
        order = await adapter.get_order_detail(account["token"], order_id)

        if not order:
            return f"Order #{order_id} gak ditemukan di {adapter.label}."

        status_label = {
            "pending": "⏳ Menunggu Pembayaran",
            "paid": "✅ Dibayar",
            "shipped": "🚚 Dikirim",
            "completed": "✔️ Selesai",
            "cancelled": "❌ Dibatalkan"
        }.get(order.get('status'), order.get('status'))

        result = f"📦 Detail Order #{order.get('id')} ({adapter.label}):\n\n"
        result += f"📋 Status: {status_label}\n"
        result += f"💳 Metode Bayar: {order.get('payment_method', '-')}\n"
        result += f"💰 Total: Rp {_num(order.get('total')):,.0f}\n\n"
        result += "🛍️ Produk yang dipesan:\n"

        items = order.get("order_items", [])
        for item in items:
            price_at_purchase = _num(item.get('price_at_purchase'))
            subtotal = price_at_purchase * item.get('quantity', 1)
            result += f"• {item.get('name_snapshot', 'Unknown')}\n"
            result += f"  {item.get('quantity')}x Rp {price_at_purchase:,.0f} = Rp {subtotal:,.0f}\n"

        # Per user policy: no order-detail LINK_CARD in chat here.
        # LINK_CARDs are reserved for post-checkout order confirmation
        # (checkout() tool) and review cards. If the user wants to click
        # through an existing order, they can use the "Pesanan" button in
        # the sidebar.

        if order.get('status') == 'pending':
            result += f"\n\n⚠️ Pesanan ini belum dibayar. Mau bayar sekarang?"

        return result

    except Exception as e:
        logging.error(f"Get order detail error: {e}")
        return f"Error: {str(e)}"


@function_tool
async def pay_order(order_id: int, source: str) -> str:
    """
    Pay for a pending order on a specific store. Only works for orders with
    'pending' status.

    Args:
        order_id: the order's ID
        source: store code, e.g. "oren" or "hijau"

    ⚠️ This action requires voice verification for security.
    """
    voice_error = require_voice_verification("bayar order")
    if voice_error:
        return voice_error

    adapter, account, error = _resolve_account(source)
    if error:
        return error

    if not account["is_logged_in"]:
        return f"Lo harus login dulu ke {adapter.label} sebelum bayar."

    try:
        order_data = await adapter.get_order_detail(account["token"], order_id)

        if not order_data:
            return f"Order #{order_id} gak ditemukan di {adapter.label}."

        if order_data.get("status") != "pending":
            status_label = {
                "paid": "sudah dibayar",
                "shipped": "sudah dikirim",
                "completed": "sudah selesai",
                "cancelled": "sudah dibatalkan"
            }.get(order_data.get('status'), order_data.get('status'))
            return f"Order #{order_id} {status_label}, gak bisa dibayar lagi."

        result = await adapter.pay_order(account["token"], order_id)

        if result["success"]:
            return (
                f"🎉 Pembayaran berhasil!\nOrder #{order_id} di {adapter.label} sudah dibayar.\n"
                f"Total: Rp {_num(order_data.get('total')):,.0f}"
            )

        return "Pembayaran gagal. Coba lagi nanti."

    except Exception as e:
        logging.error(f"Pay order error: {e}")
        return f"Error: {str(e)}"
