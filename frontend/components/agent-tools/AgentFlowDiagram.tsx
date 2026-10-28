"use client";

import {
  Bot,
  Globe,
  type LucideIcon,
  Lock,
  LockOpen,
  Radio,
  User,
} from "lucide-react";
import { useEffect } from "react";

import { useSequentialReveal } from "@/hooks/useSequentialReveal";
import { FlowArrow, FlowNode } from "./FlowNode";
import type { ToolTraceStep } from "./types";

const ACCENT_USER = "#5c9fd6";
const ACCENT_AGENT = "#8b5cf6";
const ACCENT_EXTERNAL = "#14b8a6";
const ACCENT_TRANSPORT = "#06b6d4";

function VoiceGateBadge({
  statusBefore,
  passed,
}: {
  statusBefore: string;
  passed: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] border mt-2 ${
        passed
          ? "bg-[#0ca30c]/10 border-[#0ca30c]/30 text-[#0ca30c]"
          : "bg-[#d03b3b]/10 border-[#d03b3b]/30 text-[#d03b3b]"
      }`}
    >
      {passed ? <LockOpen size={12} /> : <Lock size={12} />}
      <span className="font-medium">
        Gerbang verifikasi suara: {passed ? "lolos" : "ditolak"}
      </span>
      <span className="text-(--text-muted)">({statusBefore})</span>
    </div>
  );
}

function shortenUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname };
  } catch {
    return { host: url, path: "" };
  }
}

interface Layer {
  key: string;
  actor: string;
  icon: LucideIcon;
  accent: string;
  content: React.ReactNode;
}

function buildLayers(
  step: ToolTraceStep,
  toolIcon: LucideIcon,
  toolAccent: string,
): Layer[] {
  const layers: Layer[] = [];

  layers.push({
    key: "user-ask",
    actor: "User (Frontend)",
    icon: User,
    accent: ACCENT_USER,
    content: (
      <>
        <p className="text-[10px] uppercase tracking-wide text-(--text-muted) mb-1">
          Contoh ucapan
        </p>
        <p className="text-sm text-(--text-primary) italic">
          &ldquo;{step.user_utterance}&rdquo;
        </p>
      </>
    ),
  });

  layers.push({
    key: "agent-decide",
    actor: "Agent (Backend) — memutuskan tool",
    icon: Bot,
    accent: ACCENT_AGENT,
    content: (
      <>
        <code className="text-[11px] text-(--text-primary) break-all">
          {step.tool.signature}
        </code>
        <p className="text-[11px] text-(--text-muted) leading-relaxed mt-2">
          <span className="text-(--text-secondary) font-medium">Kenapa: </span>
          {step.policy_note}
        </p>
      </>
    ),
  });

  layers.push({
    key: "tool-call",
    actor: `Tool — ${step.tool.name}`,
    icon: toolIcon,
    accent: toolAccent,
    content: (
      <>
        {Object.entries(step.arguments).length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-(--text-muted)">
            {Object.entries(step.arguments).map(([k, v]) => (
              <span key={k}>
                <span className="text-(--text-secondary)">{k}</span>=
                {String(v)}
              </span>
            ))}
          </div>
        )}
        {step.voice_gate && (
          <VoiceGateBadge
            statusBefore={step.voice_gate.status_before}
            passed={step.voice_gate.passed}
          />
        )}
        <p className="text-[10px] text-(--text-muted) mt-2">
          {step.http_calls.length > 0
            ? `mengirim ${step.http_calls.length} permintaan ke toko dummy...`
            : "dijalankan lokal, tidak memanggil API eksternal"}
        </p>
      </>
    ),
  });

  if (step.http_calls.length > 0) {
    layers.push({
      key: "external-api",
      actor: "Dummy E-commerce — API eksternal (live)",
      icon: Globe,
      accent: ACCENT_EXTERNAL,
      content: (
        <div className="space-y-2">
          {step.http_calls.map((h, i) => {
            const { host, path } = shortenUrl(h.url);
            return (
              <div key={i} className="text-[11px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-(--text-primary)">
                    {h.method} {path}
                  </code>
                  <span
                    className={`px-1.5 rounded text-[10px] font-medium ${
                      h.status_code < 400
                        ? "bg-[#0ca30c]/15 text-[#0ca30c]"
                        : "bg-[#d03b3b]/15 text-[#d03b3b]"
                    }`}
                  >
                    {h.status_code}
                  </span>
                  <span className="text-(--text-muted)">
                    {h.duration_ms.toFixed(0)}ms
                  </span>
                </div>
                <p className="text-(--text-muted) mt-0.5">
                  {host}
                  {h.response_preview ? ` · ${h.response_preview}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      ),
    });

    layers.push({
      key: "tool-result",
      actor: `Tool — ${step.tool.name} (hasil)`,
      icon: toolIcon,
      accent: toolAccent,
      content: (
        <p className="text-[11px] text-(--text-muted)">
          Menerima{" "}
          {step.http_calls.length > 1
            ? `${step.http_calls.length} respons dan menggabungkannya`
            : "respons"}
          , total {step.result.duration_ms.toFixed(0)}ms (termasuk waktu
          tunggu API eksternal).
        </p>
      ),
    });
  }

  layers.push({
    key: "agent-reply",
    actor: "Agent (Backend) — menyusun balasan",
    icon: Bot,
    accent: ACCENT_AGENT,
    content: (
      <p className="text-sm text-(--text-primary) whitespace-pre-line leading-relaxed">
        {step.result.output}
      </p>
    ),
  });

  if (step.frontend_event) {
    layers.push({
      key: "frontend-event",
      actor: "Frontend — event data-channel",
      icon: Radio,
      accent: ACCENT_TRANSPORT,
      content: (
        <>
          <code className="text-[11px] text-(--text-primary)">
            type={step.frontend_event.type} · topic=
            {step.frontend_event.topic}
          </code>
          <p className="text-[11px] text-(--text-muted) leading-relaxed mt-1">
            {step.frontend_event.note}
          </p>
          <p className="text-[10px] text-amber-400/80 mt-1 italic">
            ⚠ Fakta dari kode (tools.py) — bukan event yang benar-benar
            terkirim di capture ini, karena tidak ada room LiveKit live.
          </p>
        </>
      ),
    });
  }

  layers.push({
    key: "user-receive",
    actor: "User (Frontend) — menerima balasan",
    icon: User,
    accent: ACCENT_USER,
    content: (
      <p className="text-xs text-(--text-muted)">
        Balasan di atas yang akan diucapkan Happy ke user
        {step.frontend_event ? ", sambil kartu produk muncul di layar" : ""}.
      </p>
    ),
  });

  return layers;
}

