"use client";

import { Lock, LockOpen } from "lucide-react";

import { Panel } from "@/components/pipeline-flow/Panel";
import type { ToolTraceStep } from "./types";

function shortenUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname };
  } catch {
    return { host: url, path: "" };
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="text-sm font-mono font-medium text-slate-900 break-all">{value}</p>
    </div>
  );
}

// Full detail for ONE layer of a tool call's round trip — real data only
// (user_utterance is the one labeled exception, see types.ts). Content
// shown depends on which layer was clicked.
export function AgentStepPanel({
  step,
  layerId,
  onClose,
}: {
  step: ToolTraceStep;
  layerId: string;
  onClose: () => void;
}) {
  const titles: Record<string, string> = {
    "user-ask": "User",
    "agent-decide": "Agent — memutuskan tool",
    "tool-call": `Tool — ${step.tool.name}`,
    "external-api": "Dummy E-commerce — API eksternal (live)",
    "tool-result": `Tool — ${step.tool.name} (hasil)`,
    "agent-reply": "Agent — menyusun balasan",
    "frontend-event": "Frontend — event data-channel",
    "user-receive": "User — menerima balasan",
  };

  return (
    <Panel title={titles[layerId] ?? layerId} subtitle={step.title} onClose={onClose}>
      {layerId === "user-ask" && (
        <>
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
            Contoh ucapan
          </p>
          <p className="text-sm text-slate-900 italic">&ldquo;{step.user_utterance}&rdquo;</p>
          <p className="text-[10px] text-slate-400 mt-2">
            Contoh ditulis manual, bukan transkrip sesi suara asli (tidak ada
            sesi live yang bisa direkam offline).
          </p>
        </>
      )}

      {layerId === "agent-decide" && (
        <>
          <code className="block text-[11px] text-slate-900 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5 break-all">
            {step.tool.signature}
          </code>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-3">
            <span className="text-slate-700 font-medium">Kenapa: </span>
            {step.policy_note}
          </p>
        </>
      )}

      {layerId === "tool-call" && (
        <>
          {Object.entries(step.arguments).length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {Object.entries(step.arguments).map(([k, v]) => (
                <Stat key={k} label={k} value={String(v)} />
              ))}
            </div>
          )}
          {step.voice_gate && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs border ${
                step.voice_gate.passed
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              {step.voice_gate.passed ? <LockOpen size={14} /> : <Lock size={14} />}
              <span className="font-medium">
                Gerbang verifikasi suara: {step.voice_gate.passed ? "lolos" : "ditolak"}
              </span>
              <span className="text-slate-500">({step.voice_gate.status_before})</span>
            </div>
          )}
          <p className="text-[11px] text-slate-500 mt-3">
            {step.http_calls.length > 0
              ? `Mengirim ${step.http_calls.length} permintaan ke API eksternal...`
              : "Dijalankan lokal, tidak memanggil API eksternal."}
          </p>
        </>
      )}

      {layerId === "external-api" && (
        <div className="space-y-3">
          {step.http_calls.map((h, i) => {
            const { host, path } = shortenUrl(h.url);
            return (
              <div key={i} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-[11px] text-slate-900">
                    {h.method} {path}
                  </code>
                  <span
                    className={`px-1.5 rounded text-[10px] font-medium ${
                      h.status_code < 400
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {h.status_code}
                  </span>
                  <span className="text-slate-500 text-[11px]">{h.duration_ms.toFixed(0)}ms</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {host}
                  {h.response_preview ? ` · ${h.response_preview}` : ""}
                </p>
              </div>
            );
          })}
          <p className="text-[10px] text-slate-400">
            Diukur langsung dari panggilan nyata ke backend toko dummy yang
            live di internet — bukan simulasi.
          </p>
        </div>
      )}

      {layerId === "tool-result" && (
        <p className="text-[11px] text-slate-500">
          Menerima{" "}
          {step.http_calls.length > 1
            ? `${step.http_calls.length} respons dan menggabungkannya`
            : "respons"}
          , total {step.result.duration_ms.toFixed(0)}ms (termasuk waktu
          tunggu API eksternal).
        </p>
      )}

      {layerId === "agent-reply" && (
        <p className="text-sm text-slate-900 whitespace-pre-line leading-relaxed">
          {step.result.output}
        </p>
      )}

      {layerId === "frontend-event" && step.frontend_event && (
        <>
          <code className="block text-[11px] text-slate-900 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
            type={step.frontend_event.type} · topic={step.frontend_event.topic}
          </code>
          <p className="text-[11px] text-slate-500 leading-relaxed mt-2">
            {step.frontend_event.note}
          </p>
          <p className="text-[10px] text-amber-600 mt-2 italic">
            ⚠ Fakta dari kode (tools.py) — bukan event yang benar-benar
            terkirim di capture ini, karena tidak ada room LiveKit live.
          </p>
        </>
      )}

      {layerId === "user-receive" && (
        <p className="text-xs text-slate-500">
          Balasan di atas yang akan diucapkan Happy ke user
          {step.frontend_event ? ", sambil kartu produk muncul di layar" : ""}.
        </p>
      )}
    </Panel>
  );
}
