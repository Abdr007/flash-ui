// ============================================
// Flash UI — Wallet Signature Authentication
// ============================================
// Server-side verification of wallet ownership via signed messages.
//
// Flow:
// 1. Client calls GET /api/auth?wallet=<pubkey> → gets a stateless nonce
// 2. Client signs the nonce message with their wallet
// 3. Client calls POST /api/auth with { wallet, signature, nonce }
// 4. Server verifies HMAC + ed25519 signature and returns a short-lived auth token
// 5. Client includes token in Authorization header on subsequent requests
// 6. Server-side middleware verifies token on protected endpoints
//
// Both nonces and tokens are stateless HMAC-signed payloads — they verify
// against AUTH_SECRET without any shared store. This is required on Vercel
// because successive requests can hit different lambda instances. A best-effort
// in-memory replay-guard prevents the same nonce from being consumed twice
// during the warm lifetime of a single instance; for full replay protection
// across cold starts, set up Vercel KV (see comment near `usedNonces`).

import { createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from "crypto";

// ============================================
// Configuration
// ============================================

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const NONCE_TTL_MS = 2 * 60 * 1000; // 2 minutes (must sign quickly)
const REPLAY_GUARD_MAX_ENTRIES = 10_000;

// Server-side secret for HMAC signing.
// PRODUCTION: WALLET_AUTH_SECRET MUST be set as a Vercel env var (same value
// across all instances and regions) — without it, tokens issued by one lambda
// instance fail HMAC verification on another, causing random 401s.
// DEV/PREVIEW: falls back to a per-process random secret (tokens invalidate on
// every restart, which is fine locally).
const AUTH_SECRET = (() => {
  const fromEnv = process.env.WALLET_AUTH_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 32) return fromEnv;

  const isProd = process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production";
  if (isProd) {
    // Refuse to boot in real production without an explicit secret. This is
    // intentional: silently falling back here causes auth to fail randomly
    // across serverless instances and is much harder to diagnose later.
    throw new Error(
      "WALLET_AUTH_SECRET is missing or too short (min 32 chars) in production. " +
        "Set it in Vercel project settings — value must be identical across all envs/regions.",
    );
  }
  if (fromEnv) {
    console.warn(
      "[wallet-auth] WALLET_AUTH_SECRET shorter than 32 chars — generating random fallback for this process.",
    );
  } else {
    console.warn(
      "[wallet-auth] WALLET_AUTH_SECRET not set — using random per-process secret. Set it before going to production.",
    );
  }
  return randomBytes(32).toString("hex");
})();

// ============================================
// Stateless HMAC Nonce
// ============================================
// A nonce is a base64url-encoded payload `{wallet, exp, rand}` plus an HMAC.
// generateNonce: server signs and returns to client.
// consumeNonce:  server verifies HMAC, checks expiry, ensures single-use.

interface NoncePayload {
  wallet: string;
  exp: number; // ms epoch
  rand: string; // 16-byte hex — uniqueness per issuance
}

function b64url(buf: Buffer | string): string {
  return (typeof buf === "string" ? Buffer.from(buf) : buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmacHex(input: string): string {
  return createHmac("sha256", AUTH_SECRET).update(input).digest("hex");
}

export function generateNonce(wallet: string): string {
  const payload: NoncePayload = {
    wallet,
    exp: Date.now() + NONCE_TTL_MS,
    rand: randomBytes(16).toString("hex"),
  };
  const data = b64url(JSON.stringify(payload));
  const sig = hmacHex(data);
  return `${data}.${sig}`;
}

// Best-effort replay guard. Stops a captured nonce from being verified twice
// within a warm-instance lifetime. Cross-instance / cross-cold-start replays
// are still possible until you wire this to Vercel KV — the underlying defense
// for that case is the 2-minute TTL and the requirement to also forge the
// wallet's ed25519 signature.
const usedNonces = new Map<string, number>();

function markNonceUsed(rand: string, exp: number) {
  // Lazy cleanup
  if (usedNonces.size > REPLAY_GUARD_MAX_ENTRIES / 2) {
    const now = Date.now();
    for (const [k, e] of usedNonces) {
      if (now > e) usedNonces.delete(k);
    }
    while (usedNonces.size > REPLAY_GUARD_MAX_ENTRIES) {
      const oldest = usedNonces.keys().next().value;
      if (oldest) usedNonces.delete(oldest);
      else break;
    }
  }
  usedNonces.set(rand, exp);
}

export function consumeNonce(wallet: string, nonce: string): boolean {
  const dot = nonce.indexOf(".");
  if (dot <= 0 || dot === nonce.length - 1) return false;
  const data = nonce.slice(0, dot);
  const sig = nonce.slice(dot + 1);

  const expected = hmacHex(data);
  if (!constantTimeStringEq(sig, expected)) return false;

  let payload: NoncePayload;
  try {
    payload = JSON.parse(b64urlDecode(data).toString("utf8")) as NoncePayload;
  } catch {
    return false;
  }
  if (!payload?.wallet || typeof payload.exp !== "number" || typeof payload.rand !== "string") return false;
  if (payload.wallet !== wallet) return false;
  if (Date.now() > payload.exp) return false;

  // Replay-guard (best-effort)
  if (usedNonces.has(payload.rand)) return false;
  markNonceUsed(payload.rand, payload.exp);

  return true;
}

// ============================================
// Auth Token (HMAC-signed, NOT JWT)
// ============================================

interface AuthPayload {
  wallet: string;
  exp: number;
}

export function createAuthToken(wallet: string): string {
  const payload: AuthPayload = {
    wallet,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const data = JSON.stringify(payload);
  const sig = hmacHex(data);
  // Wrap as base64({d, h}) — kept compatible with prior token format.
  return Buffer.from(JSON.stringify({ d: data, h: sig })).toString("base64");
}

export function verifyAuthToken(token: string): AuthPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8"));
    const { d, h } = decoded as { d?: unknown; h?: unknown };
    if (typeof d !== "string" || typeof h !== "string") return null;

    const expected = hmacHex(d);
    if (!constantTimeStringEq(h, expected)) return null;

    const payload = JSON.parse(d) as AuthPayload;
    if (!payload?.wallet || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// Constant-time string compare via Node's timingSafeEqual on equal-length buffers.
function constantTimeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return nodeTimingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    // Length mismatch already handled above; this catch is defensive.
    return false;
  }
}

// ============================================
// Signature Verification Message
// ============================================

export function getSignMessage(nonce: string): string {
  return `Flash Trade Authentication\n\nSign this message to verify wallet ownership.\nThis does NOT submit a transaction or cost any fees.\n\nNonce: ${nonce}`;
}

// ============================================
// Request Auth Extraction
// ============================================

import { NextRequest, NextResponse } from "next/server";

/**
 * Extract and verify wallet auth from request.
 * Returns the verified wallet address or null.
 */
export function getAuthWallet(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  const payload = verifyAuthToken(token);
  return payload?.wallet ?? null;
}

/**
 * Middleware-style check. Returns a 401 response if auth fails,
 * or the wallet address if auth succeeds.
 */
export function requireAuth(req: NextRequest): { wallet: string } | NextResponse {
  const wallet = getAuthWallet(req);
  if (!wallet) {
    return NextResponse.json(
      { error: "Authentication required. Sign a message with your wallet first." },
      { status: 401 },
    );
  }
  return { wallet };
}
