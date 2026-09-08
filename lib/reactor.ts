"use client";

import { Reactor, type ReactorMessage } from "@reactor-team/js-sdk";
import { PROMPT_WARN_CHARS } from "./limits";

export const REACTOR_MODEL = "reactor/fast-h3";

export interface ReactorClip {
  clipId: string;
}

type RecordValue = Record<string, unknown>;
type Waiter = { resolve: () => void; reject: (cause: Error) => void; timer: number };

let reactor: Reactor | null = null;
let connecting: Promise<Reactor> | null = null;
let configured = false;
let cachedToken: { jwt: string; expiresAtMs: number } | null = null;
let tokenRequest: Promise<string> | null = null;
let resetting: Promise<void> | null = null;
const generated = new Set<string>();
const waiters = new Map<string, Waiter>();
const playing = new Map<string, Promise<void>>();

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

function handleMessage(message: ReactorMessage) {
  if (message.type === "clip_generated") {
    const id = clipId(message);
    if (!id) return;
    generated.add(id);
    const waiter = waiters.get(id);
    if (waiter) {
      window.clearTimeout(waiter.timer);
      waiters.delete(id);
      waiter.resolve();
    }
  } else if (message.type === "clip_failed") {
    const id = clipId(message);
    if (id) failWaiter(id, "Reactor failed to generate the clip.");
    else for (const pending of [...waiters.keys()]) failWaiter(pending, "Reactor failed to generate a clip.");
  }
}

async function ensureReactor(): Promise<Reactor> {
  const configure = async (client: Reactor) => {
    if (configured) return;
    await client.sendCommand("set_canvas", { aspect: "16:9" });
    await client.sendCommand("set_flush_on_clip_end", { enabled: false });
    await client.sendCommand("set_autoplay", { enabled: false });
    configured = true;
  };
  if (reactor?.getStatus() === "ready") {
    await configure(reactor);
    return reactor;
  }
  if (connecting) return connecting;
  connecting = (async () => {
    const client = reactor ?? new Reactor({
      modelName: REACTOR_MODEL,
      jwt: getToken,
      logLevel: "warn",
    });
    if (!reactor) {
      reactor = client;
      client.on("message", handleMessage);
    }
    await client.connect();
    await configure(client);
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
      reject(new Error("Reactor clip generation timed out."));
    }, 180_000);
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
  portrait?: string;
  signal?: AbortSignal;
}): Promise<ReactorClip> {
  args.signal?.throwIfAborted();
  if (resetting) await resetting;
  const client = await ensureReactor();
  const frame = args.fromFrame ?? args.portrait;
  const startingFrame = frame
    ? await client.uploadFile(dataUriBlob(frame), { name: `beat-${args.beat}.jpg` })
    : undefined;
  args.signal?.throwIfAborted();

  const prompt = args.prompt.slice(0, PROMPT_WARN_CHARS);
  const reply = await client.sendCommand("enqueue", {
    prompt,
    seed: args.seed + args.beat,
    seconds: Math.max(5.167, Math.min(14.375, args.duration)),
    metadata: JSON.stringify({ beat: args.beat }),
    ...(startingFrame ? { starting_frame: startingFrame } : {}),
  });
  if (!reply) {
    const error = client.getLastError();
    throw new Error(error?.message ?? "Reactor did not accept the clip.");
  }
  const id = clipId(reply);
  if (!id) throw new Error("Reactor enqueue reply had no clip id.");
  await waitUntilGenerated(id);
  args.signal?.throwIfAborted();
  return { clipId: id };
}

export async function reactorMediaStream(): Promise<MediaStream> {
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
  if (existing) return combined(existing);
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
      resolve(combined(video));
    };
    client.on("trackReceived", onTrack);
  });
}

export async function playReactorClip(id: string): Promise<void> {
  const current = playing.get(id);
  if (current) return current;
  const client = await ensureReactor();
  const playback = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Reactor clip playback timed out."));
    }, 45_000);
    const matches = (message: ReactorMessage) => {
      const seen = clipId(message);
      return !seen || seen === id;
    };
    const onMessage = (message: ReactorMessage) => {
      if (message.type === "clip_finished" && matches(message)) {
        cleanup();
        resolve();
      } else if (
        (message.type === "clip_failed" ||
          message.type === "command_error" ||
          message.type === "session_reset") &&
        matches(message)
      ) {
        cleanup();
        reject(new Error("Reactor could not play the clip."));
      }
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      client.off("message", onMessage);
    };
    client.on("message", onMessage);
    void client.sendCommand("play", { clip_id: id }).catch((cause) => {
      cleanup();
      reject(cause instanceof Error ? cause : new Error("Reactor did not accept playback."));
    });
  });
  playing.set(id, playback);
  try {
    await playback;
  } finally {
    playing.delete(id);
  }
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
