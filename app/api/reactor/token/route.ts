import { NextResponse } from "next/server";

const MODEL = "reactor/fast-h3";

export async function POST() {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "REACTOR_API_KEY is not configured." }, { status: 503 });
  }

  try {
    const upstream = await fetch("https://api.reactor.inc/tokens", {
      method: "POST",
      headers: {
        "Reactor-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: 10_800,
        authorization_details: [{
          type: "session",
          resources: { models: { match: [MODEL] } },
          constraints: { max_sessions: 1, max_session_duration_seconds: 7_200 },
        }],
      }),
      cache: "no-store",
    });
    const body = await upstream.json().catch(() => ({})) as {
      jwt?: string;
      expires_at?: number;
    };
    if (!upstream.ok || !body.jwt || !body.expires_at) {
      return NextResponse.json(
        { error: "Reactor token exchange failed.", upstreamStatus: upstream.status },
        { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
      );
    }
    return NextResponse.json(
      { jwt: body.jwt, expiresAt: body.expires_at },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Reactor token exchange failed." }, { status: 502 });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
