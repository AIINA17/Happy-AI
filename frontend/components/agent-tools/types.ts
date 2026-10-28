// Mirrors backend/agent/analysis/capture_tool_traces.py's output 1:1.

export interface VoiceGateInfo {
  status_before: string;
  passed: boolean;
}

// One real HTTP call the tool made to a live dummy e-commerce backend,
// captured by temporarily wrapping requests.get/post/put/delete during
// the call — see backend/agent/analysis/capture_tool_traces.py's
// _HttpCapture.
export interface HttpCall {
  method: string;
  url: string;
  status_code: number;
  duration_ms: number;
  response_preview: string | null;
}

// A data-channel event this TOOL is documented (from reading the real
// code) to trigger as a side effect — NOT something captured live from
// this particular run (the capture script has no LiveKit room to
// publish through), so it's an architectural fact about the code, shown
// as such.
export interface FrontendEvent {
  type: string;
  topic: string;
  note: string;
}

export interface ToolTraceStep {
  step: string;
  title: string;
  // Example of what a user might say to trigger this tool — written by
  // the capture script's author, NOT a transcript of a real voice
  // session (there's no live session to capture one from offline).
  user_utterance: string;
  policy_note: string;
  tool: {
    name: string;
    signature: string;
    gated: boolean;
  };
  arguments: Record<string, string | number | boolean>;
  voice_gate: VoiceGateInfo | null;
  http_calls: HttpCall[];
  frontend_event: FrontendEvent | null;
  result: {
    output: string;
    duration_ms: number;
  };
}

export interface ToolTraceFile {
  note: string;
  steps: ToolTraceStep[];
}
