// Server-side multi-endpoint broadcast — replicates FlashEdge CLI broadcast behavior.
//
// Accepts a signed transaction (base64), fans out to all RPC endpoints in parallel,
// and returns the signature. Keeps Helius API key server-side.
//
// This is the UI equivalent of ultra-tx-engine.broadcastToAll().

import { NextRequest, NextResponse } from "next/server";

const HELIUS_RPC =
  process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

// Secondary RPCs for parallel broadcast (public endpoints, no key needed)
const SECONDARY_RPCS = [
  "https://api.mainnet-beta.solana.com",
].filter((url) => url !== HELIUS_RPC); // Avoid duplicate if Helius is down and fallback matches

// Rate limit: 30 broadcasts/min per IP (trades are infrequent)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  cleanupRateLimits();
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// Lazy cleanup — runs inside checkRateLimit, no setInterval needed on serverless
function cleanupRateLimits() {
  if (rateLimitMap.size < 50) return;
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now >= entry.resetAt) rateLimitMap.delete(ip);
  }
  // Hard cap to prevent memory leak under attack
  if (rateLimitMap.size > 1000) {
    const oldest = rateLimitMap.keys().next().value;
    if (oldest) rateLimitMap.delete(oldest);
  }
}

/**
 * Send a raw transaction to a single RPC endpoint.
 * Returns the signature on success, null on failure.
 */
async function sendToEndpoint(
  rpcUrl: string,
  txBase64: string,
  timeout = 10_000
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          txBase64,
          {
            encoding: "base64",
            skipPreflight: true,
            maxRetries: 0,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const data = await res.json();

    if (data.error) return null;
    return data.result as string;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Use trusted IP headers — x-real-ip is set by Vercel/reverse proxy (not spoofable)
  // Falls back to first x-forwarded-for entry
  const ip =
    req.headers.get("x-real-ip")?.trim() ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const txBase64: string = body?.transaction;

    if (!txBase64 || typeof txBase64 !== "string") {
      return NextResponse.json(
        { error: "Missing transaction field (base64)" },
        { status: 400 }
      );
    }

    // Validate it's plausible base64 (not arbitrary data)
    if (txBase64.length > 3000 || txBase64.length < 100) {
      return NextResponse.json(
        { error: "Invalid transaction size" },
        { status: 400 }
      );
    }

    // ── Parallel broadcast to all endpoints (same as CLI broadcastToAll) ──
    const allEndpoints = [HELIUS_RPC, ...SECONDARY_RPCS];

    const results = await Promise.allSettled(
      allEndpoints.map((url) => sendToEndpoint(url, txBase64))
    );

    let signature: string | null = null;
    let broadcastCount = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        if (!signature) signature = result.value;
        broadcastCount++;
      }
    }

    if (!signature) {
      return NextResponse.json(
        { error: "All broadcast endpoints failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      signature,
      broadcastCount,
      totalEndpoints: allEndpoints.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Broadcast failed" },
      { status: 500 }
    );
  }
}
