import { Buffer } from "node:buffer";

/**
 * The image seam. Every still in this game is made here and nowhere else.
 *
 * fal is VIDEO ONLY: h3-max films the beats, and nothing else on that key is
 * called. Stills are nano-banana again — but on Google's own platform rather
 * than through fal. They used to be invoked from three separate routes that
 * each carried their own URL, retry and timeout logic, so "change the image
 * model" meant editing three files and hoping they stayed in agreement. They
 * are one function now, and swapping providers is this file.
 *
 * WHAT A PROVIDER HAS TO DO
 *
 *   generate            prompt -> one image.
 *   edit                prompt + reference images -> one image.
 *
 * The edit path is not optional and it is the harder half. It is what makes
 * the game work at all:
 *
 *   - his portrait in each look is his source picture REDRAWN, not repainted
 *     from a description (a sentence cannot reproduce a face);
 *   - the opening frame is composed FROM his portrait, so the boy in it is
 *     the actual boy;
 *   - every beat in 无视频模式 is an edit of the previous frame plus his
 *     portrait, which is how continuity and identity survive without video.
 *
 * A provider that can only generate from text will produce a game where he is
 * a different person every shot.
 *
 * ADDING ONE: write an async function of (ImageRequest) => Buffer, add it to
 * PROVIDERS, and set IMAGE_PROVIDER in .env.local.
 */

export type Aspect = "16:9" | "3:4";

export interface ImageRequest {
  prompt: string;
  aspect: Aspect;
  /**
   * Data URIs or https URLs. Non-empty turns this into an EDIT: the output
   * should keep what these images show and change what the prompt says.
   */
  references?: string[];
  /**
   * Determinism, where the provider supports it. Nothing depends on this any
   * more — his looks are derived by editing one source rather than by
   * repainting the same seed three times — so a provider that ignores it is
   * fine.
   */
  seed?: number;
}

export class ImageGenError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ImageGenError";
  }
}

const TIMEOUT_MS = 180_000;

/** Split `data:image/jpeg;base64,...` into its mime type and payload. */
function splitDataUri(uri: string): { mime: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(uri);
  return match ? { mime: match[1], data: match[2] } : null;
}

/* ------------------------------------------------------------------------ *
 * Google — nano banana, on Vertex AI or the Gemini API
 * ------------------------------------------------------------------------ */

/**
 * Gemini image models ("nano banana"), reached either through Vertex AI or
 * through the Generative Language API.
 *
 * Both speak the SAME generateContent body, so the only things that differ
 * are the URL and the auth header.
 *
 *   Vertex     https://{LOC}-aiplatform.googleapis.com/v1/projects/{PROJ}
 *                /locations/{LOC}/publishers/google/models/{MODEL}:generateContent
 *              OAuth2 bearer token ONLY.
 *
 *   Gemini API https://generativelanguage.googleapis.com/v1beta/models/{MODEL}
 *                :generateContent
 *              API key in x-goog-api-key ONLY.
 *
 * THE ENDPOINT IS CHOSEN BY THE CREDENTIAL, not by which env var is set —
 * measured, because the two failures are opposite and each one masks the
 * other:
 *
 *   Vertex does NOT accept API keys, at all: 401 CREDENTIALS_MISSING, "API
 *   keys are not supported by this API. Expected OAuth2 access token." A key
 *   that IS allowed through the key's API restrictions still fails here —
 *   the restriction check runs first and returns a different 403
 *   (API_KEY_SERVICE_BLOCKED), which reads like the only problem and is not.
 *
 *   The Gemini API accepts API keys and nothing else, and needs the
 *   GENERATIVE LANGUAGE API allowed on that key. Allowing only the Vertex AI
 *   API is the other half of the same trap: it unblocks the endpoint that
 *   cannot use the key and leaves the one that can, blocked.
 *
 * So sending a key to Vertex can never work however the project is
 * configured. Prefer OAuth where it is genuinely obtainable; otherwise use
 * the key against the endpoint that takes keys.
 */
