"use client";

// Pipeline explainer: walks a voice-verification attempt from raw audio to
// the final VERIFIED/REPEAT/DENIED decision, one real stage at a time.
// Replay mode (default) reads a static, pre-captured JSON — no backend
// dependency, so this always works regardless of booth wifi/server state.

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

import { AntiSpoofArchitectureDiagram } from "@/components/pipeline/AntiSpoofArchitectureDiagram";
import { BehaviorProfilePanel } from "@/components/pipeline/BehaviorProfilePanel";
import { DecisionCascade } from "@/components/pipeline/DecisionCascade";
import { EcapaArchitectureDiagram } from "@/components/pipeline/EcapaArchitectureDiagram";
import { EmbeddingFingerprint } from "@/components/pipeline/EmbeddingFingerprint";
import { FinalDecisionBadge } from "@/components/pipeline/FinalDecisionBadge";
import { LiveCapturePanel } from "@/components/pipeline/LiveCapturePanel";
import { PipelineStage } from "@/components/pipeline/PipelineStage";
import { ScenarioPicker } from "@/components/pipeline/ScenarioPicker";
import { ThresholdGauge } from "@/components/pipeline/ThresholdGauge";
import { WaveformPreview } from "@/components/pipeline/WaveformPreview";
import type { PipelineTrace } from "@/components/pipeline/types";
import { useSequentialReveal } from "@/hooks/useSequentialReveal";
import { supabase } from "@/lib/supabase";
import { normalizePublicServerUrl } from "@/lib/utils";

const STAGE_COUNT = 5;

