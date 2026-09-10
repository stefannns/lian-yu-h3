"use client";

import { useCallback, useState } from "react";
import { Stage } from "@/components/stage";
import type { DirectorState } from "@/lib/engine";

const START_FRAME = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1344" height="768">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#241b2f"/>
        <stop offset="1" stop-color="#9a5867"/>
      </linearGradient>
    </defs>
    <rect width="1344" height="768" fill="url(#bg)"/>
    <circle cx="360" cy="350" r="110" fill="#f8e2d1" opacity=".9"/>
    <text x="672" y="650" fill="white" text-anchor="middle"
      font-family="sans-serif" font-size="54" font-weight="600">STARTING FRAME</text>
  </svg>
`)}`;

const INITIAL_STATE: DirectorState = {
  phase: "playing",
  beat: 1,
  currentShot: {
    beat: 1,
    action: null,
    kind: "opening",
    prompt: "Offline playback harness",
    still: false,
    videoUrl: "",
    rawUrl: "",
    reactorClipId: "mock-opening",
    thumb: START_FRAME,
  },
  freezeFrame: START_FRAME,
  narration: null,
  line: null,
  choices: [],
  shots: [],
  workingLabel: null,
  notice: null,
  canRetryScene: false,
  error: null,
  anchored: true,
  style: "cg3d",
  videoOff: false,
  him: null,
};

function report(event: string) {
  void fetch("/api/reactor/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event }),
  }).catch(() => undefined);
}

export default function ReactorMockPage() {
  const [state, setState] = useState(INITIAL_STATE);
  const [result, setResult] = useState<"running" | "passed" | "failed">("running");
  const [detail, setDetail] = useState("Starting-frame hold → local video → final-frame hold");

  const completed = useCallback((frames: { lastFrame: string; strip: string[]; thumb: string }) => {
    setResult("passed");
    setDetail(`Passed: captured ${frames.strip.length} sampled frames and the final frame.`);
    setState((current) => ({
      ...current,
      currentShot: current.currentShot
        ? { ...current.currentShot, still: true, reactorClipId: undefined, thumb: frames.thumb }
        : null,
      freezeFrame: frames.lastFrame,
    }));
    report("mock_stage_completed");
  }, []);

  const failed = useCallback((message?: string) => {
    setResult("failed");
    setDetail(message ?? "Mock playback failed.");
    report("mock_stage_failed");
  }, []);

  return (
    <>
      <Stage
        state={state}
        onClipEnded={() => undefined}
        onReactorClipEnded={completed}
        onReactorClipFailed={failed}
        onChoose={() => undefined}
        onTyped={() => undefined}
        onRetry={() => undefined}
      />
      <div style={{
        position: "fixed",
        zIndex: 20,
        top: 18,
        left: 18,
        maxWidth: 520,
        padding: "10px 14px",
        color: "#fff",
        background: result === "failed" ? "#8a2635" : result === "passed" ? "#235f43" : "#27202e",
        borderRadius: 6,
        font: "14px/1.5 sans-serif",
      }}>
        <strong>{result === "running" ? "OFFLINE MOCK RUNNING" : result === "passed" ? "OFFLINE MOCK PASSED" : "OFFLINE MOCK FAILED"}</strong>
        <div>{detail}</div>
        <div>No Reactor, Gemini, or image API calls.</div>
      </div>
    </>
  );
}
