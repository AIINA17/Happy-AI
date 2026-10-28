"use client";

// Pipeline explainer: walks a voice-verification attempt from raw audio to
// the final VERIFIED/REPEAT/DENIED decision, one real stage at a time.
// Replay mode (default) reads a static, pre-captured JSON — no backend
// dependency, so this always works regardless of booth wifi/server state.

import type { Session } from "@supabase/supabase-js";
import {
  Activity,
  AudioLines,
  CheckCircle2,
  Fingerprint,
  GitBranch,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AntiSpoofArchitectureDiagram } from "@/components/pipeline/AntiSpoofArchitectureDiagram";
import {
  blockFormula as antispoofBlockFormula,
} from "@/components/pipeline/antispoofBlockFormula";
import { blockLabel as antispoofBlockLabel } from "@/components/pipeline/antispoofBlockLabel";
import { BehaviorProfilePanel } from "@/components/pipeline/BehaviorProfilePanel";
import { DecisionCascade } from "@/components/pipeline/DecisionCascade";
import { blockFormula as ecapaBlockFormula } from "@/components/pipeline/ecapaBlockFormula";
import { blockLabel as ecapaBlockLabel } from "@/components/pipeline/ecapaBlockLabel";
import { EcapaArchitectureDiagram } from "@/components/pipeline/EcapaArchitectureDiagram";
import { EmbeddingFingerprint } from "@/components/pipeline/EmbeddingFingerprint";
import { FinalDecisionBadge } from "@/components/pipeline/FinalDecisionBadge";
import { HeroStat } from "@/components/pipeline/HeroStat";
import { LiveCapturePanel } from "@/components/pipeline/LiveCapturePanel";
import { ModelBlockTrace } from "@/components/pipeline/ModelBlockTrace";
import { PipelineStage } from "@/components/pipeline/PipelineStage";
import { ScenarioPicker } from "@/components/pipeline/ScenarioPicker";
import { SpectrogramComparison } from "@/components/pipeline/SpectrogramComparison";
import { ThresholdGauge } from "@/components/pipeline/ThresholdGauge";
import { WaveformPreview } from "@/components/pipeline/WaveformPreview";
import type { PipelineTrace } from "@/components/pipeline/types";
import { statusColor } from "@/components/charts/VerificationChartKit";
import { useSequentialReveal } from "@/hooks/useSequentialReveal";
import { supabase } from "@/lib/supabase";
import { normalizePublicServerUrl } from "@/lib/utils";

const STAGE_COUNT = 6;

const ACCENT_AUDIO = "#8a8a85";
const ACCENT_SPEAKER = "#2a78d6";
const ACCENT_ANTISPOOF = "#eb6834";
const ACCENT_BEHAVIOR = "#8b5cf6";
const ACCENT_DECISION = "#8a8a85";

const ECAPA_WORKED_INTRO =
  "Dihitung dari potongan audio yang sama, tapi pakai bobot ilustratif tetap — bukan bobot hasil training model asli. Dimensinya sengaja dikecilkan (4 frame, 4 kanal) supaya tiap langkah bisa diikuti; model asli memakai 80+ kanal mel dan lebih banyak frame.";

