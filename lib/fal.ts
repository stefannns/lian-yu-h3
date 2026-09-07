"use client";

import { fal } from "@fal-ai/client";
import { PROMPT_WARN_CHARS } from "./limits";

export { PROMPT_WARN_CHARS };

/*
 * fal is VIDEO ONLY in this project. h3-max films the beats and nothing else
 * on this key is called — stills go through lib/imagegen.ts, moderation goes
 * straight to Gemini. Keep it that way: the image provider is meant to be
 * swappable without touching anything in this file.
 */

// FAL_KEY never reaches the browser: all traffic rides the server proxy.
fal.config({ proxyUrl: "/api/fal/proxy" });

export { fal };

/**
 * Reference-to-video is the endpoint this game runs on, not image-to-video.
 *
 * It takes up to 9 reference images, each addressable in the prompt as
 * "Image 1", "Image 2" — which is the only way a run keeps him looking like
 * himself. It has NO first-frame field, so the previous shot's last frame
 * rides in as reference number one and the prompt says so explicitly.
 *
 * The trade is real: ref2v composes FROM its references rather than
 * continuing a keyframe, so it holds the room slightly less tightly than
 * i2v does. In a romance that is the right side to lose on — a sofa that
 * shifts is forgivable, a boy whose face changes is not.
 */
export const REF2V_ENDPOINT = "minimax/h3-max/reference-to-video";
export const I2V_ENDPOINT = "minimax/h3-max/image-to-video";
export const T2V_ENDPOINT = "minimax/h3-max/text-to-video";

export interface Clip {
  /** Same-origin proxied URL — safe for playback and canvas frame grabs. */
  videoUrl: string;
  /** Raw fal CDN URL. */
  rawUrl: string;
}

/**
 * Film one shot.
 *
 * With a frame and a portrait this is ref2v ([frame, portrait]); with a
 * frame alone it falls back to i2v; with neither it is a cold t2v start,
 * which only happens if the opening still failed to paint.
 *
 * The seed is fixed per run and varied per beat, so two near-identical
 * prompts stop producing two near-identical shots.
 */
export async function filmShot(args: {
  prompt: string;
  seed: number;
  beat: number;
  duration: number;
  resolution: "480P" | "768P";
  /** Data URI of the previous shot's last frame. Omit for the cold open. */
  fromFrame?: string;
  /** His cached portrait, as a data URI. */
  portrait?: string;
  signal?: AbortSignal;
}): Promise<Clip> {
  const base: Record<string, unknown> = {
    prompt: args.prompt,
    duration: args.duration,
    resolution: args.resolution,
    seed: args.seed + args.beat,
    // Enrichment rewrites the prompt, and a rewritten prompt loses the
    // camera and style clauses this game depends on. Only the cold open,
    // which has no frame to hold continuity for it, is allowed the help.
    // fal documents only "balanced" and "quality" for this field. "disabled"
    // is undocumented but is what the reference implementation uses and what
    // observed working runs sent — it is what keeps fal from rewriting the
    // prompt, and a rewritten prompt is one that has lost the camera and
    // style clauses this game depends on. Kept, but named here as the first
    // thing to try changing if the endpoint starts 422-ing.
    prompt_expansion_mode: args.fromFrame ? "disabled" : "balanced",
  };

  let endpoint: string;
  const input = { ...base };
  if (args.fromFrame && args.portrait) {
    // Continuing a scene: the frame holds the room, the portrait holds him.
    endpoint = REF2V_ENDPOINT;
    input.reference_image_urls = [args.fromFrame, args.portrait];
    input.aspect_ratio = "16:9";
  } else if (args.portrait) {
    // A CUT: no frame on purpose, because the new place must not be grown out
    // of the old one. Still ref2v rather than text-to-video — the room is
    // meant to change, his face is not, and t2v would invent a new person
    // every time the film moves. This is the whole reason a cut is allowed to
    // exist without throwing away the run's identity anchor.
    endpoint = REF2V_ENDPOINT;
    input.reference_image_urls = [args.portrait];
    input.aspect_ratio = "16:9";
  } else if (args.fromFrame) {
    endpoint = I2V_ENDPOINT;
    input.image_url = args.fromFrame;
  } else {
    // Nothing to anchor to at all — only reachable if the portrait failed.
    endpoint = T2V_ENDPOINT;
    input.aspect_ratio = "16:9";
  }

  if (args.prompt.length > PROMPT_WARN_CHARS) {
    console.warn(
      `[filmShot] prompt is ${args.prompt.length} chars, over the ~${PROMPT_WARN_CHARS} ` +
        `this endpoint reliably accepts — see dress() in lib/story.ts`
    );
  }

  const attempt = async (ep: string, body: Record<string, unknown>) => {
    const out = await fal.subscribe(ep, { input: body });
    args.signal?.throwIfAborted();
    return out;
  };

  let result;
  try {
    result = await attempt(endpoint, input);
  } catch (first) {
    // fal's own gateway returns 504 on the queue endpoint under load. Losing
    // the beat to it is far worse than paying for a second attempt, so retry
    // — and if this was a reference shot, fall the whole way back to i2v
    // rather than stranding the player mid-turn. A shot that continues the
    // frame without his portrait still plays; a beat that refuses to film
    // ends the run.
    console.error(`[filmShot] ${endpoint} failed, retrying:`, describe(first, args.prompt));
    await new Promise((done) => setTimeout(done, 900));
    try {
      result = await attempt(endpoint, input);
    } catch (second) {
      // Falling back to i2v needs a frame; a cut has none, so it just fails.
      if (endpoint !== REF2V_ENDPOINT || !args.fromFrame) throw second;
      console.error("[filmShot] ref2v failed twice, falling back to i2v:", describe(second, args.prompt));
      result = await attempt(I2V_ENDPOINT, { ...base, image_url: args.fromFrame });
    }
  }

  const rawUrl = (result.data as { video?: { url?: string } })?.video?.url;
  if (!rawUrl) throw new Error("no video in response");
  return { videoUrl: `/api/media?url=${encodeURIComponent(rawUrl)}`, rawUrl };
}

