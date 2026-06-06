"use client";

// Custom hook encapsulating LiveKit room join, audio recording, and verification.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Room, RoomEvent, Track, createLocalAudioTrack } from "livekit-client";

import { supabase } from "@/lib/supabase";
import { Product, VerificationResult } from "@/types";

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

function buildApiUrl(baseUrl: string | null, path: string) {
    if (!baseUrl) return null;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
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
                    `[useLiveKit] Mixed content: page is HTTPS but API is HTTP. '${endpoint}' will be blocked by the browser. Use an https:// API URL or serve the site over http:// during dev.`,
                    err,
                );
                return;
            }
            if (apiUrl.hostname === "backend") {
                console.error(
                    `[useLiveKit] API hostname is 'backend' (Docker service name). Browsers usually can't resolve that. Set NEXT_PUBLIC_SERVER_URL to something reachable from the browser, e.g. 'http://localhost:8000'.`,
                    err,
                );
                return;
            }
        } catch {
            // ignore
        }
    }

    console.error(
        `[useLiveKit] Failed to fetch '${endpoint}'. Check NEXT_PUBLIC_SERVER_URL and backend CORS settings.`,
        err,
    );
}

type UiState =
    | "IDLE"
    | "CONNECTING"
    | "LISTENING"
    | "RECORDING"
    | "VERIFYING"
    | "CHATTING";

type VerificationStatus = "VERIFIED" | "REPEAT" | "DENIED" | null;

interface UseLiveKitProps {
    token: string | null;
    onMessage: (role: "user" | "assistant", text: string) => void;
    onVerifyStatus: (status: string) => void;
    onRoomStatus: (status: string) => void;
    onScore: (score: number | null) => void;
    onProductCards?: (products: Product[]) => void;
    onVerificationResult?: (
        status: VerificationStatus,
        score: number | null,
        reason: string | null,
    ) => void;
}

