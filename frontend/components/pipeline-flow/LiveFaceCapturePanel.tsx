"use client";

import { Camera, X } from "lucide-react";
import { useRef, useState } from "react";

import { useNotification } from "@/contexts/NotificationContext";
import type { FaceScenario } from "./faceTypes";

// Simple camera-snapshot capture for the live face-recognition demo — no
// liveness gesture challenge (unlike FaceLivenessCapture.tsx's production
// flow), matching /face/verify-face/explain's same "recognition-only, no
// liveness_token" path the existing /face/verify-face already supports.
export function LiveFaceCapturePanel({
  token,
  apiBaseUrl,
  onResult,
}: {
  token: string;
  apiBaseUrl: string;
  onResult: (scenario: FaceScenario) => void;
}) {
  const { notify } = useNotification();
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setIsOpen(false);
  };

  const openCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      setIsOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch {
      notify({
        variant: "error",
        title: "Akses kamera gagal",
        description: "Izinkan akses kamera di browser (butuh HTTPS atau localhost).",
      });
    }
  };

  const uploadAndVerify = async (blob: Blob) => {
    setIsUploading(true);
    const form = new FormData();
    form.append("image", blob, "live.jpg");

    try {
      const res = await fetch(`${apiBaseUrl}/face/verify-face/explain`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        notify({
          variant: "error",
          title: "Verifikasi wajah gagal",
          description: data?.detail || `Server mengembalikan ${res.status}.`,
        });
        return;
      }

      onResult(data as FaceScenario);
    } catch {
      notify({
        variant: "error",
        title: "Tidak bisa menghubungi backend",
        description: "Periksa NEXT_PUBLIC_SERVER_URL dan koneksi backend.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const capture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        closeCamera();
        await uploadAndVerify(blob);
      },
      "image/jpeg",
      0.9,
    );
  };

  if (isOpen) {
    return (
      <div className="flex items-center gap-3">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-32 h-24 rounded-lg bg-slate-900 object-cover border border-slate-300"
        />
        <div className="flex flex-col gap-1.5">
          <button
            onClick={capture}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs hover:bg-emerald-700 cursor-pointer"
          >
            <Camera size={13} /> Ambil foto
          </button>
          <button
            onClick={closeCamera}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            <X size={13} /> Batal
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={openCamera}
      disabled={isUploading}
      className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
    >
      <Camera size={16} />
      {isUploading ? "Memverifikasi..." : "Buka kamera & verifikasi wajah (live)"}
    </button>
  );
}