export default function PipelinePage() {
  const [traces, setTraces] = useState<PipelineTrace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveTrace, setLiveTrace] = useState<PipelineTrace | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const apiBaseUrl = normalizePublicServerUrl(
    process.env.NEXT_PUBLIC_SERVER_URL,
  );

  const { activeStage, play, showAll, reset } = useSequentialReveal(
    STAGE_COUNT,
    700,
  );

  useEffect(() => {
    fetch("/pipeline-demo/traces.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: PipelineTrace[]) => {
        setTraces(data);
        if (data.length > 0) setSelectedId(data[0].scenario_id);
      })
      .catch(() =>
        setError(
          "Gagal memuat data skenario (public/pipeline-demo/traces.json).",
        ),
      );
  }, []);

  // Replay mode never needs a login — only the "coba live" toggle does, and
  // only when it's actually used. No redirect on missing session: a judge
  // reading this page shouldn't get bounced to /login.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    reset();
  }, [selectedId, liveTrace, reset]);

  const trace = liveTrace ?? traces.find((t) => t.scenario_id === selectedId) ?? null;

  return (
    <main className="min-h-screen bg-(--bg-primary) overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-(--text-primary)">
            Alur Verifikasi Suara
          </h1>
          <p className="text-sm text-(--text-muted) mt-1">
            Dari audio masuk sampai keputusan VERIFIED / REPEAT / DENIED —
            data nyata dari speaker verification (ECAPA-TDNN) dan
            anti-spoofing (wav2vec2), bukan angka ilustratif.
          </p>
        </header>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {error}
          </div>
        )}

        {traces.length > 0 && selectedId && (
          <div className="mb-4">
            <ScenarioPicker
              traces={traces}
              selectedId={liveTrace ? "" : selectedId}
              onSelect={(id) => {
                setLiveTrace(null);
                setSelectedId(id);
              }}
            />
          </div>
        )}

        <div className="mb-6 p-4 rounded-xl bg-(--bg-card) border border-(--border-color)/20">
          <p className="text-sm font-medium text-(--text-primary) mb-2">
            Coba Live
          </p>
          {!apiBaseUrl && (
            <p className="text-xs text-(--text-muted)">
              NEXT_PUBLIC_SERVER_URL belum dikonfigurasi.
            </p>
          )}
          {apiBaseUrl && !session && (
            <p className="text-xs text-(--text-muted)">
              Login untuk coba live mode (perlu baca enrollment suara akun
              kamu).
            </p>
          )}
          {apiBaseUrl && session && (
            <div className="space-y-2">
              <LiveCapturePanel
                token={session.access_token}
                apiBaseUrl={apiBaseUrl}
                onResult={setLiveTrace}
              />
              {liveTrace && (
                <button
                  onClick={() => setLiveTrace(null)}
                  className="text-xs text-(--text-muted) hover:text-(--text-primary) underline cursor-pointer"
                >
                  Kembali ke mode replay
                </button>
              )}
            </div>
          )}
        </div>

        {trace && (
          <>
            <div className="flex gap-2 mb-6">
              <button
                onClick={play}
                className="px-4 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-sm text-(--text-primary) hover:border-(--border-color)/60 cursor-pointer"
              >
                ▶ Mulai animasi
              </button>
              <button
                onClick={showAll}
                className="px-4 py-2 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-sm text-(--text-primary) hover:border-(--border-color)/60 cursor-pointer"
              >
                Tampilkan semua
              </button>
            </div>

            <div className="space-y-5">
              <PipelineStage
                index={0}
                activeStage={activeStage}
                title="1. Audio Masuk"
                subtitle={trace.source_file ?? undefined}
              >
                <WaveformPreview
                  preview={trace.input.waveform_preview}
                  trimStartSec={trace.input.trim_start_sec}
                  trimEndSec={trace.input.trim_end_sec}
                  durationSec={trace.input.duration_sec}
                />
              </PipelineStage>

              <PipelineStage
                index={1}
                activeStage={activeStage}
                title="2. Speaker Verification & Anti-Spoofing"
                subtitle="Dua model independen, diproses terhadap audio yang sama"
              >
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-medium text-(--text-primary) mb-2">
                      ECAPA-TDNN (speaker verification)
                    </p>
                    <EcapaArchitectureDiagram
                      embeddingDim={trace.speaker_verification.embedding_dim}
                      score={trace.speaker_verification.score}
                      matchedLabel={trace.speaker_verification.best_label}
                    />
                    <div className="mt-3">
                      <EmbeddingFingerprint
                        values={trace.speaker_verification.live_embedding}
                        compareValues={
                          trace.speaker_verification.matched_enroll_embedding
                        }
                        label="live"
                        compareLabel="enrolled"
                      />
                    </div>
                    <div className="mt-3">
                      <ThresholdGauge
                        value={trace.speaker_verification.score}
                        min={0}
                        max={1}
                        thresholds={[
                          {
                            value:
                              trace.speaker_verification.thresholds
                                .abs_min_speaker,
                            label: "min",
                            color: "#d03b3b",
                          },
                          {
                            value:
                              trace.speaker_verification.thresholds
                                .voice_repeat,
                            label: "repeat",
                            color: "#fab219",
                          },
                          {
                            value:
                              trace.speaker_verification.thresholds
                                .voice_accept,
                            label: "accept",
                            color: "#0ca30c",
                          },
                        ]}
                        valueLabel={`score=${trace.speaker_verification.score.toFixed(3)}`}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-(--text-primary) mb-2">
                      Anti-Spoofing (wav2vec2)
                    </p>
                    <AntiSpoofArchitectureDiagram
                      fakeProb={trace.anti_spoof.fake_prob}
                      realProb={trace.anti_spoof.real_prob}
                    />
                    <div className="mt-3">
                      <ThresholdGauge
                        value={trace.anti_spoof.fake_prob}
                        min={0}
                        max={1}
                        scale="log"
                        thresholds={[
                          {
                            value: trace.anti_spoof.thresholds.replay_warn,
                            label: "warn",
                            color: "#fab219",
                          },
                          {
                            value: trace.anti_spoof.thresholds.replay_deny,
                            label: "deny",
                            color: "#d03b3b",
                          },
                        ]}
                        valueLabel={`fake_prob=${trace.anti_spoof.fake_prob.toFixed(5)}`}
                      />
                    </div>
                  </div>
                </div>
              </PipelineStage>

              <PipelineStage
                index={2}
                activeStage={activeStage}
                title="3. Behavior Profiling"
                subtitle="Hanya aktif jika histori suara user cukup — bisa men-downgrade VERIFIED jadi REPEAT, tidak pernah DENIED sendiri"
              >
                <BehaviorProfilePanel
                  behaviorProfiling={trace.behavior_profiling}
                />
              </PipelineStage>

              <PipelineStage
                index={3}
                activeStage={activeStage}
                title="4. Decision Engine"
                subtitle="Cascade threshold berurutan — gate pertama yang gagal menentukan hasil"
              >
                <DecisionCascade steps={trace.decision.steps} />
                {trace.synthetic_note && (
                  <p className="text-xs text-amber-400/80 mt-3 italic">
                    ⚠ {trace.synthetic_note}
                  </p>
                )}
              </PipelineStage>

              <PipelineStage
                index={4}
                activeStage={activeStage}
                title="5. Keputusan Akhir"
              >
                <FinalDecisionBadge decision={trace.decision} />
              </PipelineStage>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
