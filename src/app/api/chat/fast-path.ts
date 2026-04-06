// ============================================
// Flash AI — Deterministic Fast Path Engine
// ============================================
// Zero-latency, zero-network parser for strict trading commands.
// Skips AI model entirely — returns synthetic tool result stream.
//
// PERFORMANCE:
//   Parse:      <1ms  (single regex exec)
//   Validate:   <1ms  (numeric checks + firewall)
//   Price:      0ms   (reads from module-level cache, no network)
//   Total:      <5ms  (excluding stream write overhead)
//
// SUPPORTED (strict grammar only):
//   (long|short) <MARKET> [$]<AMOUNT> <LEV>x [market] [tp <N>] [sl <N>]
//
// ANYTHING ELSE → falls back to AI. No partial match. No fuzzy. No guessing.
//
// SAFETY:
//   Same validation as AI path: numeric safety, direction rules,
//   dynamic distance, firewall. Fast path ≠ bypass.

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { getCachedPrice, metrics as cacheMetrics } from "./price-cache";
import { enforceFirewall, getMaxLeverageForMarket } from "@/lib/trade-firewall";
import { MARKETS, MARKET_ALIASES, DEFAULT_SLIPPAGE_BPS, MIN_COLLATERAL } from "@/lib/constants";
import type { Position } from "@/lib/types";

// ---- Background cache refresh (non-blocking, fire-and-forget) ----
let _refreshPending = false;
function triggerBackgroundRefresh(): void {
  if (_refreshPending) return;
  _refreshPending = true;
  import("./flash-api")
    .then(({ fetchAllPrices }) => fetchAllPrices())
    .catch(() => {})
    .finally(() => { _refreshPending = false; });
}

// ---- Micro-burst dedup (prevents duplicate trade previews on rapid clicks) ----
// Key: normalized input string. Value: timestamp of last successful fast-path hit.
// Window: 500ms — identical inputs within this window are rejected.
const _recentHits = new Map<string, number>();
const DEDUP_WINDOW_MS = 500;

function isDuplicate(input: string): boolean {
  const now = Date.now();
  const prev = _recentHits.get(input);
  if (prev && now - prev < DEDUP_WINDOW_MS) return true;
  // Evict old entries (keep map bounded)
  if (_recentHits.size > 50) {
    for (const [k, t] of _recentHits) {
      if (now - t > DEDUP_WINDOW_MS) _recentHits.delete(k);
    }
  }
  return false;
}

function recordHit(input: string): void {
  _recentHits.set(input, Date.now());
}

// ---- Strict Regex (full-string match, no partial) ----
// Uses RegExp constructor to avoid template literal $ escaping issues.
// Groups: 1=side, 2=market, 3=collateral, 4=leverage, 5=tp1, 6=sl1, 7=tp2, 8=sl2
const FAST_TRADE_RE = new RegExp(
  "^(long|short)\\s+(\\w+)\\s+[$]?(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)x" +
  "(?:\\s+market)?" +
  "(?:\\s+tp\\s+(\\d+(?:\\.\\d+)?))?" +
  "(?:\\s+sl\\s+(\\d+(?:\\.\\d+)?))?" +
  "(?:\\s+tp\\s+(\\d+(?:\\.\\d+)?))?" +
  "(?:\\s+sl\\s+(\\d+(?:\\.\\d+)?))?$",
  "i"
);

// ---- Metrics (module-level, non-blocking) ----
export const metrics = {
  hits: 0,
  misses: 0,
  fallbacks: 0,
  validationFailures: 0,
};

// ---- Types ----

export interface FastPathResult {
  matched: boolean;
  response?: Response;
}

interface ParsedTrade {
  side: "LONG" | "SHORT";
  market: string;
  collateral: number;
  leverage: number;
  tp: number | null;
  sl: number | null;
}

// ---- Market Resolution (synchronous) ----

function resolveMarket(token: string): string | null {
  const lower = token.toLowerCase();
  if (MARKET_ALIASES[lower]) return MARKET_ALIASES[lower];
  const upper = token.toUpperCase();
  if (MARKETS[upper]) return upper;
  return null;
}