// The full round trip for ONE tool call: User (frontend) says something ->
// Agent (backend) decides to call a tool -> Tool runs, optionally hitting a
// real external API -> Agent gets the real result back -> optionally a
// frontend-bound event fires -> User sees/hears the real response. Layer
// count is dynamic: only the layers that actually happened for THIS call
// are shown (e.g. no "external API" layer for a tool that never leaves the
// process). Only one tool-call step is shown at once (picked via
// ToolStepPicker in the page), not all of them stacked together.
export function AgentFlowDiagram({
  step,
  toolIcon,
  toolAccent,
}: {
  step: ToolTraceStep;
  toolIcon: LucideIcon;
  toolAccent: string;
}) {
  const layers = buildLayers(step, toolIcon, toolAccent);
  const { activeStage, play, showAll, reset } = useSequentialReveal(
    layers.length,
    600,
  );

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const visible = (i: number) => activeStage >= i;

  return (
    <div>
      <div className="flex gap-2 mb-5">
        <button
          onClick={play}
          className="px-3 py-1.5 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-xs text-(--text-primary) hover:border-(--border-color)/60 cursor-pointer"
        >
          ▶ Mulai animasi
        </button>
        <button
          onClick={showAll}
          className="px-3 py-1.5 rounded-lg bg-(--bg-secondary) border border-(--border-color)/30 text-xs text-(--text-primary) hover:border-(--border-color)/60 cursor-pointer"
        >
          Tampilkan semua
        </button>
      </div>

      <div>
        {layers.map((layer, i) => (
          <div key={layer.key}>
            {i > 0 && <FlowArrow visible={visible(i)} />}
            <FlowNode
              visible={visible(i)}
              actor={layer.actor}
              icon={layer.icon}
              accent={layer.accent}
            >
              {layer.content}
            </FlowNode>
          </div>
        ))}
      </div>
    </div>
  );
}