/**
 * Say what actually went wrong.
 *
 * The previous version read three optional fields off the cause and returned
 * an object literal — which printed as `{}` in the browser console for a real
 * failure, because fal's ApiError carries `message` and `status` as own
 * properties that a spread-free field read can still miss, and because an
 * empty `message` collapses the whole thing to nothing useful. A retry log
 * that says "it failed: {}" costs more than no log at all: it looks like
 * information and answers nothing.
 *
 * fal throws ApiError (and ValidationError, its 422 subclass) with .status,
 * .body, .requestId — see @fal-ai/client/src/response.js. Everything is
 * pulled out defensively, plus the raw String() form as a last resort, plus
 * the prompt length, which is the single most common cause of a 422 here.
 */
function describe(cause: unknown, prompt: string) {
  const err = (cause ?? {}) as {
    name?: string;
    message?: string;
    status?: number;
    requestId?: string;
    body?: unknown;
  };
  let body: string | undefined;
  try {
    body = err.body === undefined ? undefined : JSON.stringify(err.body).slice(0, 700);
  } catch {
    body = String(err.body).slice(0, 700);
  }
  return {
    name: err.name,
    status: err.status,
    message: err.message || undefined,
    requestId: err.requestId || undefined,
    body,
    raw: String(cause).slice(0, 300),
    promptChars: prompt.length,
  };
}

/**
 * Crop a still to the aspect the caller wanted.
 *
 * Usually a no-op — the image provider is asked for the right aspect — but "16:9" is
 * not exactly 1280/720 in every renderer, and handing a still of the wrong
 * shape to a 16:9 clip makes h3 reframe a composition nobody asked it to
 * touch. Done in the browser so /api/image stays free of an image library.
 */
async function cropTo(source: string, width: number, height: number): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("still failed to decode"));
    el.crossOrigin = "anonymous";
    el.src = source;
  });

  const want = width / height;
  const have = image.naturalWidth / image.naturalHeight;
  if (Math.abs(want - have) < 0.01) return source;

  const cropW = have > want ? image.naturalHeight * want : image.naturalWidth;
  const cropH = have > want ? image.naturalHeight : image.naturalWidth / want;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropW);
  canvas.height = Math.round(cropH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(
    image,
    Math.round((image.naturalWidth - cropW) / 2),
    Math.round((image.naturalHeight - cropH) / 2),
    Math.round(cropW),
    Math.round(cropH),
    0, 0, canvas.width, canvas.height
  );
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Paint a still through /api/image. Returns a data URI, not
 * a URL: the still is cropped on a browser canvas (a cross-origin source
 * would taint it) and can be used as the next Gemini still or posted to fal
 * as a video reference. Both paths accept data URIs.
 */
export async function paintFrame(args: {
  prompt: string;
  seed: number;
  width: number;
  height: number;
  /** Turns the call into an EDIT from these references. */
  references?: string[];
}): Promise<string> {
  const refs = (args.references ?? []).filter(Boolean);
  const response = await fetch("/api/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: args.prompt,
      width: args.width,
      height: args.height,
      seed: args.seed,
      ...(refs.length > 0 ? { referenceImages: refs.slice(0, 8) } : {}),
    }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `image API responded ${response.status}`);
  }
  const { image } = (await response.json()) as { image?: string };
  if (!image) throw new Error("no image in response");
  return cropTo(image, args.width, args.height);
}

/** Fetch one character's cached portrait for one look, making it if absent. */
export async function loadPortrait(id: string, style: string): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/portrait?id=${encodeURIComponent(id)}&style=${encodeURIComponent(style)}`
    );
    if (!response.ok) return null;
    const { portrait } = (await response.json()) as { portrait?: string };
    return portrait ?? null;
  } catch {
    return null;
  }
}
