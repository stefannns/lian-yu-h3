import { NextRequest, NextResponse } from "next/server";
import { generateGemini, type GeminiPart } from "@/lib/gemini";

/**
 * Server-side Gemini proxy.
 *
 * The Adjudicator, the Witness and the DM all run in the browser, so they
 * cannot hold a key. This route is the equivalent of the fal proxy for
 * Google's API: the key stays in the process environment and only the
 * generated text crosses back.
 *
 * Caps are deliberate. Like the fal proxy this endpoint is unauthenticated,
 * so anything reachable from the page is reachable by anyone who finds it —
 * bounding tokens and payload size keeps a stray caller from being able to
 * spend real money.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const TIMEOUT_MS = 30_000;

const MAX_PROMPT_CHARS = 24_000;
const MAX_SYSTEM_CHARS = 16_000;
const MAX_OUTPUT_TOKENS = 2_000;
const MAX_IMAGES = 4;
/** ~1.4MB of base64, comfortably above a 768px JPEG frame. */
const MAX_IMAGE_CHARS = 1_400_000;

interface Body {
  system?: unknown;
  prompt?: unknown;
  /** Data URIs, in order. */
  images?: unknown;
  maxTokens?: unknown;
  temperature?: unknown;
  /** Ask Gemini for strict JSON rather than scraping it out of prose. */
  json?: unknown;
  model?: unknown;
}

/** Split a `data:image/jpeg;base64,...` URI into Gemini's inline_data shape. */
function toInlineData(uri: string): GeminiPart | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(uri);
  if (!match) return null;
  if (!match[1].startsWith("image/")) return null;
  if (match[2].length > MAX_IMAGE_CHARS) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "Invalid prompt." }, { status: 400 });
  }
  const system =
    typeof body.system === "string" ? body.system.slice(0, MAX_SYSTEM_CHARS) : "";

  const parts: GeminiPart[] = [];
  if (Array.isArray(body.images)) {
    for (const entry of body.images.slice(0, MAX_IMAGES)) {
      if (typeof entry !== "string") continue;
      const part = toInlineData(entry);
      if (part) parts.push(part);
    }
  }
  parts.push({ text: prompt });

  const maxTokens =
    typeof body.maxTokens === "number" && Number.isFinite(body.maxTokens)
      ? Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Math.round(body.maxTokens)))
      : 800;
  const temperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.max(0, Math.min(2, body.temperature))
      : 0.7;
  const model =
    typeof body.model === "string" && /^[\w.-]{1,64}$/.test(body.model)
      ? body.model
      : DEFAULT_MODEL;
  const usesThinkingLevel = /^gemini-3\.(?:6|7|8)-flash$/.test(model);

  try {
    const response = await generateGemini({
      model,
      system,
      parts,
      timeoutMs: TIMEOUT_MS,
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(body.json === true ? { responseMimeType: "application/json" } : {}),
        ...(usesThinkingLevel
          ? { thinkingConfig: { thinkingLevel: "LOW" } }
          : { temperature }),
      },
    });

    if (!response.ok) {
      // Surface Google's own message: a wrong model name, a quota hit, and
      // a capacity-side 503 all look identical as a bare "502" to the
      // browser and to the dev server's own request log. Logging the real
      // upstream status/body here is the only way to tell them apart later.
      const detail = await response.text().catch(() => "");
      console.error(`[/api/llm] Gemini ${response.status} for model ${model}:`, detail.slice(0, 500));
      return NextResponse.json(
        {
          error: `Gemini responded ${response.status}`,
          detail: detail.slice(0, 400),
        },
        { status: 502 }
      );
    }

    const data = (await response.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
    };
    const candidate = data.candidates?.[0];
    const output = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");

    if (!output) {
      return NextResponse.json(
        {
          error: "Gemini returned no text.",
          detail: candidate?.finishReason ?? "no candidates",
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ output });
  } catch (cause) {
    // Covers the 30s AbortSignal timeout and any network-level failure —
    // both invisible in the dev server's own request log otherwise.
    const message = cause instanceof Error ? cause.message : "unknown";
    console.error(`[/api/llm] request to ${model} failed:`, message);
    return NextResponse.json(
      { error: "Gemini request failed.", detail: message },
      { status: 502 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
