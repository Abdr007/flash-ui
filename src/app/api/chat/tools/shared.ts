// ============================================
// Flash AI — Shared Tool Types + Guards
// ============================================
// All guards enforced in STRICT order:
// 1. Replay protection
// 2. Wallet rate limit
// 3. Kill switch
// 4. (tool-specific logic follows)

import { logInfo, logError } from "@/lib/logger";
import { isReplay } from "@/lib/tool-dedup";
import { MARKET_ALIASES } from "@/lib/constants";
import { resolveSymbol, refreshIfStale } from "@/lib/markets-registry";

// ---- Tool Response (strict, no `any`) ----

export interface ToolResponse<T> {
  status: "success" | "error" | "degraded";
  data: T | null;
  fallback?: T;
  error?: string;
  request_id: string;
  latency_ms: number;
  warnings?: string[];
}

// ---- Market Resolution ----

export function resolveMarket(input: string): string | null {
  if (!input) return null;
  refreshIfStale();

  // 1. Direct symbol match against registry
  const direct = resolveSymbol(input);
  if (direct) return direct;

  // 2. Natural-language alias (bitcoin → BTC, etc.)
  const lower = input.toLowerCase().trim();
  const aliased = MARKET_ALIASES[lower];
  if (aliased) {
    const resolved = resolveSymbol(aliased);
    if (resolved) return resolved;
  }

  return null;
}

// ---- Global Kill Switch ----

const TRADING_ENABLED = process.env.TRADING_ENABLED !== "false";

export function checkTradingEnabled(requestId: string): ToolResponse<null> | null {
  if (!TRADING_ENABLED) {
    logError("tool_call", {
      request_id: requestId,
      error: "Trading disabled via kill switch",
    });
    return {
      status: "error",
      data: null,
      error: "Trading temporarily disabled",
      request_id: requestId,
      latency_ms: 0,
    };
  }
  return null;
}

// ---- Wallet-Scoped Rate Limiter ----

interface WalletRateEntry {
  timestamps: number[];
}

const walletToolRates = new Map<string, WalletRateEntry>();
const MAX_WALLET_RATE_ENTRIES = 500; // [F2] Prevent unbounded growth

const RATE_MAX_PER_SECOND = 5;
const RATE_BURST_WINDOW_MS = 10_000;
const RATE_BURST_MAX = 20;

/**
 * Per-wallet rate limiting:
 * - Max 5 tool calls/sec/wallet
 * - Max 20 tool calls/10s burst/wallet
 *
 * Returns null if allowed, error ToolResponse if blocked.
 */
export function checkWalletToolRate(wallet: string, requestId: string): ToolResponse<null> | null {
  if (!wallet) return null;

  const now = Date.now();
  let entry = walletToolRates.get(wallet);

  if (!entry) {
    // [F2] Evict oldest wallet if at capacity
    if (walletToolRates.size >= MAX_WALLET_RATE_ENTRIES) {
      const firstKey = walletToolRates.keys().next().value;
      if (firstKey !== undefined) walletToolRates.delete(firstKey);
    }
    entry = { timestamps: [] };
    walletToolRates.set(wallet, entry);
  }

  // Evict timestamps older than burst window
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < RATE_BURST_WINDOW_MS);

  // Check per-second
  const lastSecond = entry.timestamps.filter((ts) => now - ts < 1_000);
  if (lastSecond.length >= RATE_MAX_PER_SECOND) {
    logError("tool_call", {
      request_id: requestId,
      wallet,
      error: "Wallet rate limit exceeded (per-second)",
    });
    return {
      status: "error",
      data: null,
      error: "Rate limit exceeded — max 5 tool calls per second",
      request_id: requestId,
      latency_ms: 0,
    };
  }

  // Push first, then check burst count (defensive against concurrent async entries)
  entry.timestamps.push(now);
  if (entry.timestamps.length > RATE_BURST_MAX) {
    logError("tool_call", {
      request_id: requestId,
      wallet,
      error: "Wallet rate limit exceeded (burst)",
    });
    return {
      status: "error",
      data: null,
      error: "Too many operations. Wait a moment.",
      request_id: requestId,
      latency_ms: 0,
    };
  }

  return null;
}

// ---- Replay Protection ----

/**
 * Check if request_id was already processed.
 * Returns error ToolResponse if replay, null if fresh.
 */
export function checkReplay(requestId: string): ToolResponse<null> | null {
  if (isReplay(requestId)) {
    logError("tool_call", {
      request_id: requestId,
      error: "Replay detected — duplicate request_id",
    });
    return {
      status: "error",
      data: null,
      error: "Duplicate request rejected",
      request_id: requestId,
      latency_ms: 0,
    };
  }
  return null;
}

// ---- Pre-Execution Guard Chain ----

/**
 * Run ALL pre-execution guards in STRICT order.
 * Returns error response if any guard fails, null if all pass.
 *
 * Order:
 * 1. Replay protection
 * 2. Wallet rate limit
 * 3. Kill switch (trade tools only)
 */
export function runTradeGuards(requestId: string, wallet: string): ToolResponse<null> | null {
  // 1. Replay protection
  const replay = checkReplay(requestId);
  if (replay) return replay;

  // 2. Wallet rate limit
  const rateLimited = checkWalletToolRate(wallet, requestId);
  if (rateLimited) return rateLimited;

  // 3. Kill switch
  const killCheck = checkTradingEnabled(requestId);
  if (killCheck) return killCheck;

  return null;
}

/**
 * Run guards for read-only tools (no kill switch).
 * Order:
 * 1. Replay protection
 * 2. Wallet rate limit
 */
export function runReadGuards(requestId: string, wallet: string): ToolResponse<null> | null {
  // 1. Replay protection
  const replay = checkReplay(requestId);
  if (replay) return replay;

  // 2. Wallet rate limit
  const rateLimited = checkWalletToolRate(wallet, requestId);
  if (rateLimited) return rateLimited;

  return null;
}

// ---- Tool Timeout ----

const TOOL_TIMEOUT_MS = 2_000;

/**
 * Wrap an async function with a timeout.
 * If execution exceeds 2s, abort and return degraded/error.
 */
export async function withToolTimeout<T>(
  fn: () => Promise<T>,
  fallback: T | null = null,
): Promise<{ result: T; timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ result: fallback as T, timedOut: true });
      }
    }, TOOL_TIMEOUT_MS);

    fn()
      .then((result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ result, timedOut: false });
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ result: fallback as T, timedOut: true });
        }
      });
  });
}

// ---- Logging Helpers ----

export function logToolCall(tool: string, requestId: string, wallet: string, data?: Record<string, unknown>): void {
  logInfo("tool_call", { tool, request_id: requestId, wallet, data });
}

export function logToolResult(
  tool: string,
  requestId: string,
  wallet: string,
  latencyMs: number,
  status: string,
  extra?: Record<string, unknown>,
): void {
  logInfo("tool_result", {
    tool,
    request_id: requestId,
    wallet,
    latency_ms: latencyMs,
    data: { status, ...extra },
  });
}

/**
 * Log firewall validation result.
 * Logs for BOTH pass and block — critical audit trail.
 */
export function logFirewallResult(
  tool: string,
  requestId: string,
  wallet: string,
  blocked: boolean,
  errors?: string[],
  warnings?: string[],
): void {
  const fn = blocked ? logError : logInfo;
  fn("firewall", {
    tool,
    request_id: requestId,
    wallet,
    data: { blocked, errors: errors ?? [], warnings: warnings ?? [] },
  });
}
