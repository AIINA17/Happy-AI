"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanFace, Trash2 } from "lucide-react";
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
  setVerifyStatus: (status: string) => void;
}

type EnrollmentPhase =
  | "idle"
  | "loading"
  | "scanning"
  | "capturing"
  | "success"
  | "error";

const STABILITY_DURATION_MS = 1500;

export default function FaceEnrollment({ userId, setVerifyStatus }: Props) {
    // face_recognition is now mounted under /face on the same backend as
  // voice verification (see backend/README.md), not a separate service.
  const SERVER_URL = `${process.env.NEXT_PUBLIC_SERVER_URL}/face`;

  const [isOpen, setIsOpen] = useState(false);
  const [phase, setPhase] = useState<EnrollmentPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  // null = belum diketahui/masih dicek ke server.
  const [isEnrolled, setIsEnrolled] = useState<boolean | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [detectionBox, setDetectionBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [stableProgress, setStableProgress] = useState(0);

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

    setStableProgress(0);
    setDetectionBox(null);
    stableSinceRef.current = null;

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

  const checkEnrollmentStatus = useCallback(async () => {
    if (!userId) {
      setIsEnrolled(null);
      return;
    }

    try {
      const res = await fetch(`${SERVER_URL}/enroll-face/${userId}`);
      if (!res.ok) return;
      const data = await res.json();
      setIsEnrolled(!!data.enrolled);
    } catch (err) {
      console.error("Gagal cek status face enrollment:", err);
    }
  }, [userId, SERVER_URL]);

  useEffect(() => {
    checkEnrollmentStatus();
  }, [checkEnrollmentStatus]);

  const handleDelete = useCallback(async () => {
    if (!userId) return;
    if (!confirm("Hapus pendaftaran wajah? Kamu perlu mendaftar ulang untuk verifikasi wajah berikutnya.")) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`${SERVER_URL}/enroll-face/${userId}`, {
        method: "DELETE",
      });
      const result = await res.json();

      if (res.ok && result.status === "DELETED") {
        toast.success("Pendaftaran wajah berhasil dihapus.");
        setVerifyStatus("Face enrollment dihapus.");
        setIsEnrolled(false);
      } else {
        const message = result.message || "Gagal menghapus pendaftaran wajah.";
        toast.error(message);
      }
    } catch (err) {
      console.error("Face enrollment delete error:", err);
      toast.error("Gagal menghubungi server.");
    } finally {
      setIsDeleting(false);
    }
  }, [userId, SERVER_URL, setVerifyStatus]);

  const openModal = useCallback(() => {
    setIsOpen(true);
    setPhase("loading");
    setErrorMessage("");
  }, []);

  const closeModal = useCallback(() => {
    stopCamera();
    setIsOpen(false);
    setPhase("idle");
    setErrorMessage("");
  }, [stopCamera]);

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
        0.92,
      );
    });
  }, []);

  const captureAndEnroll = useCallback(async () => {
    if (!userId) return;

    setErrorMessage("");

    try {
      const blob = await captureFrame();

      const form = new FormData();
      form.append("user_id", userId);
      form.append("image", blob, "face.jpg");

      const res = await fetch(`${SERVER_URL}/enroll-face`, {
        method: "POST",
        body: form,
      });

      const result = await res.json();

      if (res.ok && result.status === "ENROLLMENT_SUCCESS") {
        stopCamera();
        setPhase("success");
        setIsEnrolled(true);
        toast.success("Wajah berhasil didaftarkan!");
        setVerifyStatus("Face enrollment berhasil!");
        // Beri jeda sebentar biar notifikasinya kelihatan dulu sebelum
        // modal-nya ketutup, bukan langsung hilang.
        setTimeout(closeModal, 1200);
      } else {
        const message =
          result.detail || result.message || "Enrollment gagal.";
        setErrorMessage(message);
        setPhase("error");
        toast.error(message);
        setVerifyStatus(`Face enrollment error: ${message}`);
      }
    } catch (err) {
      console.error("Face enroll upload error:", err);
      const message =
        err instanceof Error ? err.message : "Gagal menghubungi server.";
      setErrorMessage(message);
      setPhase("error");
      toast.error(message);
      setVerifyStatus(`Face enrollment error: ${message}`);
    }
  }, [userId, SERVER_URL, setVerifyStatus, closeModal, stopCamera, captureFrame]);

  // Held in a ref (rather than referencing the useCallback binding by name
  // from inside itself) so the recursive requestAnimationFrame call doesn't
  // trip the "accessed before declared" lint rule on this self-referencing
  // rAF loop.
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
      captureAndEnroll();
    }
  }, [phase, captureAndEnroll]);

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
                {/* Waiting state: kuning kalau belum ada wajah */}
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

                {/* Face detected: dua ring - background hijau redup + progress ring hijau terang */}
                {detectionBox && (
                  <>
                    {/* Background track: hijau redup, static */}
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
                    {/* Progress ring: hijau terang, ngisi searah jarum jam */}
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

            {phase === "capturing" && (
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
            {phase === "capturing" && "Wajah terdeteksi, menyimpan wajah..."}
            {phase === "success" && "Wajah berhasil didaftarkan!"}
            {phase === "error" && errorMessage}
          </p>

          <Button
            onClick={closeModal}
            variant="outline"
            disabled={phase === "capturing"}
            className="w-full max-w-xs mx-auto"
          >
            Tutup
          </Button>
        </DialogContent>
      </Dialog>

      {isEnrolled ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground px-1">
            Wajah sudah terdaftar. Hapus dulu untuk mendaftar ulang.
          </p>
          <Button
            onClick={handleDelete}
            disabled={isDeleting}
            variant="destructive"
            className="w-full h-auto rounded-xl py-3"
          >
            <Trash2 size={18} />
            <span>
              {isDeleting ? "Menghapus..." : "Hapus Pendaftaran Wajah"}
            </span>
          </Button>
        </div>
      ) : (
        <Button
          onClick={openModal}
          disabled={!userId || isEnrolled === null}
          className="w-full h-auto rounded-xl py-3"
        >
          <ScanFace size={18} />
          <span>Enroll Face</span>
        </Button>
      )}
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
