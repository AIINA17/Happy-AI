// Mirrors backend/voiceverification/utils/pipeline_trace.py's
// build_trace_record() output 1:1. Both replay mode (static
// /pipeline-demo/traces.json) and live mode (POST /verify-voice/explain)
// resolve to this same shape.

export interface DecisionStep {
  check: string;
  passed: boolean;
  detail: string;
}

// One sub-module's forward-pass output, captured via a PyTorch forward hook
// (see backend/voiceverification/models/speaker_verifier.py for ECAPA-TDNN,
// backend/voiceverification/core/asvspoof.py for the anti-spoof wav2vec2
// model) — real activations from this run, not illustrative. Shared shape
// for both models.
export interface LayerBlockOutput {
  name: string;
  shape: number[];
  mean?: number;
  std?: number;
  min?: number;
  max?: number;
  preview: number[];
}

// One step of a simplified, illustrative architecture walkthrough (see
// backend/voiceverification/utils/ecapa_worked_example.py and
// antispoof_worked_example.py) — real short audio slice in, small fixed
// illustrative weights (not the trained model's), real arithmetic out.
// input/output are always 2D (rows of values) even for single-vector
// steps, so rendering never branches on shape. Shared shape for both
// models.
export interface LayerWorkedStep {
  step: string;
  title: string;
  formula: string | null;
  input: number[][] | null;
  output: number[][];
  note: string;
  extra: Record<string, number[]> | null;
}

// Log-mel spectrogram, downsampled on the time axis — see
// backend/voiceverification/utils/pipeline_trace.py's
// build_spectrogram_data(). db is [n_mels][n_frames], low→high mel bin.
export interface SpectrogramData {
  sample_rate: number;
  duration_sec: number;
  n_mels: number;
  n_frames: number;
  db: number[][];
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
    spectrogram: SpectrogramData | null;
  };

  speaker_verification: {
    model: string;
    embedding_dim: number;
    live_embedding: number[];
    matched_enroll_embedding: number[];
    ecapa_blocks: LayerBlockOutput[];
    ecapa_worked_example: LayerWorkedStep[];
    enrolled_spectrogram: SpectrogramData | null;
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
    antispoof_blocks: LayerBlockOutput[];
    antispoof_worked_example: LayerWorkedStep[];
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
