// Mirrors backend/voiceverification/utils/pipeline_trace.py's
// build_trace_record() output 1:1. Both replay mode (static
// /pipeline-demo/traces.json) and live mode (POST /verify-voice/explain)
// resolve to this same shape.

export interface DecisionStep {
  check: string;
  passed: boolean;
  detail: string;
}

export interface PipelineTrace {
  scenario_id: string;
  title: string;
  scenario_type:
    | "real_recording"
    | "truncated_real_recording"
    | "synthetic_behavior_profile"
    | "live_capture";
  source_file: string | null;
  enrolled_label: string | null;
  synthetic_note: string | null;

  input: {
    sample_rate: number;
    duration_sec: number;
    trim_start_sec: number;
    trim_end_sec: number;
    speech_sec: number;
    waveform_preview: number[];
  };

  speaker_verification: {
    model: string;
    embedding_dim: number;
    live_embedding: number[];
    matched_enroll_embedding: number[];
    all_scores: number[];
    best_index: number;
    best_label: string;
    score: number;
    thresholds: {
      voice_accept: number;
      voice_repeat: number;
      abs_min_speaker: number;
    };
  };

  anti_spoof: {
    model: string;
    fake_prob: number;
    real_prob: number | null;
    thresholds: {
      replay_warn: number;
      replay_deny: number;
    };
  };

  behavior_profiling: {
    available: boolean;
    n_samples: number;
    pitch_hz: number | null;
    rate_proxy_sec: number | null;
    z_pitch: number | null;
    z_rate: number | null;
    behavior_score: number | null;
    thresholds: {
      behavior_repeat: number;
      behavior_min_samples: number;
    };
  };

  decision: {
    final: "VERIFIED" | "REPEAT" | "DENIED";
    reason: string;
    steps: DecisionStep[];
  };

  captured_at: string;
}
