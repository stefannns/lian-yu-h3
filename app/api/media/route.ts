import { type NextRequest } from "next/server";

// Streams fal CDN videos through the local origin so <canvas> frame grabs
// are never blocked by CORS, and playback + seeking stay reliable.
const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
];

function isAllowed(url: URL) {
  return (
    url.protocol === "https:" &&
    (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))
  );
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return new Response("missing url", { status: 400 });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (!isAllowed(url)) return new Response("host not allowed", { status: 403 });

  const range = req.headers.get("range");
  const upstream = await fetch(url, {
    headers: range ? { range } : undefined,
    cache: "no-store",
  });

  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Clips are immutable once generated.
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(upstream.body, { status: upstream.status, headers });
}
