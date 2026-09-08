import { generateGemini, type GeminiPart } from "./gemini";
import type { LlmArgs } from "./llm";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const TIMEOUT_MS = 30_000;
const MAX_PROMPT_CHARS = 24_000;
const MAX_SYSTEM_CHARS = 16_000;
const MAX_OUTPUT_TOKENS = 2_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 1_400_000;

export class ServerLlmError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly detail?: string
  ) {
    super(message);
    this.name = "ServerLlmError";
  }
}

function toInlineData(uri: string): GeminiPart | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(uri);
  if (!match || !match[1].startsWith("image/") || match[2].length > MAX_IMAGE_CHARS) {
    return null;
  }
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

/** One bounded in-process Gemini text call for server-side story runners. */
export async function callGeminiText(args: LlmArgs): Promise<string> {
  if (!args.prompt || args.prompt.length > MAX_PROMPT_CHARS) {
    throw new ServerLlmError("Invalid prompt.", 400);
  }
  const system = typeof args.system === "string" ? args.system.slice(0, MAX_SYSTEM_CHARS) : "";
  const parts: GeminiPart[] = [];
  for (const entry of args.images?.slice(0, MAX_IMAGES) ?? []) {
    const part = toInlineData(entry);
    if (part) parts.push(part);
  }
  parts.push({ text: args.prompt });

  const maxTokens = Number.isFinite(args.maxTokens)
    ? Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Math.round(args.maxTokens!)))
    : 800;
  const temperature = Number.isFinite(args.temperature)
    ? Math.max(0, Math.min(2, args.temperature!))
    : 0.7;
  const model = args.model && /^[\w.-]{1,64}$/.test(args.model) ? args.model : DEFAULT_MODEL;
  const usesThinkingLevel = /^gemini-3\.(?:6|7|8)-flash$/.test(model);

  let response: Response;
  try {
    response = await generateGemini({
      model,
      system,
      parts,
      timeoutMs: TIMEOUT_MS,
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(args.json ? { responseMimeType: "application/json" } : {}),
        ...(usesThinkingLevel
          ? { thinkingConfig: { thinkingLevel: "LOW" } }
          : { temperature }),
      },
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown";
    console.error(`[server-llm] request to ${model} failed:`, detail);
    throw new ServerLlmError("Gemini request failed.", 502, detail);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[server-llm] Gemini ${response.status} for model ${model}:`, detail.slice(0, 500));
    throw new ServerLlmError(`Gemini responded ${response.status}`, 502, detail.slice(0, 400));
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const candidate = data.candidates?.[0];
  const output = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  if (!output) {
    throw new ServerLlmError(
      "Gemini returned no text.",
      502,
      candidate?.finishReason ?? "no candidates"
    );
  }
  return output;
}
