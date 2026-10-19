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

export interface Message {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  reviews?: Review[];
  reviewProductName?: string;
}

export interface Product {
    id: number;
    name: string;
    price: number;
    rating: number;
    category: string;
    image_url?: string;
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
