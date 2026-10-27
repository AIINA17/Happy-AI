"use client";

// Voice-embedding visualization — classic ML showcase for the capstone.
// Shows enrolled speaker vectors projected to 2-D via PCA, and lets the
// user record a live test sample that gets projected into the same 2-D
// space so audiences can SEE whether the test voice falls inside the
// enrolled cluster (accepted) or outside (rejected).
//
// Full-dimensional (256-D) cosine similarity is still what drives the
// accept/reject decision in production — the 2-D view here is a visual
// aid for interpretability only.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ZAxis,
} from "recharts";
import { Mic, Loader2, CheckCircle, XCircle } from "lucide-react";

import { supabase } from "@/lib/supabase";

interface Point {
  x: number;
  y: number;
  label: string;
}

interface Similarity {
  label: string;
  similarity: number;
}

// Decision threshold. If best cosine similarity ≥ this, we color the
// test dot as "accepted". Mirrors the backend's threshold philosophy —
// adjust if backend's decision_engine uses something different.
const ACCEPT_THRESHOLD = 0.75;

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;

// Palette for enrolled label clusters. Cycles if more labels than colors.
const COLORS = [
  "#60a5fa", // blue
  "#34d399", // emerald
  "#f59e0b", // amber
  "#a78bfa", // violet
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#fb7185", // rose
];

