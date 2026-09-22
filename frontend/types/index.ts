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
