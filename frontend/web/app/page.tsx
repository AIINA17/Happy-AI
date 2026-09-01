"use client";

// Main authenticated chat page for the voice shopping assistant.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";

import ChatArea from "@/components/ChatArea";
import Sidebar from "@/components/Sidebar";
import { useVerificationToast } from "@/hooks/useVerificationToast";
import { supabase } from "@/lib/supabase";
import { Message, Product } from "@/types";

type VerificationStatus = "VERIFIED" | "REPEAT" | "DENIED" | null;

export default function Home() {
    const router = useRouter();

    // Auth state
    const [session, setSession] = useState<Session | null>(null);
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // Chat state
    const [messages, setMessages] = useState<Message[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [products, setProducts] = useState<Product[]>([]);

    // Voice state
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [speakingRole, setSpeakingRole] = useState<"user" | "agent" | null>(
        null,
    );

    // Status
    const [, setVerifyStatus] = useState("Idle");
    const [, setRoomStatus] = useState("Not connected");
    const [, setScore] = useState<number | null>(null);

    const [verificationResult, setVerificationResult] = useState<{
        status: VerificationStatus;
        score: number | null;
        reason: string | null;
    }>({ status: null, score: null, reason: null });

    const [currentSessionId, setCurrentSessionId] = useState<string | null>(
        null,
    );

    const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0);

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

        // Listen for auth changes
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

    const addMessage = (role: "user" | "assistant", text: string) => {
        if (!text || text.trim() === "") return;

        const newMessage: Message = {
            role,
            text: text.trim(),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, newMessage]);
    };

    const handleProductCards = (newProducts: Product[]) => {
        setProducts(newProducts);
    };

    const clearVerificationResult = useCallback(() => {
        setVerificationResult({ status: null, score: null, reason: null });
    }, []);

    useVerificationToast(verificationResult, clearVerificationResult);

    const handleSelectSession = (sessionId: string) => {
        setCurrentSessionId(sessionId);
        router.push(`/history/${sessionId}`);
    };

    const handleNewChat = () => {
        setCurrentSessionId(null);
        setMessages([]);
        setProducts([]);
        setSessionsRefreshKey((key) => key + 1);
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
            <main className="h-screen bg-background flex items-center justify-center">
                <div className="text-muted-foreground">Loading...</div>
            </main>
        );
    }

    if (!isLoggedIn) {
        return (
            <main className="h-screen bg-background flex items-center justify-center">
                <div className="text-muted-foreground">
                    Redirecting to login...
                </div>
            </main>
        );
    }

    return (
        <main className="h-screen bg-background flex overflow-hidden">
            <Sidebar
                isLoggedIn={isLoggedIn}
                userEmail={session?.user?.email || ""}
                onLogout={handleLogout}
                token={session?.access_token || null}
                setVerifyStatus={setVerifyStatus}
                currentSessionId={currentSessionId}
                onSelectSession={handleSelectSession}
                onNewChat={handleNewChat}
                refreshKey={sessionsRefreshKey}
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
                addMessage={addMessage}
                onProductCards={handleProductCards}
                setVerifyStatus={setVerifyStatus}
                setRoomStatus={setRoomStatus}
                setScore={setScore}
                setVerificationResult={setVerificationResult}
                onEndChat={handleNewChat}
            />
        </main>
    );
}
