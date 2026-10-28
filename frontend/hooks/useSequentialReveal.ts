"use client";

import { useCallback, useRef, useState } from "react";

// Fixed, scripted stage-by-stage reveal for the /pipeline explainer page.
// Plain setInterval is enough here — the sequence is a short, known-length
// list of stages, not something that needs spring physics or gestures.
export function useSequentialReveal(stageCount: number, stepMs = 700) {
  const [activeStage, setActiveStage] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    stop();
    setActiveStage(-1);
    let i = -1;
    timerRef.current = setInterval(() => {
      i += 1;
      setActiveStage(i);
      if (i >= stageCount - 1) stop();
    }, stepMs);
  }, [stageCount, stepMs, stop]);

  const showAll = useCallback(() => {
    stop();
    setActiveStage(stageCount - 1);
  }, [stageCount, stop]);

  const reset = useCallback(() => {
    stop();
    setActiveStage(-1);
  }, [stop]);

  return { activeStage, play, showAll, reset };
}
