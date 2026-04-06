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
import { enforceFirewall } from "@/lib/trade-firewall";
import { MARKETS, MARKET_ALIASES, DEFAULT_SLIPPAGE_BPS, MIN_COLLATERAL, MAX_LEVERAGE } from "@/lib/constants";
import type { Position } from "@/lib/types";

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
  if (!Number.isFinite(leverage) || leverage < 1 || leverage > MAX_LEVERAGE) return null;

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

function validate(
  trade: ParsedTrade,
  entryPrice: number,
  positions: Position[],
  wallet: string,
): { valid: boolean; preview?: Record<string, unknown>; warnings?: string[] } {

  // TP/SL dynamic distance validation
  if (trade.tp != null) {
    const dist = Math.abs(trade.tp - entryPrice) / entryPrice;
    if (dist > 5.0 || dist < 0.001) return { valid: false };
    if (trade.side === "LONG" && trade.tp <= entryPrice) return { valid: false };
    if (trade.side === "SHORT" && trade.tp >= entryPrice) return { valid: false };
  }
  if (trade.sl != null) {
    const dist = Math.abs(trade.sl - entryPrice) / entryPrice;
    if (dist > 5.0 || dist < 0.001) return { valid: false };
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

    // PHASE 1: Parse
    const trade = parse(trimmed);
    if (!trade) { metrics.misses++; return { matched: false }; }

    // PHASE 2: Get cached price (SYNCHRONOUS — no network)
    const cached = getCachedPrice(trade.market);
    if (!cached) {
      // No cached price → can't validate TP/SL direction → fall back
      metrics.fallbacks++;
      return { matched: false };
    }

    // PHASE 3: Validate
    const result = validate(trade, cached.price, positions, walletAddress);
    if (!result.valid) {
      metrics.validationFailures++;
      return { matched: false };
    }

    // PHASE 4: Build response
    metrics.hits++;
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

/** Get fast path + cache metrics for diagnostics */
export function getMetrics() {
  return { fastPath: { ...metrics }, priceCache: { ...cacheMetrics } };
}
