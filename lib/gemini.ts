/**
 * One server-only Gemini transport for both supported Google products.
 *
 * The Gemini Developer API-key path is the default because it is the
 * simplest fit for the game's server-side writing. Vertex OAuth is opt-in
 * through GEMINI_TRANSPORT=vertex, which places text spend on the linked
 * Google Cloud billing account rather than an AI Studio key.
 */

const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface GeminiRequest {
  model: string;
  system?: string;
  parts: GeminiPart[];
  generationConfig?: Record<string, unknown>;
  timeoutMs?: number;
}

export class GeminiTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiTransportError";
  }
}

function responseRetryAfterMs(response: Response, detail: string): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  const headerDelay = Number.isFinite(seconds)
    ? seconds * 1_000
    : header
      ? Date.parse(header) - Date.now()
      : 0;
  const bodyMatch = /"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"/.exec(detail);
  const bodyDelay = bodyMatch ? Number(bodyMatch[1]) * 1_000 : 0;
  return Math.max(
    Number.isFinite(headerDelay) ? headerDelay : 0,
    Number.isFinite(bodyDelay) ? bodyDelay : 0,
    0
  );
}

async function vertexToken(): Promise<string | null> {
  try {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({ scopes: [CLOUD_SCOPE] });
    return (await (await auth.getClient()).getAccessToken()).token ?? null;
  } catch (cause) {
    console.warn(
      "[gemini] Vertex credentials were unavailable:",
      cause instanceof Error ? cause.message : "unknown"
    );
    return null;
  }
}

/** Send one server-side generateContent request without exposing credentials. */
async function generateGeminiWithRetry({
  model,
  system,
  parts,
  generationConfig,
  timeoutMs = 30_000,
}: GeminiRequest): Promise<Response> {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || "us-central1";
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const useVertex = process.env.GEMINI_TRANSPORT?.trim().toLowerCase() === "vertex";
  const token = useVertex && project ? await vertexToken() : null;

  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (useVertex) {
    // An explicit transport setting is a billing decision. Never silently
    // fall back to the AI Studio key if service-account auth is misconfigured:
    // that would put a paid request on a different account than the player
    // chose, and make cost tracking misleading.
    if (!project || !token) {
      throw new GeminiTransportError(
        "Vertex text transport is selected but service-account credentials could not be loaded. " +
          "Check GOOGLE_CLOUD_PROJECT and GOOGLE_APPLICATION_CREDENTIALS."
      );
    }
    const host =
      location === "global"
        ? "https://aiplatform.googleapis.com"
        : `https://${location}-aiplatform.googleapis.com`;
    url = `${host}/v1/projects/${project}/locations/${location}` +
      `/publishers/google/models/${model}:generateContent`;
    headers.Authorization = `Bearer ${token}`;
  } else if (apiKey) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers["x-goog-api-key"] = apiKey;
  } else {
    throw new GeminiTransportError(
      useVertex && project
        ? "Vertex credentials could not be loaded. Check GOOGLE_APPLICATION_CREDENTIALS."
        : "No Gemini credentials are configured."
    );
  }

  const payload: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    ...(generationConfig ? { generationConfig } : {}),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === 3) return response;

    const detail = await response.text().catch(() => "");
    const waitHint = responseRetryAfterMs(response, detail);
    if (waitHint > 120_000) return new Response(detail, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    const baseDelay = response.status === 429 ? 15_000 : 2_000;
    const delay = Math.max(
      waitHint,
      baseDelay * 2 ** (attempt - 1) + Math.floor(Math.random() * 2_000)
    );
    console.warn("[gemini] retrying transient failure", {
      status: response.status,
      model,
      attempt,
      delayMs: delay,
    });
    await new Promise((done) => setTimeout(done, delay));
  }

  throw new GeminiTransportError("Gemini retry loop ended unexpectedly.");
}

// Moderation, shot writing and scene reading can arrive from different API
// routes. Serialize them inside this server process so one player action
// cannot create a burst against Vertex shared capacity.
let geminiQueue: Promise<void> = Promise.resolve();

export function generateGemini(request: GeminiRequest): Promise<Response> {
  const result = geminiQueue.then(() => generateGeminiWithRetry(request));
  geminiQueue = result.then(() => undefined, () => undefined);
  return result;
}
