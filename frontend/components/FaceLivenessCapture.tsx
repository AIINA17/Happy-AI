"use client";

// Shared face-verification modal: camera preview + a randomized liveness
// challenge (blink / open mouth / turn head) via MediaPipe FaceLandmarker
// blendshapes, auto-captures once the challenge passes, then verifies
// against the user's enrolled face (POST /face/verify-face).
//
// This is a client-side heuristic (require a low→high blendshape
// transition, or enough head-turn movement, during the session) meant to
// make a *printed/screen photo* meaningfully harder to pass than a live
// face — it is not cryptographic-grade liveness detection.
//
// Used both by FaceVerifyTest.tsx (manual "[TEST] Verify Face" button) and
// by useLiveKit.ts (agent-triggered fallback after 3 failed voice
// verifications) — `open`/`onOpenChange` are controlled from outside so
// both callers can drive the same modal.

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanEye } from "lucide-react";
import {
    FaceLandmarker,
    FilesetResolver,
    type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { toast } from "sonner";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type FaceVerifyDecision = "VERIFIED" | "DENIED" | "ERROR";

export interface FaceVerifyOutcome {
    decision: FaceVerifyDecision;
    similarity: number | null;
    message?: string;
}

interface Props {
    userId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onResult?: (outcome: FaceVerifyOutcome) => void;
}

type ChallengeType = "blink" | "mouth" | "turn";

const CHALLENGES: { type: ChallengeType; instruction: string }[] = [
    { type: "blink", instruction: "Kedipkan mata kamu" },
    { type: "mouth", instruction: "Buka mulut kamu sebentar" },
    { type: "turn", instruction: "Gelengkan kepala ke kiri atau kanan" },
];

// Blendshape score thresholds for the low→high transition check (blink /
// mouth). Resting face sits near 0; a real blink/mouth-open spikes well
// above HIGH. Requiring both a LOW sighting *and then* a HIGH crossing
// (not just a single high reading) is what defeats a static photo, whose
// blendshape scores never change frame to frame.
const LOW_THRESHOLD = 0.15;
const HIGH_THRESHOLD = 0.5;

// Normalized (by landmark-cloud width) nose-tip travel required to count
// as a head turn.
const TURN_THRESHOLD = 0.45;

const LIVENESS_TIMEOUT_MS = 15000;
const NO_FACE_MESSAGE = "Posisikan wajah kamu di dalam kamera";
const MULTI_FACE_MESSAGE =
    "Terlalu banyak wajah terdeteksi — pastikan cuma kamu di depan kamera";

// How many faces FaceLandmarker tracks per frame. Capped well above 1 so a
// second/third face in frame is actually *detected* (and rejected below)
// instead of silently ignored — the backend also rejects a captured photo
// with >1 face (arcface_model.py), but catching it client-side first avoids
// a wasted liveness attempt + round trip.
const MAX_FACES_TRACKED = 5;

// Maps a normalized (0-1) point from the video's native frame into pixel
// coordinates on a canvas that's rendering that video with object-fit:
// cover (which crops/scales the video to fill the box, off-center by half
// the overflow on whichever axis got cropped).
function mapObjectCoverPoint(
    nx: number,
    ny: number,
    videoW: number,
    videoH: number,
    canvasW: number,
    canvasH: number,
) {
    const scale = Math.max(canvasW / videoW, canvasH / videoH);
    const dispW = videoW * scale;
    const dispH = videoH * scale;
    const offsetX = (canvasW - dispW) / 2;
    const offsetY = (canvasH - dispH) / 2;
    return { x: offsetX + nx * dispW, y: offsetY + ny * dispH };
}

// Draws one bounding box per detected face onto the overlay canvas — green
// when there's exactly one (the normal, verifiable case), red when there's
// more than one (ambiguous — see MULTI_FACE_MESSAGE).
function drawFaceBoxes(
    canvas: HTMLCanvasElement | null,
    video: HTMLVideoElement,
    landmarksList: NormalizedLandmark[][],
) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    if (canvas.width !== displayW || canvas.height !== displayH) {
        canvas.width = displayW;
        canvas.height = displayH;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    if (!videoW || !videoH) return;

    const single = landmarksList.length === 1;

    landmarksList.forEach((landmarks) => {
        const xs = landmarks.map((l) => l.x);
        const ys = landmarks.map((l) => l.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        // Small margin so the box sits just outside the landmark cloud
        // instead of clipping through the jawline/forehead.
        const marginX = (maxX - minX) * 0.15;
        const marginY = (maxY - minY) * 0.15;

        const topLeft = mapObjectCoverPoint(
            minX - marginX,
            minY - marginY,
            videoW,
            videoH,
            canvas.width,
            canvas.height,
        );
        const bottomRight = mapObjectCoverPoint(
            maxX + marginX,
            maxY + marginY,
            videoW,
            videoH,
            canvas.width,
            canvas.height,
        );

        ctx.strokeStyle = single ? "#4ade80" : "#f87171";
        ctx.lineWidth = 3;
        ctx.strokeRect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
        );
    });
}

type Phase = "idle" | "loading" | "liveness" | "capturing" | "result" | "error";

export default function FaceLivenessCapture({
    userId,
    open,
    onOpenChange,
    onResult,
}: Props) {
    const SERVER_URL = `${process.env.NEXT_PUBLIC_SERVER_URL}/face`;

    const [phase, setPhase] = useState<Phase>("idle");
    const [message, setMessage] = useState<string>("");
    const [challenge, setChallenge] = useState<
        (typeof CHALLENGES)[number] | null
    >(null);
    const [facesCount, setFacesCount] = useState(0);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const landmarkerRef = useRef<FaceLandmarker | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const livenessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Per-challenge running state, reset whenever a new challenge starts.
    const livenessTrackRef = useRef({
        sawLow: false,
        passed: false,
        minNoseX: Infinity,
        maxNoseX: -Infinity,
    });

    const reportedRef = useRef(false);

    const clearTimers = useCallback(() => {
        if (livenessTimeoutRef.current) {
            clearTimeout(livenessTimeoutRef.current);
            livenessTimeoutRef.current = null;
        }
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
    }, []);

    const stopCamera = useCallback(() => {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }

        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }

        const overlay = overlayCanvasRef.current;
        if (overlay) {
            overlay
                .getContext("2d")
                ?.clearRect(0, 0, overlay.width, overlay.height);
        }

        setFacesCount(0);
    }, []);

    // Reports the outcome exactly once per open/close cycle — both the
    // success/failure paths below and a manual close mid-flow funnel through
    // here, mirroring sendForVerificationRef's "always report something"
    // contract in useLiveKit.ts.
    const report = useCallback(
        (outcome: FaceVerifyOutcome) => {
            if (reportedRef.current) return;
            reportedRef.current = true;
            onResult?.(outcome);
        },
        [onResult],
    );

    const closeModal = useCallback(
        (outcome?: FaceVerifyOutcome) => {
            clearTimers();
            stopCamera();
            report(
                outcome ?? {
                    decision: "ERROR",
                    similarity: null,
                    message: "Dibatalkan",
                },
            );
            setPhase("idle");
            setMessage("");
            setChallenge(null);
            onOpenChange(false);
        },
        [clearTimers, stopCamera, report, onOpenChange],
    );

    const captureAndVerify = useCallback(async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !userId) return;

        clearTimers();
        setPhase("capturing");
        setMessage("Mengambil gambar...");

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            closeModal({
                decision: "ERROR",
                similarity: null,
                message: "Gagal mengambil gambar dari kamera.",
            });
            return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        stopCamera();

        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.92),
        );
        if (!blob) {
            closeModal({
                decision: "ERROR",
                similarity: null,
                message: "Gagal memproses gambar.",
            });
            return;
        }

        try {
            const form = new FormData();
            form.append("user_id", userId);
            form.append("image", blob, "face.jpg");

            const res = await fetch(`${SERVER_URL}/verify-face`, {
                method: "POST",
                body: form,
            });

            const result = await res.json();

            if (res.ok && result.status === "VERIFIED") {
                const text = `Cocok — similarity ${result.similarity?.toFixed(3)}`;
                setPhase("result");
                setMessage(text);
                toast.success(text);
                closeTimeoutRef.current = setTimeout(
                    () =>
                        closeModal({
                            decision: "VERIFIED",
                            similarity: result.similarity ?? null,
                        }),
                    1500,
                );
            } else if (res.ok && result.status === "DENIED") {
                const text = `Tidak cocok — similarity ${result.similarity?.toFixed(3)}`;
                setPhase("result");
                setMessage(text);
                toast.error(text);
                closeTimeoutRef.current = setTimeout(
                    () =>
                        closeModal({
                            decision: "DENIED",
                            similarity: result.similarity ?? null,
                        }),
                    2000,
                );
            } else {
                const text =
                    result.message || result.detail || "Verifikasi gagal.";
                setPhase("result");
                setMessage(text);
                toast.error(text);
                closeTimeoutRef.current = setTimeout(
                    () =>
                        closeModal({
                            decision: "ERROR",
                            similarity: null,
                            message: text,
                        }),
                    2000,
                );
            }
        } catch (err) {
            console.error("Face verify error:", err);
            const text = "Gagal menghubungi server.";
            setPhase("result");
            setMessage(text);
            toast.error(text);
            closeTimeoutRef.current = setTimeout(
                () =>
                    closeModal({
                        decision: "ERROR",
                        similarity: null,
                        message: text,
                    }),
                2000,
            );
        }
    }, [userId, SERVER_URL, clearTimers, stopCamera, closeModal]);

    // Held in a ref so the recursive requestAnimationFrame call doesn't trip
    // the "accessed before declared" lint rule on this self-referencing loop
    // (same trick as FaceEnrollment.tsx / FaceVerifyTest.tsx).
    const detectionLoopRef = useRef<() => void>(() => {});
    const captureAndVerifyRef = useRef(captureAndVerify);
    useEffect(() => {
        captureAndVerifyRef.current = captureAndVerify;
    }, [captureAndVerify]);

    const detectionLoop = useCallback(() => {
        const video = videoRef.current;
        const landmarker = landmarkerRef.current;
        const overlay = overlayCanvasRef.current;

        if (!video || !landmarker || video.readyState < 2) {
            animationFrameRef.current = requestAnimationFrame(() =>
                detectionLoopRef.current(),
            );
            return;
        }

        const timestamp = performance.now();
        const result = landmarker.detectForVideo(video, timestamp);
        const allLandmarks = result.faceLandmarks ?? [];
        const allBlendshapes = result.faceBlendshapes ?? [];

        setFacesCount(allLandmarks.length);
        drawFaceBoxes(overlay, video, allLandmarks);

        const track = livenessTrackRef.current;
        const currentChallenge = challengeRef.current;

        // Only score the challenge when exactly one face is in frame — with 0
        // or 2+ faces there's no unambiguous "the user" to track, so we just
        // wait (and reset any in-progress transition below, so a second face
        // briefly wandering into frame mid-blink can't contribute stale
        // low/high readings once it leaves again).
        if (allLandmarks.length !== 1) {
            track.sawLow = false;
            track.minNoseX = Infinity;
            track.maxNoseX = -Infinity;
        } else if (currentChallenge && !track.passed) {
            const landmarks = allLandmarks[0];
            const blendshapes = allBlendshapes[0]?.categories ?? [];

            if (currentChallenge.type === "turn") {
                const xs = landmarks.map((l) => l.x);
                const faceWidth = Math.max(...xs) - Math.min(...xs);
                const noseX = landmarks[1]?.x ?? 0;
                track.minNoseX = Math.min(track.minNoseX, noseX);
                track.maxNoseX = Math.max(track.maxNoseX, noseX);
                const range =
                    faceWidth > 0
                        ? (track.maxNoseX - track.minNoseX) / faceWidth
                        : 0;

                if (range > TURN_THRESHOLD) {
                    track.passed = true;
                }
            } else {
                const name =
                    currentChallenge.type === "blink"
                        ? "eyeBlinkLeft"
                        : "jawOpen";
                const nameRight =
                    currentChallenge.type === "blink" ? "eyeBlinkRight" : null;

                const score =
                    blendshapes.find((c) => c.categoryName === name)?.score ??
                    0;
                const scoreRight = nameRight
                    ? (blendshapes.find((c) => c.categoryName === nameRight)
                          ?.score ?? 0)
                    : score;
                const combined = Math.min(score, scoreRight);

                if (combined < LOW_THRESHOLD) {
                    track.sawLow = true;
                } else if (track.sawLow && combined > HIGH_THRESHOLD) {
                    track.passed = true;
                }
            }

            if (track.passed) {
                captureAndVerifyRef.current();
                return;
            }
        }

        animationFrameRef.current = requestAnimationFrame(() =>
            detectionLoopRef.current(),
        );
    }, []);

    useEffect(() => {
        detectionLoopRef.current = detectionLoop;
    }, [detectionLoop]);

    // Kept in a ref alongside `challenge` state so the detection loop (a
    // stable useCallback with an empty dep array) always reads the current
    // challenge without needing to be recreated every time it changes.
    const challengeRef = useRef<(typeof CHALLENGES)[number] | null>(null);
    useEffect(() => {
        challengeRef.current = challenge;
    }, [challenge]);

    const startSession = useCallback(async () => {
        reportedRef.current = false;
        setPhase("loading");
        setMessage("Menyiapkan kamera...");

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: "user",
                },
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }

            if (!landmarkerRef.current) {
                const vision = await FilesetResolver.forVisionTasks(
                    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
                );
                landmarkerRef.current = await FaceLandmarker.createFromOptions(
                    vision,
                    {
                        baseOptions: {
                            modelAssetPath:
                                "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                            delegate: "GPU",
                        },
                        outputFaceBlendshapes: true,
                        runningMode: "VIDEO",
                        numFaces: MAX_FACES_TRACKED,
                    },
                );
            }

            const picked =
                CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
            livenessTrackRef.current = {
                sawLow: false,
                passed: false,
                minNoseX: Infinity,
                maxNoseX: -Infinity,
            };
            setChallenge(picked);
            setPhase("liveness");
            setMessage(picked.instruction);

            detectionLoop();

            livenessTimeoutRef.current = setTimeout(() => {
                const text = "Waktu habis, coba lagi.";
                closeModal({
                    decision: "DENIED",
                    similarity: null,
                    message: text,
                });
            }, LIVENESS_TIMEOUT_MS);
        } catch (err) {
            console.error("Face liveness camera/model error:", err);
            setPhase("error");
            const text =
                "Gagal mengakses kamera atau memuat model deteksi wajah.";
            setMessage(text);
            closeTimeoutRef.current = setTimeout(
                () =>
                    closeModal({
                        decision: "ERROR",
                        similarity: null,
                        message: text,
                    }),
                2500,
            );
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- detectionLoop/closeModal are stable refs/callbacks by construction; re-running this on their identity would restart an in-progress session
    }, []);

    useEffect(() => {
        if (open) {
            void startSession();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when `open` flips
    }, [open]);

    useEffect(() => {
        return () => {
            clearTimers();
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, [clearTimers]);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) closeModal();
            }}>
            <DialogContent
                showCloseButton={false}
                className="sm:max-w-lg text-center">
                <DialogHeader className="sr-only">
                    <DialogTitle>Verifikasi Wajah</DialogTitle>
                </DialogHeader>

                <div
                    className={`relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden mb-4 flex items-center justify-center border-4 transition-colors duration-300 ${
                        phase === "liveness"
                            ? facesCount === 1
                                ? "border-green-400 shadow-[0_0_20px_rgba(74,222,128,0.4)]"
                                : facesCount > 1
                                  ? "border-red-400 shadow-[0_0_20px_rgba(248,113,113,0.4)]"
                                  : "border-yellow-400/70"
                            : "border-transparent"
                    }`}>
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                    />
                    <canvas
                        ref={overlayCanvasRef}
                        className="absolute inset-0 w-full h-full pointer-events-none"
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {phase === "loading" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                            Menyiapkan kamera...
                        </div>
                    )}

                    {phase === "liveness" && facesCount === 0 && (
                        <div className="absolute inset-0 flex items-end justify-center pb-4 bg-black/20 text-white text-sm px-4 text-center">
                            {NO_FACE_MESSAGE}
                        </div>
                    )}

                    {phase === "liveness" && facesCount > 1 && (
                        <div className="absolute inset-0 flex items-end justify-center pb-4 bg-black/30 text-white text-sm px-4 text-center">
                            {MULTI_FACE_MESSAGE}
                        </div>
                    )}

                    {phase === "error" && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm px-4 text-center">
                            {message}
                        </div>
                    )}
                </div>

                <p className="text-base text-muted-foreground mb-1">
                    {phase === "loading" && "Menyiapkan kamera..."}
                    {phase === "liveness" && (
                        <span className="flex items-center justify-center gap-2">
                            <ScanEye size={18} className="text-primary" />
                            {message}
                        </span>
                    )}
                    {phase === "capturing" && "Memverifikasi..."}
                    {phase === "result" && message}
                    {phase === "error" && message}
                </p>

                {phase === "liveness" && (
                    <p className="text-xs text-muted-foreground mb-4">
                        Ini cek anti-foto sederhana — pastikan gerakannya
                        benar-benar dilakukan di depan kamera.
                    </p>
                )}

                <Button
                    onClick={() => closeModal()}
                    variant="outline"
                    disabled={phase === "capturing"}
                    className="w-full max-w-xs mx-auto">
                    Tutup
                </Button>
            </DialogContent>
        </Dialog>
    );
}
