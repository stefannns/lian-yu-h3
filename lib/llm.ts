/**
 * Browser-side handle on the Gemini proxy. The key lives only in the
 * server route; this just carries the prompt over and the text back.
 */

export interface LlmArgs {
  system?: string;
  prompt: string;
  /** Data URIs, in order. Used by the vision paths, ignored by the DM. */
  images?: string[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for a strict JSON body instead of scraping it out of prose. */
  json?: boolean;
  /** Override the server's default model. */
  model?: string;
}

export type LlmCaller = (args: LlmArgs) => Promise<string>;

export class LlmError extends Error {
  constructor(
    message: string,
    readonly detail?: string
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/**
 * Where /api/llm lives. In the browser a relative path is correct and always
 * right. On the server — a route handler, or the dry-run CLI — there is no
 * origin to be relative to, so one is taken from the environment.
 */
function endpoint(): string {
  if (typeof window !== "undefined") return "/api/llm";
  const base = process.env.APP_BASE_URL || "http://localhost:3210";
  return `${base.replace(/\/+$/, "")}/api/llm`;
}

export async function llmCall(args: LlmArgs): Promise<string> {
  let response: Response;
  try {
    response = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (cause) {
    // The server may already have completed a billed request. Retrying from
    // the browser would be an uncorrelated duplicate; the server transport
    // owns the only retry budget.
    throw new LlmError(cause instanceof Error ? cause.message : "network error");
  }

  const body = (await response.json().catch(() => ({}))) as {
    output?: string;
    error?: string;
    detail?: string;
  };
  if (response.ok && typeof body.output === "string") return body.output;
  throw new LlmError(
    body.error ?? `LLM request failed (${response.status})`,
    body.detail
  );
}

/** Extract the first {...} object from a reply. Only needed off JSON mode. */
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON in reply");
  return text.slice(start, end + 1);
}
