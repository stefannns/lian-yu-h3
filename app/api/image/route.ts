import { NextRequest, NextResponse } from "next/server";
import { ImageGenError, generateImage, imageFailureMessage, toDataUri } from "@/lib/imagegen";

/**
 * Server-side still painter.
 *
 * paintFrame() runs in the browser and so cannot hold a key; this route is the
 * image equivalent of /api/llm. The model itself lives behind lib/imagegen.ts
 * — fal is video-only in this project, and nothing here knows or cares which
 * provider is configured.
 *
 * Caps are deliberate. Like /api/llm this endpoint is unauthenticated, so
 * anything reachable from the page is reachable by anyone who finds it, and
 * bounding prompt size, reference count and payload keeps a stray caller from
 * spending real money.
 */

const MAX_PROMPT_CHARS = 4_000;
const MAX_REFERENCES = 8;
/** ~4MB of base64 per reference, comfortably above a 1536px jpeg. */
const MAX_REFERENCE_CHARS = 5_600_000;

export async function POST(request: NextRequest) {
  let body: {
    prompt?: unknown;
    width?: unknown;
    height?: unknown;
    seed?: unknown;
    referenceImages?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "Invalid prompt." }, { status: 400 });
  }

  // The caller asks in pixels; the provider layer thinks in aspects. Only two
  // shapes are ever asked for — a 16:9 frame and a 3:4 portrait — so this is
  // a comparison, not a lookup table.
  const width = typeof body.width === "number" && body.width > 0 ? body.width : 1280;
  const height = typeof body.height === "number" && body.height > 0 ? body.height : 720;
  const aspect = width >= height ? "16:9" : "3:4";

  const references = Array.isArray(body.referenceImages)
    ? body.referenceImages
        .filter(
          (reference): reference is string =>
            typeof reference === "string" &&
            reference.length <= MAX_REFERENCE_CHARS &&
            (/^data:image\//.test(reference) || /^https?:\/\//i.test(reference))
        )
        .slice(0, MAX_REFERENCES)
    : [];

  try {
    const bytes = await generateImage({
      prompt,
      aspect,
      references,
      seed:
        typeof body.seed === "number" && Number.isFinite(body.seed)
          ? Math.floor(body.seed)
          : undefined,
    });
    // A data URI, not a URL: the still is cropped on a browser canvas (a
    // cross-origin source would taint it) and posted straight back to fal as a
    // video reference, which accepts data URIs.
    return NextResponse.json({ image: toDataUri(bytes), aspect });
  } catch (cause) {
    const status = cause instanceof ImageGenError ? cause.status : undefined;
    console.error("[/api/image] failed", { status, type: cause instanceof Error ? cause.name : "unknown" });
    return NextResponse.json(
      { error: imageFailureMessage(cause), upstreamStatus: status },
      { status: status === 429 ? 429 : 502 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
