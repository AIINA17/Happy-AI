"use client";

// Controls for joining LiveKit, driving the voice button and status.

import React, { useEffect } from "react";
import Image from "next/image";
import { Mic, MicOff, MessageCircle } from "lucide-react";

import VoiceButton from "./VoiceButton";
import FaceLivenessCapture from "./FaceLivenessCapture";
import { useLiveKit } from "@/hooks/useLiveKit";
import { useUserLocation } from "@/hooks/useUserLocation";
import { useNotification } from "@/contexts/NotificationContext";
import { Product } from "@/types";

interface LiveKitControlsProps {
    token: string | null;
    setIsConnected: (value: boolean) => void;
    setRoomStatus: (status: string) => void;
    setVerifyStatus: (status: string) => void;
    setScore: (score: number | null) => void;
    setIsAgentSpeaking: (value: boolean) => void;
    addMessage: (role: "user" | "assistant", text: string) => void;
    onProductCards: (products: Product[]) => void;
    setIsTyping: (value: boolean) => void;
    setVerificationResult: (result: {
        status: "VERIFIED" | "REPEAT" | "DENIED" | null;
        score: number | null;
        reason: string | null;
    }) => void;
    onEndChat?: () => void;
    // When true, renders the full set of controls (mic + mute + chat toggle)
    // in the horizontal pill layout shown in voice/carousel mode. When false,
    // renders the classic single-button layout used elsewhere.
    showPillControls?: boolean;
    onToggleChatMode?: () => void;
    isChatMode?: boolean;
}

