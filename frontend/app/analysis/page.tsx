"use client";

// Hidden analysis dashboard: reachable only by typing /analysis directly.
// Nothing in the app links here.

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

interface SpectrogramProfile {
    id: string;
    label: string;
    created_at: string;
    spectrogram_url: string | null;
}

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

export default function AnalysisPage() {
    const router = useRouter();

    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [profiles, setProfiles] = useState<SpectrogramProfile[]>([]);
    const [isFetching, setIsFetching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const apiBaseUrl = normalizePublicServerUrl(
        process.env.NEXT_PUBLIC_SERVER_URL,
    );

    useEffect(() => {
        const checkSession = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (session) {
                setSession(session);
            } else {
                router.replace("/login");
            }

            setIsLoading(false);
        };

        checkSession();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            if (!session) router.replace("/login");
        });

        return () => subscription.unsubscribe();
    }, [router]);

    useEffect(() => {
        const loadSpectrograms = async () => {
            if (!session?.access_token) return;

            if (!apiBaseUrl) {
                setError(
                    "NEXT_PUBLIC_SERVER_URL belum dikonfigurasi (contoh: http://localhost:8000).",
                );
                return;
            }

            setIsFetching(true);
            setError(null);

            try {
                const res = await fetch(`${apiBaseUrl}/spectrograms`, {
                    headers: {
                        Authorization: `Bearer ${session.access_token}`,
                    },
                });

                const data = await res.json().catch(() => null);

                if (!res.ok || data?.status !== "OK") {
                    setError(
                        data?.detail || `Gagal memuat data (${res.status}).`,
                    );
                    return;
                }

                setProfiles(data.profiles || []);
            } catch {
                setError(
                    "Tidak bisa menghubungi backend. Periksa NEXT_PUBLIC_SERVER_URL dan CORS.",
                );
            } finally {
                setIsFetching(false);
            }
        };

        loadSpectrograms();
    }, [apiBaseUrl, session]);

    if (isLoading) {
        return (
            <main className="h-screen bg-(--bg-primary) flex items-center justify-center">
                <div className="text-(--text-secondary)">Loading...</div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-(--bg-primary) overflow-y-auto">
            <div className="max-w-5xl mx-auto px-6 py-10">
                <header className="mb-8">
                    <h1 className="text-2xl font-semibold text-(--text-primary)">
                        Analysis Dashboard
                    </h1>
                    <p className="text-sm text-(--text-muted) mt-1">
                        Spektrogram tiap suara terdaftar milik{" "}
                        {session?.user?.email}
                    </p>
                </header>

                {error && (
                    <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                        {error}
                    </div>
                )}

                {isFetching && (
                    <p className="text-sm text-(--text-muted)">
                        Memuat spektrogram...
                    </p>
                )}

                {!isFetching && !error && profiles.length === 0 && (
                    <p className="text-sm text-(--text-muted)">
                        Belum ada voice enrollment.
                    </p>
                )}

                <div className="space-y-6">
                    {profiles.map((profile) => (
                        <section
                            key={profile.id}
                            className="p-5 rounded-2xl bg-(--bg-card) border border-(--border-color)/20">
                            <div className="flex items-baseline justify-between mb-4">
                                <h2 className="text-lg font-medium text-(--text-primary)">
                                    {profile.label}
                                </h2>
                                <span className="text-xs text-(--text-muted)">
                                    {new Date(
                                        profile.created_at,
                                    ).toLocaleString("id-ID")}
                                </span>
                            </div>

                            {profile.spectrogram_url ? (
                                <Image
                                    src={profile.spectrogram_url}
                                    alt={`Spektrogram ${profile.label}`}
                                    width={1200}
                                    height={500}
                                    unoptimized
                                    className="w-full h-auto rounded-lg bg-white"
                                />
                            ) : (
                                <p className="text-sm text-(--text-muted)">
                                    Spektrogram belum tersedia untuk enrollment
                                    ini. Hapus lalu enroll ulang suaranya untuk
                                    membuat spektrogram.
                                </p>
                            )}
                        </section>
                    ))}
                </div>
            </div>
        </main>
    );
}
