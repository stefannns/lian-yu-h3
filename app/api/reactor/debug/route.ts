import { NextResponse } from "next/server";

const SAFE_TEXT = /^[a-zA-Z0-9_.:-]{1,80}$/;

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new Response(null, { status: 204 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const event = typeof body.event === "string" && SAFE_TEXT.test(body.event)
    ? body.event
    : "invalid";
  const details = Object.fromEntries(
    Object.entries(body.details && typeof body.details === "object"
      ? body.details as Record<string, unknown>
      : {})
      .filter(([key, value]) =>
        SAFE_TEXT.test(key) &&
        (typeof value === "number" ||
          typeof value === "boolean" ||
          (typeof value === "string" && SAFE_TEXT.test(value)))
      )
  );

  console.info("[reactor]", event, details);
  return new Response(null, { status: 204 });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
