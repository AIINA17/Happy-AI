"use client";

// History detail page for viewing a specific conversation by session id.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";

import ChatArea from "@/components/ChatArea";
import Sidebar from "@/components/Sidebar";
import VerificationToast from "@/components/VerificationToast";
import { supabase } from "@/lib/supabase";
import { Message, Product } from "@/types";

function normalizePublicServerUrl(raw: string | undefined) {
    const trimmed = raw?.trim();
    if (!trimmed) return null;

    const normalized = trimmed.replace(/\/+$/, "");
    if (normalized.startsWith("/")) {
        if (typeof window === "undefined") return null;
        return `${window.location.origin}${normalized}`;
    }

    try {
        new URL(normalized);
        return normalized;
    } catch {
        return null;
    }
}

function logFetchHint(params: {
    endpoint: string;
    baseUrl: string | null;
    err: unknown;
}) {
    const { endpoint, baseUrl, err } = params;

    if (typeof window !== "undefined" && baseUrl) {
        try {
            const apiUrl = new URL(baseUrl);
            if (
                window.location.protocol === "https:" &&
                apiUrl.protocol === "http:"
            ) {
                console.error(
                    `[History] Mixed content: page is HTTPS but API is HTTP. '${endpoint}' will be blocked by the browser. Use an https:// API URL or serve the site over http:// during dev.`,
                    err,
                );
                return;
            }
            if (apiUrl.hostname === "backend") {
                console.error(
                    `[History] API hostname is 'backend' (Docker service name). Browsers usually can't resolve that. Set NEXT_PUBLIC_SERVER_URL to something reachable from the browser, e.g. 'http://localhost:8000'.`,
                    err,
                );
                return;
            }
        } catch {
            // ignore
        }
    }

    console.error(
        `[History] Failed to fetch '${endpoint}'. Check NEXT_PUBLIC_SERVER_URL and backend CORS settings.`,
        err,
    );
}

export default function HistoryDetailPage() {
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const sessionId = params.id;

    const [session, setSession] = useState<Session | null>(null);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const [messages, setMessages] = useState<Message[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const [isConnected, setIsConnected] = useState(false);

    const [isSpeaking, setIsSpeaking] = useState(false);
    const [speakingRole, setSpeakingRole] = useState<"user" | "agent" | null>(
        null,
    );

    const [, setVerifyStatus] = useState("Idle");
    const [, setRoomStatus] = useState("Not connected");
    const [, setScore] = useState<number | null>(null);

    const [verificationResult, setVerificationResult] = useState<{
        status: "VERIFIED" | "REPEAT" | "DENIED" | null;
        score: number | null;
        reason: string | null;
    }>({ status: null, score: null, reason: null });

    const [currentSessionId, setCurrentSessionId] = useState<string | null>(
        null,
    );

    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;
    const apiBaseUrl = normalizePublicServerUrl(SERVER_URL);

    useEffect(() => {
        const checkSession = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (session) {
                setSession(session);
                setIsLoggedIn(true);
            } else {
                setIsLoggedIn(false);
                router.replace("/login");
            }

            setIsLoading(false);
        };

        checkSession();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            const loggedIn = !!session;
            setIsLoggedIn(loggedIn);

            if (!loggedIn) {
                router.replace("/login");
            }
        });

        return () => subscription.unsubscribe();
    }, [router]);

    useEffect(() => {
        const loadSession = async () => {
            if (!session?.access_token || !apiBaseUrl || !sessionId) return;

            setCurrentSessionId(sessionId);

            try {
                const res = await fetch(
                    `${apiBaseUrl}/logs/sessions/${sessionId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${session.access_token}`,
                        },
                    },
                );
                if (!res.ok) return;
                const data = await res.json();

                const newMessages: Message[] = (data.logs || []).map(
                    (log: {
                        role: "user" | "assistant";
                        content: string;
                        created_at: string;
                    }) => ({
                        role: log.role,
                        text: log.content,
                        timestamp: new Date(log.created_at),
                    }),
                );

                const allProducts: Product[] = (
                    data.product_cards || []
                ).flatMap(
                    (card: { products?: Product[] }) => card.products || [],
                );

                setMessages(newMessages);
                setProducts(allProducts);
                setIsConnected(false); // pastikan selalu history mode
            } catch (error) {
                logFetchHint({
                    endpoint: "/logs/sessions/:id",
                    baseUrl: apiBaseUrl,
                    err: error,
                });
            }
        };

        loadSession();
    }, [apiBaseUrl, session, sessionId]);

    const clearVerificationResult = useCallback(() => {
        setVerificationResult({ status: null, score: null, reason: null });
    }, []);

    const handleSelectSession = async (newSessionId: string) => {
        router.replace(`/history/${newSessionId}`);
    };

    const handleNewChat = () => {
        router.replace("/");
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setSession(null);
        setIsLoggedIn(false);
        setMessages([]);
        setProducts([]);
        setIsConnected(false);
        setCurrentSessionId(null);
        router.replace("/login");
    };

    if (isLoading) {
        return (
            <main className="h-screen bg-(--bg-primary) flex items-center justify-center">
                <div className="text-(--text-secondary)">Loading...</div>
            </main>
        );
    }

    if (!isLoggedIn) {
        return (
            <main className="h-screen bg-(--bg-primary) flex items-center justify-center">
                <div className="text-(--text-secondary)">
                    Redirecting to login...
                </div>
            </main>
        );
    }

    return (
        <main className="h-screen bg-(--bg-primary) flex overflow-hidden">
            <VerificationToast
                status={verificationResult.status}
                score={verificationResult.score}
                reason={verificationResult.reason}
                onClose={clearVerificationResult}
            />

            <Sidebar
                isLoggedIn={isLoggedIn}
                userEmail={session?.user?.email || ""}
                onLogout={handleLogout}
                token={session?.access_token || null}
                setVerifyStatus={setVerifyStatus}
                currentSessionId={currentSessionId || sessionId}
                onSelectSession={handleSelectSession}
                onNewChat={handleNewChat}
            />

            <ChatArea
                messages={messages}
                products={products}
                isLoggedIn={isLoggedIn}
                token={session?.access_token || null}
                isConnected={isConnected}
                isTyping={isTyping}
                isSpeaking={isSpeaking}
                speakingRole={speakingRole}
                setMessages={setMessages}
                setIsConnected={setIsConnected}
                setIsTyping={setIsTyping}
                setIsSpeaking={setIsSpeaking}
                setSpeakingRole={setSpeakingRole}
                addMessage={() => {}}
                onProductCards={(p) => setProducts(p)}
                setVerifyStatus={setVerifyStatus}
                setRoomStatus={setRoomStatus}
                setScore={setScore}
                setVerificationResult={setVerificationResult}
                isViewingHistory
            />
        </main>
    );
}
