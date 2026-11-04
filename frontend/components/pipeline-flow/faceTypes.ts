// Mirrors backend/face_recognition/analysis/capture_face_traces.py's
// output 1:1 — real outputs from insightface's buffalo_l pipeline
// (detection, landmark, alignment, ArcFace recognition), not illustrative.

export interface FaceStageData {
  source_file: string;
  image_shape: number[];
  image_preview: string; // data:image/jpeg;base64,...
  detection: {
    bbox: number[]; // [x1, y1, x2, y2]
    det_score: number;
  };
  landmark: {
    kps: number[][]; // 5 x [x, y]
    landmark_2d_106_count: number;
  };
  alignment: {
    aligned_preview: string; // data:image/jpeg;base64,... 112x112
    size: number[];
  };
  embedding_dim: number;
  embedding_preview: number[];
}

export interface FaceScenario {
  scenario_id: string;
  title: string;
  probe: FaceStageData;
  similarity: number;
  threshold: number;
  decision: "VERIFIED" | "DENIED";
}

export interface FaceTraceFile {
  liveness_note: string;
  enrolled: FaceStageData;
  threshold: number;
  scenarios: FaceScenario[];
}
