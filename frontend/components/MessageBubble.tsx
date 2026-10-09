"use client";

// Chat bubble component for rendering user and assistant messages.

import Image from "next/image";

import { Message } from "@/types";

interface MessageBubbleProps {
    message: Message;
    userName?: string;
}

export default function MessageBubble({
    message,
    userName = "You",
}: MessageBubbleProps) {
    const { role, text } = message;
    const isUser = role === "user";

    return (
        <div
            className={`flex gap-3 animate-fadeIn ${
                isUser ? "justify-end" : "justify-start"
            }`}>
            <div
                className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-2 mb-1">
                    {!isUser && (
                        <Image
                            src="/icons/Happy_Polos.png"
                            alt="Happy"
                            width={14}
                            height={14}
                            style={{ width: "auto", height: "auto" }}
                            className="opacity-70"
                        />
                    )}
                    <span className="text-sm text-muted-foreground">
                        {isUser ? userName : "Happy"}
                    </span>
                </div>

                <div
                    className={`px-4 py-3 rounded-2xl max-w-4xl wrap-break-words ${
                        isUser
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted text-foreground rounded-bl-md"
                    }`}>
                    <p className="text-base leading-relaxed">{text}</p>
                </div>
            </div>
        </div>
    );
}
