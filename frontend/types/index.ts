export interface Store {
  id: number;
  name: string;
  city: string;
  address?: string;
  created_at?: string;
}

export interface Review {
  id: number;
  product_id: number;
  reviewer_name: string;
  rating: number;
  comment: string;
  created_at: string;
}

// A product/cart/order link the agent wants the user to be able to click,
// sent as its own LINK_CARD data message (see backend/agent/tools.py's
// _send_link_card_internal) instead of relying on Gemini's spoken reply
// text to carry the raw URL.
export interface LinkCard {
  label: string;
  url: string;
}

export interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  reviews?: Review[];
  reviewProductName?: string;
  linkCard?: LinkCard;
}

export interface Product {
    id: number;
    name: string;
    price: number;
    rating: number;
    category: string;
    image_url?: string;
    // Optional image gallery. ProductCarousel uses this for the auto-rotating
    // image slideshow. Falls back to [image_url] when the backend only sends
    // a single thumbnail.
    images?: string[];
    stock: number;
    // Which e-commerce store this came from (see backend/ecommerce_sources.py)
    // — search_product now queries every registered store at once, so cards
    // can mix products from different sources.
    source?: string;
    source_label?: string;
    link?: string;
    store?: Store | null;
}

export interface AgentCommand {
  type: string;
  action?: string;
  products?: Product[];
  reviews?: Review[];
  product_name?: string;
  text?: string;
  role?: string;
  label?: string;
  url?: string;
  [key: string]: unknown;
}

export interface VerificationResult {
  decision: string;
  reason: string | null;
  best_label: string | null;
  verified: boolean;
  status: string;
  score: number;
  spoof_prob?: number;
}
