"use client";

import { Mic, Square } from "lucide-react";
import { useRef, useState } from "react";

import { useNotification } from "@/contexts/NotificationContext";
import type { PipelineTrace } from "./types";

const MAX_RECORD_SEC = 8;

export function LiveCapturePanel({
  token,
  apiBaseUrl,
  onResult,
}: {
  token: string;
  apiBaseUrl: string;
  onResult: (trace: PipelineTrace) => void;
}) {
  const { notify } = useNotification();
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopRecording = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      recorderRef.current = recorder;
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);

        const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
        await uploadAndVerify(blob);
      };

      recorder.start();
      setIsRecording(true);

      timerRef.current = setTimeout(stopRecording, MAX_RECORD_SEC * 1000);
    } catch {
      notify({
        variant: "error",
        title: "Akses mikrofon gagal",
        description:
          "Izinkan akses mikrofon di browser (butuh HTTPS atau localhost).",
      });
    }
  };

  const uploadAndVerify = async (blob: Blob) => {
    setIsUploading(true);

    const form = new FormData();
    form.append("audio", blob, "live.webm");

    try {
      const res = await fetch(`${apiBaseUrl}/verify-voice/explain`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        notify({
          variant: "error",
          title: "Verifikasi gagal",
          description: data?.detail || `Server mengembalikan ${res.status}.`,
        });
        return;
      }

      onResult(data as PipelineTrace);
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

  return (
    <div className="flex items-center gap-3">
      {!isRecording && (
        <button
          onClick={startRecording}
          disabled={isUploading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-sm text-(--text-primary) hover:border-(--border-color)/60 cursor-pointer disabled:opacity-50"
        >
          <Mic size={16} />
          {isUploading ? "Memverifikasi..." : "Rekam & verifikasi (live)"}
        </button>
      )}
      {isRecording && (
        <button
          onClick={stopRecording}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 cursor-pointer"
        >
          <Square size={14} />
          Stop rekam
        </button>
      )}
      <p className="text-xs text-(--text-muted)">
        Maks {MAX_RECORD_SEC}s · tidak mengubah histori/behavior profile akun
        ini.
      </p>
    </div>
  );
}
