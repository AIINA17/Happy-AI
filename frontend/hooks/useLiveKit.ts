"use client";

// Custom hook encapsulating LiveKit room join, audio recording, and verification.

import { useCallback, useEffect, useRef, useState } from "react";
import {
    Room,
    RoomEvent,
    Track,
    createLocalAudioTrack,
    type LocalAudioTrack,
} from "livekit-client";

import { supabase } from "@/lib/supabase";
import { Product, Review, VerificationResult } from "@/types";

type UiState =
    | "IDLE"
    | "CONNECTING"
    | "LISTENING"
    | "RECORDING"
    | "VERIFYING"
    | "FACE_VERIFYING"
    | "CHATTING";

type VerificationStatus = "VERIFIED" | "REPEAT" | "DENIED" | null;

interface UseLiveKitProps {
    token: string | null;
    userCity: string | null;
    onMessage: (
        role: "user" | "assistant",
        text: string,
        extras?: {
            reviews?: Review[];
            reviewProductName?: string;
        },
    ) => void;
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
    userCity,
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
    // The same track already published to LiveKit for the live conversation
    // — reused for voice-verification recording so we never open a second,
    // competing getUserMedia capture (see startVADRecordingRef).
    const micTrackRef = useRef<LocalAudioTrack | null>(null);

    const [uiState, setUiState] = useState<UiState>("IDLE");
    const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
    const [isAgentThinking, setIsAgentThinking] = useState(false);
    // Flipped on when the backend watchdog says Happy has been silent in
    // "thinking" state longer than STUCK_TIMEOUT_SEC — i.e. likely a dead
    // Gemini socket. The UI uses this to prompt the user to retry.
    const [isAgentStuck, setIsAgentStuck] = useState(false);
    // Mic mute — when true, stops streaming audio to the agent without
    // disconnecting from the room. Lets the user pause so background noise
    // doesn't keep triggering unintended turns.
    const [isMuted, setIsMuted] = useState(false);

    const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL!;
    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL!;

    const onMessageRef = useRef(onMessage);
    const onVerifyStatusRef = useRef(onVerifyStatus);
    const onRoomStatusRef = useRef(onRoomStatus);
    const onScoreRef = useRef(onScore);
    const onProductCardsRef = useRef(onProductCards);
    const onVerificationResultRef = useRef(onVerificationResult);
    const tokenRef = useRef(token);
    const userCityRef = useRef(userCity);

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
    useEffect(() => {
        userCityRef.current = userCity;
    }, [userCity]);

    const handleAgentDataRef = useRef(
        // 2nd arg is RoomEvent.DataReceived's topic — we don't use it,
        // but keep the signature so the callback matches the LiveKit SDK's
        // call shape without a type cast.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept to match RoomEvent.DataReceived's call signature above
        (payload: Uint8Array, _topic?: string) => {
            const text = new TextDecoder().decode(payload).trim();
            if (!text.startsWith("{")) return;

            let msg: {
                type?: string;
                action?: string;
                products?: Product[];
                reviews?: Review[];
                product_name?: string;
                text?: string;
                role?: string;
                active?: boolean;
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

            if (
                msg.type === "FACE_CMD" &&
                msg.action === "START_FACE_CAPTURE"
            ) {
                startFaceVerificationRef.current();
                return;
            }

            if (msg.type === "REVIEW_CARDS" && msg.reviews) {
                onMessageRef.current("assistant", "", {
                    reviews: msg.reviews,
                    reviewProductName: msg.product_name || "produk ini",
                });
                return;
            }

            if (msg.type === "AGENT_MESSAGE" && msg.text) {
                setIsAgentThinking(false);
                // Any real reply from Happy clears the "stuck" flag — the
                // socket is clearly alive again.
                setIsAgentStuck(false);
                onMessageRef.current("assistant", msg.text);
                return;
            }

            if (msg.type === "AGENT_THINKING") {
                setIsAgentThinking(!!msg.active);
                // Fresh thinking cycle starts clean — forget the previous
                // stuck state so the UI can show it again if the new turn
                // also wedges.
                if (msg.active) setIsAgentStuck(false);
                return;
            }

            if (msg.type === "AGENT_STUCK") {
                // Backend watchdog says Gemini socket is probably wedged.
                // Surface it in the UI; see useLiveKit's return value.
                setIsAgentStuck(true);
                setIsAgentThinking(false);
                return;
            }

            if (msg.type === "USER_MESSAGE" && msg.text) {
                onMessageRef.current("user", msg.text);
            }
        },
    );

    /* ================= VOICE RECORDING ================= */

    const startVADRecordingRef = useRef(async () => {
        if (recorderRef.current) return;
        if (!tokenRef.current) {
            onVerifyStatusRef.current("❌ Login dulu sebelum verifikasi");
            return;
        }

        setUiState("LISTENING");
        onVerifyStatusRef.current("🎧 Bicara satu kalimat penuh ya...");

        // Reuse the mic track already published to LiveKit instead of
        // calling getUserMedia again — a second concurrent capture from the
        // same device fought the live conversation's audio pipeline for the
        // mic/CPU, which is what was causing the agent's replies to stall
        // for many seconds every time verification was retried mid-call.
        const liveMicTrack = micTrackRef.current?.mediaStreamTrack;
        if (!liveMicTrack) {
            onVerifyStatusRef.current("❌ Mic belum siap, coba lagi");
            return;
        }
        const stream = new MediaStream([liveMicTrack]);
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
        let speechMs = 0;
        let lastTick = performance.now();

        const START = 0.015;
        const STOP = 0.01;
        const SILENCE_MS = 800;
        // ECAPA needs a few seconds of speech to place a voice reliably. On
        // identical audio, the score climbs 0.17 (0.5s) → 0.39 (1.4s) → 0.77
        // (2.9s) → 0.94 (5.7s), so a short "iya" scores like an impostor and
        // gets DENIED. Keep listening until enough speech has accumulated
        // (silence in between doesn't count), then stop on the usual pause.
        const MIN_SPEECH_MS = 3000;
        // Cap a single take so a noisy room can't record indefinitely.
        const MAX_RECORD_MS = 15000;
        let recordStartedAt = 0;

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            recorderRef.current = null;

            // Don't stop the track — it's shared with the live LiveKit
            // publish, only tear down our own analyser/recorder plumbing.
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

            const now = performance.now();
            const elapsed = now - lastTick;
            lastTick = now;

            if (!recording && rms > START) {
                recorder.start();
                recording = true;
                recordStartedAt = now;
                setUiState("RECORDING");
            }

            if (recording) {
                if (rms < STOP) {
                    silenceStart ??= now;
                    const paused = now - silenceStart;
                    if (paused > SILENCE_MS && speechMs >= MIN_SPEECH_MS) {
                        recorder.stop();
                        return;
                    }
                    if (paused > SILENCE_MS) {
                        onVerifyStatusRef.current(
                            "🎧 Lanjut bicara sebentar lagi ya...",
                        );
                    }
                } else {
                    speechMs += elapsed;
                    silenceStart = null;
                }

                if (now - recordStartedAt > MAX_RECORD_MS) {
                    recorder.stop();
                    return;
                }
            }

            rafRef.current = requestAnimationFrame(loop);
        };

        loop();
    });

