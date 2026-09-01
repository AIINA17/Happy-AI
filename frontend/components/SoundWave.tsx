"use client";

// Simple animated sound wave visuals used in voice-related UI.

interface SoundWaveProps {
    variant?: "default" | "small";
    color?: string;
}

export default function SoundWave({
    variant = "default",
    color = "var(--accent-primary)",
}: SoundWaveProps) {
    const barCount = variant === "small" ? 5 : 7;

    return (
        <div className="flex items-center justify-center gap-1 h-8">
            {Array.from({ length: barCount }).map((_, index) => (
                <div
                    key={index}
                    className="soundwave-bar"
                    style={{
                        backgroundColor: color,
                        animationDelay: `${index * 0.1}s`,
                        height: "8px",
                    }}
                />
            ))}
        </div>
    );
}

export function SoundWaveAnimated({ color = "#D97757" }: { color?: string }) {
    return (
        <div className="flex items-end justify-center gap-0.75 h-8">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div
                    key={i}
                    className="w-1 rounded-full animate-soundwave"
                    style={{
                        backgroundColor: color,
                        animationDelay: `${i * 0.1}s`,
                    }}
                />
            ))}
        </div>
    );
}

export function SoundWaveStatic({ color = "#D97757" }: { color?: string }) {
    const heights = [8, 16, 24, 20, 24, 16, 8];

    return (
        <div className="flex items-end justify-center gap-0.75 h-8">
            {heights.map((height, i) => (
                <div
                    key={i}
                    className="w-1 rounded-full"
                    style={{
                        backgroundColor: color,
                        height: `${height}px`,
                    }}
                />
            ))}
        </div>
    );
}
