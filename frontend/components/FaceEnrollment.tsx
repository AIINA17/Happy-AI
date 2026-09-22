"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ScanFace, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "./ConfirmDialog";

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
  | "naming"
  | "uploading"
  | "success"
  | "error";

const STABILITY_DURATION_MS = 1500;

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
  const [stableProgress, setStableProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const stableSinceRef = useRef<number | null>(null);
  const capturedBlobRef = useRef<Blob | null>(null);
  const [label, setLabel] = useState("");

  const [enrolledFace, setEnrolledFace] = useState<{
    label: string;
    created_at: string | null;
  } | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editingLabel, setEditingLabel] = useState("");

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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
    capturedBlobRef.current = null;
    setLabel("");

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

  const captureAndPreview = useCallback(async () => {
    try {
      const blob = await captureFrame();
      capturedBlobRef.current = blob;
      setPhase("naming");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Gagal mengambil foto";
      setErrorMessage(message);
      setPhase("error");
    }
  }, [captureFrame]);

  const fetchFaceInfo = useCallback(async () => {
    if (!userId) return;

    try {
      const response = await fetch(`${SERVER_URL}/face/${userId}`);
      if (!response.ok) return;

      const data = await response.json();

      if (data.has_face) {
        setEnrolledFace({
          label: data.label,
          created_at: data.created_at,
        });
      } else {
        setEnrolledFace(null);
      }
    } catch (err) {
      console.error("Fetch face info error:", err);
    }
  }, [userId, SERVER_URL]);

  const submitEnrollment = useCallback(async () => {
    if (!userId || !capturedBlobRef.current) {
      setErrorMessage("Data tidak lengkap. Coba ulang.");
      setPhase("error");
      return;
    }

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      return;
    }

    setPhase("uploading");

    try {
      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("label", trimmedLabel);
      formData.append("image", capturedBlobRef.current, "enroll.jpg");

      const response = await fetch(`${SERVER_URL}/enroll-face`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Enrollment gagal");
      }

      const result = await response.json();
      console.log("Enrollment success:", result);
      setPhase("success");
      setVerifyStatus(`Wajah "${trimmedLabel}" berhasil didaftarkan!`);

      await fetchFaceInfo();

      setTimeout(() => {
        closeModal();
      }, 2000);
    } catch (err) {
      console.error("Upload error:", err);
      const message =
        err instanceof Error ? err.message : "Gagal mengirim data ke server";
      setErrorMessage(message);
      setPhase("error");
      setVerifyStatus(`Face enrollment error: ${message}`);
    }
  }, [userId, SERVER_URL, label, setVerifyStatus, fetchFaceInfo]);

  const handleRename = useCallback(async () => {
    if (!userId || !editingLabel.trim()) return;

    try {
      const response = await fetch(`${SERVER_URL}/face/${userId}/label`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editingLabel.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Rename gagal");
      }

      await fetchFaceInfo();
      setIsEditing(false);
    } catch (err) {
      console.error("Rename error:", err);
      alert(err instanceof Error ? err.message : "Rename gagal");
    }
  }, [userId, SERVER_URL, editingLabel, fetchFaceInfo]);

  const handleDelete = useCallback(async () => {
    if (!userId) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`${SERVER_URL}/enroll-face/${userId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Delete gagal");
      }

      setEnrolledFace(null);
      setShowDeleteDialog(false);
    } catch (err) {
      console.error("Delete error:", err);
      alert("Gagal menghapus wajah");
    } finally {
      setIsDeleting(false);
    }
  }, [userId, SERVER_URL]);

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
      captureAndPreview();
    }
  }, [phase, captureAndPreview]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    fetchFaceInfo();
  }, [fetchFaceInfo]);

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
            {phase === "capturing" && "Wajah terdeteksi, sedang memotret..."}
            {phase === "naming" && "Beri nama untuk wajah kamu"}
            {phase === "uploading" && "Menyimpan wajah, mohon tunggu..."}
            {phase === "success" && "Wajah berhasil didaftarkan!"}
            {phase === "error" && errorMessage}
          </p>

          {phase === "naming" && (
            <div className="space-y-3 mb-4">
              <Input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Contoh: Wajah utama, Muka pagi..."
                className="h-11 rounded-lg"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && label.trim()) submitEnrollment();
                }}
              />
              <Button
                onClick={submitEnrollment}
                disabled={!label.trim()}
                className="w-full h-auto rounded-xl py-3"
              >
                Simpan Wajah
              </Button>
            </div>
          )}

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
        <span>{enrolledFace ? "Ganti Wajah" : "Enroll Face"}</span>
      </Button>

      {enrolledFace && (
        <div className="mt-3 p-4 rounded-xl bg-card border border-border/20">
          {isEditing ? (
            <div className="space-y-2">
              <Input
                type="text"
                value={editingLabel}
                onChange={(e) => setEditingLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setIsEditing(false);
                }}
                autoFocus
                className="h-10"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(false)}
                >
                  Batal
                </Button>
                <Button
                  size="sm"
                  onClick={handleRename}
                  disabled={!editingLabel.trim()}
                >
                  Simpan
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <span className="text-foreground text-sm">
                {enrolledFace.label}
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="p-1 rounded hover:bg-muted transition-colors cursor-pointer">
                    <MoreVertical size={16} className="text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditingLabel(enrolledFace.label);
                      setIsEditing(true);
                    }}
                  >
                    <Pencil />
                    <span>Rename</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 />
                    <span>Delete</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteDialog}
        type="delete"
        title="Hapus Wajah Terdaftar?"
        message="Kamu akan menghapus wajah"
        highlightText={enrolledFace?.label || ""}
        confirmText="Hapus"
        cancelText="Batal"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteDialog(false)}
        isLoading={isDeleting}
      />
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