// ---- PHASE 1: Parse (synchronous, <1ms) ----

function parse(input: string): ParsedTrade | null {
  const m = FAST_TRADE_RE.exec(input);
  if (!m) return null;

  const market = resolveMarket(m[2]);
  if (!market) return null;

  const collateral = parseFloat(m[3]);
  const leverage = parseFloat(m[4]);

  // Numeric safety — reject NaN/Infinity/out-of-bounds
  if (!Number.isFinite(collateral) || collateral < MIN_COLLATERAL) return null;
  // Per-market leverage cap (same as firewall — reject early, don't waste cycles)
  const maxLev = getMaxLeverageForMarket(market);
  if (!Number.isFinite(leverage) || leverage < 1 || leverage > maxLev) return null;

  // TP can be in group 5 or 7, SL in 6 or 8 (either ordering)
  const tp = m[5] ? parseFloat(m[5]) : m[7] ? parseFloat(m[7]) : null;
  const sl = m[6] ? parseFloat(m[6]) : m[8] ? parseFloat(m[8]) : null;

  if (tp != null && (!Number.isFinite(tp) || tp <= 0)) return null;
  if (sl != null && (!Number.isFinite(sl) || sl <= 0)) return null;

  return {
    side: m[1].toUpperCase() as "LONG" | "SHORT",
    market,
    collateral,
    leverage,
    tp,
    sl,
  };
}

// ---- PHASE 2: Validate (synchronous, <1ms) ----
// When price is STALE (2-30s old), use CONSERVATIVE bounds to prevent
// stale-data mistakes. Fresh prices get standard bounds.
//
// FRESH:        distance 0.1% – 500%
// STALE:        distance 1.0% – 450%  (tighter = safer with old data)

const DIST_MAX_FRESH = 5.0;     // 500%
const DIST_MIN_FRESH = 0.001;   // 0.1%
const DIST_MAX_STALE = 4.5;     // 450%
const DIST_MIN_STALE = 0.01;    // 1.0%

function validate(
  trade: ParsedTrade,
  entryPrice: number,
  priceFresh: boolean,
  positions: Position[],
  wallet: string,
): { valid: boolean; preview?: Record<string, unknown>; warnings?: string[] } {

  const distMax = priceFresh ? DIST_MAX_FRESH : DIST_MAX_STALE;
  const distMin = priceFresh ? DIST_MIN_FRESH : DIST_MIN_STALE;

  // TP/SL dynamic distance validation (freshness-aware)
  if (trade.tp != null) {
    const dist = Math.abs(trade.tp - entryPrice) / entryPrice;
    if (dist > distMax || dist < distMin) return { valid: false };
    if (trade.side === "LONG" && trade.tp <= entryPrice) return { valid: false };
    if (trade.side === "SHORT" && trade.tp >= entryPrice) return { valid: false };
  }
  if (trade.sl != null) {
    const dist = Math.abs(trade.sl - entryPrice) / entryPrice;
    if (dist > distMax || dist < distMin) return { valid: false };
    if (trade.side === "LONG" && trade.sl >= entryPrice) return { valid: false };
    if (trade.side === "SHORT" && trade.sl <= entryPrice) return { valid: false };
  }

  // Build trade preview (same math as AI tool)
  const positionSize = trade.collateral * trade.leverage;
  const feeRate = 0.0008;
  const fees = positionSize * feeRate;
  const liquidationPrice = trade.side === "LONG"
    ? entryPrice - entryPrice / trade.leverage
    : entryPrice + entryPrice / trade.leverage;

  if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) return { valid: false };

  const preview: Record<string, unknown> = {
    market: trade.market,
    side: trade.side,
    collateral_usd: trade.collateral,
    leverage: trade.leverage,
    entry_price: entryPrice,
    liquidation_price: liquidationPrice,
    position_size: positionSize,
    fees,
    fee_rate: feeRate,
    slippage_bps: DEFAULT_SLIPPAGE_BPS,
    ...(trade.tp != null && { take_profit_price: trade.tp }),
    ...(trade.sl != null && { stop_loss_price: trade.sl }),
  };

  // Firewall validation (same as AI path — zero trust)
  const firewall = enforceFirewall("build_trade", preview, wallet, positions);
  if (firewall.blocked) return { valid: false };

  return { valid: true, preview, warnings: firewall.warnings };
}

