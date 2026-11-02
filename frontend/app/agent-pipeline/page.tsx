"use client";

// Agent tool-calling explainer, v2: same interactive left-to-right flow
// diagram style as /pipeline (pan/zoom/drag canvas via @xyflow/react,
// light theme, click-to-drill-down blocks) instead of a picker + vertical
// stacked round-trip. Overview shows the real hub topology (User <-> Agent,
// Agent -> each of the 7 real captured tool calls). Clicking a tool call
// "breaks it apart" into its own real round-trip chain (User -> Agent ->
// Tool -> optional external API -> Agent -> optional frontend event ->
// User); clicking a layer in that chain opens a side panel with that one
// piece's real captured data.
//
// Same real data as before (backend/agent/analysis/capture_tool_traces.py)
// — this is a new presentation layer, not new/different data.

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
  Bot,
  CreditCard,
  type LucideIcon,
  MapPin,
  Package,
  Search,
  ShieldAlert,
  ShoppingCart,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ACCENT_AGENT, ACCENT_USER, buildAgentLayers } from "@/components/agent-tools/agentLayers";
import { AgentStepPanel } from "@/components/agent-tools/AgentStepPanel";
import type { ToolTraceFile, ToolTraceStep } from "@/components/agent-tools/types";
import { nodeTypes } from "@/components/pipeline-flow/BlockNode";
import { LightThemeScope } from "@/components/pipeline-flow/LightThemeScope";

const STEP_META = [
  { icon: MapPin, accent: "#8a8a85" },
  { icon: Search, accent: "#2a78d6" },
  { icon: Package, accent: "#2a78d6" },
  { icon: ShieldAlert, accent: "#d03b3b" },
  { icon: ShieldAlert, accent: "#eb6834" },
  { icon: ShoppingCart, accent: "#8a8a85" },
  { icon: CreditCard, accent: "#d03b3b" },
] as const;

type View = "overview" | "detail";

function buildOverviewGraph(steps: ToolTraceStep[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    {
      id: "user",
      type: "block",
      position: { x: 0, y: steps.length * 50 },
      data: { label: "User", subtitle: "voice command", icon: User, accent: ACCENT_USER, clickable: false },
    },
    {
      id: "agent",
      type: "block",
      position: { x: 280, y: steps.length * 50 },
      data: { label: "Agent (Backend)", subtitle: "LiveKit + Gemini Live", icon: Bot, accent: ACCENT_AGENT, clickable: false },
    },
    ...steps.map((s, i) => {
      const meta = STEP_META[i % STEP_META.length];
      return {
        id: `tool-${i}`,
        type: "block",
        position: { x: 600, y: i * 110 },
        data: {
          label: s.tool.name,
          subtitle: s.title,
          icon: meta.icon,
          accent: s.voice_gate ? (s.voice_gate.passed ? "#0ca30c" : "#d03b3b") : meta.accent,
          clickable: true,
          stat: s.voice_gate ? (s.voice_gate.passed ? "gerbang lolos" : "gerbang ditolak") : undefined,
        },
      } satisfies Node;
    }),
  ];

  const edges: Edge[] = [
    { id: "user-agent", source: "user", target: "agent", animated: true, style: { stroke: ACCENT_USER } },
    ...steps.map((_, i) => ({
      id: `agent-tool-${i}`,
      source: "agent",
      target: `tool-${i}`,
      animated: true,
      style: { stroke: STEP_META[i % STEP_META.length].accent },
    })),
  ];

  return { nodes, edges };
}

function buildDetailGraph(step: ToolTraceStep, toolIcon: LucideIcon, toolAccent: string) {
  const layers = buildAgentLayers(step, toolIcon, toolAccent);
  const nodes: Node[] = layers.map((l, i) => ({
    id: l.id,
    type: "block",
    position: { x: i * 220, y: 0 },
    data: { label: l.label, icon: l.icon, accent: l.accent, compact: true, clickable: true },
  }));
  const edges: Edge[] = [];
  for (let i = 0; i < layers.length - 1; i++) {
    edges.push({
      id: `seq-${i}`,
      source: layers[i].id,
      target: layers[i + 1].id,
      animated: true,
      style: { stroke: layers[i + 1].accent },
    });
  }
  return { nodes, edges };
}

function FlowCanvas({
  view,
  steps,
  selectedIndex,
  onSelectTool,
  onSelectLayer,
}: {
  view: View;
  steps: ToolTraceStep[];
  selectedIndex: number | null;
  onSelectTool: (index: number) => void;
  onSelectLayer: (layerId: string) => void;
}) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (view === "overview") return buildOverviewGraph(steps);
    if (view === "detail" && selectedIndex !== null && steps[selectedIndex]) {
      const meta = STEP_META[selectedIndex % STEP_META.length];
      return buildDetailGraph(steps[selectedIndex], meta.icon, meta.accent);
    }
    return { nodes: [], edges: [] };
  }, [view, steps, selectedIndex]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ duration: 500, padding: 0.25 }), 50);
    return () => clearTimeout(t);
  }, [view, selectedIndex, nodes.length, fitView]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (view === "overview") {
      if (node.id.startsWith("tool-")) onSelectTool(Number(node.id.split("-")[1]));
      return;
    }
    onSelectLayer(node.id);
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

export default function AgentPipelinePage() {
  const [data, setData] = useState<ToolTraceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [panelLayerId, setPanelLayerId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/pipeline-demo/tool-traces.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: ToolTraceFile) => setData(json))
      .catch(() => setError("Gagal memuat data (public/pipeline-demo/tool-traces.json)."));
  }, []);

  const selectedStep = selectedIndex !== null ? (data?.steps[selectedIndex] ?? null) : null;

  return (
    <LightThemeScope>
      <main className="h-screen flex flex-col">
        <header className="px-6 py-4 border-b border-slate-200 bg-white">
          <h1 className="text-xl font-semibold text-slate-900">
            Diagram Alir Tool-Calling Agent
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Geser &amp; zoom diagramnya, klik salah satu tool untuk pecah ke
            alur round-trip aslinya (User → Agent → Tool → User).
          </p>

          {view === "detail" && (
            <button
              onClick={() => {
                setView("overview");
                setSelectedIndex(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 mt-3 rounded-lg border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <ArrowLeft size={14} /> Kembali ke overview
            </button>
          )}
        </header>

        {error && (
          <div className="m-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {data && (
          <div className="flex-1 relative">
            <ReactFlowProvider>
              <FlowCanvas
                view={view}
                steps={data.steps}
                selectedIndex={selectedIndex}
                onSelectTool={(i) => {
                  setSelectedIndex(i);
                  setView("detail");
                }}
                onSelectLayer={setPanelLayerId}
              />
            </ReactFlowProvider>

            <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur border border-slate-200 rounded-xl p-3 shadow-lg max-w-sm">
              <p className="text-xs text-slate-600 leading-relaxed">{data.note}</p>
            </div>
          </div>
        )}

        {selectedStep && panelLayerId && (
          <AgentStepPanel
            step={selectedStep}
            layerId={panelLayerId}
            onClose={() => setPanelLayerId(null)}
          />
        )}
      </main>
    </LightThemeScope>
  );
}
