"use client";

// Pipeline explainer, v2: an interactive left-to-right flow diagram
// (pan/zoom/drag canvas via @xyflow/react) instead of a stacked list of
// cards. Top level shows the real architecture topology (audio feeds both
// speaker-verification and anti-spoofing in parallel into one decision;
// face recognition is a separate, independent fallback path — it is NOT
// merged into the same decision, because it isn't in the real code
// either). Clicking the ECAPA-TDNN, anti-spoof, or face-recognition block
// "breaks it apart" into its own real sub-stage chain; clicking a
// sub-stage opens a side panel with that one piece's real captured data.
//
// All data is the same real captured traces the previous version of this
// page used (backend/voiceverification/analysis/capture_pipeline_traces.py
// + the new backend/face_recognition/analysis/capture_face_traces.py) —
// this is a new presentation layer, not new/different data.

import {
  Background,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowLeft,
  AudioLines,
  Camera,
  CheckCircle2,
  Fingerprint,
  GitBranch,
  MapPin,
  ScanFace,
  ShieldAlert,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

import { nodeTypes } from "@/components/pipeline-flow/BlockNode";
import type { FaceScenario, FaceStageData, FaceTraceFile } from "@/components/pipeline-flow/faceTypes";
import { LightThemeScope } from "@/components/pipeline-flow/LightThemeScope";
import { LiveFaceCapturePanel } from "@/components/pipeline-flow/LiveFaceCapturePanel";
import { FaceStagePanel, LayerBlockPanel } from "@/components/pipeline-flow/SidePanel";
import { statusColor } from "@/components/charts/VerificationChartKit";
import { blockExplainer as antispoofBlockExplainer } from "@/components/pipeline/antispoofBlockExplainer";
import { blockLabel as antispoofBlockLabel } from "@/components/pipeline/antispoofBlockLabel";
import type { BlockExplainer } from "@/components/pipeline/blockExplainer";
import { blockExplainer as ecapaBlockExplainer } from "@/components/pipeline/ecapaBlockExplainer";
import { blockLabel as ecapaBlockLabel } from "@/components/pipeline/ecapaBlockLabel";
import { LayerMagnitudeChart } from "@/components/pipeline/LayerMagnitudeChart";
import { LiveCapturePanel } from "@/components/pipeline/LiveCapturePanel";
import type { LayerBlockOutput, PipelineTrace } from "@/components/pipeline/types";
import { supabase } from "@/lib/supabase";
import { normalizePublicServerUrl } from "@/lib/utils";

const ACCENT_AUDIO = "#64748b";
const ACCENT_SPEAKER = "#2a78d6";
const ACCENT_ANTISPOOF = "#eb6834";
const ACCENT_FACE = "#14b8a6";
const ACCENT_DECISION = "#64748b";

type View = "overview" | "ecapa" | "antispoof" | "face";

type PanelSelection =
  | { kind: "layer"; label: string; block: LayerBlockOutput; explainer: BlockExplainer | null; accent: string }
  | { kind: "face"; stage: "detection" | "landmark" | "alignment" | "recognition"; data: FaceStageData; accent: string }
  | null;

function buildOverviewGraph(
  voiceTrace: PipelineTrace | null,
  faceScenario: { decision: string; similarity: number } | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "audio-input",
      type: "block",
      position: { x: 0, y: 40 },
      data: { label: "Audio Masuk", icon: AudioLines, accent: ACCENT_AUDIO, clickable: false },
    },
    {
      id: "ecapa",
      type: "block",
      position: { x: 280, y: -60 },
      data: {
        label: "Speaker Verification",
        subtitle: "ECAPA-TDNN",
        icon: Fingerprint,
        accent: ACCENT_SPEAKER,
        clickable: true,
        stat: voiceTrace ? `score=${voiceTrace.speaker_verification.score.toFixed(3)}` : undefined,
      },
    },
    {
      id: "antispoof",
      type: "block",
      position: { x: 280, y: 140 },
      data: {
        label: "Anti-Spoofing",
        subtitle: "wav2vec2",
        icon: ShieldAlert,
        accent: ACCENT_ANTISPOOF,
        clickable: true,
        stat: voiceTrace ? `fake_prob=${voiceTrace.anti_spoof.fake_prob.toFixed(4)}` : undefined,
      },
    },
    {
      id: "voice-decision",
      type: "block",
      position: { x: 600, y: 40 },
      data: { label: "Decision Engine", icon: GitBranch, accent: ACCENT_DECISION, clickable: false },
    },
    {
      id: "voice-final",
      type: "block",
      position: { x: 860, y: 40 },
      data: {
        label: voiceTrace?.decision.final ?? "—",
        subtitle: "Keputusan suara",
        icon: CheckCircle2,
        accent: voiceTrace ? statusColor(voiceTrace.decision.final) : ACCENT_DECISION,
        clickable: false,
        highlight: true,
      },
    },
    {
      id: "face-input",
      type: "block",
      position: { x: 0, y: 380 },
      data: { label: "Foto Wajah", subtitle: "jalur fallback terpisah", icon: Camera, accent: ACCENT_FACE, clickable: false },
    },
    {
      id: "face-recognition",
      type: "block",
      position: { x: 280, y: 380 },
      data: {
        label: "Face Recognition",
        subtitle: "InsightFace buffalo_l",
        icon: ScanFace,
        accent: ACCENT_FACE,
        clickable: true,
        stat: faceScenario ? `similarity=${faceScenario.similarity.toFixed(3)}` : undefined,
      },
    },
    {
      id: "face-final",
      type: "block",
      position: { x: 600, y: 380 },
      data: {
        label: faceScenario?.decision ?? "—",
        subtitle: "Keputusan wajah",
        icon: CheckCircle2,
        accent: faceScenario ? statusColor(faceScenario.decision) : ACCENT_DECISION,
        clickable: false,
        highlight: true,
      },
    },
  ];

  const edges: Edge[] = [
    { id: "e1", source: "audio-input", target: "ecapa", animated: true, style: { stroke: ACCENT_SPEAKER } },
    { id: "e2", source: "audio-input", target: "antispoof", animated: true, style: { stroke: ACCENT_ANTISPOOF } },
    { id: "e3", source: "ecapa", target: "voice-decision", animated: true, style: { stroke: ACCENT_SPEAKER } },
    { id: "e4", source: "antispoof", target: "voice-decision", animated: true, style: { stroke: ACCENT_ANTISPOOF } },
    { id: "e5", source: "voice-decision", target: "voice-final", animated: true, style: { stroke: ACCENT_DECISION } },
    { id: "e6", source: "face-input", target: "face-recognition", animated: true, style: { stroke: ACCENT_FACE } },
    { id: "e7", source: "face-recognition", target: "face-final", animated: true, style: { stroke: ACCENT_FACE } },
  ];

  return { nodes, edges };
}

