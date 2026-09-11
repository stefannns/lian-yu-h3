"use client";

import { FastH3Model } from "@reactor-models/fast-h3";
import type { ReactorMessage } from "@reactor-team/js-sdk";
import { REACTOR_PROMPT_MAX_CHARS } from "./limits";

const SAFE_CLIP_SECONDS = 5.167;

export interface ReactorClip {
  clipId: string;
}

type RecordValue = Record<string, unknown>;
type Waiter = { resolve: () => void; reject: (cause: Error) => void; timer: number };

let reactor: FastH3Model | null = null;
let connecting: Promise<FastH3Model> | null = null;
let configured = false;
let cachedToken: { jwt: string; expiresAtMs: number } | null = null;
let tokenRequest: Promise<string> | null = null;
let resetting: Promise<void> | null = null;
const generated = new Set<string>();
const waiters = new Map<string, Waiter>();
const playing = new Map<string, Promise<void>>();
let generationInFlight = false;
let mockCanvas: HTMLCanvasElement | null = null;
let mockStream: MediaStream | null = null;
let reactorAudioContext: AudioContext | null = null;
let activeAudioSource: MediaStreamAudioSourceNode | null = null;

/**
 * Resume Web Audio during the player's click, before asynchronous generation
 * loses browser user activation. Stage later routes Reactor's audio track
 * through this already-authorized context.
 */
export function primeReactorAudio() {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return;
  reactorAudioContext ??= new window.AudioContext();
  if (reactorAudioContext.state !== "running") void reactorAudioContext.resume();
}

export function attachReactorAudio(stream: MediaStream): () => void {
  primeReactorAudio();
  const context = reactorAudioContext;
  if (!context) return () => undefined;

  let source: MediaStreamAudioSourceNode | null = null;
  const connect = () => {
    if (source) return;
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    activeAudioSource?.disconnect();
    source = context.createMediaStreamSource(new MediaStream(tracks));
    source.connect(context.destination);
    activeAudioSource = source;
  };

  stream.addEventListener("addtrack", connect);
  connect();
  return () => {
    stream.removeEventListener("addtrack", connect);
    source?.disconnect();
    if (activeAudioSource === source) activeAudioSource = null;
  };
}

function trace(event: string, details: Record<string, string | number | boolean> = {}) {
  if (process.env.NODE_ENV !== "development") return;
  void fetch("/api/reactor/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, details }),
    keepalive: true,
  }).catch(() => undefined);
}

function isMockHarness(): boolean {
  return typeof window !== "undefined" &&
    window.location.pathname === "/reactor-mock";
}

function ensureMockStream(): MediaStream {
  if (mockStream) return mockStream;
  const canvas = document.createElement("canvas");
  canvas.width = 1344;
  canvas.height = 768;
  const context = canvas.getContext("2d");
  if (!context || typeof canvas.captureStream !== "function") {
    throw new Error("This browser cannot create the offline Reactor mock stream.");
  }
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  mockCanvas = canvas;
  mockStream = canvas.captureStream(24);
  trace("mock_stream_ready");
  return mockStream;
}

