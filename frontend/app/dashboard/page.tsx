"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import {
  MessageSquare,
  Calendar,
  Activity,
  TrendingUp,
  Clock,
  Zap,
  Mic,
  Loader2,
  CheckCircle,
  XCircle,
} from "lucide-react";

import { supabase } from "@/lib/supabase";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  interface Kpis {
    totalSessions: number;
    totalMessages: number;
    sessionsToday: number;
    avgMessagesPerSession: number;
  }

  const [kpis, setKpis] = useState<Kpis>({
    totalSessions: 0,
    totalMessages: 0,
    sessionsToday: 0,
    avgMessagesPerSession: 0,
  });
  const [kpiLoading, setKpiLoading] = useState(true);

  interface DailyPoint {
    day: string;
    sessions: number;
  }

  const [dailySessions, setDailySessions] = useState<DailyPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);

  interface RolePoint {
    name: string;
    value: number;
  }

  const [roleData, setRoleData] = useState<RolePoint[]>([]);
  const [roleLoading, setRoleLoading] = useState(true);

  interface LatencyPoint {
    turn: number;
    seconds: number;
  }

  const [latencies, setLatencies] = useState<LatencyPoint[]>([]);
  const [latencyLoading, setLatencyLoading] = useState(true);

  interface RecentSession {
    id: string;
    label: string;
    created_at: string;
    message_count: number;
  }

  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  // "Live now" — sessions created in the last 5 minutes. Polled every 10 s
  // so the number ticks up / down during the demo while juri is watching.
  const [liveSessions, setLiveSessions] = useState<number>(0);
  const [avgLatency, setAvgLatency] = useState<number>(0);

  // ================= EMBEDDING VISUALIZER STATE =================
  // Voice embeddings projected from 256-D down to 2-D via PCA. Shown
  // as a scatter plot so the audience can SEE the enrolled speaker
  // clusters and where a live test sample lands.
  interface EmbPoint {
    x: number;
    y: number;
    label: string;
  }
  interface Similarity {
    label: string;
    similarity: number;
  }

  const [enrolledPoints, setEnrolledPoints] = useState<EmbPoint[]>([]);
  const [testPoint, setTestPoint] = useState<EmbPoint | null>(null);
  const [similarities, setSimilarities] = useState<Similarity[]>([]);
  const [bestScore, setBestScore] = useState<number | null>(null);
  const [bestMatch, setBestMatch] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [embErrorMsg, setEmbErrorMsg] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Live verification dots streamed from Supabase realtime. Each dot
  // is a voice sample the backend verified during an active session.
  // The newest dot pulses so demo audiences can spot the fresh one.
  interface LivePoint {
    x: number;
    y: number;
    decision: string;
    created_at: string;
    all_scores?: { label: string; score: number }[];
    label?: string | null;
    speaker_score?: number | null;
  }
  const [livePoints, setLivePoints] = useState<LivePoint[]>([]);

  const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL;
  const ACCEPT_THRESHOLD = 0.75;
  const EMB_COLORS = [
    "#60a5fa",
    "#34d399",
    "#f59e0b",
    "#a78bfa",
    "#f472b6",
    "#22d3ee",
    "#fb7185",
  ];

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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) {
        router.replace("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!session) return;

    const loadKpis = async () => {
      setKpiLoading(true);
      try {
        // 1. Total sessions all-time
        const { count: totalSessions } = await supabase
          .from("conversation_sessions")
          .select("*", { count: "exact", head: true });

        // 2. Total conversation log entries (= total messages)
        const { count: totalMessages } = await supabase
          .from("conversation_logs")
          .select("*", { count: "exact", head: true });

        // 3. Sessions created today (midnight local -> now)
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const { count: sessionsToday } = await supabase
          .from("conversation_sessions")
          .select("*", { count: "exact", head: true })
          .gte("created_at", startOfDay.toISOString());

        // 4. Avg messages per session (simple divide — don't need
        //    a fancy GROUP BY for a top-level KPI).
        const avgMessagesPerSession = totalSessions
          ? (totalMessages || 0) / totalSessions
          : 0;

        setKpis({
          totalSessions: totalSessions || 0,
          totalMessages: totalMessages || 0,
          sessionsToday: sessionsToday || 0,
          avgMessagesPerSession,
        });
      } catch (err) {
        console.error("Failed to load KPIs:", err);
      } finally {
        setKpiLoading(false);
      }
    };

    loadKpis();
    // Re-fetch every 10 s so numbers tick up live during the demo
    const id = setInterval(loadKpis, 10_000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const loadDaily = async () => {
      setChartLoading(true);
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const { data, error } = await supabase
          .from("conversation_sessions")
          .select("created_at")
          .gte("created_at", sevenDaysAgo.toISOString());

        if (error) throw error;

        const buckets = new Map<string, number>();
        const dayLabels = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          d.setHours(0, 0, 0, 0);
          const key = d.toISOString().slice(0, 10);
          buckets.set(key, 0);
        }

        for (const row of data || []) {
          const key = row.created_at.slice(0, 10);
          if (buckets.has(key)) {
            buckets.set(key, (buckets.get(key) || 0) + 1);
          }
        }

        const points: DailyPoint[] = Array.from(buckets.entries()).map(
          ([date, count]) => {
            const dow = new Date(date).getDay();
            return { day: dayLabels[dow], sessions: count };
          },
        );

        setDailySessions(points);
      } catch (err) {
        console.error("Failed to load daily sessions:", err);
      } finally {
        setChartLoading(false);
      }
    };

    loadDaily();
    const id = setInterval(loadDaily, 15_000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const loadRoles = async () => {
      setRoleLoading(true);
      try {
        // Count user messages
        const { count: userCount } = await supabase
          .from("conversation_logs")
          .select("*", { count: "exact", head: true })
          .eq("role", "user");

        // Count assistant messages
        const { count: assistantCount } = await supabase
          .from("conversation_logs")
          .select("*", { count: "exact", head: true })
          .eq("role", "assistant");

        setRoleData([
          { name: "User", value: userCount || 0 },
          { name: "Happy", value: assistantCount || 0 },
        ]);
      } catch (err) {
        console.error("Failed to load role data:", err);
      } finally {
        setRoleLoading(false);
      }
    };

    loadRoles();
    const id = setInterval(loadRoles, 15_000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (!session) return;

    const loadLatencies = async () => {
      setLatencyLoading(true);
      try {
        const { data, error } = await supabase
          .from("conversation_logs")
          .select("session_id, role, created_at")
          .order("created_at", { ascending: true })
          .limit(200);

        if (error) throw error;

        const bySession = new Map<
          string,
          { role: string; created_at: string }[]
        >();

        for (const row of data || []) {
          const arr = bySession.get(row.session_id) || [];
          arr.push({ role: row.role, created_at: row.created_at });
          bySession.set(row.session_id, arr);
        }

        const pairs: number[] = [];
        for (const logs of bySession.values()) {
          for (let i = 0; i < logs.length - 1; i++) {
            if (logs[i].role === "user" && logs[i + 1].role === "assistant") {
              const diff =
                (new Date(logs[i + 1].created_at).getTime() -
                  new Date(logs[i].created_at).getTime()) /
                1000;
              if (diff > 0 && diff < 60) pairs.push(diff);
            }
          }
        }

        const last30 = pairs.slice(-30);
        const points: LatencyPoint[] = last30.map((seconds, i) => ({
          turn: i + 1,
          seconds: Number(seconds.toFixed(2)),
        }));

        setLatencies(points);
      } catch (err) {
        console.error("Failed to load latencies:", err);
      } finally {
        setLatencyLoading(false);
      }
    };

    loadLatencies();
    const id = setInterval(loadLatencies, 10_000);
    return () => clearInterval(id);
  }, [session]);

  // Recent sessions — table di bawah charts
  useEffect(() => {
    if (!session) return;

    const loadRecent = async () => {
      setRecentLoading(true);
      try {
        const { data: sessions, error } = await supabase
          .from("conversation_sessions")
          .select("id, label, created_at")
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) throw error;

        // Count messages per session (parallel queries)
        const withCounts = await Promise.all(
          (sessions || []).map(async (s) => {
            const { count } = await supabase
              .from("conversation_logs")
              .select("*", { count: "exact", head: true })
              .eq("session_id", s.id);
            return {
              id: s.id,
              label: s.label || "Untitled session",
              created_at: s.created_at,
              message_count: count || 0,
            };
          }),
        );

        setRecentSessions(withCounts);
      } catch (err) {
        console.error("Failed to load recent sessions:", err);
      } finally {
        setRecentLoading(false);
      }
    };

    loadRecent();
    const id = setInterval(loadRecent, 10_000);
    return () => clearInterval(id);
  }, [session]);

  // Live polling — count sessions in last 5 minutes + avg of latest latencies.
  // Runs every 10 seconds so the KPI chip at the top ticks live during demo.
  useEffect(() => {
    if (!session) return;

    const tick = async () => {
      try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { count } = await supabase
          .from("conversation_sessions")
          .select("*", { count: "exact", head: true })
          .gte("created_at", fiveMinAgo);
        setLiveSessions(count || 0);
      } catch (err) {
        console.error("Live poll failed:", err);
      }
    };

    tick(); // initial fire
    const id = setInterval(tick, 10_000); // every 10s
    return () => clearInterval(id);
  }, [session]);

  // Keep avgLatency in sync with the latencies chart data
  useEffect(() => {
    if (latencies.length === 0) {
      setAvgLatency(0);
      return;
    }
    const sum = latencies.reduce((acc, p) => acc + p.seconds, 0);
    setAvgLatency(Number((sum / latencies.length).toFixed(2)));
  }, [latencies]);

  // ================= EMBEDDING VISUALIZER LOGIC =================
  // Load enrolled embeddings (2-D projections) from backend
  const loadEnrolledEmbeddings = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`${SERVER_URL}/embeddings/visualize`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.status === "OK") {
        setEnrolledPoints(data.points || []);
      }
    } catch (err) {
      console.error("Failed to load enrolled embeddings:", err);
    }
  }, [session, SERVER_URL]);

  useEffect(() => {
    loadEnrolledEmbeddings();
  }, [loadEnrolledEmbeddings]);

  // ============ LIVE VERIFICATION DOTS (Supabase Realtime) ============
  // 1. On mount: hydrate with the last 30 verification events so the
  //    chart has history to show, not just events-from-now.
  // 2. Then subscribe to INSERT events on voice_verification_logs so
  //    every new verification (during a live session) animates in
  //    without reload.
  useEffect(() => {
    if (!session) return;

    // Hydrate
    const loadHistory = async () => {
      const { data } = await supabase
        .from("voice_verification_logs")
        .select(
          "pca_x, pca_y, decision, created_at, all_scores, label, speaker_score",
        )
        .not("pca_x", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (data) {
        setLivePoints(
          data.reverse().map((d) => ({
            x: d.pca_x,
            y: d.pca_y,
            decision: d.decision,
            created_at: d.created_at,
            all_scores: d.all_scores || [],
            label: d.label,
            speaker_score: d.speaker_score,
          })),
        );
      }
    };
    loadHistory();

    // Subscribe
    const channel = supabase
      .channel("voice-verification-live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "voice_verification_logs",
        },
        (payload) => {
          const row = payload.new as {
            pca_x?: number;
            pca_y?: number;
            decision?: string;
            created_at?: string;
            all_scores?: { label: string; score: number }[];
            label?: string | null;
            speaker_score?: number | null;
          };
          if (row.pca_x == null || row.pca_y == null) return;
          setLivePoints((prev) => {
            const next = [
              ...prev,
              {
                x: row.pca_x!,
                y: row.pca_y!,
                decision: row.decision || "UNKNOWN",
                created_at: row.created_at || new Date().toISOString(),
                all_scores: row.all_scores || [],
                label: row.label,
                speaker_score: row.speaker_score,
              },
            ];
            return next.slice(-30);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Record 3s audio and project it to the same PCA space.
  // Backend returns the 2-D coordinate + cosine similarity to each
  // enrolled vector so we can color the test dot (green = accepted).
  const startEmbRecording = useCallback(async () => {
    setEmbErrorMsg(null);
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
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          setTestPoint({
            x: data.live.x,
            y: data.live.y,
            label: "Test Voice",
          });
          setSimilarities(data.similarities || []);
          setBestScore(data.best_score);
          setBestMatch(data.best_match);
        } catch (err) {
          console.error("Projection failed:", err);
          setEmbErrorMsg(
            err instanceof Error ? err.message : "Gagal memproses audio.",
          );
        } finally {
          setIsProcessing(false);
          stream.getTracks().forEach((t) => t.stop());
        }
      };

      mr.start();
      setIsRecording(true);

      // Auto-stop after 3 seconds — enough speech for a stable embedding
      setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, 3000);
    } catch (err) {
      console.error("Mic access failed:", err);
      setEmbErrorMsg("Gagal akses mikrofon. Izinkan mic di browser.");
      setIsRecording(false);
    }
  }, [session, SERVER_URL]);

  // Group enrolled points by label so each gets its own colored Scatter
  const groupedByLabel = enrolledPoints.reduce<Record<string, EmbPoint[]>>(
    (acc, p) => {
      if (!acc[p.label]) acc[p.label] = [];
      acc[p.label].push(p);
      return acc;
    },
    {},
  );
  const uniqueLabels = Object.keys(groupedByLabel);
  const accepted = bestScore !== null && bestScore >= ACCEPT_THRESHOLD;

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

  return (
    <main className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              Happy{" "}
              <span className="text-muted-foreground font-normal">
                / Live Dashboard
              </span>
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time session &amp; agent telemetry
            </p>
          </div>

          {/* Live indicator chip — pulsing dot + active-now count.
              The dot animation signals the dashboard is still polling
              instead of showing stale data. */}
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span className="text-xs font-medium text-emerald-300">
              {liveSessions} active · last 5 min
            </span>
          </div>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <KpiCard
            icon={<Activity className="w-5 h-5 text-blue-400" />}
            label="Total Session"
            value={kpis.totalSessions.toLocaleString("id-ID")}
            loading={kpiLoading}
          />
          <KpiCard
            icon={<MessageSquare className="w-5 h-5 text-emerald-400" />}
            label="Total Message"
            value={kpis.totalMessages.toLocaleString("id-ID")}
            loading={kpiLoading}
          />
          <KpiCard
            icon={<Calendar className="w-5 h-5 text-amber-400" />}
            label="Session Hari Ini"
            value={kpis.sessionsToday.toLocaleString("id-ID")}
            loading={kpiLoading}
          />
          <KpiCard
            icon={<TrendingUp className="w-5 h-5 text-purple-400" />}
            label="Avg Msg / Session"
            value={kpis.avgMessagesPerSession.toFixed(1)}
            loading={kpiLoading}
          />
          <KpiCard
            icon={<Clock className="w-5 h-5 text-rose-400" />}
            label="Avg Latency"
            value={avgLatency > 0 ? `${avgLatency}s` : "—"}
            loading={latencyLoading}
          />
          <KpiCard
            icon={<Zap className="w-5 h-5 text-cyan-400" />}
            label="Live Sessions"
            value={liveSessions.toString()}
            loading={false}
          />
        </section>
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {/* Session per Hari — ambil 2/3 lebar di desktop */}
          <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Session per Hari</h2>
              <span className="text-xs text-muted-foreground">Last 7 days</span>
            </div>

            {chartLoading ? (
              <div className="h-64 bg-muted/20 rounded-lg animate-pulse" />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailySessions}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.08)"
                    />
                    <XAxis
                      dataKey="day"
                      stroke="rgba(255,255,255,0.5)"
                      fontSize={12}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="rgba(255,255,255,0.5)"
                      fontSize={12}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(20,20,25,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar
                      dataKey="sessions"
                      fill="#60a5fa"
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">User vs Happy</h2>
              <span className="text-xs text-muted-foreground">All time</span>
            </div>

            {roleLoading ? (
              <div className="h-64 bg-muted/20 rounded-lg animate-pulse" />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={roleData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      <Cell fill="#60a5fa" />
                      <Cell fill="#34d399" />
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "rgba(20,20,25,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      wrapperStyle={{ fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        {/* Latency per Turn — paling "production-vibes" buat juri */}
        <section className="mb-8">
          <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Latency per Turn</h2>
              <span className="text-xs text-muted-foreground">
                Last 30 turns · lower = snappier
              </span>
            </div>

            {latencyLoading ? (
              <div className="h-64 bg-muted/20 rounded-lg animate-pulse" />
            ) : latencies.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                Belum ada data turn
              </div>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={latencies}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.08)"
                    />
                    <XAxis
                      dataKey="turn"
                      stroke="rgba(255,255,255,0.5)"
                      fontSize={12}
                      label={{
                        value: "Turn #",
                        position: "insideBottom",
                        offset: -5,
                        fill: "rgba(255,255,255,0.5)",
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      stroke="rgba(255,255,255,0.5)"
                      fontSize={12}
                      label={{
                        value: "Seconds",
                        angle: -90,
                        position: "insideLeft",
                        fill: "rgba(255,255,255,0.5)",
                        fontSize: 11,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(20,20,25,0.95)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      formatter={(v) => [`${v}s`, "Latency"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="seconds"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      dot={{ fill: "#a78bfa", r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </section>

        {/* Recent sessions table */}
        <section className="mb-8">
          <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Recent Sessions</h2>
              <span className="text-xs text-muted-foreground">
                Last 10 sessions
              </span>
            </div>

            {recentLoading ? (
              <div className="h-48 bg-muted/20 rounded-lg animate-pulse" />
            ) : recentSessions.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                Belum ada session
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground uppercase tracking-wide border-b border-border/60">
                      <th className="text-left font-medium py-2 pr-4">
                        Session
                      </th>
                      <th className="text-left font-medium py-2 pr-4">
                        Started
                      </th>
                      <th className="text-right font-medium py-2 pr-4">
                        Messages
                      </th>
                      <th className="text-right font-medium py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSessions.map((s) => {
                      const started = new Date(s.created_at);
                      const ageMs = Date.now() - started.getTime();
                      const isLive = ageMs < 5 * 60 * 1000;
                      const timeLabel = started.toLocaleString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "short",
                      });
                      return (
                        <tr
                          key={s.id}
                          className="border-b border-border/30 hover:bg-muted/20 transition-colors"
                        >
                          <td className="py-3 pr-4 font-medium truncate max-w-xs">
                            {s.label}
                          </td>
                          <td className="py-3 pr-4 text-muted-foreground tabular-nums">
                            {timeLabel}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            {s.message_count}
                          </td>
                          <td className="py-3 text-right">
                            {isLive ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                live
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                ended
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* ========= VOICE EMBEDDING VISUALIZER ========= */}
        {/* 256-D speaker embeddings projected to 2-D via PCA. Record a
            test voice -> see where it lands relative to enrolled clusters. */}
        <section className="mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Scatter chart */}
            <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h2 className="text-lg font-semibold">
                    Voice Embedding Space
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    256-D speaker vectors · PCA 2-D · live stream dari
                    session aktif
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {enrolledPoints.length} enrolled
                  </span>
                  <span
                    className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1"
                    title={`${livePoints.length} verifikasi suara dari realtime stream (max 30 yg paling baru).`}
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                    </span>
                    <span className="text-xs font-medium text-emerald-300">
                      {livePoints.length} verifikasi
                    </span>
                  </span>
                </div>
              </div>

              {enrolledPoints.length === 0 ? (
                <div className="h-80 flex items-center justify-center text-muted-foreground text-sm text-center px-6">
                  Belum ada enrollment voice. Daftarkan voice dulu di halaman
                  utama (Enroll Voice) untuk melihat visualisasi.
                </div>
              ) : (
                <div className="h-80 w-full">
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
                        content={<EmbeddingTooltip />}
                      />
                      <Legend
                        verticalAlign="top"
                        iconType="circle"
                        wrapperStyle={{ fontSize: "11px" }}
                      />

                      {uniqueLabels.map((label, idx) => (
                        <Scatter
                          key={label}
                          name={label}
                          data={groupedByLabel[label]}
                          fill={EMB_COLORS[idx % EMB_COLORS.length]}
                        />
                      ))}

                      {/* Live realtime dots — colored by RECENCY instead
                          of decision. Older events = orange (fade back),
                          the latest event pops in bright red so viewers
                          can instantly spot "yg paling baru". Decision
                          (VERIFIED/REJECTED) tetap keliatan di tooltip
                          when they hover. */}
                      {livePoints.length > 1 && (
                        <Scatter
                          name="Live · older"
                          data={livePoints.slice(0, -1)}
                          fill="#f59e0b"
                          fillOpacity={0.55}
                          shape="triangle"
                        />
                      )}
                      {livePoints.length > 0 && (
                        <Scatter
                          name="Live · newest"
                          data={[livePoints[livePoints.length - 1]]}
                          fill="#dc2626"
                          shape="triangle"
                        />
                      )}

                      {testPoint && (
                        <Scatter
                          name={`Test ${accepted ? "✓ ACCEPTED" : "✗ REJECTED"}`}
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
                onClick={startEmbRecording}
                disabled={
                  isRecording || isProcessing || enrolledPoints.length < 2
                }
                className={`w-full h-28 rounded-xl flex flex-col items-center justify-center gap-2
                            transition-all font-semibold
                            ${
                              isRecording
                                ? "bg-rose-500/20 border-2 border-rose-500 text-rose-300"
                                : isProcessing
                                  ? "bg-amber-500/20 border-2 border-amber-500 text-amber-300"
                                  : enrolledPoints.length < 2
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
                    <span className="text-sm">Extracting…</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-7 h-7" />
                    <span className="text-sm">
                      {enrolledPoints.length < 2
                        ? "Perlu ≥2 enrollment"
                        : "Klik untuk rekam"}
                    </span>
                  </>
                )}
              </button>

              {embErrorMsg && (
                <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg p-2">
                  {embErrorMsg}
                </div>
              )}

              {testPoint && bestScore !== null && (
                <div
                  className={`rounded-xl p-3 border-2 ${
                    accepted
                      ? "bg-emerald-500/10 border-emerald-500/50"
                      : "bg-rose-500/10 border-rose-500/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {accepted ? (
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400" />
                    )}
                    <span
                      className={`font-bold ${
                        accepted ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {accepted ? "ACCEPTED" : "REJECTED"}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Match:{" "}
                    <span className="text-foreground">{bestMatch}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Kemiripan:{" "}
                    <span className="text-foreground font-mono">
                      {(bestScore * 100).toFixed(1)}%
                    </span>{" "}
                    <span>(threshold {(ACCEPT_THRESHOLD * 100).toFixed(0)}%)</span>
                  </div>
                </div>
              )}

              {similarities.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Kemiripan ke setiap enrollment
                  </div>
                  <div className="space-y-1.5">
                    {similarities
                      .sort((a, b) => b.similarity - a.similarity)
                      .map((s, i) => {
                        const percent = s.similarity * 100;
                        const passed = s.similarity >= ACCEPT_THRESHOLD;
                        return (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="truncate flex-1">{s.label}</span>
                            {/* Progress bar + percent — more visually
                                scannable than raw numbers in a line. */}
                            <div className="flex items-center gap-2 min-w-[90px]">
                              <div className="w-14 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                                <div
                                  className={`h-full ${
                                    passed ? "bg-emerald-400" : "bg-rose-400"
                                  }`}
                                  style={{
                                    width: `${Math.max(0, Math.min(100, percent))}%`,
                                  }}
                                />
                              </div>
                              <span className="font-mono tabular-nums w-11 text-right">
                                {percent.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {!testPoint && !embErrorMsg && (
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Backend akan ekstrak embedding voice lu, proyeksikan ke PCA
                  space yang sama dengan enrollment, dan tunjukin lokasinya
                  di chart.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading?: boolean;
}

function KpiCard({ icon, label, value, loading }: KpiCardProps) {
  return (
    <div
      className="rounded-xl border border-border/60 bg-card/60
                       backdrop-blur-sm p-4 flex flex-col gap-2
                       hover:border-border transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        {icon}
      </div>
      <div className="text-3xl font-bold tabular-nums">
        {loading ? (
          <span className="inline-block w-16 h-8 bg-muted/40 rounded animate-pulse" />
        ) : (
          value
        )}
      </div>
    </div>
  );
}

/* ============ CUSTOM TOOLTIP FOR EMBEDDING SCATTER ============
   Recharts default tooltip shows "x: 0.42, y: -0.11" which is
   meaningless to users. This one is content-aware:
   - If payload is an enrolled dot → shows the label
   - If payload is a live triangle → shows decision + per-enrollment %
   - If payload is the test star → shows "Test Voice"
*/
interface TooltipPayload {
  payload?: {
    label?: string;
    decision?: string;
    speaker_score?: number | null;
    all_scores?: { label: string; score: number }[];
    created_at?: string;
  };
}

function EmbeddingTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  const isLive =
    d.decision !== undefined &&
    (d.decision === "VERIFIED" || d.decision === "REPEAT" || d.decision === "DENIED");
  const isTest = d.label === "Test Voice";

  return (
    <div className="rounded-lg border border-border/60 bg-background/95 backdrop-blur-md p-3 text-xs shadow-lg min-w-[180px]">
      {isLive ? (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`font-bold ${
                d.decision === "VERIFIED"
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {d.decision}
            </span>
            {d.created_at && (
              <span className="text-muted-foreground">
                {new Date(d.created_at).toLocaleTimeString("id-ID")}
              </span>
            )}
          </div>
          {d.all_scores && d.all_scores.length > 0 ? (
            <>
              <div className="text-muted-foreground mb-1 uppercase tracking-wide text-[10px]">
                Kemiripan ke enrollment
              </div>
              <div className="space-y-0.5">
                {[...d.all_scores]
                  .sort((a, b) => b.score - a.score)
                  .map((s, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <span className="truncate">{s.label}</span>
                      <span className="font-mono tabular-nums">
                        {(s.score * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
            </>
          ) : d.speaker_score != null ? (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Best score:</span>
              <span className="font-mono">
                {(d.speaker_score * 100).toFixed(1)}%
              </span>
            </div>
          ) : null}
        </>
      ) : isTest ? (
        <div className="font-semibold text-primary">⭐ Test Voice</div>
      ) : (
        <div className="font-semibold">{d.label || "Enrolled voice"}</div>
      )}
    </div>
  );
}