export function useLiveKit({
    token,
    onMessage,
    onVerifyStatus,
    onRoomStatus,
    onScore,
    onProductCards,
    onVerificationResult,
}: UseLiveKitProps) {
    const roomRef = useRef<Room | null>(null);
    const isJoiningRef = useRef(false);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const rafRef = useRef<number | null>(null);

    const [uiState, setUiState] = useState<UiState>("IDLE");
    const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);

    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;
    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL!;

    const apiBaseUrl = useMemo(
        () => normalizePublicServerUrl(SERVER_URL),
        [SERVER_URL],
    );

    const onMessageRef = useRef(onMessage);
    const onVerifyStatusRef = useRef(onVerifyStatus);
    const onRoomStatusRef = useRef(onRoomStatus);
    const onScoreRef = useRef(onScore);
    const onProductCardsRef = useRef(onProductCards);
    const onVerificationResultRef = useRef(onVerificationResult);
    const tokenRef = useRef(token);

    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);
    useEffect(() => {
        onVerifyStatusRef.current = onVerifyStatus;
    }, [onVerifyStatus]);
    useEffect(() => {
        onRoomStatusRef.current = onRoomStatus;
    }, [onRoomStatus]);
    useEffect(() => {
        onScoreRef.current = onScore;
    }, [onScore]);
    useEffect(() => {
        onProductCardsRef.current = onProductCards;
    }, [onProductCards]);
    useEffect(() => {
        onVerificationResultRef.current = onVerificationResult;
    }, [onVerificationResult]);
    useEffect(() => {
        tokenRef.current = token;
    }, [token]);

    /* ================= HANDLE AGENT DATA ================= */

    const handleAgentDataRef = useRef((payload: Uint8Array) => {
        const text = new TextDecoder().decode(payload).trim();
        if (!text.startsWith("{")) return;

        let msg: {
            type?: string;
            action?: string;
            products?: Product[];
            text?: string;
            role?: string;
        };
        try {
            msg = JSON.parse(text);
        } catch {
            return;
        }

        if (msg.type === "VOICE_CMD" && msg.action === "START_RECORD") {
            startVADRecordingRef.current();
            return;
        }

        if (msg.type === "PRODUCT_CARDS" && msg.products) {
            onProductCardsRef.current?.(msg.products);
            return;
        }

        if (msg.type === "AGENT_MESSAGE" && msg.text) {
            onMessageRef.current("assistant", msg.text);
            return;
        }

        if (msg.type === "USER_MESSAGE" && msg.text) {
            onMessageRef.current("user", msg.text);
        }
    });

    /* ================= VOICE RECORDING ================= */

    const startVADRecordingRef = useRef(async () => {
        if (recorderRef.current) return;
        if (!tokenRef.current) {
            onVerifyStatusRef.current("❌ Login dulu sebelum verifikasi");
            return;
        }

        setUiState("LISTENING");
        onVerifyStatusRef.current("🎧 Silakan bicara...");

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);

        const buffer = new Uint8Array(analyser.fftSize);

        const recorder = new MediaRecorder(stream, {
            mimeType: "audio/webm;codecs=opus",
        });

        recorderRef.current = recorder;
        chunksRef.current = [];

        let recording = false;
        let silenceStart: number | null = null;

        const START = 0.015;
        const STOP = 0.01;
        const SILENCE_MS = 800;

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            recorderRef.current = null;

            stream.getTracks().forEach((t) => t.stop());
            audioCtx.close();

            if (!chunksRef.current.length) return;

            setUiState("VERIFYING");
            onVerifyStatusRef.current("🔐 Memverifikasi suara...");

            await sendForVerificationRef.current(
                new Blob(chunksRef.current, { type: "audio/webm;codecs=opus" }),
            );
        };

        const loop = () => {
            analyser.getByteTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) {
                const v = (buffer[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / buffer.length);

            if (!recording && rms > START) {
                recorder.start();
                recording = true;
                setUiState("RECORDING");
            }

            if (recording) {
                if (rms < STOP) {
                    silenceStart ??= performance.now();
                    if (performance.now() - silenceStart > SILENCE_MS) {
                        recorder.stop();
                        return;
                    }
                } else {
                    silenceStart = null;
                }
            }

            rafRef.current = requestAnimationFrame(loop);
        };

        loop();
    });

    /* ================= VERIFY ================= */

    const sendForVerificationRef = useRef(async (blob: Blob) => {
        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token;

        if (!accessToken) {
            onVerifyStatusRef.current("❌ Login dulu sebelum verifikasi");
            return;
        }

        const form = new FormData();
        form.append("audio", blob, "voice.webm");

        const url = buildApiUrl(apiBaseUrl, "/verify-voice");
        if (!url) {
            onVerifyStatusRef.current(
                "❌ Server URL belum dikonfigurasi (NEXT_PUBLIC_SERVER_URL)",
            );
            setUiState("CHATTING");
            return;
        }

        let res: Response;
        try {
            res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
                body: form,
            });
        } catch (err) {
            logFetchHint({
                endpoint: "/verify-voice",
                baseUrl: apiBaseUrl,
                err,
            });
            onVerifyStatusRef.current("❌ Gagal konek server verifikasi");
            setUiState("CHATTING");
            return;
        }

        const result: VerificationResult = await res.json().catch(
            () =>
                ({
                    status: "DENIED",
                    score: null,
                    reason: "Invalid response from server",
                }) as VerificationResult,
        );
        onScoreRef.current(result.score ?? null);

        const status = result.status as VerificationStatus;
        onVerificationResultRef.current?.(
            status,
            result.score ?? null,
            result.reason ?? null,
        );

        await roomRef.current?.localParticipant.publishData(
            new TextEncoder().encode(
                JSON.stringify({
                    decision: result.status,
                    score: result.score,
                    ts: Date.now(),
                }),
            ),
            { reliable: true, topic: "VOICE_RESULT" },
        );

        setUiState("CHATTING");
    });

    /* ================= JOIN ROOM ================= */

    const joinRoom = useCallback(async () => {
        if (isJoiningRef.current) return;
        isJoiningRef.current = true;

        try {
            setUiState("CONNECTING");
            onRoomStatusRef.current("⏳ Connecting…");

            const {
                data: { session },
            } = await supabase.auth.getSession();
            const accessToken = session?.access_token;

            if (!accessToken) {
                onRoomStatusRef.current("❌ Belum login");
                setUiState("IDLE");
                isJoiningRef.current = false;
                return;
            }

            const url = buildApiUrl(apiBaseUrl, "/join-token");
            if (!url) {
                onRoomStatusRef.current(
                    "❌ Server URL belum dikonfigurasi (NEXT_PUBLIC_SERVER_URL)",
                );
                setUiState("IDLE");
                isJoiningRef.current = false;
                return;
            }

            let res: Response;
            try {
                res = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${accessToken}`,
                    },
                });
            } catch (err) {
                logFetchHint({
                    endpoint: "/join-token",
                    baseUrl: apiBaseUrl,
                    err,
                });
                onRoomStatusRef.current("❌ Gagal konek server");
                setUiState("IDLE");
                isJoiningRef.current = false;
                return;
            }

            if (!res.ok) {
                onRoomStatusRef.current("❌ Gagal ambil token");
                setUiState("IDLE");
                isJoiningRef.current = false;
                return;
            }

            const { token: lkToken } = await res.json();

            const room = new Room({ adaptiveStream: true, dynacast: true });
            roomRef.current = room;

            room.on(RoomEvent.Connected, () => {
                onRoomStatusRef.current("✅ Connected");
                setUiState("CHATTING");
            });

            room.on(RoomEvent.Disconnected, () => {
                isJoiningRef.current = false;
                setIsAgentSpeaking(false);
                onRoomStatusRef.current("🔌 Disconnected");
                setUiState("IDLE");
                roomRef.current = null;
            });

            room.on(RoomEvent.DataReceived, (payload, _, __) => {
                handleAgentDataRef.current(payload);
            });

            room.on(RoomEvent.TrackSubscribed, (track) => {
                if (track.kind === Track.Kind.Audio) {
                    const el = track.attach();
                    document.body.appendChild(el);
                    el.play().catch(() => {});
                    setIsAgentSpeaking(true);
                    el.onended = () => setIsAgentSpeaking(false);
                    el.onpause = () => setIsAgentSpeaking(false);
                }
            });

            room.on(RoomEvent.TrackUnsubscribed, (track) => {
                if (track.kind === Track.Kind.Audio) {
                    setIsAgentSpeaking(false);
                }
            });

            room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
                const agentSpeaking = speakers.some(
                    (s) => s.identity !== room.localParticipant.identity,
                );
                setIsAgentSpeaking(agentSpeaking);
            });

            await room.connect(LIVEKIT_URL, lkToken);

            const micTrack = await createLocalAudioTrack();
            await room.localParticipant.publishTrack(micTrack);
        } catch (err) {
            console.error("Join error:", err);
            isJoiningRef.current = false;
            setUiState("IDLE");
            onRoomStatusRef.current("❌ Connection error");
        }
    }, [SERVER_URL, LIVEKIT_URL]);

    /* ================= LEAVE ROOM ================= */

    const leaveRoom = useCallback(async () => {
        if (roomRef.current) {
            await roomRef.current.disconnect();
            roomRef.current = null;
        }

        if (recorderRef.current) {
            recorderRef.current.stop();
            recorderRef.current = null;
        }

        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }

        isJoiningRef.current = false;
        setIsAgentSpeaking(false);
        setUiState("IDLE");
        onRoomStatusRef.current("🔌 Disconnected");
    }, []);

    const toggleRoom = useCallback(async () => {
        if (uiState === "IDLE") {
            await joinRoom();
        } else {
            await leaveRoom();
        }
    }, [uiState, joinRoom, leaveRoom]);

    const isConnected = uiState !== "IDLE" && uiState !== "CONNECTING";

    return {
        joinRoom,
        leaveRoom,
        toggleRoom,
        uiState,
        isConnected,
        isAgentSpeaking,
    };
}
