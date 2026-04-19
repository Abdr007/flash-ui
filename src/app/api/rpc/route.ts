// Server-side RPC proxy — keeps Helius API key private.
//
// Security:
// - Rate limited per IP (60 req/min) using trusted x-real-ip
// - Request body bounded to 32KB (real-read enforcement, not header-only)
// - Read-only method whitelist (sendTransaction EXCLUDED — use /api/broadcast)
// - Supports batched JSON-RPC arrays (wallet adapters frequently batch)
// - Hard-fails at startup in production if HELIUS_RPC_URL is missing —
//   public mainnet-beta is rate-limited globally and causes flaky wallet
//   connections / mid-trade timeouts.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, RateLimiter, rateLimitResponse, readBoundedBody, RPC_READ_METHODS } from "@/lib/api-security";

const RpcCall = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string(),
  params: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
});

// JSON-RPC supports a single object or an array of objects (batch).
const RpcBody = z.union([RpcCall, z.array(RpcCall).min(1).max(20)]);

const RPC_URL = (() => {
  const url = process.env.HELIUS_RPC_URL?.trim();
  const isProd = process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production";
  if (url) return url;
  if (isProd) {
    throw new Error(
      "HELIUS_RPC_URL is missing in production. Public mainnet-beta is rate-limited and will cause user-visible flakiness. " +
        "Set HELIUS_RPC_URL in Vercel project settings.",
    );
  }
  console.warn("[api/rpc] HELIUS_RPC_URL not set — falling back to api.mainnet-beta.solana.com (dev only).");
  return "https://api.mainnet-beta.solana.com";
})();

const MAX_BODY_SIZE = 32_000; // 32KB — accommodates batched requests

// Rate limit: 60 req/min per IP (per-instance, see RateLimiter caveat).
const limiter = new RateLimiter(60);

export async function POST(req: NextRequest) {
  // ---- Rate Limit (trusted IP) ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  // ---- Body bounded read ----
  const bodyText = await readBoundedBody(req, MAX_BODY_SIZE);
  if (bodyText instanceof NextResponse) return bodyText;

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = RpcBody.safeParse(parsedBody);
  if (!validated.success) {
    return NextResponse.json({ error: "Invalid JSON-RPC request" }, { status: 400 });
  }

  // ---- Method whitelist applies to every call in a batch ----
  const calls = Array.isArray(validated.data) ? validated.data : [validated.data];
  for (const c of calls) {
    if (!RPC_READ_METHODS.has(c.method)) {
      return NextResponse.json({ error: `Method not allowed: ${c.method}` }, { status: 403 });
    }
  }

  try {
    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validated.data),
      signal: AbortSignal.timeout(15_000),
    });

    // Forward upstream JSON verbatim — preserves shape for batch responses.
    const upstreamBody = await upstream.text();
    return new NextResponse(upstreamBody, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "RPC proxy error" }, { status: 502 });
  }
}
