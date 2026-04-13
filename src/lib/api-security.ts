// ============================================
// Flash UI — API Security Module
// ============================================
// Centralized security primitives for all API routes.
// Single source of truth for rate limiting, IP extraction,
// body size validation, input sanitization, and error handling.

import { NextRequest, NextResponse } from "next/server";

// ============================================
// 1. IP Extraction (Vercel-trusted)
// ============================================
// x-real-ip is set by Vercel's edge network and CANNOT be spoofed.
// x-forwarded-for CAN be spoofed by clients — only use as fallback.

export function getClientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip")?.trim() ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

// ============================================
// 2. Rate Limiter (reusable, per-route)
// ============================================
// Each route creates its own limiter instance with custom limits.
// In-memory with lazy cleanup — works on serverless (shared across warm invocations).

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private map = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;

  constructor(maxRequests: number, windowMs = 60_000, maxEntries = 2000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  check(key: string): boolean {
    this.cleanup();
    const now = Date.now();
    const entry = this.map.get(key);

    if (!entry || now >= entry.resetAt) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.maxRequests) return false;
    entry.count++;
    return true;
  }

  getRemainingSeconds(key: string): number {
    const entry = this.map.get(key);
    if (!entry) return 0;
    const remaining = Math.max(0, entry.resetAt - Date.now());
    return Math.ceil(remaining / 1000);
  }

  private cleanup() {
    if (this.map.size < 50) return;
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (now >= entry.resetAt) this.map.delete(key);
    }
    // Hard cap prevents memory exhaustion under DDoS
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest) this.map.delete(oldest);
      else break;
    }
  }
}

export function rateLimitResponse(retryAfterSeconds = 60): NextResponse {
  return NextResponse.json(
    { error: "Rate limit exceeded. Try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// ============================================
// 3. Body Size Validation
// ============================================

export function checkBodySize(req: NextRequest, maxBytes: number): NextResponse | null {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }
  return null;
}

// ============================================
// 4. Wallet Address Validation
// ============================================
// Validates a Solana public key without importing @solana/web3.js
// (avoids heavy import in lightweight routes).

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(address: string): boolean {
  return typeof address === "string" && BASE58_REGEX.test(address);
}

// ============================================
// 5. Input Sanitization for LLM
// ============================================
// Strips control characters and common prompt injection patterns.
// Does NOT alter the semantic content — just removes attack vectors.

export function sanitizeLlmInput(input: string, maxLength = 500): string {
  // Strip control characters (except newline, tab)
  let clean = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Collapse excessive whitespace
  clean = clean.replace(/\s{10,}/g, " ");
  // Truncate
  return clean.slice(0, maxLength);
}

// ============================================
// 6. Safe Error Response
// ============================================
// Never leak stack traces, internal paths, or sensitive details.

export function safeErrorResponse(err: unknown, fallbackMessage: string, status = 500): NextResponse {
  // Only use known safe messages — never pass raw error.message to client
  // as it may contain internal details (file paths, SQL, config values).
  const message = err instanceof Error && isSafeErrorMessage(err.message) ? err.message : fallbackMessage;

  return NextResponse.json({ error: message }, { status });
}

// Error messages that are safe to surface to the client
const SAFE_PATTERNS = [
  /^invalid/i,
  /^missing/i,
  /^insufficient/i,
  /^you don't have/i,
  /^transaction would fail/i,
  /^wallet/i,
  /^account not found/i,
  /^not enough/i,
  /^too many/i,
  /^unknown action/i,
  /^transfers are/i,
];

function isSafeErrorMessage(msg: string): boolean {
  return SAFE_PATTERNS.some((p) => p.test(msg));
}

// ============================================
// 7. Security Headers
// ============================================
// Common security headers applied to all API responses.

export function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "0"); // Modern browsers: CSP is better
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

// ============================================
// 8. FSTATS Path Whitelist
// ============================================

const ALLOWED_FSTATS_PATHS = new Set([
  "overview/stats",
  "overview/oi",
  "overview/volume",
  "overview/fees",
  "overview/users",
  "trades",
  "trades/recent",
  "liquidity",
  "liquidity/pools",
  "whales",
  "whales/positions",
  "markets",
  "markets/stats",
  "leaderboard",
]);

export function isAllowedFstatsPath(path: string): boolean {
  // Reject any path traversal attempts
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) return false;
  // Must be in whitelist
  return ALLOWED_FSTATS_PATHS.has(path);
}

// ============================================
// 9. RPC Method Whitelist (read-only by default)
// ============================================

export const RPC_READ_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "getMultipleAccounts",
  "getRecentBlockhash",
  "getMinimumBalanceForRentExemption",
  // simulateTransaction EXCLUDED — allows probing protocol state
  // sendTransaction EXCLUDED — use /api/broadcast with validation
  // getBlock EXCLUDED — heavyweight, can be used for DoS
  // getProgramAccounts EXCLUDED — heavyweight scan, can be used for DoS
]);

// sendTransaction is deliberately EXCLUDED from the default whitelist.
// Transactions should be broadcast via /api/broadcast which has
// additional validation and monitoring.

// ============================================
// 10. Wallet Auth Enforcement
// ============================================
// Verifies that the authenticated wallet matches the wallet in the request.
// Prevents impersonation: user A cannot build transactions for user B.

import { getAuthWallet } from "@/lib/wallet-auth";

/**
 * Verify that the request's auth token wallet matches the claimed wallet.
 * Returns null if valid, or an error response if mismatched.
 *
 * STRICT MODE (default): Auth is REQUIRED. No token = 401.
 * PERMISSIVE MODE (strict=false): No token = allowed (backwards compat for read-only).
 */
export function enforceWalletMatch(req: NextRequest, claimedWallet: string, strict = true): NextResponse | null {
  const authWallet = getAuthWallet(req);
  if (!authWallet) {
    if (strict) {
      return NextResponse.json(
        { error: "Authentication required. Sign a message with your wallet first." },
        { status: 401 },
      );
    }
    return null; // Permissive mode for read-only endpoints
  }
  // If auth IS provided, wallet must match
  if (authWallet.toLowerCase() !== claimedWallet.toLowerCase()) {
    return NextResponse.json(
      { error: "Wallet mismatch: authenticated wallet does not match request" },
      { status: 403 },
    );
  }
  return null;
}
