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
export async function generateGemini({
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

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}
