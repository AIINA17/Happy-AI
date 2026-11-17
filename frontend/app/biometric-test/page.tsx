"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FlaskConical, Mic, Square } from "lucide-react";
import type { Session } from "@supabase/supabase-js";

import FaceLivenessCapture, {
  type FaceVerifyOutcome,
} from "@/components/FaceLivenessCapture";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type TestResult = {
  time: string;
  type: "voice" | "face";
  decision: string;
  score: string;
  spoof_prob: string;
  duration_ms: string;
  verify_duration_ms: string;
  message: string;
};

const VOICE_RECORDING_SECONDS = 10;

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export default function BiometricTestPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(VOICE_RECORDING_SECONDS);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [faceOpen, setFaceOpen] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) setSession(data.session);
      else router.replace("/login");
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) router.replace("/login");
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [router]);

  const addResult = (result: TestResult) => {
    setResults((current) => [...current, result]);
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setIsRecording(false);
  };

  const startVoiceTest = async () => {
    if (!session?.access_token || isRecording) return;

    setVoiceMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      chunksRef.current = [];
      startedAtRef.current = performance.now();
      streamRef.current = stream;
      recorderRef.current = recorder;
      setCountdown(VOICE_RECORDING_SECONDS);
      setIsRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const startedAt = startedAtRef.current ?? performance.now();
        const durationMs = Math.round(performance.now() - startedAt);
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const form = new FormData();
        form.append("audio", blob, "biometric-test.webm");
        setVoiceMessage("Mengirim rekaman ke backend...");

        try {
          const response = await fetch(
            `${process.env.NEXT_PUBLIC_SERVER_URL}/verify-voice`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${session.access_token}` },
              body: form,
            },
          );
          const data = await response.json().catch(() => null);
          const decision = data?.decision || data?.status || "ERROR";
          const score =
            typeof data?.score === "number" ? data.score.toFixed(3) : "";
          const spoofProb =
            typeof data?.spoof_prob === "number"
              ? data.spoof_prob.toFixed(4)
              : "";
          const verifyDuration =
            typeof data?.verification_duration_ms === "number"
              ? String(data.verification_duration_ms)
              : "";
          const message = data?.reason || data?.detail || "";
          addResult({
            time: new Date().toISOString(),
            type: "voice",
            decision,
            score,
            spoof_prob: spoofProb,
            duration_ms: String(durationMs),
            verify_duration_ms: verifyDuration,
            message,
          });
          setVoiceMessage(
            response.ok
              ? `Hasil: ${decision}${score ? ` (score ${score})` : ""}`
              : `Gagal (${response.status}): ${message || "permintaan ditolak"}`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Koneksi gagal";
          addResult({
            time: new Date().toISOString(),
            type: "voice",
            decision: "ERROR",
            score: "",
            spoof_prob: "",
            duration_ms: String(durationMs),
            verify_duration_ms: "",
            message,
          });
          setVoiceMessage(`Gagal menghubungi backend: ${message}`);
        }
      };

      recorder.start();
      timerRef.current = setInterval(() => {
        setCountdown((current) => {
          if (current <= 1) {
            stopRecording();
            return 0;
          }
          return current - 1;
        });
      }, 1000);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Izin mikrofon ditolak";
      setVoiceMessage(`Tidak dapat merekam: ${message}`);
    }
  };

  const handleFaceResult = (outcome: FaceVerifyOutcome) => {
    addResult({
      time: new Date().toISOString(),
      type: "face",
      decision: outcome.decision,
      score:
        outcome.similarity === null ? "" : outcome.similarity.toFixed(3),
      spoof_prob: "",
      duration_ms: "",
      verify_duration_ms: "",
      message: outcome.message || "",
    });
  };

  const downloadCsv = () => {
    const header = [
      "time",
      "type",
      "decision",
      "score",
      "spoof_prob",
      "duration_ms",
      "verify_duration_ms",
      "message",
    ];
    const body = results.map((result) =>
      header.map((key) => csvCell(result[key as keyof TestResult])).join(","),
    );
    const blob = new Blob([[header.join(","), ...body].join("\n") as string], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `biometric-test-${new Date()
      .toISOString()
      .slice(0, 19)
      .replaceAll(":", "-")}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <main className="p-8 text-muted-foreground">Memuat...</main>;
  }

  if (!session) return null;

  return (
    <main className="min-h-screen bg-background p-6 text-foreground md:p-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Happy / Pengujian</p>
            <h1 className="text-2xl font-semibold">Uji Biometrik Mandiri</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pengujian ini tidak menghubungkan LiveKit atau agen. Setiap hasil
              verifikasi suara tetap dicatat backend ke Supabase.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.push("/")}>
            Kembali
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Mic size={20} />
              <h2 className="font-medium">Uji suara</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Tekan mulai, ucapkan kalimat uji, lalu tunggu rekaman otomatis
              selama {VOICE_RECORDING_SECONDS} detik.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={startVoiceTest} disabled={isRecording}>
                <Mic size={16} />
                Mulai rekam
              </Button>
              <Button
                variant="outline"
                onClick={stopRecording}
                disabled={!isRecording}
              >
                <Square size={16} />
                Berhenti
              </Button>
              {isRecording && (
                <span className="text-sm">{countdown} detik</span>
              )}
            </div>
            {voiceMessage && (
              <p className="mt-3 text-sm text-muted-foreground">
                {voiceMessage}
              </p>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <FlaskConical size={20} />
              <h2 className="font-medium">Uji wajah</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Jalankan kamera dan tantangan liveness tanpa membuat sesi agen.
            </p>
            <Button className="mt-4" onClick={() => setFaceOpen(true)}>
              Mulai uji wajah
            </Button>
            <FaceLivenessCapture
              userId={session.user.id}
              open={faceOpen}
              onOpenChange={setFaceOpen}
              onResult={handleFaceResult}
            />
          </section>
        </div>

        <section className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-medium">Hasil uji sesi ini ({results.length})</h2>
            <Button
              variant="outline"
              onClick={downloadCsv}
              disabled={!results.length}
            >
              <Download size={16} />
              Unduh CSV
            </Button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="p-2">Waktu</th>
                  <th className="p-2">Jenis</th>
                  <th className="p-2">Keputusan</th>
                  <th className="p-2">Score</th>
                  <th className="p-2">Spoof</th>
                  <th className="p-2">Durasi rekam (ms)</th>
                  <th className="p-2">Durasi verifikasi (ms)</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={`${result.time}-${index}`} className="border-b">
                    <td className="p-2 whitespace-nowrap">
                      {new Date(result.time).toLocaleTimeString()}
                    </td>
                    <td className="p-2">{result.type}</td>
                    <td className="p-2">{result.decision}</td>
                    <td className="p-2">{result.score || "-"}</td>
                    <td className="p-2">{result.spoof_prob || "-"}</td>
                    <td className="p-2">{result.duration_ms || "-"}</td>
                    <td className="p-2">{result.verify_duration_ms || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!results.length && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Belum ada hasil.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
