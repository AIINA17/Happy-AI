"use client";

import type { BlockExplainer } from "@/components/pipeline/blockExplainer";
import type { LayerBlockOutput } from "@/components/pipeline/types";
import { faceStageExplainer } from "./faceStageExplainer";
import type { FaceStageData } from "./faceTypes";
import { Panel } from "./Panel";

// Structured "what is this block" breakdown, shown the same way for a real
// captured ECAPA/anti-spoof layer and for a face-pipeline stage: the
// formula broken into readable steps, then input/output shape+meaning,
// what the block actually does, a short real-numbers example, and why the
// step exists at all. Always expanded (not behind a toggle) — the user
// already clicked into a block wanting this detail.
function ExplainerSections({ explainer }: { explainer: BlockExplainer }) {
  return (
    <div className="space-y-5 mt-5 pt-5 border-t border-slate-200">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Rumus</p>
        <div className="space-y-1.5">
          {explainer.formula.map((line, i) => (
            <code
              key={i}
              className="block text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 leading-relaxed"
            >
              {line}
            </code>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-blue-50 border border-blue-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-500 mb-1.5">Input</p>
          <p className="text-sm text-slate-700 leading-relaxed">{explainer.input}</p>
        </div>
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-1.5">Output</p>
          <p className="text-sm text-slate-700 leading-relaxed">{explainer.output}</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
          Proses: blok ini ngapain
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">{explainer.process}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
          Contoh perhitungan singkat
        </p>
        <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
          {explainer.calculation}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-500 mb-1.5">
          Kenapa blok ini penting
        </p>
        <p className="text-sm text-slate-600 leading-relaxed">{explainer.why}</p>
      </div>
    </div>
  );
}

function FeatureStrip({ preview }: { preview: number[] }) {
  const values = preview.slice(0, 64);
  if (values.length === 0) return null;
  const maxAbs = Math.max(...values.map(Math.abs), 1e-6);
  return (
    <div className="grid grid-cols-8 gap-0.5 mt-2 max-w-50">
      {values.map((v, i) => {
        const intensity = Math.min(1, Math.abs(v) / maxAbs);
        return (
          <span
            key={i}
            className="h-2 rounded-[1px]"
            title={v.toFixed(5)}
            style={{
              backgroundColor:
                v >= 0
                  ? `rgba(42,120,214,${0.15 + intensity * 0.85})`
                  : `rgba(235,104,52,${0.15 + intensity * 0.85})`,
            }}
          />
        );
      })}
    </div>
  );
}

// One real captured layer (ECAPA or anti-spoof) — mean/std/min/max are
// computed over the FULL tensor, so they're representative; the raw-value
// strip below is honestly labeled as just the first 64 flattened values.
export function LayerBlockPanel({
  label,
  block,
  explainer,
  accent,
  onClose,
}: {
  label: string;
  block: LayerBlockOutput;
  explainer: BlockExplainer | null;
  accent: string;
  onClose: () => void;
}) {
  return (
    <Panel title={label} subtitle={`shape [${block.shape.join("×")}]`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          ["mean (μ)", block.mean],
          ["std (σ)", block.std],
          ["min", block.min],
          ["max", block.max],
        ].map(([lbl, v]) => (
          <div key={lbl as string} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-xs text-slate-500">{lbl}</p>
            <p className="text-base font-mono font-medium text-slate-900">
              {typeof v === "number" ? v.toFixed(4) : "—"}
            </p>
          </div>
        ))}
      </div>

      <p className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">
        Contoh nilai mentah (64 pertama dari tensor)
      </p>
      <FeatureStrip preview={block.preview} />
      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
        Statistik di atas dihitung dari seluruh tensor layer ini (bukan dari
        64 nilai yang ditampilkan) — ditangkap lewat forward hook pada model
        pretrained asli.
      </p>

      {explainer && <ExplainerSections explainer={explainer} />}

      <div className="mt-4 pt-3 border-t border-slate-200 flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="text-sm text-slate-500">Bagian dari {label.split(" ")[0]}</span>
      </div>
    </Panel>
  );
}

function BBoxOverlay({
  imageShape,
  bbox,
  displayWidth = 220,
}: {
  imageShape: number[];
  bbox: number[];
  displayWidth?: number;
}) {
  const [imgH, imgW] = imageShape;
  const displayHeight = (imgH / imgW) * displayWidth;
  const scale = displayWidth / imgW;
  return (
    <div
      className="absolute border-2 border-emerald-500 rounded-sm"
      style={{
        left: bbox[0] * scale,
        top: bbox[1] * scale,
        width: (bbox[2] - bbox[0]) * scale,
        height: (bbox[3] - bbox[1]) * scale,
        maxWidth: displayWidth,
        maxHeight: displayHeight,
      }}
    />
  );
}

function KpsOverlay({
  imageShape,
  kps,
  displayWidth = 220,
}: {
  imageShape: number[];
  kps: number[][];
  displayWidth?: number;
}) {
  const [, imgW] = imageShape;
  const scale = displayWidth / imgW;
  return (
    <>
      {kps.map(([x, y], i) => (
        <span
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full bg-emerald-500"
          style={{ left: x * scale - 3, top: y * scale - 3 }}
        />
      ))}
    </>
  );
}

// One real stage of the insightface buffalo_l pipeline — bbox/score,
// keypoints, aligned crop, and embedding preview are all read straight off
// the real `Face` object (see capture_face_traces.py), not fabricated.
export function FaceStagePanel({
  stage,
  data,
  accent,
  onClose,
}: {
  stage: "detection" | "landmark" | "alignment" | "recognition";
  data: FaceStageData;
  accent: string;
  onClose: () => void;
}) {
  const titles: Record<typeof stage, string> = {
    detection: "Face Detection (det_10g.onnx)",
    landmark: "Landmark Localization (2d106det.onnx)",
    alignment: "Face Alignment (norm_crop)",
    recognition: "Recognition — ArcFace (w600k_r50.onnx)",
  };
  const explainer = faceStageExplainer(stage);

  return (
    <Panel title={titles[stage]} subtitle={data.source_file} onClose={onClose}>
      {stage === "detection" && (
        <>
          <div className="relative inline-block">
            <img
              src={data.image_preview}
              alt="preview"
              width={220}
              className="rounded-lg border border-slate-200"
            />
            <BBoxOverlay imageShape={data.image_shape} bbox={data.detection.bbox} />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500">det_score</p>
              <p className="text-base font-mono font-medium text-slate-900">
                {data.detection.det_score.toFixed(4)}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-xs text-slate-500">bbox [x1,y1,x2,y2]</p>
              <p className="text-sm font-mono text-slate-900">
                {data.detection.bbox.map((v) => v.toFixed(0)).join(", ")}
              </p>
            </div>
          </div>
        </>
      )}

      {stage === "landmark" && (
        <>
          <div className="relative inline-block">
            <img
              src={data.image_preview}
              alt="preview"
              width={220}
              className="rounded-lg border border-slate-200"
            />
            <KpsOverlay imageShape={data.image_shape} kps={data.landmark.kps} />
          </div>
          <p className="text-sm text-slate-500 mt-3 leading-relaxed">
            5 titik kunci (mata, hidung, sudut mulut) dipakai untuk alignment
            — model juga menghasilkan {data.landmark.landmark_2d_106_count}{" "}
            titik landmark 2D yang lebih detail (tidak digambar di sini).
          </p>
        </>
      )}

      {stage === "alignment" && (
        <>
          <img
            src={data.alignment.aligned_preview}
            alt="aligned face"
            width={112}
            height={112}
            className="rounded-lg border border-slate-200"
          />
          <p className="text-sm text-slate-500 mt-3 leading-relaxed">
            Wajah asli dipotong &amp; diluruskan (warp geometris berdasarkan 5
            titik kunci) ke {data.alignment.size.join("×")} — ini persis
            gambar yang masuk ke model pengenalan, bukan ilustrasi.
          </p>
        </>
      )}

      {stage === "recognition" && (
        <>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 mb-3">
            <p className="text-xs text-slate-500">embedding_dim</p>
            <p className="text-base font-mono font-medium text-slate-900">
              {data.embedding_dim}
            </p>
          </div>
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">
            16 nilai pertama embedding (dari {data.embedding_dim})
          </p>
          <div className="grid grid-cols-4 gap-1">
            {data.embedding_preview.map((v, i) => (
              <span
                key={i}
                className="text-xs font-mono text-center py-1 rounded bg-slate-50 border border-slate-200 text-slate-700"
              >
                {v.toFixed(3)}
              </span>
            ))}
          </div>
        </>
      )}

      <ExplainerSections explainer={explainer} />

      <div className="mt-4 pt-3 border-t border-slate-200 flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="text-sm text-slate-500">
          Data nyata dari insightface buffalo_l
        </span>
      </div>
    </Panel>
  );
}
