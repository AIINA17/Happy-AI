import { Bot, Globe, type LucideIcon, Radio, User } from "lucide-react";

import type { ToolTraceStep } from "./types";

export const ACCENT_USER = "#5c9fd6";
export const ACCENT_AGENT = "#8b5cf6";
export const ACCENT_EXTERNAL = "#14b8a6";
export const ACCENT_TRANSPORT = "#06b6d4";

export interface AgentLayer {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: string;
}

// The full round trip for ONE tool call, as data (not JSX) — used to build
// both the compact React Flow nodes and the side-panel content for
// whichever layer is clicked. Layer count is dynamic: "external-api" /
// "tool-result" only appear if this step actually made an HTTP call;
// "frontend-event" only appears if this tool is documented to trigger one
// — never fabricated for a step that didn't do either.
export function buildAgentLayers(
  step: ToolTraceStep,
  toolIcon: LucideIcon,
  toolAccent: string,
): AgentLayer[] {
  const layers: AgentLayer[] = [
    { id: "user-ask", label: "User", icon: User, accent: ACCENT_USER },
    { id: "agent-decide", label: "Agent — memutuskan", icon: Bot, accent: ACCENT_AGENT },
    { id: "tool-call", label: step.tool.name, icon: toolIcon, accent: toolAccent },
  ];

  if (step.http_calls.length > 0) {
    layers.push({ id: "external-api", label: "API Eksternal (live)", icon: Globe, accent: ACCENT_EXTERNAL });
    layers.push({ id: "tool-result", label: `${step.tool.name} (hasil)`, icon: toolIcon, accent: toolAccent });
  }

  layers.push({ id: "agent-reply", label: "Agent — balasan", icon: Bot, accent: ACCENT_AGENT });

  if (step.frontend_event) {
    layers.push({ id: "frontend-event", label: "Frontend — event", icon: Radio, accent: ACCENT_TRANSPORT });
  }

  layers.push({ id: "user-receive", label: "User — menerima", icon: User, accent: ACCENT_USER });

  return layers;
}
