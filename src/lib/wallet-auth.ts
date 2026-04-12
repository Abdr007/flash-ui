// ============================================
// Flash UI — Wallet Signature Authentication
// ============================================
// Server-side verification of wallet ownership via signed messages.
//
// Flow:
// 1. Client calls GET /api/auth/nonce?wallet=<pubkey> → gets a nonce
// 2. Client signs the nonce message with their wallet
// 3. Client calls POST /api/auth/verify with { wallet, signature, nonce }
// 4. Server verifies and returns a short-lived auth token
// 5. Client includes token in Authorization header on subsequent requests
// 6. Server-side middleware verifies token on protected endpoints
//
// The token is a base64-encoded JSON { wallet, exp, hmac } — NOT a JWT
// (no external dependency needed). HMAC uses a server-side secret.

import { createHmac, randomBytes } from "crypto";

// ============================================
// Configuration
// ============================================

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const NONCE_TTL_MS = 2 * 60 * 1000; // 2 minutes (must sign quickly)
const MAX_NONCES = 5000; // Memory cap

// Server-side secret for HMAC signing — falls back to random per-deploy
// (tokens invalidate on redeploy, which is fine for security)
const AUTH_SECRET = process.env.WALLET_AUTH_SECRET || randomBytes(32).toString("hex");

// ============================================
// Nonce Store (in-memory, per-instance)
// ============================================

const nonceStore = new Map<string, { nonce: string; expires: number }>();

export function generateNonce(wallet: string): string {
  cleanupNonces();
  const nonce = randomBytes(16).toString("hex");
  nonceStore.set(wallet, { nonce, expires: Date.now() + NONCE_TTL_MS });
  return nonce;
}

export function consumeNonce(wallet: string, nonce: string): boolean {
  const entry = nonceStore.get(wallet);
  if (!entry) return false;
  if (Date.now() > entry.expires) {
    nonceStore.delete(wallet);
    return false;
  }
  if (entry.nonce !== nonce) return false;
  nonceStore.delete(wallet); // Single use
  return true;
}

function cleanupNonces() {
  if (nonceStore.size < 100) return;
  const now = Date.now();
  for (const [key, entry] of nonceStore) {
    if (now > entry.expires) nonceStore.delete(key);
  }
  while (nonceStore.size > MAX_NONCES) {
    const oldest = nonceStore.keys().next().value;
    if (oldest) nonceStore.delete(oldest);
    else break;
  }
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
  const hmac = createHmac("sha256", AUTH_SECRET).update(data).digest("hex");
  const token = Buffer.from(JSON.stringify({ d: data, h: hmac })).toString("base64");
  return token;
}

export function verifyAuthToken(token: string): AuthPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf-8"));
    const { d, h } = decoded;
    if (!d || !h) return null;

    // Verify HMAC
    const expected = createHmac("sha256", AUTH_SECRET).update(d).digest("hex");
    if (!timingSafeEqual(h, expected)) return null;

    // Parse and check expiry
    const payload: AuthPayload = JSON.parse(d);
    if (!payload.wallet || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

// Timing-safe string comparison (prevents timing attacks on HMAC)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
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

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

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
      { status: 401 }
    );
  }
  return { wallet };
}