export default function LiveKitControls({
    token,
    setIsConnected,
    setRoomStatus,
    setVerifyStatus,
    setScore,
    setIsAgentSpeaking,
    addMessage,
    onProductCards,
    setIsTyping,
    setVerificationResult,
    onEndChat,
    showPillControls = false,
    onToggleChatMode,
    isChatMode = false,
}: LiveKitControlsProps) {
    const { city: userCity } = useUserLocation();

    const { notify } = useNotification();

    const {
        toggleRoom,
        uiState,
        isConnected: hookIsConnected,
        isAgentSpeaking,
        isAgentThinking,
        isAgentStuck,
        isMuted,
        toggleMute,
        faceVerifyOpen,
        faceVerifyUserId,
        onFaceVerifyResult,
    } = useLiveKit({
        token,
        userCity,
        onMessage: addMessage,
        onProductCards,
        onVerifyStatus: setVerifyStatus,
        onRoomStatus: setRoomStatus,
        onScore: setScore,
        onVerificationResult: (status, score, reason) =>
            setVerificationResult({ status, score, reason }),
    });

    useEffect(() => {
        setIsConnected(hookIsConnected);
    }, [hookIsConnected, setIsConnected]);

    useEffect(() => {
        setIsTyping(
            uiState === "RECORDING" ||
                uiState === "VERIFYING" ||
                uiState === "FACE_VERIFYING" ||
                isAgentThinking,
        );
    }, [uiState, isAgentThinking, setIsTyping]);

    useEffect(() => {
        setIsAgentSpeaking(isAgentSpeaking);
    }, [isAgentSpeaking, setIsAgentSpeaking]);

    // Backend watchdog says Happy has been silent too long after the user
    // spoke — surface it so users don't just stare at a dead-looking UI.
    useEffect(() => {
        if (!isAgentStuck) return;
        notify({
            variant: "warning",
            title: "Happy belum nyambung nih",
            description:
                "Koneksi suara agak tersendat. Coba ngomong lagi, atau tap tombol mic buat reset ya.",
            duration: 5000,
        });
    }, [isAgentStuck, notify]);

    const getButtonState = ():
        | "idle"
        | "connecting"
        | "connected"
        | "speaking" => {
        switch (uiState) {
            case "IDLE":
                return "idle";
            case "CONNECTING":
                return "connecting";
            case "RECORDING":
            case "LISTENING":
                return "speaking";
            case "CHATTING":
            case "VERIFYING":
            case "FACE_VERIFYING":
                return "connected";
            default:
                return "idle";
        }
    };

    const getStatusText = () => {
        switch (uiState) {
            case "CONNECTING":
                return "Menghubungkan...";
            case "LISTENING":
                return "Menunggu suara...";
            case "RECORDING":
                return "Merekam suara...";
            case "VERIFYING":
                return "Memverifikasi...";
            case "FACE_VERIFYING":
                return "Verifikasi wajah...";
            case "CHATTING":
                return "Terhubung dengan Happy";
            default:
                return "Klik untuk mulai";
        }
    };

    const getStatusColor = () => {
        switch (uiState) {
            case "CHATTING":
                return "text-green-500";
            case "RECORDING":
            case "VERIFYING":
            case "FACE_VERIFYING":
            case "LISTENING":
                return "text-primary";
            case "CONNECTING":
                return "text-yellow-500";
            default:
                return "text-muted-foreground";
        }
    };

    const handleClick = async () => {
        if (uiState === "IDLE") {
            await toggleRoom();
        } else {
            await toggleRoom();
            onEndChat?.();
        }
    };

    // ========== PILL CONTROLS LAYOUT (voice-first mode) ==========
    if (showPillControls) {
        const isActiveSession = hookIsConnected;
        return (
            <div className="flex flex-col items-center gap-3">
                <FaceLivenessCapture
                    userId={faceVerifyUserId}
                    open={faceVerifyOpen}
                    onOpenChange={() => {}}
                    onResult={onFaceVerifyResult}
                />

                {/* Soundwave previously rendered here above the pill
                    control. Removed per user request — the main animation
                    stays below the Happy mascot so the control area is
                    cleaner and the user focuses on the carousel. */}

                {/* 3-button pill: [Mute] [Mic big] [Chat toggle] */}
                <div className="flex items-center gap-3 bg-muted/60 backdrop-blur-sm
                                rounded-full p-1.5 border border-border/40">
                    {/* Mute toggle (only shows during active session) */}
                    <button
                        onClick={toggleMute}
                        disabled={!isActiveSession}
                        aria-label={isMuted ? "Unmute mic" : "Mute mic"}
                        title={isMuted ? "Unmute" : "Mute"}
                        className={`w-10 h-10 rounded-full flex items-center justify-center
                                   transition-all cursor-pointer
                                   disabled:opacity-30 disabled:cursor-not-allowed
                                   ${
                                       isMuted
                                           ? "bg-rose-500 text-white hover:bg-rose-600"
                                           : "bg-background text-muted-foreground hover:text-foreground hover:bg-background"
                                   }`}>
                        {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                    </button>

                    {/* Big main voice button — always uses the original
                        Mic.svg icon; only the ring/color feedback changes
                        with state. */}
                    <button
                        onClick={handleClick}
                        aria-label={
                            isActiveSession ? "End voice session" : "Start voice session"
                        }
                        className={`relative w-14 h-14 rounded-full flex items-center justify-center
                                   transition-all cursor-pointer shadow-lg bg-muted
                                   border-[3px] border-primary hover:scale-105 active:scale-95
                                   ${
                                       uiState === "CONNECTING"
                                           ? "animate-pulse"
                                           : ""
                                   }
                                   ${
                                       uiState === "RECORDING" || uiState === "LISTENING"
                                           ? "ring-4 ring-primary/30"
                                           : ""
                                   }`}>
                        <Image
                            src="/icons/Mic.svg"
                            alt="Mic"
                            width={20}
                            height={20}
                            style={{ width: "32px", height: "32px" }}
                            className="object-contain"
                        />
                    </button>

                    {/* Chat mode toggle */}
                    <button
                        onClick={onToggleChatMode}
                        aria-label={isChatMode ? "Back to voice mode" : "Open chat"}
                        title={isChatMode ? "Voice mode" : "Chat mode"}
                        className={`w-10 h-10 rounded-full flex items-center justify-center
                                   transition-all cursor-pointer
                                   ${
                                       isChatMode
                                           ? "bg-primary text-primary-foreground"
                                           : "bg-background text-muted-foreground hover:text-foreground"
                                   }`}>
                        <MessageCircle size={16} />
                    </button>
                </div>

                {/* Mini status */}
                <div className={`text-[0.7rem] ${getStatusColor()}`}>
                    {getStatusText()}
                </div>
            </div>
        );
    }

    // ========== CLASSIC LAYOUT (default) ==========
    return (
        <div className="space-y-4 justify-center items-center flex flex-col">
            {/* Agent-triggered face verification (fallback after 3x failed
                voice verification) — open/close is fully driven by
                faceVerifyOpen from the hook; onOpenChange here is a no-op
                because FaceLivenessCapture already reports its outcome via
                onFaceVerifyResult before it ever calls onOpenChange. */}
            <FaceLivenessCapture
                userId={faceVerifyUserId}
                open={faceVerifyOpen}
                onOpenChange={() => {}}
                onResult={onFaceVerifyResult}
            />

            {/* Voice Button - Always visible, changes based on state */}
            <VoiceButton state={getButtonState()} onClick={handleClick} />

            {/* Status Display */}
            <div className="flex items-center justify-center gap-2">
                <div
                    className={`w-2 h-2 rounded-full ${
                        uiState === "CHATTING"
                            ? "bg-green-500"
                            : uiState === "RECORDING" ||
                                uiState === "VERIFYING" ||
                                uiState === "FACE_VERIFYING" ||
                                uiState === "LISTENING"
                              ? "bg-primary animate-pulse"
                              : uiState === "CONNECTING"
                                ? "bg-yellow-500 animate-pulse"
                                : "bg-muted-foreground"
                    }`}
                />
                <span className={`text-sm ${getStatusColor()}`}>
                    {getStatusText()}
                </span>
            </div>
        </div>
    );
}