export default function EmbeddingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [enrolled, setEnrolled] = useState<Point[]>([]);
  const [testPoint, setTestPoint] = useState<Point | null>(null);
  const [similarities, setSimilarities] = useState<Similarity[]>([]);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [bestMatch, setBestMatch] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Auth gate
  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setSession(session);
      } else {
        router.replace("/login");
      }
      setIsLoading(false);
    };
    checkSession();
  }, [router]);

  // Load enrolled embeddings (2-D projections)
  const loadEnrolled = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`${SERVER_URL}/embeddings/visualize`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.status === "OK") {
        setEnrolled(data.points || []);
      }
    } catch (err) {
      console.error("Failed to load enrolled embeddings:", err);
    }
  }, [session]);

  useEffect(() => {
    loadEnrolled();
  }, [loadEnrolled]);

  // Group enrolled by label so each label gets its own colored Scatter.
  // Recharts Scatter accepts an array of {x, y}, so we build { labelName
  // -> points[] } then render one <Scatter> per group.
  const groupedByLabel = enrolled.reduce<Record<string, Point[]>>((acc, p) => {
    if (!acc[p.label]) acc[p.label] = [];
    acc[p.label].push(p);
    return acc;
  }, {});
  const uniqueLabels = Object.keys(groupedByLabel);

  // Start microphone recording. We ask for 3 seconds and auto-stop.
  const startRecording = useCallback(async () => {
    setErrorMsg(null);
    setTestPoint(null);
    setSimilarities([]);
    setBestScore(null);
    setBestMatch(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      chunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const form = new FormData();
        form.append("audio", blob, "test.webm");

        try {
          const res = await fetch(`${SERVER_URL}/embeddings/project`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session?.access_token}` },
            body: form,
          });

          if (!res.ok) {
            const text = await res.text();
            throw new Error(text);
          }

          const data = await res.json();
          setTestPoint({ x: data.live.x, y: data.live.y, label: "Test Voice" });
          setSimilarities(data.similarities || []);
          setBestScore(data.best_score);
          setBestMatch(data.best_match);
        } catch (err) {
          console.error("Projection failed:", err);
          setErrorMsg(
            err instanceof Error ? err.message : "Gagal memproses audio.",
          );
        } finally {
          setIsProcessing(false);
          // Stop the mic track
          stream.getTracks().forEach((t) => t.stop());
        }
      };

      mr.start();
      setIsRecording(true);

      // Auto-stop after 3 seconds
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 3000);
    } catch (err) {
      console.error("Mic access failed:", err);
      setErrorMsg("Gagal akses mikrofon. Izinkan mic di browser.");
      setIsRecording(false);
    }
  }, [session]);

  if (isLoading) {
    return (
      <main className="h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading…</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Redirecting to login…</div>
      </main>
    );
  }

  const accepted = bestScore !== null && bestScore >= ACCEPT_THRESHOLD;

  return (
    <main className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">
            Voice Embedding{" "}
            <span className="text-muted-foreground font-normal">
              / Visualizer
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            256-D speaker embeddings projected to 2-D via PCA. Record a test
            voice to see where it lands.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Scatter plot — takes 2/3 width */}
          <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Embedding Space (PCA 2D)</h2>
              <span className="text-xs text-muted-foreground">
                {enrolled.length} enrolled voices
              </span>
            </div>

            {enrolled.length === 0 ? (
              <div className="h-96 flex items-center justify-center text-muted-foreground text-sm text-center px-6">
                Belum ada enrollment voice. Daftarkan voice dulu di halaman
                utama (Enroll Voice).
              </div>
            ) : (
              <div className="h-96 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart
                    margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.08)"
                    />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="PC1"
                      stroke="rgba(255,255,255,0.5)"
                      fontSize={11}
                      label={{
                        value: "Principal Component 1",
                        position: "insideBottom",
                        offset: -8,
                        fill: "rgba(255,255,255,0.5)",
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="PC2"
                      stroke="rgba(255,255,255,0.5)"
                      fontSize={11}
                      label={{
                        value: "Principal Component 2",
                        angle: -90,
                        position: "insideLeft",
                        fill: "rgba(255,255,255,0.5)",
                        fontSize: 11,
                      }}
                    />
                    <ZAxis range={[80, 80]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      contentStyle={{
                        background: "rgba(20,20,25,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      iconType="circle"
                      wrapperStyle={{ fontSize: "11px" }}
                    />

                    {/* One Scatter per enrolled label for color grouping */}
                    {uniqueLabels.map((label, idx) => (
                      <Scatter
                        key={label}
                        name={label}
                        data={groupedByLabel[label]}
                        fill={COLORS[idx % COLORS.length]}
                      />
                    ))}

                    {/* Test voice point — star-shape by using large size +
                        distinct color (red = rejected, green = accepted) */}
                    {testPoint && (
                      <Scatter
                        name={`Test Voice ${
                          accepted ? "✓ ACCEPTED" : "✗ REJECTED"
                        }`}
                        data={[testPoint]}
                        fill={accepted ? "#10b981" : "#ef4444"}
                        shape="star"
                      />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Side panel — recording + results */}
          <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5 flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Test Voice</h2>

            <button
              onClick={startRecording}
              disabled={isRecording || isProcessing || enrolled.length < 2}
              className={`w-full h-32 rounded-xl flex flex-col items-center justify-center gap-2
                          transition-all font-semibold
                          ${
                            isRecording
                              ? "bg-rose-500/20 border-2 border-rose-500 text-rose-300"
                              : isProcessing
                                ? "bg-amber-500/20 border-2 border-amber-500 text-amber-300"
                                : enrolled.length < 2
                                  ? "bg-muted/30 border-2 border-border text-muted-foreground cursor-not-allowed"
                                  : "bg-primary/10 border-2 border-primary/60 text-primary hover:bg-primary/20"
                          }`}
            >
              {isRecording ? (
                <>
                  <span className="relative flex h-5 w-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-rose-500" />
                  </span>
                  <span className="text-sm">Recording… 3s</span>
                </>
              ) : isProcessing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm">Extracting embedding…</span>
                </>
              ) : (
                <>
                  <Mic className="w-8 h-8" />
                  <span className="text-sm">
                    {enrolled.length < 2
                      ? "Perlu ≥2 enrollment"
                      : "Klik untuk rekam"}
                  </span>
                </>
              )}
            </button>

            {errorMsg && (
              <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">
                {errorMsg}
              </div>
            )}

            {/* Result box */}
            {testPoint && bestScore !== null && (
              <div
                className={`rounded-xl p-4 border-2 ${
                  accepted
                    ? "bg-emerald-500/10 border-emerald-500/50"
                    : "bg-rose-500/10 border-rose-500/50"
                }`}
              >
                <div className="flex items-center gap-2 mb-3">
                  {accepted ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-rose-400" />
                  )}
                  <span
                    className={`font-bold text-lg ${
                      accepted ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {accepted ? "ACCEPTED" : "REJECTED"}
                  </span>
                </div>

                <div className="text-xs text-muted-foreground mb-1">
                  Best match: <span className="text-foreground">{bestMatch}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Cosine similarity:{" "}
                  <span className="text-foreground font-mono">
                    {bestScore.toFixed(4)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    (threshold {ACCEPT_THRESHOLD})
                  </span>
                </div>
              </div>
            )}

            {/* Similarity breakdown */}
            {similarities.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Similarity ke setiap enrollment
                </div>
                <div className="space-y-1.5">
                  {similarities
                    .sort((a, b) => b.similarity - a.similarity)
                    .map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="truncate">{s.label}</span>
                        <span className="font-mono tabular-nums">
                          {s.similarity.toFixed(3)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {!testPoint && (
              <div className="text-xs text-muted-foreground">
                Tekan tombol di atas, ngomong apa aja selama 3 detik. Backend
                akan ekstrak embedding voice lu, proyeksikan ke PCA 2D yang
                sama dengan enrollment, dan tunjukin lokasinya di chart.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
