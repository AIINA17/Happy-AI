"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanSearch } from "lucide-react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  userId: string | null;
  setVerifyStatus: (status: string) => void;
}

type VerificationPhase =
  | "idle"
  | "loading"
  | "scanning"
  | "capturing"
  | "uploading"
  | "result"
  | "error";

interface VerificationResult {
  verified: boolean;
  status: string;
  similarity: number | null;
  threshold: number;
}

const STABILITY_DURATION_MS = 1500;

export default function FaceVerification({ userId, setVerifyStatus }: Props) {
  const SERVER_URL = process.env.NEXT_PUBLIC_FACE_SERVER_URL;

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<VerificationPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [detectionBox, setDetectionBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [stableProgress, setStableProgress] = useState(0);

  const [verificationResult, setVerificationResult] =
    useState<VerificationResult | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const stableSinceRef = useRef<number | null>(null);

  const startCamera = useCallback(async () => {
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
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPhase("scanning");
    } catch (err) {
      const message = mapCameraError(err);
      setErrorMessage(message);
      setPhase("error");
      setVerifyStatus(`Face verification error: ${message}`);
    }
  }, [setVerifyStatus]);

  const stopCamera = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setStableProgress(0);
    setDetectionBox(null);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const loadFaceDetector = useCallback(async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm",
      );
      const detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
      });
      faceDetectorRef.current = detector;
    } catch (err) {
      console.error("Gagal load face detector:", err);
      setErrorMessage("Failed to load face detector");
      setPhase("error");
    }
  }, []);

  const detectionLoop = useCallback(() => {
    const video = videoRef.current;
    const detector = faceDetectorRef.current;

    if (!video || !detector) {
      animationFrameRef.current = requestAnimationFrame(detectionLoop);
      return;
    }
    if (video.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(detectionLoop);
      return;
    }

    const timestamp = performance.now();
    const results = detector.detectForVideo(video, timestamp);

    if (results.detections.length > 0) {
      const detection = results.detections[0];
      const bbox = detection.boundingBox;

      if (bbox) {
        setDetectionBox({
          x: bbox.originX / video.videoWidth,
          y: bbox.originY / video.videoHeight,
          width: bbox.width / video.videoWidth,
          height: bbox.height / video.videoHeight,
        });

        if (stableSinceRef.current === null) {
          stableSinceRef.current = performance.now();
        }

        const stableDuration = performance.now() - stableSinceRef.current;
        const progress = Math.min(stableDuration / STABILITY_DURATION_MS, 1);
        setStableProgress(progress);

        if (stableDuration >= STABILITY_DURATION_MS) {
          setPhase("capturing");
          return;
        }
      }
    } else {
      setDetectionBox(null);
      stableSinceRef.current = null;
      setStableProgress(0);
    }

    animationFrameRef.current = requestAnimationFrame(detectionLoop);
  }, []);

  const captureFrame = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        reject(new Error("Video atau canvas belum siap"));
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context tidak tersedia"));
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Gagal convert canvas ke image"));
        },
        "image/jpeg",
        0.9,
      );
    });
  }, []);

  const captureAndVerify = useCallback(async () => {
    if (!userId) {
      setErrorMessage("User ID tidak tersedia");
      setPhase("error");
      return;
    }

    try {
      const blob = await captureFrame();
      setPhase("uploading");

      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("image", blob, "verify.jpg");

      const response = await fetch(`${SERVER_URL}/verify-face`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Verifikasi gagal");
      }

      const result = await response.json();
      console.log("Verify result:", result);

      setVerificationResult({
        verified: result.verified,
        status: result.status,
        similarity: result.similarity ?? null,
        threshold: result.threshold ?? 0.45,
      });
      setPhase("result");

      if (result.verified) {
        setVerifyStatus(
          `Wajah terverifikasi (${(result.similarity * 100).toFixed(0)}% mirip)`,
        );
      } else if (result.status === "NO_FACE_ENROLLMENT") {
        setVerifyStatus("Belum ada wajah terdaftar. Enroll dulu.");
      } else {
        setVerifyStatus("Wajah tidak dikenali");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal verifikasi";
      setErrorMessage(message);
      setPhase("error");
      setVerifyStatus(`Face verification error: ${message}`);
    }
  }, [userId, SERVER_URL, captureFrame, setVerifyStatus]);

  const resetForRetry = useCallback(() => {
    setVerificationResult(null);
    setDetectionBox(null);
    setStableProgress(0);
    stableSinceRef.current = null;
    setPhase("scanning");
  }, []);

  const openModal = () => {
    setIsOpen(true);
    setPhase("loading");
    setErrorMessage("");
    setVerificationResult(null);
  };

  const closeModal = () => {
    stopCamera();
    setIsOpen(false);
    setPhase("idle");
    setErrorMessage("");
    setVerificationResult(null);
  };

  useEffect(() => {
    if (phase === "loading") {
      startCamera();
      loadFaceDetector();
    }
  }, [phase, startCamera, loadFaceDetector]);

  useEffect(() => {
    if (phase === "scanning") {
      detectionLoop();
      return () => {
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        stableSinceRef.current = null;
      };
    }
  }, [phase, detectionLoop]);

  useEffect(() => {
    if (phase === "capturing") {
      captureAndVerify();
    }
  }, [phase, captureAndVerify]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-lg text-center"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Face Verification</DialogTitle>
          </DialogHeader>

          <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden mb-4 flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />

            {phase === "scanning" && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {!detectionBox && (
                  <rect
                    x="1"
                    y="1"
                    width="98"
                    height="98"
                    rx="1.5"
                    ry="1.5"
                    fill="none"
                    stroke="rgb(250, 204, 21)"
                    strokeOpacity="0.7"
                    strokeWidth="4"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {detectionBox && (
                  <>
                    <rect
                      x="1"
                      y="1"
                      width="98"
                      height="98"
                      rx="1.5"
                      ry="1.5"
                      fill="none"
                      stroke="rgb(74, 222, 128)"
                      strokeOpacity="0.25"
                      strokeWidth="4"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x="1"
                      y="1"
                      width="98"
                      height="98"
                      rx="1.5"
                      ry="1.5"
                      fill="none"
                      stroke="rgb(74, 222, 128)"
                      strokeWidth="4"
                      vectorEffect="non-scaling-stroke"
                      pathLength="100"
                      strokeDasharray="100"
                      strokeDashoffset={100 - stableProgress * 100}
                      strokeLinecap="round"
                    />
                  </>
                )}
              </svg>
            )}

            {(phase === "capturing" || phase === "uploading") && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none animate-pulse"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <rect
                  x="1"
                  y="1"
                  width="98"
                  height="98"
                  rx="1.5"
                  ry="1.5"
                  fill="none"
                  stroke="rgb(74, 222, 128)"
                  strokeWidth="4"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}

            {phase === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                Menyiapkan kamera...
              </div>
            )}

            {/* Error overlay */}
            {phase === "error" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm px-4 text-center">
                {errorMessage}
              </div>
            )}
          </div>

          <p className="text-base text-muted-foreground mb-4">
            {phase === "idle" && "Persiapkan wajah kamu di depan kamera"}
            {phase === "loading" && "Menyiapkan kamera..."}
            {phase === "scanning" && "Arahkan wajah ke kamera..."}
            {phase === "capturing" && "Wajah terdeteksi, sedang memotret..."}
            {phase === "uploading" && "Sedang memverifikasi..."}
            {phase === "error" && errorMessage}
          </p>

          {phase === "result" && verificationResult && (
            <div className="space-y-3 mb-4">
              <div
                className={`p-4 rounded-lg ${
                  verificationResult.verified
                    ? "bg-green-50 dark:bg-green-950/30"
                    : "bg-red-50 dark:bg-red-950/30"
                }`}
              >
                {/* Status badge - VERIFIED atau DENIED */}
                <div
                  className={`text-2xl font-bold text-center ${
                    verificationResult.verified
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {verificationResult.verified ? "✓ VERIFIED" : "✗ DENIED"}
                </div>

                {verificationResult.similarity !== null && (
                  <div className="mt-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Similarity Score:
                      </span>
                      <span className="font-mono font-semibold">
                        {(verificationResult.similarity * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Threshold:</span>
                      <span className="font-mono">
                        {(verificationResult.threshold * 100).toFixed(1)}%
                      </span>
                    </div>

                    {/* Visual bar: seberapa jauh score di atas/bawah threshold */}
                    <div className="relative h-3 bg-muted rounded-full overflow-hidden mt-3">
                      <div
                        className={`absolute inset-y-0 left-0 transition-all duration-500 ${
                          verificationResult.verified
                            ? "bg-green-500"
                            : "bg-red-500"
                        }`}
                        style={{
                          width: `${Math.max(0, Math.min(verificationResult.similarity * 100, 100))}%`,
                        }}
                      />
                      {/* Threshold marker - garis vertikal */}
                      <div
                        className="absolute inset-y-0 w-0.5 bg-foreground"
                        style={{
                          left: `${verificationResult.threshold * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {verificationResult.status === "NO_FACE_ENROLLMENT" && (
                  <div className="mt-2 text-sm text-muted-foreground">
                    Belum ada wajah yang didaftarkan. Silakan enroll dulu.
                  </div>
                )}
              </div>

              <Button onClick={resetForRetry} className="w-full">
                Coba Lagi
              </Button>
            </div>
          )}

          {phase !== "capturing" && phase !== "uploading" && (
            <Button
              onClick={closeModal}
              variant="outline"
              className="w-full max-w-xs mx-auto"
            >
              Tutup
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <Button
        onClick={openModal}
        disabled={!userId}
        variant="outline"
        className="w-full h-auto rounded-xl py-3"
      >
        <ScanSearch size={18} />
        <span>Verify Face</span>
      </Button>
    </>
  );
}

function mapCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Izin kamera ditolak. Buka pengaturan browser dan izinkan akses kamera.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "Kamera tidak ditemukan pada perangkat ini.";
      case "NotReadableError":
      case "TrackStartError":
        return "Kamera sedang dipakai aplikasi lain.";
      case "OverconstrainedError":
        return "Kamera tidak mendukung resolusi yang diminta.";
      case "SecurityError":
        return "Akses kamera diblokir karena halaman tidak aman.";
      default:
        return `Gagal mengakses kamera (${err.name}).`;
    }
  }
  return "Terjadi kesalahan tidak diketahui saat mengakses kamera.";
}