function playMockClip(id: string, onStarted?: () => void): Promise<void> {
  const current = playing.get(id);
  if (current) return current;

  const playback = new Promise<void>((resolve, reject) => {
    try {
      ensureMockStream();
      const canvas = mockCanvas;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) throw new Error("Offline Reactor mock canvas is unavailable.");
      const begun = performance.now();
      let announced = false;

      const paint = (now: number) => {
        const elapsed = now - begun;
        // Hold black briefly, exactly like Reactor's idle stream. The Stage
        // must keep its starting frame visible during this interval.
        if (elapsed < 250) {
          requestAnimationFrame(paint);
          return;
        }
        if (!announced) {
          announced = true;
          trace("mock_clip_started", { clip: id });
          onStarted?.();
        }

        const progress = Math.min(1, (elapsed - 250) / 2400);
        const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, `hsl(${330 - progress * 40} 58% 24%)`);
        gradient.addColorStop(1, `hsl(${34 + progress * 26} 78% 58%)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "rgba(255,255,255,.9)";
        context.beginPath();
        context.arc(220 + progress * 900, 350, 72, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#fff";
        context.font = "600 54px sans-serif";
        context.fillText("OFFLINE REACTOR MOCK", 330, 680);

        if (progress < 1) {
          requestAnimationFrame(paint);
        } else {
          trace("mock_clip_finished", { clip: id });
          resolve();
        }
      };
      requestAnimationFrame(paint);
    } catch (cause) {
      reject(cause);
    }
  }).finally(() => {
    if (playing.get(id) === playback) playing.delete(id);
  });
  playing.set(id, playback);
  return playback;
}

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" ? value as RecordValue : null;
}

function payload(message: ReactorMessage): RecordValue {
  return record(message.data) ?? record(message) ?? {};
}

function clipRecord(message: ReactorMessage): RecordValue {
  const data = payload(message);
  return record(data.clip) ?? data;
}

function clipId(message: ReactorMessage): string {
  const clip = clipRecord(message);
  const value = clip.clip_id ?? clip.clipId;
  return typeof value === "string" ? value : "";
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) return cachedToken.jwt;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    try {
      const response = await fetch("/api/reactor/token", { method: "POST", cache: "no-store" });
      const body = await response.json().catch(() => ({})) as {
        jwt?: string;
        expiresAt?: number;
        error?: string;
      };
      if (!response.ok || !body.jwt || !body.expiresAt) {
        throw new Error(body.error ?? `Reactor token API responded ${response.status}`);
      }
      cachedToken = { jwt: body.jwt, expiresAtMs: body.expiresAt * 1000 };
      return body.jwt;
    } finally {
      tokenRequest = null;
    }
  })();
  return tokenRequest;
}

function failWaiter(id: string, message: string) {
  const waiter = waiters.get(id);
  if (!waiter) return;
  window.clearTimeout(waiter.timer);
  waiters.delete(id);
  waiter.reject(new Error(message));
}

function markGenerated(id: string) {
  generated.add(id);
  const waiter = waiters.get(id);
  if (!waiter) return;
  window.clearTimeout(waiter.timer);
  waiters.delete(id);
  waiter.resolve();
}

function handleMessage(message: ReactorMessage) {
  if ([
    "clip_generated",
    "clip_failed",
    "clip_started",
    "clip_finished",
    "clip_stopped",
    "command_error",
    "session_reset",
  ].includes(message.type)) {
    trace(message.type, { clip: clipId(message).slice(0, 12) || "unknown" });
  }
  if (message.type === "clip_generated") {
    const id = clipId(message);
    if (!id) return;
    markGenerated(id);
  } else if (message.type === "queue_update") {
    // queue_update is Reactor's authoritative snapshot. It also recovers if a
    // clip_generated broadcast is delayed or missed while the SDK reconnects.
    const playout = payload(message).playout;
    if (Array.isArray(playout)) {
      for (const item of playout) {
        const clip = record(item);
        const id = clip?.clip_id ?? clip?.clipId;
        if (typeof id === "string" && id) markGenerated(id);
      }
    }
  } else if (message.type === "clip_failed") {
    const id = clipId(message);
    if (id) failWaiter(id, "Reactor failed to generate the clip.");
    else for (const pending of [...waiters.keys()]) failWaiter(pending, "Reactor failed to generate a clip.");
  }
}

async function ensureReactor(): Promise<FastH3Model> {
  const configure = async (client: FastH3Model) => {
    if (configured) return;
    const canvas = await client.sendCommand("set_canvas", { aspect: "16:9" });
    const flush = await client.sendCommand("set_flush_on_clip_end", { enabled: false });
    const autoplay = await client.sendCommand("set_autoplay", { enabled: false });
    if (!canvas || !flush || !autoplay) {
      throw new Error(client.getLastError()?.message ?? "Reactor session setup failed.");
    }
    configured = true;
  };
  if (reactor?.getStatus() === "ready") {
    await configure(reactor);
    return reactor;
  }
  if (connecting) return connecting;
  connecting = (async () => {
    // The model-specific client predeclares Fast H3's video and audio tracks,
    // so SDP negotiation can begin in parallel with coordinator readiness.
    const client = reactor ?? new FastH3Model({
      jwt: getToken,
      // Bound a bad connection before any enqueue can happen. These attempts
      // poll the same pre-generation session state; they never create clips.
      readyTimeoutMs: 12_000,
      maxSessionAttempts: 8,
      maxSdpAttempts: 8,
      logLevel: "warn",
    });
    if (!reactor) {
      reactor = client;
      client.on("message", handleMessage);
      client.on("statusChanged", (status) => trace("status", { status }));
      client.on("error", (error) => trace("sdk_error", {
        code: error.code || "unknown",
        recoverable: error.recoverable,
      }));
    }
    trace("connect_start");
    await client.connect();
    trace("connect_ready");
    await configure(client);
    trace("session_configured");
    return client;
  })();
  try {
    return await connecting;
  } catch (cause) {
    reactor = null;
    configured = false;
    throw cause;
  } finally {
    connecting = null;
  }
}

function dataUriBlob(uri: string): Blob {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/.exec(uri);
  if (!match) throw new Error("Reactor starting frame is not a data URI.");
  const mime = match[1] || "image/jpeg";
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function waitUntilGenerated(id: string): Promise<void> {
  if (generated.has(id)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      waiters.delete(id);
      trace("generation_timeout", { clip: id.slice(0, 12) });
      reject(new Error("Reactor clip generation timed out."));
    }, 45_000);
    waiters.set(id, { resolve, reject, timer });
  });
}

export async function filmShot(args: {
  prompt: string;
  seed: number;
  beat: number;
  duration: number;
  resolution: "480P" | "768P";
  fromFrame?: string;
  continueFromClipId?: string;
  signal?: AbortSignal;
}): Promise<ReactorClip> {
  args.signal?.throwIfAborted();
  if (Boolean(args.fromFrame) === Boolean(args.continueFromClipId)) {
    throw new Error("Reactor video needs exactly one starting frame source.");
  }
  if (generationInFlight) throw new Error("A video clip is already being generated.");

  // Set synchronously before the first await. React remounts and repeated
  // actions cannot enqueue two paid clips at the same time.
  generationInFlight = true;
  try {
    if (resetting) await resetting;
    const client = await ensureReactor();
    const startingFrame = args.fromFrame
      ? await client.uploadFile(dataUriBlob(args.fromFrame), { name: "beat-" + args.beat + ".jpg" })
      : undefined;
    args.signal?.throwIfAborted();

    const prompt = args.prompt.slice(0, REACTOR_PROMPT_MAX_CHARS);
    trace("enqueue_start", {
      beat: args.beat,
      seconds: SAFE_CLIP_SECONDS,
      source: startingFrame ? "starting_frame" : "previous_clip",
      promptChars: prompt.length,
      noTextLead: prompt.startsWith("NO ON-SCREEN TEXT OR SUBTITLES"),
      noTextGuard: prompt.includes("ABSOLUTELY NO on-screen text"),
    });
    const reply = await client.sendCommand("enqueue", {
      prompt,
      seed: args.seed + args.beat,
      seconds: SAFE_CLIP_SECONDS,
      metadata: JSON.stringify({ beat: args.beat }),
      ...(startingFrame ? { starting_frame: startingFrame } : {}),
      ...(args.continueFromClipId ? { continue_from_clip_id: args.continueFromClipId } : {}),
    });
    if (!reply) {
      const error = client.getLastError();
      throw new Error(error?.message ?? "Reactor did not accept the clip.");
    }
    const id = clipId(reply);
    if (!id) throw new Error("Reactor enqueue reply had no clip id.");
    trace("enqueue_accepted", { clip: id.slice(0, 12) });
    try {
      await waitUntilGenerated(id);
      args.signal?.throwIfAborted();
    } catch (cause) {
      generated.delete(id);
      await client.sendCommand("pop", { clip_id: id });
      throw cause;
    }
    return { clipId: id };
  } finally {
    generationInFlight = false;
  }
}

export async function reactorMediaStream(): Promise<MediaStream> {
  if (isMockHarness()) return ensureMockStream();
  const client = await ensureReactor();
  const combined = (video: MediaStreamTrack) => {
    const stream = new MediaStream([video]);
    const audio = client.getTrackByName("main_audio");
    if (audio) {
      stream.addTrack(audio);
    } else {
      const onAudio = (name: string, track: MediaStreamTrack) => {
        if (name !== "main_audio") return;
        client.off("trackReceived", onAudio);
        stream.addTrack(track);
      };
      client.on("trackReceived", onAudio);
    }
    return stream;
  };
  const existing = client.getTrackByName("main_video");
  if (existing) {
    trace("video_track_ready", { state: existing.readyState, muted: existing.muted });
    return combined(existing);
  }
  trace("video_track_wait");
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      client.off("trackReceived", onTrack);
      reject(new Error("Reactor video track timed out."));
    }, 30_000);
    const onTrack = (name: string) => {
      if (name !== "main_video") return;
      window.clearTimeout(timer);
      client.off("trackReceived", onTrack);
      const video = client.getTrackByName("main_video");
      if (!video) return reject(new Error("Reactor video track is unavailable."));
      trace("video_track_received", { state: video.readyState, muted: video.muted });
      resolve(combined(video));
    };
    client.on("trackReceived", onTrack);
  });
}

async function playReactorClipOnce(id: string, onStarted?: () => void): Promise<void> {
  const client = await ensureReactor();
  trace("play_prepare", { clip: id.slice(0, 12) });
  const playback = new Promise<void>((resolve, reject) => {
    let started = false;
    const finishTimer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Reactor clip playback timed out."));
    }, 45_000);
    const startTimer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Reactor clip did not start within 8 seconds."));
    }, 8_000);
    const matches = (message: ReactorMessage) => {
      const seen = clipId(message);
      return !seen || seen === id;
    };
    const onMessage = (message: ReactorMessage) => {
      if (message.type === "clip_started" && matches(message)) {
        if (!started) {
          started = true;
          window.clearTimeout(startTimer);
          onStarted?.();
        }
      } else if (message.type === "clip_finished" && matches(message)) {
        cleanup();
        resolve();
      } else if (
        (message.type === "clip_failed" ||
          message.type === "command_error" ||
          message.type === "session_reset") &&
        matches(message)
      ) {
        cleanup();
        const data = payload(message);
        const reason = typeof data.reason === "string" ? data.reason : "";
        reject(new Error(reason ? `Reactor playback failed: ${reason}` : "Reactor could not play the clip."));
      }
    };
    const cleanup = () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(finishTimer);
      client.off("message", onMessage);
    };
    client.on("message", onMessage);
    trace("play_command", { clip: id.slice(0, 12) });
    void client.sendCommand("play", { clip_id: id }).catch((cause) => {
      cleanup();
      reject(cause instanceof Error ? cause : new Error("Reactor did not accept playback."));
    });
  });
  await playback;
  generated.delete(id);
}

export function playReactorClip(id: string, onStarted?: () => void): Promise<void> {
  if (isMockHarness() && id.startsWith("mock-")) {
    return playMockClip(id, onStarted);
  }
  const current = playing.get(id);
  if (current) return current;

  // Store the shared promise before the first connection await inside
  // playReactorClipOnce. Effect remounts and development refreshes must join
  // this one play command rather than race through duplicate sends.
  const playback = playReactorClipOnce(id, onStarted).finally(() => {
    if (playing.get(id) === playback) playing.delete(id);
  });
  playing.set(id, playback);
  return playback;
}

export async function discardReactorClip(id: string): Promise<void> {
  generated.delete(id);
  const client = reactor;
  if (client?.getStatus() === "ready") await client.sendCommand("pop", { clip_id: id });
}

export async function resetReactorSession(): Promise<void> {
  if (resetting) return resetting;
  resetting = (async () => {
    generated.clear();
    for (const id of [...waiters.keys()]) failWaiter(id, "Reactor session reset.");
    const client = reactor;
    if (client?.getStatus() === "ready") {
      await client.sendCommand("reset", {});
      configured = false;
    }
  })();
  try {
    await resetting;
  } finally {
    resetting = null;
  }
}

export async function disconnectReactor(): Promise<void> {
  const client = reactor;
  reactor = null;
  configured = false;
  generated.clear();
  playing.clear();
  for (const id of [...waiters.keys()]) failWaiter(id, "Reactor session closed.");
  if (client) await client.disconnect().catch(() => undefined);
}
