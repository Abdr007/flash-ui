// ============================================
// Flash AI — Deterministic Fast Path
// ============================================
// Zero-latency parser for strict trading commands.
// Skips AI model entirely — returns synthetic tool result stream.
//
// SUPPORTED (strict patterns only):
//   long SOL $100 5x
//   short BTC 200 3x tp 70000 sl 60000
//   long ETH $50 10x tp 4000
//   short SOL 100 5x sl 80
//
// NOT SUPPORTED (falls back to AI):
//   Natural language, limit orders, incomplete commands,
//   reordered syntax, modifications, queries, closes
//
// Safety: uses the SAME validation as the AI path (enrichment + firewall).
// Performance: ~2ms parse + 1 price fetch (~100ms) = ~102ms total vs ~2-3s AI.

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { fetchPrice, fetchPositions } from "./flash-api";
import { enforceFirewall } from "@/lib/trade-firewall";
import { MARKETS, MARKET_ALIASES, DEFAULT_SLIPPAGE_BPS, MIN_COLLATERAL, MAX_LEVERAGE } from "@/lib/constants";
import { logInfo } from "@/lib/logger";
import type { Position } from "@/lib/types";

// ---- Strict Regex (full-string match, no partial) ----

// Matches: (long|short) <MARKET> [$]<NUMBER> <NUMBER>x [market] [tp <NUMBER>] [sl <NUMBER>]
// Groups 5/7 = TP (either order), Groups 6/8 = SL (either order)
// Uses [dollar sign] as literal via character class [$] to avoid escaping issues
const FAST_TRADE_RE = new RegExp(
  "^(long|short)\\s+(\\w+)\\s+[$]?(\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)x" +
  "(?:\\s+market)?" +
  "(?:\\s+tp\\s+(\\d+(?:\\.\\d+)?))?" +
  "(?:\\s+sl\\s+(\\d+(?:\\.\\d+)?))?" +
  "(?:\\s+tp\\s+(\\d+(?:\\.\\d+)?))?" +
  "(?:\\s+sl\\s+(\\d+(?:\\.\\d+)?))?$",
  "i"
);

export interface FastPathResult {
  matched: boolean;
  response?: Response;
}

function resolveMarket(token: string): string | null {
  const lower = token.toLowerCase();
  if (MARKET_ALIASES[lower]) return MARKET_ALIASES[lower];
  const upper = token.toUpperCase();
  if (MARKETS[upper]) return upper;
  return null;
}

/**
 * Attempt deterministic fast-path parse.
 * Returns { matched: true, response } if successful.
 * Returns { matched: false } if input doesn't match — caller should fall back to AI.
 */
