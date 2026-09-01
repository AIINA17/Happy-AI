"use client";

// Minimal typing indicator bubble used when the agent is generating a reply.

export default function TypingIndicator() {
    return (
        <div className="flex gap-3 self-start max-w-[80%] animate-fadeIn">
            <div className="flex flex-col gap-1 items-start">
                <div className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Listening
                </div>

                <div className="px-4 py-3 rounded-2xl bg-muted rounded-bl-md">
                    <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                            <div
                                key={i}
                                className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-typing"
                                style={{ animationDelay: `${i * 0.2}s` }}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