function buildLayerDetailGraph(
  blocks: LayerBlockOutput[],
  labelFn: (name: string) => string,
  accent: string,
  finalLabel: string,
  idPrefix: string,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = blocks.map((b, i) => ({
    id: `${idPrefix}-${i}`,
    type: "block",
    position: { x: i * 210, y: 0 },
    data: {
      label: `${i + 1}. ${labelFn(b.name)}`,
      subtitle: `[${b.shape.join("×")}]`,
      icon: idPrefix === "ecapa" ? Fingerprint : ShieldAlert,
      accent,
      compact: true,
      clickable: true,
      stat: `μ=${b.mean?.toFixed(3)}`,
    },
  }));
  nodes.push({
    id: `${idPrefix}-final`,
    type: "block",
    position: { x: blocks.length * 210, y: 0 },
    data: {
      label: finalLabel,
      icon: CheckCircle2,
      accent,
      compact: true,
      clickable: false,
      highlight: true,
    },
  });

  // Sequential chain: 0 -> 1 -> 2 -> ... -> final.
  const seqEdges: Edge[] = [];
  for (let i = 0; i < blocks.length - 1; i++) {
    seqEdges.push({
      id: `${idPrefix}-seq${i}`,
      source: `${idPrefix}-${i}`,
      target: `${idPrefix}-${i + 1}`,
      animated: true,
      style: { stroke: accent },
    });
  }
  seqEdges.push({
    id: `${idPrefix}-seqfinal`,
    source: `${idPrefix}-${blocks.length - 1}`,
    target: `${idPrefix}-final`,
    animated: true,
    style: { stroke: accent },
  });
  return { nodes, edges: seqEdges };
}

