"use client";

// TEMPORARY testing component for /face/verify-face — lets you manually
// verify against whatever face is currently enrolled for this user,
// without wiring it into the agent's verification flow yet. Safe to
// delete once that real integration exists (see backend/README.md's
// "Belum dipanggil dari agent/" note).

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanEye } from "lucide-react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  userId: string | null;
}

type VerifyPhase =
  | "idle"
  | "loading"
  | "scanning"
  | "verifying"
  | "result"
  | "error";

export default function FaceVerifyTest({ userId }: Props) {
  const SERVER_URL = `${process.env.NEXT_PUBLIC_SERVER_URL}/face`;

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<VerifyPhase>("idle");
  const [message, setMessage] = useState<string>("");
  const [detectionBox, setDetectionBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setPhase("scanning");
    } catch (err) {
      console.error("Camera error:", err);
      setMessage("Gagal mengakses kamera.");
      setPhase("error");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

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
      setMessage("Gagal load face detector.");
      setPhase("error");
    }
  }, []);

  const openModal = useCallback(() => {
    setIsOpen(true);
    setPhase("loading");
    setMessage("");
  }, []);

  const closeModal = useCallback(() => {
    stopCamera();
    setIsOpen(false);
    setPhase("idle");
    setMessage("");
  }, [stopCamera]);

  const captureAndVerify = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !userId) return;

    setPhase("verifying");
    setMessage("");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setMessage("Gagal mengambil gambar dari kamera.");
      setPhase("error");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setMessage("Gagal memproses gambar.");
          setPhase("error");
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

          if (!res.ok) {
            const detail = result.detail || "Verifikasi gagal.";
            setMessage(detail);
            setPhase("error");
            toast.error(detail);
            return;
          }

          stopCamera();

          if (result.status === "VERIFIED") {
            const text = `Cocok — similarity ${result.similarity?.toFixed(3)} (threshold ${result.threshold})`;
            setMessage(text);
            setPhase("result");
            toast.success(text);
          } else if (result.status === "DENIED") {
            const text = `Tidak cocok — similarity ${result.similarity?.toFixed(3)} (threshold ${result.threshold})`;
            setMessage(text);
            setPhase("result");
            toast.error(text);
          } else {
            const text =
              result.message || `Status: ${result.status || "unknown"}`;
            setMessage(text);
            setPhase("result");
            toast.error(text);
          }

          setTimeout(closeModal, 2000);
        } catch (err) {
          console.error("Face verify error:", err);
          setMessage("Gagal menghubungi server.");
          setPhase("error");
          toast.error("Gagal menghubungi server.");
        }
      },
      "image/jpeg",
      0.92,
    );
  }, [userId, SERVER_URL, closeModal, stopCamera]);

  // Held in a ref (rather than referencing the useCallback binding by name
  // from inside itself) so the recursive requestAnimationFrame call doesn't
  // trip the "accessed before declared" lint rule on this self-referencing
  // rAF loop — same trick as FaceEnrollment.tsx.
  const detectionLoopRef = useRef<() => void>(() => {});

  const detectionLoop = useCallback(() => {
    const video = videoRef.current;
    const detector = faceDetectorRef.current;

    if (!video || !detector) {
      animationFrameRef.current = requestAnimationFrame(() =>
        detectionLoopRef.current(),
      );
      return;
    }

    if (video.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(() =>
        detectionLoopRef.current(),
      );
      return;
    }

    const timestamp = performance.now();
    const results = detector.detectForVideo(video, timestamp);

    if (results.detections.length > 0) {
      const bbox = results.detections[0].boundingBox;

      if (bbox) {
        setDetectionBox({
          x: bbox.originX / video.videoWidth,
          y: bbox.originY / video.videoHeight,
          width: bbox.width / video.videoWidth,
          height: bbox.height / video.videoHeight,
        });
      }
    } else {
      setDetectionBox(null);
    }

    animationFrameRef.current = requestAnimationFrame(() =>
      detectionLoopRef.current(),
    );
  }, []);

  useEffect(() => {
    detectionLoopRef.current = detectionLoop;
  }, [detectionLoop]);

  useEffect(() => {
    if (phase !== "loading") return;

    void (async () => {
      await Promise.all([startCamera(), loadFaceDetector()]);
    })();
  }, [phase, startCamera, loadFaceDetector]);

  useEffect(() => {
    if (phase === "scanning") {
      detectionLoop();
    }
  }, [phase, detectionLoop]);

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
            <DialogTitle>Face Verify Test</DialogTitle>
          </DialogHeader>

          <div
            className={`relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden mb-4 flex items-center justify-center border-4 transition-colors duration-300 ${
              phase === "scanning"
                ? detectionBox
                  ? "border-green-400 shadow-[0_0_20px_rgba(74,222,128,0.4)]"
                  : "border-yellow-400/70"
                : "border-transparent"
            }`}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            <canvas ref={canvasRef} className="hidden" />

            {phase === "loading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white">
                Menyiapkan kamera...
              </div>
            )}

            {phase === "error" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-sm px-4 text-center">
                {message}
              </div>
            )}
          </div>

          <p className="text-base text-muted-foreground mb-4">
            {phase === "idle" && "Arahkan wajah ke kamera untuk dites"}
            {phase === "loading" && "Menyiapkan kamera..."}
            {phase === "scanning" && "Arahkan wajah ke kamera..."}
            {phase === "verifying" && "Memverifikasi..."}
            {phase === "result" && message}
            {phase === "error" && message}
          </p>

          {phase === "scanning" && (
            <Button
              onClick={captureAndVerify}
              disabled={!detectionBox}
              className="w-full max-w-xs mx-auto mb-2"
            >
              <ScanEye size={18} />
              <span>Verifikasi Wajah</span>
            </Button>
          )}

          <Button
            onClick={closeModal}
            variant="outline"
            disabled={phase === "verifying"}
            className="w-full max-w-xs mx-auto"
          >
            Tutup
          </Button>
        </DialogContent>
      </Dialog>

      <Button
        onClick={openModal}
        disabled={!userId}
        variant="secondary"
        className="w-full h-auto rounded-xl py-3 mt-2"
      >
        <ScanEye size={18} />
        <span>[TEST] Verify Face</span>
      </Button>
    </>
  );
}
