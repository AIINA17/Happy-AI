"use client";

import { useState } from "react";
import { ScanSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import FaceLivenessCapture, {
  type FaceVerifyOutcome,
} from "./FaceLivenessCapture";

interface Props {
  userId: string | null;
  setVerifyStatus: (status: string) => void;
}

// Manual, on-demand trigger for the *same* liveness-gated flow the agent
// uses (FaceLivenessCapture.tsx): server-picked gesture challenge +
// single-use liveness_token + /face/verify-face. This used to run its own
// separate camera/MediaPipe capture pipeline with no liveness check at
// all, which duplicated most of FaceLivenessCapture's logic without its
// actual guarantee — now it just opens that shared modal, so "testing
// face recognition" from the sidebar also genuinely exercises liveness.
export default function FaceVerification({ userId, setVerifyStatus }: Props) {
  const [open, setOpen] = useState(false);

  const handleResult = (outcome: FaceVerifyOutcome) => {
    if (outcome.decision === "VERIFIED") {
      setVerifyStatus(
        outcome.similarity !== null
          ? `Wajah terverifikasi (similarity ${outcome.similarity.toFixed(3)})`
          : "Wajah terverifikasi",
      );
    } else if (outcome.decision === "DENIED") {
      setVerifyStatus(
        outcome.similarity !== null
          ? `Wajah tidak cocok (similarity ${outcome.similarity.toFixed(3)})`
          : "Wajah tidak cocok atau liveness gagal",
      );
    } else {
      setVerifyStatus(
        `Verifikasi wajah error${outcome.message ? `: ${outcome.message}` : ""}`,
      );
    }
  };

  return (
    <>
      <FaceLivenessCapture
        userId={userId}
        open={open}
        onOpenChange={setOpen}
        onResult={handleResult}
      />

      <Button
        onClick={() => setOpen(true)}
        disabled={!userId}
        variant="outline"
        className="w-full h-auto rounded-xl py-3"
      >
        <ScanSearch size={18} />
        <span>Test Face Recognition</span>
      </Button>
    </>
  );
}
