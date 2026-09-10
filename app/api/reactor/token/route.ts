import { NextResponse } from "next/server";

const MODEL = "reactor/fast-h3";
const TOKEN_LIFETIME_SECONDS = 300;
const SESSION_LIFETIME_SECONDS = 180;

type TokenGrant = { jwt: string; expiresAt: number };

// Keep one grant for the lifetime of this local server. A browser refresh must
// not silently mint another credential and open another billable session.
let cachedGrant: TokenGrant | null = null;
let grantRequest: Promise<TokenGrant> | null = null;

async function issueGrant(): Promise<TokenGrant> {
  const apiKey = process.env.REACTOR_API_KEY;
  if (!apiKey) throw new Error("REACTOR_API_KEY is not configured.");

  const upstream = await fetch("https://api.reactor.inc/tokens", {
    method: "POST",
    headers: {
      "Reactor-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: TOKEN_LIFETIME_SECONDS,
      authorization_details: [{
        type: "session",
        resources: { models: { match: [MODEL] } },
        constraints: {
          max_sessions: 1,
          max_session_duration_seconds: SESSION_LIFETIME_SECONDS,
        },
      }],
    }),
    cache: "no-store",
  });
  const body = await upstream.json().catch(() => ({})) as {
    jwt?: string;
    expires_at?: number;
  };
  if (!upstream.ok || !body.jwt || !body.expires_at) {
    throw new Error(`Reactor token exchange failed (${upstream.status}).`);
  }
  return { jwt: body.jwt, expiresAt: body.expires_at };
}

export async function POST() {
  if (!process.env.REACTOR_API_KEY) {
    return NextResponse.json({ error: "REACTOR_API_KEY is not configured." }, { status: 503 });
  }

  try {
    // Return the same grant even when it is near expiry. Once it expires the
    // browser must fail closed; only an intentional local server restart can
    // mint another credential.
    if (cachedGrant) {
      return NextResponse.json(cachedGrant, { headers: { "Cache-Control": "no-store" } });
    }

    grantRequest ??= issueGrant();
    const grant = await grantRequest;
    cachedGrant = grant;
    return NextResponse.json(
      grant,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Reactor token exchange failed." }, { status: 502 });
  } finally {
    grantRequest = null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