const ANTISPOOF_WORKED_INTRO =
  "Dihitung dari potongan audio yang sama, tapi pakai bobot ilustratif tetap — bukan bobot hasil training model asli. Dimensinya sengaja dikecilkan (17 sample mentah, beberapa kanal) supaya tiap langkah bisa diikuti; model asli memproses ribuan sample dengan 512+ kanal dan 12 layer transformer.";

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

  const trace =
    liveTrace ?? traces.find((t) => t.scenario_id === selectedId) ?? null;

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
                stepNumber={1}
                icon={AudioLines}
                accent={ACCENT_AUDIO}
                title="Audio Masuk"
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
                stepNumber={2}
                icon={Fingerprint}
                accent={ACCENT_SPEAKER}
                title="Speaker Verification — ECAPA-TDNN"
                subtitle="Apakah suara ini cocok dengan suara yang terdaftar?"
              >
                <HeroStat
                  label="Cosine similarity vs profil terdaftar"
                  value={trace.speaker_verification.score.toFixed(3)}
                  color={ACCENT_SPEAKER}
                  caption={`dibandingkan dengan "${trace.speaker_verification.best_label}"`}
                />
                <EcapaArchitectureDiagram
                  embeddingDim={trace.speaker_verification.embedding_dim}
                  score={trace.speaker_verification.score}
                  matchedLabel={trace.speaker_verification.best_label}
                />
                <div className="mt-4">
                  <ThresholdGauge
                    value={trace.speaker_verification.score}
                    min={0}
                    max={1}
                    thresholds={[
                      {
                        value:
                          trace.speaker_verification.thresholds.abs_min_speaker,
                        label: "min",
                        color: "#d03b3b",
                      },
                      {
                        value: trace.speaker_verification.thresholds.voice_repeat,
                        label: "repeat",
                        color: "#fab219",
                      },
                      {
                        value: trace.speaker_verification.thresholds.voice_accept,
                        label: "accept",
                        color: "#0ca30c",
                      },
                    ]}
                    valueLabel={`score=${trace.speaker_verification.score.toFixed(3)}`}
                  />
                </div>
                <div className="mt-4">
                  <SpectrogramComparison
                    live={trace.input.spectrogram}
                    enrolled={trace.speaker_verification.enrolled_spectrogram}
                    enrolledLabel={trace.speaker_verification.best_label}
                  />
                </div>
                <div className="mt-4">
                  <p className="text-xs font-medium text-(--text-primary) mb-2">
                    Fingerprint embedding (live vs enrolled)
                  </p>
                  <EmbeddingFingerprint
                    values={trace.speaker_verification.live_embedding}
                    compareValues={
                      trace.speaker_verification.matched_enroll_embedding
                    }
                    label="live"
                    compareLabel="enrolled"
                  />
                </div>
                <div className="mt-5 pt-4 border-t border-(--border-color)/15">
                  <ModelBlockTrace
                    blocks={trace.speaker_verification.ecapa_blocks}
                    workedExample={trace.speaker_verification.ecapa_worked_example}
                    workedExampleIntro={ECAPA_WORKED_INTRO}
                    labelFn={ecapaBlockLabel}
                    formulaFn={ecapaBlockFormula}
                    color={ACCENT_SPEAKER}
                  />
                </div>
              </PipelineStage>

              <PipelineStage
                index={2}
                activeStage={activeStage}
                stepNumber={3}
                icon={ShieldAlert}
                accent={ACCENT_ANTISPOOF}
                title="Anti-Spoofing — wav2vec2"
                subtitle="Apakah audio ini rekaman ulang/sintetis, bukan suara langsung?"
              >
                <HeroStat
                  label="Probabilitas audio ini palsu (replay/sintetis)"
                  value={trace.anti_spoof.fake_prob.toFixed(5)}
                  color={ACCENT_ANTISPOOF}
                  caption={
                    trace.anti_spoof.real_prob != null
                      ? `real_prob = ${trace.anti_spoof.real_prob.toFixed(5)}`
                      : undefined
                  }
                />
                <AntiSpoofArchitectureDiagram
                  fakeProb={trace.anti_spoof.fake_prob}
                  realProb={trace.anti_spoof.real_prob}
                />
                <div className="mt-4">
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
                <div className="mt-5 pt-4 border-t border-(--border-color)/15">
                  <ModelBlockTrace
                    blocks={trace.anti_spoof.antispoof_blocks}
                    workedExample={trace.anti_spoof.antispoof_worked_example}
                    workedExampleIntro={ANTISPOOF_WORKED_INTRO}
                    labelFn={antispoofBlockLabel}
                    formulaFn={antispoofBlockFormula}
                    color={ACCENT_ANTISPOOF}
                  />
                </div>
              </PipelineStage>

              <PipelineStage
                index={3}
                activeStage={activeStage}
                stepNumber={4}
                icon={Activity}
                accent={ACCENT_BEHAVIOR}
                title="Behavior Profiling"
                subtitle="Hanya aktif jika histori suara user cukup — bisa men-downgrade VERIFIED jadi REPEAT, tidak pernah DENIED sendiri"
              >
                <BehaviorProfilePanel
                  behaviorProfiling={trace.behavior_profiling}
                />
              </PipelineStage>

              <PipelineStage
                index={4}
                activeStage={activeStage}
                stepNumber={5}
                icon={GitBranch}
                accent={ACCENT_DECISION}
                title="Decision Engine"
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
                index={5}
                activeStage={activeStage}
                stepNumber={6}
                icon={CheckCircle2}
                accent={statusColor(trace.decision.final)}
                title="Keputusan Akhir"
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
