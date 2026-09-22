"use client";

// Controls for joining LiveKit, driving the voice button and status.

import React, { useEffect } from "react";

import VoiceButton from "./VoiceButton";
import { useLiveKit } from "@/hooks/useLiveKit";
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
}: LiveKitControlsProps) {
    const {
        toggleRoom,
        uiState,
        isConnected: hookIsConnected,
        isAgentSpeaking,
    } = useLiveKit({
        token,
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
        setIsTyping(uiState === "RECORDING" || uiState === "VERIFYING");
    }, [uiState, setIsTyping]);

    useEffect(() => {
        setIsAgentSpeaking(isAgentSpeaking);
    }, [isAgentSpeaking, setIsAgentSpeaking]);

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

    return (
        <div className="space-y-4 justify-center items-center flex flex-col">
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
