// Server-side RPC proxy — keeps Helius API key private.
//
// Security:
// - Rate limited per IP (60 req/min) using trusted x-real-ip
// - Request body size limited (10KB)
// - Read-only method whitelist (sendTransaction EXCLUDED — use /api/broadcast)
// - No secrets in response

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, RateLimiter, rateLimitResponse, checkBodySize, RPC_READ_METHODS } from "@/lib/api-security";

const RpcBody = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.array(z.unknown()).optional(),
});

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

const MAX_BODY_SIZE = 10_000; // 10KB

// Rate limit: 60 req/min per IP
const limiter = new RateLimiter(60);

export async function POST(req: NextRequest) {
  // ---- Rate Limit (trusted IP) ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  // ---- Body Size Check ----
  const sizeCheck = checkBodySize(req, MAX_BODY_SIZE);
  if (sizeCheck) return sizeCheck;

  try {
    const rawBody = await req.json();
    const parsed = RpcBody.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const body = parsed.data;

    // ---- Method Whitelist (read-only — no sendTransaction) ----
    const { method } = body;
    if (!RPC_READ_METHODS.has(method)) {
      return NextResponse.json({ error: "Method not allowed" }, { status: 403 });
    }

    // ---- Proxy to Helius ----
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "RPC proxy error" }, { status: 502 });
  }
}
