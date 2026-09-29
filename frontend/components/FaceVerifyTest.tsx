"use client";

// TEMPORARY testing component for /face/verify-face — lets you manually
// verify against whatever face is currently enrolled for this user,
// without wiring it into the agent's verification flow yet. Safe to
// delete once that real integration exists (see backend/README.md's
// "Belum dipanggil dari agent/" note).

import { useState } from "react";
import { ScanEye } from "lucide-react";

import { Button } from "@/components/ui/button";
import FaceLivenessCapture from "./FaceLivenessCapture";

interface Props {
  userId: string | null;
}

export default function FaceVerifyTest({ userId }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <FaceLivenessCapture userId={userId} open={open} onOpenChange={setOpen} />

      <Button
        onClick={() => setOpen(true)}
        disabled={!userId}
        variant="secondary"
        className="w-full h-auto rounded-xl py-3 mt-2"
      >
        <ScanEye size={18} />
        <span>[TEST] Verify Face</span>
      </Button>
    </>
  );
}