export async function tryFastPath(
  input: string,
  walletAddress: string,
): Promise<FastPathResult> {
  const trimmed = input.trim();
  if (!trimmed) return { matched: false };

  const m = FAST_TRADE_RE.exec(trimmed);
  if (!m) return { matched: false };

  // ---- Extract tokens (each assigned exactly once) ----
  const sideRaw = m[1].toUpperCase() as "LONG" | "SHORT";
  const marketRaw = m[2];
  const collateralRaw = parseFloat(m[3]);
  const leverageRaw = parseFloat(m[4]);
  // TP can be in group 5 or 7 (depending on order), SL in 6 or 8
  const tpRaw = m[5] ? parseFloat(m[5]) : m[7] ? parseFloat(m[7]) : null;
  const slRaw = m[6] ? parseFloat(m[6]) : m[8] ? parseFloat(m[8]) : null;

  // ---- Resolve market ----
  const market = resolveMarket(marketRaw);
  if (!market) return { matched: false }; // Unknown market → AI fallback

  // ---- Numeric safety ----
  if (!Number.isFinite(collateralRaw) || collateralRaw < MIN_COLLATERAL) return { matched: false };
  if (!Number.isFinite(leverageRaw) || leverageRaw < 1 || leverageRaw > MAX_LEVERAGE) return { matched: false };
  if (tpRaw != null && (!Number.isFinite(tpRaw) || tpRaw <= 0)) return { matched: false };
  if (slRaw != null && (!Number.isFinite(slRaw) || slRaw <= 0)) return { matched: false };

  const side = sideRaw;
  const collateral = collateralRaw;
  const leverage = leverageRaw;

  logInfo("fast_path", { data: { market, side, collateral, leverage, tp: tpRaw, sl: slRaw } });

  // ---- Fetch price (the only async call — ~100ms) ----
  let entryPrice: number;
  let positions: Position[];
  try {
    const [priceData, pos] = await Promise.all([
      fetchPrice(market),
      walletAddress ? fetchPositions(walletAddress) : Promise.resolve([]),
    ]);
    if (!priceData || !Number.isFinite(priceData.price) || priceData.price <= 0) {
      return { matched: false }; // Price unavailable → AI fallback
    }
    entryPrice = priceData.price;
    positions = pos as Position[];
  } catch {
    return { matched: false }; // Fetch failed → AI fallback
  }

  // ---- TP/SL validation (dynamic distance: >500% reject, <0.1% reject) ----
  if (tpRaw != null) {
    const dist = Math.abs(tpRaw - entryPrice) / entryPrice;
    if (dist > 5.0 || dist < 0.001) return { matched: false };
    if (side === "LONG" && tpRaw <= entryPrice) return { matched: false };
    if (side === "SHORT" && tpRaw >= entryPrice) return { matched: false };
  }
  if (slRaw != null) {
    const dist = Math.abs(slRaw - entryPrice) / entryPrice;
    if (dist > 5.0 || dist < 0.001) return { matched: false };
    if (side === "LONG" && slRaw >= entryPrice) return { matched: false };
    if (side === "SHORT" && slRaw <= entryPrice) return { matched: false };
  }

  // ---- Build trade preview (same math as AI tool) ----
  const positionSize = collateral * leverage;
  const feeRate = 0.0008;
  const fees = positionSize * feeRate;
  const liquidationPrice = side === "LONG"
    ? entryPrice - entryPrice / leverage
    : entryPrice + entryPrice / leverage;

  const tradePreview = {
    market,
    side,
    collateral_usd: collateral,
    leverage,
    entry_price: entryPrice,
    liquidation_price: liquidationPrice,
    position_size: positionSize,
    fees,
    fee_rate: feeRate,
    slippage_bps: DEFAULT_SLIPPAGE_BPS,
    ...(tpRaw != null && { take_profit_price: tpRaw }),
    ...(slRaw != null && { stop_loss_price: slRaw }),
  };

  // ---- Firewall validation (same as AI path) ----
  const firewall = enforceFirewall("build_trade", tradePreview, walletAddress, positions);
  if (firewall.blocked) {
    return { matched: false }; // Firewall blocked → AI fallback (will show better error)
  }

  // ---- Build synthetic UI message stream ----
  const toolCallId = `tc_fast_${Date.now()}`;

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      // Start message
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });

      // Tool call: input available
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "build_trade",
        input: { market, side, collateral_usd: collateral, leverage, take_profit_price: tpRaw, stop_loss_price: slRaw },
      });

      // Tool call: output available
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: {
          status: "success",
          data: tradePreview,
          request_id: `fast_${Date.now()}`,
          latency_ms: 0,
          warnings: firewall.warnings,
        },
      });

      writer.write({ type: "finish-step" });

      // Short text response
      const textId = `text_fast_${Date.now()}`;
      writer.write({ type: "text-start", id: textId });
      writer.write({ type: "text-delta", id: textId, delta: "Trade ready — confirm to execute." });
      writer.write({ type: "text-end", id: textId });

      writer.write({ type: "finish" });
    },
  });

  return {
    matched: true,
    response: createUIMessageStreamResponse({ stream }),
  };
}