// ---- PHASE 3: Build Response (the only "async" part — but no network) ----

function buildResponse(
  trade: ParsedTrade,
  preview: Record<string, unknown>,
  warnings: string[] | undefined,
  priceFresh: boolean,
): Response {
  const toolCallId = `tc_fast_${Date.now()}`;
  const status = priceFresh ? "success" : "degraded";

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });

      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "build_trade",
        input: {
          market: trade.market,
          side: trade.side,
          collateral_usd: trade.collateral,
          leverage: trade.leverage,
          take_profit_price: trade.tp,
          stop_loss_price: trade.sl,
        },
      });

      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: {
          status,
          data: preview,
          request_id: `fast_${Date.now()}`,
          latency_ms: 0,
          warnings: warnings ?? [],
        },
      });

      writer.write({ type: "finish-step" });

      const textId = `text_fast_${Date.now()}`;
      writer.write({ type: "text-start", id: textId });
      writer.write({
        type: "text-delta",
        id: textId,
        delta: "Trade ready — confirm to execute.",
      });
      writer.write({ type: "text-end", id: textId });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

// ---- PUBLIC API ----

/**
 * Attempt deterministic fast-path execution.
 *
 * - Fully synchronous for parse + validate (reads price from module-level cache)
 * - Returns { matched: true, response } on success
 * - Returns { matched: false } on any failure — caller falls back to AI
 * - NEVER throws, NEVER blocks on network
 */
export function tryFastPath(
  input: string,
  walletAddress: string,
  positions: Position[],
): FastPathResult {
  try {
    const trimmed = input.trim();
    if (!trimmed) { metrics.misses++; return { matched: false }; }

    // PHASE 0: Micro-burst dedup — reject identical input within 500ms window
    if (isDuplicate(trimmed)) { metrics.misses++; return { matched: false }; }

    // PHASE 1: Parse
    const trade = parse(trimmed);
    if (!trade) { metrics.misses++; return { matched: false }; }

    // PHASE 2: Get cached price (SYNCHRONOUS — no network)
    const cached = getCachedPrice(trade.market);
    if (!cached) {
      // No cached price → can't validate → fall back. Fire background refresh for next request.
      triggerBackgroundRefresh();
      metrics.fallbacks++;
      return { matched: false };
    }

    // PHASE 3: Validate (stale-aware — conservative bounds when price is old)
    const result = validate(trade, cached.price, cached.fresh, positions, walletAddress);
    if (!result.valid) {
      metrics.validationFailures++;
      return { matched: false };
    }

    // PHASE 4: Build response + record dedup
    metrics.hits++;
    recordHit(trimmed);
    return {
      matched: true,
      response: buildResponse(trade, result.preview!, result.warnings, cached.fresh),
    };
  } catch {
    // NEVER throws — any exception = safe fallback
    metrics.fallbacks++;
    return { matched: false };
  }
}

/** Get fast path + cache metrics with derived rates for diagnostics */
export function getMetrics() {
  const fp = { ...metrics };
  const pc = { ...cacheMetrics };
  const total = fp.hits + fp.misses + fp.fallbacks + fp.validationFailures;
  return {
    fastPath: fp,
    priceCache: pc,
    derived: {
      totalAttempts: total,
      successRate: total > 0 ? fp.hits / total : 0,
      fallbackRate: total > 0 ? (fp.misses + fp.fallbacks) / total : 0,
      validationRejectRate: total > 0 ? fp.validationFailures / total : 0,
      cacheHitRate: (pc.hits + pc.stale) > 0
        ? (pc.hits + pc.stale) / (pc.hits + pc.stale + pc.misses + pc.expired)
        : 0,
    },
  };
}