function buildFaceDetailGraph(): { nodes: Node[]; edges: Edge[] } {
  const stages: { id: string; label: string; subtitle: string }[] = [
    { id: "face-detection", label: "1. Detection", subtitle: "det_10g.onnx" },
    { id: "face-landmark", label: "2. Landmark", subtitle: "2d106det.onnx" },
    { id: "face-alignment", label: "3. Alignment", subtitle: "norm_crop → 112×112" },
    { id: "face-recognition-stage", label: "4. Recognition", subtitle: "w600k_r50.onnx (ArcFace)" },
  ];
  const nodes: Node[] = stages.map((s, i) => ({
    id: s.id,
    type: "block",
    position: { x: i * 210, y: 0 },
    data: { label: s.label, subtitle: s.subtitle, icon: ScanFace, accent: ACCENT_FACE, compact: true, clickable: true },
  }));
  nodes.push({
    id: "face-embedding",
    type: "block",
    position: { x: stages.length * 210, y: 0 },
    data: { label: "Embedding 512-d", icon: CheckCircle2, accent: ACCENT_FACE, compact: true, clickable: false, highlight: true },
  });

  const edges: Edge[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    edges.push({ id: `fe${i}`, source: stages[i].id, target: stages[i + 1].id, animated: true, style: { stroke: ACCENT_FACE } });
  }
  edges.push({ id: "fe-final", source: stages[stages.length - 1].id, target: "face-embedding", animated: true, style: { stroke: ACCENT_FACE } });

  return { nodes, edges };
}

function FlowCanvas({
  view,
  voiceTrace,
  faceScenario,
  onNavigate,
  onSelectLayer,
  onSelectFace,
}: {
  view: View;
  voiceTrace: PipelineTrace | null;
  faceScenario: { decision: string; similarity: number } | null;
  onNavigate: (v: View) => void;
  onSelectLayer: (kind: "ecapa" | "antispoof", index: number) => void;
  onSelectFace: (stage: "detection" | "landmark" | "alignment" | "recognition") => void;
}) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (view === "overview") return buildOverviewGraph(voiceTrace, faceScenario);
    if (view === "ecapa" && voiceTrace)
      return buildLayerDetailGraph(
        voiceTrace.speaker_verification.ecapa_blocks,
        ecapaBlockLabel,
        ACCENT_SPEAKER,
        "Embedding 192-d",
        "ecapa",
      );
    if (view === "antispoof" && voiceTrace)
      return buildLayerDetailGraph(
        voiceTrace.anti_spoof.antispoof_blocks,
        antispoofBlockLabel,
        ACCENT_ANTISPOOF,
        "Fake/Real Probability",
        "antispoof",
      );
    if (view === "face") return buildFaceDetailGraph();
    return { nodes: [], edges: [] };
  }, [view, voiceTrace, faceScenario]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 500, padding: 0.25 }), 50);
    return () => clearTimeout(t);
  }, [view, nodes.length, fitView]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (view === "overview") {
      if (node.id === "ecapa") onNavigate("ecapa");
      else if (node.id === "antispoof") onNavigate("antispoof");
      else if (node.id === "face-recognition") onNavigate("face");
      return;
    }
    if (view === "ecapa" && node.id.startsWith("ecapa-") && node.id !== "ecapa-final") {
      onSelectLayer("ecapa", Number(node.id.split("-")[1]));
      return;
    }
    if (view === "antispoof" && node.id.startsWith("antispoof-") && node.id !== "antispoof-final") {
      onSelectLayer("antispoof", Number(node.id.split("-")[1]));
      return;
    }
    if (view === "face") {
      if (node.id === "face-detection") onSelectFace("detection");
      else if (node.id === "face-landmark") onSelectFace("landmark");
      else if (node.id === "face-alignment") onSelectFace("alignment");
      else if (node.id === "face-recognition-stage") onSelectFace("recognition");
    }
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={handleNodeClick}
      fitView
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#cbd5e1" gap={24} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => (n.data as { accent?: string }).accent ?? "#94a3b8"}
        maskColor="rgba(241,245,249,0.7)"
        className="bg-white! border! border-slate-200!"
      />
    </ReactFlow>
  );
}