async function googleImage(request: ImageRequest): Promise<Buffer> {
  const key =
    process.env.GOOGLE_IMAGE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY;
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1";
  const model = process.env.VERTEX_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";

  // OAuth first, and only if a project is configured to use it against.
  // Covers a service-account JSON at GOOGLE_APPLICATION_CREDENTIALS and a
  // developer signed in with `gcloud auth application-default login`. The
  // import is dynamic so the key-only path never pays for the library.
  let token: string | null = null;
  if (project) {
    try {
      const { GoogleAuth } = await import("google-auth-library");
      const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      token = (await (await auth.getClient()).getAccessToken()).token ?? null;
    } catch {
      token = null; // No ADC on this machine — fall through to the key.
    }
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url: string;
  const usingVertex = Boolean(project && token);

  if (usingVertex) {
    // Google publishes Nano Banana Pro in Vertex's global region. Unlike
    // regional endpoints, that location uses the non-prefixed API hostname.
    const vertexHost =
      location === "global"
        ? "https://aiplatform.googleapis.com"
        : `https://${location}-aiplatform.googleapis.com`;
    url =
      `${vertexHost}/v1/projects/${project}` +
      `/locations/${location}/publishers/google/models/${model}:generateContent`;
    headers.Authorization = `Bearer ${token}`;
  } else if (key) {
    if (project) {
      console.warn(
        "[imagegen] GOOGLE_CLOUD_PROJECT is set but no OAuth credentials were " +
          "found, and Vertex rejects API keys — using the Gemini API endpoint " +
          "with the key instead. To actually use Vertex, point " +
          "GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON."
      );
    }
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers["x-goog-api-key"] = key;
  } else {
    throw new ImageGenError(
      "No usable Google image credentials. Either set GOOGLE_IMAGE_API_KEY " +
        "(used against the Gemini API), or point GOOGLE_APPLICATION_CREDENTIALS " +
        "at a service-account JSON to use Vertex — Vertex rejects API keys."
    );
  }

  // Reference images ride as inline_data parts alongside the text. The text
  // goes FIRST: the prompt describes what to do with the images that follow,
  // and the model reads the parts in order.
  const parts: unknown[] = [{ text: request.prompt }];
  for (const reference of request.references ?? []) {
    const split = splitDataUri(reference);
    if (split) parts.push({ inline_data: { mimeType: split.mime, data: split.data } });
  }

  const send = (modalities: string[]) =>
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: modalities,
          // aspectRatio only. imageSize is documented inconsistently across
          // these models ("1K"/"2K" in one place, pixel strings in another),
          // and a value the model rejects fails the entire request — whereas
          // omitting it simply takes the default resolution.
          imageConfig: { aspectRatio: request.aspect },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  // These models disagree about whether TEXT may accompany IMAGE: some
  // require both, some accept IMAGE alone. Ask for both, and retry with IMAGE
  // alone if that is what this one wants. Parsing scans every part either
  // way, so an extra text part costs nothing.
  let response = await send(["TEXT", "IMAGE"]);
  if (response.status === 400) {
    const first = await response.text().catch(() => "");
    if (/modalit/i.test(first)) {
      response = await send(["IMAGE"]);
    } else {
      throw new ImageGenError(`image API 400: ${first.slice(0, 400)}`, 400);
    }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const hint =
      response.status === 403 && usingVertex
        ? " — Vertex OAuth succeeded, but this service account lacks " +
          "aiplatform.endpoints.predict. Grant Agent Platform User " +
          "(roles/aiplatform.user) to the JSON's client_email on this project."
        : response.status === 403
          ? " — a 403 here is the key's API restrictions. This endpoint needs the " +
          "GENERATIVE LANGUAGE API (generativelanguage.googleapis.com) enabled " +
          "on the project AND allowed on the key. Allowing only the Vertex AI " +
          "API is not enough — Vertex rejects API keys outright."
        : response.status === 401
          ? " — 401 means an API key reached Vertex, which only accepts OAuth2."
          : "";
    throw new ImageGenError(
      `image API ${response.status}: ${detail.slice(0, 400)}${hint}`,
      response.status
    );
  }

  const body = (await response.json()) as {
    candidates?: {
      content?: {
        parts?: {
          inlineData?: { data?: string };
          inline_data?: { data?: string };
          text?: string;
        }[];
      };
      finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
  };

  // The image can arrive in any part, and the field is camelCase over REST
  // but snake_case in some responses — accept both rather than guess.
  for (const part of body.candidates?.[0]?.content?.parts ?? []) {
    const data = part.inlineData?.data ?? part.inline_data?.data;
    if (data) return Buffer.from(data, "base64");
  }

  // No image in a 200. Say what the model said instead: a safety block, a
  // finish reason, or its plain-text refusal. Anything is better than
  // "returned no image", which describes the symptom and hides the cause.
  const said =
    body.promptFeedback?.blockReason ||
    body.candidates?.[0]?.finishReason ||
    body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join(" ") ||
    "no reason given";
  throw new ImageGenError(`image API returned no image — it said: ${said}`);
}

/* ------------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------------ */

/** The default until a provider is chosen. Fails loudly rather than silently. */
async function notConfigured(): Promise<Buffer> {
  throw new ImageGenError(
    "No image provider is configured. Set IMAGE_PROVIDER in .env.local " +
      `(available: ${Object.keys(PROVIDERS)
        .filter((name) => name !== "none")
        .join(", ")}), or add one to lib/imagegen.ts. fal is video-only here.`
  );
}

const PROVIDERS: Record<string, (request: ImageRequest) => Promise<Buffer>> = {
  none: notConfigured,
  /** nano banana. One function, two transports — see googleImage(). */
  google: googleImage,
  /** Alias, for when the project is configured and OAuth is available. */
  vertex: googleImage,
};

/**
 * Which provider is live.
 *
 * Explicit IMAGE_PROVIDER wins. With nothing set, a configured credential is
 * taken as a clear enough statement of intent; failing that it is the error,
 * which names what to do. It never falls back to fal — that is the whole
 * point of this file.
 */
export function activeProvider(): string {
  const named = process.env.IMAGE_PROVIDER?.trim();
  if (named && named in PROVIDERS) return named;
  if (process.env.GOOGLE_IMAGE_API_KEY || process.env.GOOGLE_CLOUD_PROJECT) {
    return "google";
  }
  return "none";
}

/**
 * Make one image. Returns the bytes; callers decide whether they want a file,
 * a data URI or a response.
 *
 * One retry on a transport failure, because a portrait is generated once and
 * then rides every later shot as the run's identity anchor — losing one to a
 * dropped connection costs the whole run its face.
 */
export async function generateImage(request: ImageRequest): Promise<Buffer> {
  const provider = PROVIDERS[activeProvider()];
  try {
    return await provider(request);
  } catch (first) {
    // A refusal, a bad key or a bad request will fail the same way twice;
    // only a transport-shaped failure is worth paying for again.
    if (first instanceof ImageGenError && first.status && first.status < 500) {
      throw first;
    }
    console.error(
      "[imagegen] first attempt failed, retrying:",
      first instanceof Error ? first.message : first
    );
    await new Promise((done) => setTimeout(done, 800));
    return await provider(request);
  }
}

/** Convenience for the callers that want to hand bytes straight to fal. */
export function toDataUri(bytes: Buffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
