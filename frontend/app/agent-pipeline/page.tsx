"use client";

// Agent tool-calling explainer: walks through what actually happens when
// the voice shopping agent decides to call a tool — real arguments, the
// real voice-verification gate check, real results from the live dummy
// e-commerce backends. Captured offline (see
// backend/agent/analysis/capture_tool_traces.py) by calling the agent's
// real @function_tool functions directly, bypassing the LiveKit/Gemini
// voice session (which this static page doesn't need to demonstrate the
// real tool-calling + security-gate behavior).
//
// Shown as a round-trip flow (User -> Agent -> Tool -> Agent -> User), one
// tool call at a time — pick which call to look at instead of seeing all
// of them stacked together.

import {
  CreditCard,
  MapPin,
  Package,
  Search,
  ShieldAlert,
  ShoppingCart,
} from "lucide-react";
import { useEffect, useState } from "react";

import { AgentFlowDiagram } from "@/components/agent-tools/AgentFlowDiagram";
import { ToolStepPicker } from "@/components/agent-tools/ToolStepPicker";
import type { ToolTraceFile } from "@/components/agent-tools/types";

const STEP_META = [
  { icon: MapPin, accent: "#8a8a85" },
  { icon: Search, accent: "#2a78d6" },
  { icon: Package, accent: "#2a78d6" },
  { icon: ShieldAlert, accent: "#d03b3b" },
  { icon: ShieldAlert, accent: "#eb6834" },
  { icon: ShoppingCart, accent: "#8a8a85" },
  { icon: CreditCard, accent: "#d03b3b" },
] as const;

export default function AgentPipelinePage() {
  const [data, setData] = useState<ToolTraceFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    fetch("/pipeline-demo/tool-traces.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: ToolTraceFile) => setData(json))
      .catch(() =>
        setError(
          "Gagal memuat data (public/pipeline-demo/tool-traces.json).",
        ),
      );
  }, []);

  const step = data?.steps[selectedIndex];
  const meta = STEP_META[selectedIndex % STEP_META.length];

  return (
    <main className="min-h-screen bg-(--bg-primary) overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-(--text-primary)">
            Alur Tool-Calling Agent Belanja
          </h1>
          <p className="text-sm text-(--text-muted) mt-1">
            Apa yang sebenarnya terjadi saat Happy memutuskan memanggil
            sebuah tool — argumen asli, pengecekan gerbang verifikasi suara,
            dan hasil asli dari toko dummy yang live (bukan disimulasikan).
          </p>
        </header>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="mb-6 px-4 py-3 rounded-xl bg-(--bg-card) border border-(--border-color)/20 text-xs text-(--text-muted) leading-relaxed">
              {data.note}
            </div>

            <div className="mb-6">
              <p className="text-xs font-medium text-(--text-primary) mb-2">
                Pilih tool yang mau dilihat alurnya
              </p>
              <ToolStepPicker
                steps={data.steps}
                selectedIndex={selectedIndex}
                onSelect={setSelectedIndex}
              />
            </div>

            {step && (
              <div className="p-5 rounded-2xl bg-(--bg-card) border border-(--border-color)/20">
                <AgentFlowDiagram
                  step={step}
                  toolIcon={meta.icon}
                  toolAccent={meta.accent}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
