"use client";

/**
 * Browser helpers for Vertex-generated stills and cached character portraits.
 * Video lives in lib/reactor.ts; this file never calls a video provider.
 */

async function cropTo(source: string, width: number, height: number): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    const timer = window.setTimeout(() => {
      element.onload = null;
      element.onerror = null;
      reject(new Error("still image decode timed out"));
    }, 10_000);
    element.onload = () => {
      window.clearTimeout(timer);
      resolve(element);
    };
    element.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("still failed to decode"));
    };
    element.crossOrigin = "anonymous";
    element.src = source;
  });

  const wanted = width / height;
  const actual = image.naturalWidth / image.naturalHeight;
  if (Math.abs(wanted - actual) < 0.01) return source;

  const cropWidth = actual > wanted ? image.naturalHeight * wanted : image.naturalWidth;
  const cropHeight = actual > wanted ? image.naturalHeight : image.naturalWidth / wanted;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropWidth);
  canvas.height = Math.round(cropHeight);
  const context = canvas.getContext("2d");
  if (!context) return source;
  context.drawImage(
    image,
    Math.round((image.naturalWidth - cropWidth) / 2),
    Math.round((image.naturalHeight - cropHeight) / 2),
    Math.round(cropWidth),
    Math.round(cropHeight),
    0,
    0,
    canvas.width,
    canvas.height
  );
  return canvas.toDataURL("image/jpeg", 0.92);
}

export async function paintFrame(args: {
  prompt: string;
  seed: number;
  width: number;
  height: number;
  references?: string[];
}): Promise<string> {
  const references = (args.references ?? []).filter(Boolean);
  let response: Response;
  try {
    response = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: args.prompt,
        width: args.width,
        height: args.height,
        seed: args.seed,
        ...(references.length > 0 ? { referenceImages: references.slice(0, 8) } : {}),
      }),
      // Slightly longer than the server's complete queue + retry budget.
      signal: AbortSignal.timeout(80_000),
    });
  } catch (cause) {
    throw new Error(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "image request timed out"
        : cause instanceof Error
          ? cause.message
          : "image request failed"
    );
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(detail.error ?? `image API responded ${response.status}`);
  }
  const { image } = await response.json() as { image?: string };
  if (!image) throw new Error("no image in response");
  return cropTo(image, args.width, args.height);
}

export async function loadPortrait(id: string, style: string): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/portrait?id=${encodeURIComponent(id)}&style=${encodeURIComponent(style)}`
    );
    if (!response.ok) return null;
    const { portrait } = await response.json() as { portrait?: string };
    return portrait ?? null;
  } catch {
    return null;
  }
}
