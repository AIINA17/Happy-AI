"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanFace } from "lucide-react";
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

type EnrollmentPhase =
  | "idle"
  | "loading"
  | "scanning"
  | "capturing"
  | "success"
  | "error";

export default function FaceEnrollment({ userId, setVerifyStatus }: Props) {
  const SERVER_URL = process.env.NEXT_PUBLIC_FACE_SERVER_URL;

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<EnrollmentPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
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
          facingMode: "user", //
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setPhase("scanning");
    } catch (err) {
      // Kalau gagal, kita mapping error jadi pesan user-friendly.
      const message = mapCameraError(err);
      setErrorMessage(message);
      setPhase("error");
      setVerifyStatus(`Face enrollment error: ${message}`);
    }
  }, [setVerifyStatus]);

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
      setErrorMessage("failed to load face detector");
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

        console.log("Face detected:", {
          confidence: detection.categories[0]?.score.toFixed(2),
          x: bbox.originX,
          y: bbox.originY,
        });
      }
    } else {
      setDetectionBox(null);
    }

    animationFrameRef.current = requestAnimationFrame(detectionLoop);
  }, []);

  const openModal = () => {
    setIsOpen(true);
    setPhase("loading");
    setErrorMessage("");
  };

  const closeModal = () => {
    stopCamera();
    setIsOpen(false);
    setPhase("idle");
    setErrorMessage("");
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
            <DialogTitle>Face Enrollment</DialogTitle>
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
                {errorMessage}
              </div>
            )}
          </div>

          <p className="text-base text-muted-foreground mb-4">
            {phase === "idle" && "Persiapkan wajah kamu di depan kamera"}
            {phase === "loading" && "Menyiapkan kamera..."}
            {phase === "scanning" && "Arahkan wajah ke kamera..."}
            {phase === "capturing" && "Menyimpan wajah..."}
            {phase === "success" && "Wajah berhasil didaftarkan!"}
            {phase === "error" && errorMessage}
          </p>

          <Button
            onClick={closeModal}
            variant="outline"
            className="w-full max-w-xs mx-auto"
          >
            Tutup
          </Button>
        </DialogContent>
      </Dialog>

      <Button
        onClick={openModal}
        disabled={!userId}
        className="w-full h-auto rounded-xl py-3"
      >
        <ScanFace size={18} />
        <span>Enroll Face</span>
      </Button>
    </>
  );
}

function mapCameraError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Izin kamera ditolak. Buka pengaturan browser dan izinkan akses kamera untuk situs ini.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "Kamera tidak ditemukan pada perangkat ini.";
      case "NotReadableError":
      case "TrackStartError":
        return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.";
      case "OverconstrainedError":
        return "Kamera tidak mendukung resolusi yang diminta.";
      case "SecurityError":
        return "Akses kamera diblokir karena halaman tidak aman (butuh HTTPS).";
      default:
        return `Gagal mengakses kamera (${err.name}).`;
    }
  }
  return "Terjadi kesalahan tidak diketahui saat mengakses kamera.";
}
