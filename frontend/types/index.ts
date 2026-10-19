// Shared TypeScript interfaces for chat messages, products, and verification.

export interface Message {
    role: "user" | "assistant";
    text: string;
    timestamp: Date;
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
}

export interface AgentCommand {
    type: string;
    action?: string;
    products?: Product[];
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