    /* ================= VERIFY ================= */

    const sendForVerificationRef = useRef(async (blob: Blob) => {
        // The agent learns the outcome from the backend's own server-side
        // push (voiceverification/server.py's /verify-voice publishes
        // VOICE_RESULT itself via the LiveKit admin API — see
        // utils/room_notify.py) rather than from us republishing it here.
        // A client-published VOICE_RESULT would be indistinguishable from
        // one forged by anyone else in the room (e.g. from devtools), so
        // the agent now ignores any VOICE_RESULT/FACE_RESULT that isn't
        // server-sent (see agent.py's data_received handler). This
        // function only needs to update our own local UI from the
        // response.
        let status: VerificationStatus = "DENIED";
        let score: number | null = null;
        let reason: string | null = null;

        try {
            const session = await supabase.auth.getSession();
            const accessToken = session.data.session?.access_token;

            if (!accessToken) {
                onVerifyStatusRef.current("❌ Login dulu sebelum verifikasi");
                reason = "Belum login";
                return;
            }

            const form = new FormData();
            form.append("audio", blob, "voice.webm");

            const res = await fetch(`${SERVER_URL}/verify-voice`, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
                body: form,
            });

            const result: VerificationResult = await res.json();
            score = result.score ?? null;
            status = (result.status as VerificationStatus) ?? "DENIED";
            reason = result.reason ?? null;
        } catch (err) {
            console.error("Verification error:", err);
            onVerifyStatusRef.current("❌ Verifikasi gagal, coba lagi");
            reason = "Verification request failed";
        } finally {
            onScoreRef.current(score);
            onVerificationResultRef.current?.(status, score, reason);
            setUiState("CHATTING");
        }
    });

    /* ================= FACE VERIFICATION (fallback after 3x voice fail) ==== */

    // The actual camera + liveness-check + capture UI lives in
    // FaceLivenessCapture.tsx, rendered by whoever consumes this hook
    // (LiveKitControls.tsx) so it can show a real preview — this hook only
    // tracks *when* that modal should be open and reports its outcome back
    // to the agent over the room's data channel.
    const [faceVerifyOpen, setFaceVerifyOpen] = useState(false);

    const startFaceVerificationRef = useRef(() => {
        setUiState("FACE_VERIFYING");
        onVerifyStatusRef.current(
            "📷 Verifikasi wajah, arahkan wajah ke kamera...",
        );
        setFaceVerifyOpen(true);
    });

    const handleFaceVerifyResult = useCallback(
        async (outcome: { decision: "VERIFIED" | "DENIED" | "ERROR"; similarity: number | null }) => {
            // The agent learns the outcome from face_recognition/main.py's
            // own server-side push (/face/verify-face publishes
            // FACE_RESULT itself via utils/room_notify.py), not from us
            // republishing it here — see sendForVerificationRef's comment
            // above for why. This only updates our own local UI.
            setFaceVerifyOpen(false);

            if (outcome.decision === "VERIFIED") {
                onVerifyStatusRef.current("✅ Verifikasi wajah berhasil");
            } else if (outcome.decision === "DENIED") {
                onVerifyStatusRef.current("❌ Wajah tidak cocok");
            } else {
                onVerifyStatusRef.current("❌ Verifikasi wajah gagal");
            }

            setUiState("CHATTING");
        },
        [],
    );

    // The room's own participant identity is the Supabase user id (see
    // server.py's /join-token: token.with_identity(user_id)) — no separate
    // auth lookup needed for FaceLivenessCapture's `userId` prop.
    const faceVerifyUserId = roomRef.current?.localParticipant.identity ?? null;

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

            const res = await fetch(`${SERVER_URL}/join-token`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({ user_city: userCityRef.current }),
            });

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
                setIsAgentThinking(false);
                onRoomStatusRef.current("🔌 Disconnected");
                setUiState("IDLE");
                roomRef.current = null;
            });

            room.on(RoomEvent.DataReceived, (payload, _, __, topic) => {
                handleAgentDataRef.current(payload, topic);
            });

            room.on(RoomEvent.TrackSubscribed, (track) => {
                if (track.kind === Track.Kind.Audio) {
                    // Detach any previously attached elements for this track first
                    // (e.g. a resubscribe after a brief reconnect) so audio never
                    // plays from more than one element at once.
                    track.detach().forEach((el) => el.remove());

                    const el = track.attach();
                    document.body.appendChild(el);
                    el.play().catch(() => {});
                    setIsAgentSpeaking(true);
                    setIsAgentThinking(false);
                    el.onended = () => setIsAgentSpeaking(false);
                    el.onpause = () => setIsAgentSpeaking(false);
                }
            });

            room.on(RoomEvent.TrackUnsubscribed, (track) => {
                if (track.kind === Track.Kind.Audio) {
                    track.detach().forEach((el) => el.remove());
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
            micTrackRef.current = micTrack;
            await room.localParticipant.publishTrack(micTrack);
        } catch (err) {
            console.error("Join error:", err);
            isJoiningRef.current = false;
            setUiState("IDLE");
            onRoomStatusRef.current("❌ Connection error");
        }
    }, [SERVER_URL, LIVEKIT_URL]);

    /* ================= LEAVE ROOM ================= */

    // Timestamp of the most recent disconnect. Used to enforce a short
    // cooldown before the next join, giving the backend / LiveKit server
    // time to tear down the previous dispatch — otherwise a quick
    // disconnect→reconnect ends up reusing a stale dispatch and no agent
    // ever joins the new session.
    const lastLeftAtRef = useRef<number>(0);

    const leaveRoom = useCallback(async () => {
        if (roomRef.current) {
            await roomRef.current.disconnect();
            roomRef.current = null;
        }
        micTrackRef.current = null;

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
        lastLeftAtRef.current = Date.now();
    }, []);

    const toggleRoom = useCallback(async () => {
        if (uiState === "IDLE") {
            // Enforce cooldown after a recent disconnect so the backend has
            // time to clean up the previous agent dispatch.
            const COOLDOWN_MS = 2000;
            const sinceLeave = Date.now() - lastLeftAtRef.current;
            if (lastLeftAtRef.current > 0 && sinceLeave < COOLDOWN_MS) {
                onRoomStatusRef.current("⏳ Tunggu sebentar...");
                await new Promise((resolve) =>
                    setTimeout(resolve, COOLDOWN_MS - sinceLeave),
                );
            }
            await joinRoom();
        } else {
            await leaveRoom();
        }
    }, [uiState, joinRoom, leaveRoom]);

    const isConnected = uiState !== "IDLE" && uiState !== "CONNECTING";

    // Toggle microphone mute. Operates on the already-published local audio
    // track so the room connection stays alive; the agent just stops hearing
    // us until unmuted.
    const toggleMute = useCallback(async () => {
        const track = micTrackRef.current;
        if (!track) {
            // No track yet (not connected) — just flip the UI flag
            setIsMuted((prev) => !prev);
            return;
        }
        try {
            if (track.isMuted) {
                await track.unmute();
                setIsMuted(false);
            } else {
                await track.mute();
                setIsMuted(true);
            }
        } catch (err) {
            console.error("Toggle mute failed:", err);
        }
    }, []);

    // Reset mute state whenever we leave the room so the next session starts
    // with the mic open.
    useEffect(() => {
        if (uiState === "IDLE") {
            setIsMuted(false);
        }
    }, [uiState]);

    return {
        joinRoom,
        leaveRoom,
        toggleRoom,
        uiState,
        isConnected,
        isAgentSpeaking,
        isAgentThinking,
        isAgentStuck,
        isMuted,
        toggleMute,
        faceVerifyOpen,
        faceVerifyUserId,
        onFaceVerifyResult: handleFaceVerifyResult,
    };
}