export default function PipelinePage() {
  const [voiceTraces, setVoiceTraces] = useState<PipelineTrace[]>([]);
  const [faceTrace, setFaceTrace] = useState<FaceTraceFile | null>(null);
  const [voiceScenarioId, setVoiceScenarioId] = useState<string | null>(null);
  const [faceScenarioId, setFaceScenarioId] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [panel, setPanel] = useState<PanelSelection>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [voiceLive, setVoiceLive] = useState<PipelineTrace | null>(null);
  const [faceLive, setFaceLive] = useState<FaceScenario | null>(null);

  const apiBaseUrl = normalizePublicServerUrl(process.env.NEXT_PUBLIC_SERVER_URL);

  useEffect(() => {
    fetch("/pipeline-demo/traces.json")
      .then((r) => r.json())
      .then((data: PipelineTrace[]) => {
        setVoiceTraces(data);
        if (data.length > 0) setVoiceScenarioId(data[0].scenario_id);
      });
    fetch("/pipeline-demo/face-traces.json")
      .then((r) => r.json())
      .then((data: FaceTraceFile) => {
        setFaceTrace(data);
        if (data.scenarios.length > 0) setFaceScenarioId(data.scenarios[0].scenario_id);
      });
  }, []);

  // Replay mode never needs a login — only the live-capture buttons do,
  // and only when actually used. No redirect on missing session: a judge
  // reading this page shouldn't get bounced to /login.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const voiceTrace = voiceLive ?? voiceTraces.find((t) => t.scenario_id === voiceScenarioId) ?? null;
  const faceScenario = faceLive ?? faceTrace?.scenarios.find((s) => s.scenario_id === faceScenarioId) ?? null;

  const handleSelectLayer = (kind: "ecapa" | "antispoof", index: number) => {
    if (!voiceTrace) return;
    const blocks = kind === "ecapa" ? voiceTrace.speaker_verification.ecapa_blocks : voiceTrace.anti_spoof.antispoof_blocks;
    const labelFn = kind === "ecapa" ? ecapaBlockLabel : antispoofBlockLabel;
    const explainerFn = kind === "ecapa" ? ecapaBlockExplainer : antispoofBlockExplainer;
    const accent = kind === "ecapa" ? ACCENT_SPEAKER : ACCENT_ANTISPOOF;
    const block = blocks[index];
    if (!block) return;
    setPanel({ kind: "layer", label: `${index + 1}. ${labelFn(block.name)}`, block, explainer: explainerFn(block.name), accent });
  };

  const handleSelectFace = (stage: "detection" | "landmark" | "alignment" | "recognition") => {
    const data = faceScenario?.probe ?? faceTrace?.enrolled;
    if (!data) return;
    setPanel({ kind: "face", stage, data, accent: ACCENT_FACE });
  };

  return (
    <LightThemeScope>
      <main className="h-screen flex flex-col">
        <header className="px-6 py-4 border-b border-slate-200 bg-white">
          <h1 className="text-xl font-semibold text-slate-900">
            Diagram Alir Verifikasi Biometrik
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Geser &amp; zoom diagramnya, klik blok Speaker Verification /
            Anti-Spoofing / Face Recognition untuk pecah ke detail aslinya.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-3">
            {view !== "overview" && (
              <button
                onClick={() => setView("overview")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <ArrowLeft size={14} /> Kembali ke overview
              </button>
            )}

            {voiceTraces.length > 0 && (
              <select
                value={voiceLive ? "live" : (voiceScenarioId ?? "")}
                onChange={(e) => {
                  setVoiceLive(null);
                  setVoiceScenarioId(e.target.value);
                }}
                className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700"
              >
                {voiceLive && <option value="live">🔴 Hasil live barusan</option>}
                {voiceTraces.map((t) => (
                  <option key={t.scenario_id} value={t.scenario_id}>
                    🎤 {t.title}
                  </option>
                ))}
              </select>
            )}

            {faceTrace && faceTrace.scenarios.length > 0 && (
              <select
                value={faceLive ? "live" : (faceScenarioId ?? "")}
                onChange={(e) => {
                  setFaceLive(null);
                  setFaceScenarioId(e.target.value);
                }}
                className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-700"
              >
                {faceLive && <option value="live">🔴 Hasil live barusan</option>}
                {faceTrace.scenarios.map((s) => (
                  <option key={s.scenario_id} value={s.scenario_id}>
                    📷 {s.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-slate-100">
            <span className="text-xs font-medium text-slate-500">Coba Live:</span>
            {!apiBaseUrl && (
              <p className="text-xs text-slate-400">NEXT_PUBLIC_SERVER_URL belum dikonfigurasi.</p>
            )}
            {apiBaseUrl && !session && (
              <p className="text-xs text-slate-400">Login untuk coba live (perlu baca enrollment akun kamu).</p>
            )}
            {apiBaseUrl && session && (
              <>
                <LiveCapturePanel
                  token={session.access_token}
                  apiBaseUrl={apiBaseUrl}
                  onResult={(trace) => {
                    setVoiceLive(trace);
                    setView("overview");
                  }}
                />
                <LiveFaceCapturePanel
                  token={session.access_token}
                  apiBaseUrl={apiBaseUrl}
                  onResult={(scenario) => {
                    setFaceLive(scenario);
                    setView("overview");
                  }}
                />
              </>
            )}
          </div>
        </header>

        <div className="flex-1 relative">
          <ReactFlowProvider>
            <FlowCanvas
              view={view}
              voiceTrace={voiceTrace}
              faceScenario={faceScenario}
              onNavigate={setView}
              onSelectLayer={handleSelectLayer}
              onSelectFace={handleSelectFace}
            />
          </ReactFlowProvider>

          {(view === "ecapa" || view === "antispoof") && voiceTrace && (
            <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:w-105 bg-white/95 backdrop-blur border border-slate-200 rounded-xl p-3 shadow-lg">
              <p className="text-xs font-medium text-slate-700 mb-1">
                Perkembangan magnitude aktivasi
              </p>
              <LayerMagnitudeChart
                blocks={
                  view === "ecapa"
                    ? voiceTrace.speaker_verification.ecapa_blocks
                    : voiceTrace.anti_spoof.antispoof_blocks
                }
                labelFn={view === "ecapa" ? ecapaBlockLabel : antispoofBlockLabel}
                color={view === "ecapa" ? ACCENT_SPEAKER : ACCENT_ANTISPOOF}
              />
            </div>
          )}

          {view === "face" && faceTrace && (
            <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur border border-slate-200 rounded-xl p-3 shadow-lg max-w-sm">
              <p className="text-xs text-slate-600 leading-relaxed flex items-start gap-1.5">
                <MapPin size={13} className="mt-0.5 shrink-0 text-amber-500" />
                {faceTrace.liveness_note}
              </p>
            </div>
          )}
        </div>

        {panel?.kind === "layer" && (
          <LayerBlockPanel
            label={panel.label}
            block={panel.block}
            explainer={panel.explainer}
            accent={panel.accent}
            onClose={() => setPanel(null)}
          />
        )}
        {panel?.kind === "face" && (
          <FaceStagePanel
            stage={panel.stage}
            data={panel.data}
            accent={panel.accent}
            onClose={() => setPanel(null)}
          />
        )}
      </main>
    </LightThemeScope>
  );
}
