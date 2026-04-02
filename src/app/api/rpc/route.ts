// Server-side RPC proxy — keeps Helius API key private.
//
// Security:
// - Rate limited per IP (60 req/min)
// - Request body size limited (10KB)
// - Only JSON-RPC methods allowed (whitelist)
// - No secrets in response

import { NextRequest, NextResponse } from "next/server";

const RPC_URL =
  process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

const MAX_BODY_SIZE = 10_000; // 10KB
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

// ---- Rate Limiter (in-memory, per IP) ----
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

// Periodic cleanup to prevent memory leak (every 5 min)
if (typeof globalThis !== "undefined") {
  const cleanup = () => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
      if (now >= entry.resetAt) rateLimitMap.delete(ip);
    }
  };
  setInterval(cleanup, 300_000);
}

// ---- Allowed RPC Methods (whitelist) ----
const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlock",
  "getBlockHeight",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "sendTransaction",
  "simulateTransaction",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getRecentBlockhash",
  "getMinimumBalanceForRentExemption",
]);

export async function POST(req: NextRequest) {
  // ---- Rate Limit ----
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 }
    );
  }

  try {
    // ---- Body Size Check ----
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    const body = await req.json();

    // ---- Method Whitelist ----
    const method = body?.method;
    if (!method || typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        { error: `Method not allowed: ${method}` },
        { status: 403 }
      );
    }

    // ---- Proxy to Helius ----
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "RPC proxy error" }, { status: 502 });
  }
}
