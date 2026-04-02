// ============================================
// Flash UI — Deterministic Intent Engine
// ============================================
//
// Deterministic regex parser. No AI. No guessing.
//
// Capabilities:
//   - Single-pass full extraction (market, side, collateral, leverage, SL, TP)
//   - Multi-intent chaining ("Long BTC 100 5x and set SL 2%")
//   - Relative modifications ("double leverage", "increase size", "half")
//   - Context resolution ("close it", "make it 200")
//   - Ambiguity detection (asks clarification, never assumes)
//
// Supported intents:
//   OPEN_POSITION   CLOSE_POSITION   REDUCE_POSITION   MODIFY_TRADE
//   SET_SL          SET_TP           CANCEL            QUERY

import type { Side, TradeObject, ParsedIntent } from "./types";
import {
  MARKET_ALIASES,
  MARKETS,
  DEFAULT_LEVERAGE,
  DEFAULT_SLIPPAGE_BPS,
} from "./constants";

let nextId = 0;
function genId(): string {
  return `trade_${Date.now()}_${++nextId}`;
}

export interface ParseResult {
  type: "trade" | "close" | "reduce" | "modify" | "sl" | "tp" | "cancel" | "query" | "ambiguous" | "unknown";
  intent: ParsedIntent;
  trade?: TradeObject;
  /** Chained intents to execute after the primary (e.g., SL/TP after open) */
  chain?: ParsedIntent[];
  /** Ambiguity: list of options to present to the user */
  ambiguityQuestion?: string;
  /** Parse confidence: 1.0 = grammar match, 0.0 = unknown. AI fallback assigns its own. */
  confidence?: number;
  /** Parse source */
  source?: "grammar" | "ai";
}

// ============================================
// Entity Extraction (pure, no side effects)
// ============================================

function resolveMarket(token: string): string | null {
  const lower = token.toLowerCase();
  const alias = MARKET_ALIASES[lower];
  if (alias) return alias;
  const upper = token.toUpperCase();
  if (MARKETS[upper]) return upper;
  return null;
}

function extractSide(input: string): Side | null {
  const lower = input.toLowerCase();
  if (/\b(long|buy|bullish)\b/.test(lower)) return "LONG";
  if (/\b(short|sell|bearish)\b/.test(lower)) return "SHORT";
  return null;
}

function extractMarket(input: string): string | null {
  const lower = input.toLowerCase();
  for (const [alias, symbol] of Object.entries(MARKET_ALIASES)) {
    const regex = new RegExp(`\\b${alias}\\b`, "i");
    if (regex.test(lower)) return symbol;
  }
  const words = input.split(/\s+/);
  for (const w of words) {
    const upper = w.toUpperCase().replace(/[^A-Z]/g, "");
    if (MARKETS[upper]) return upper;
  }
  return null;
}

function extractCollateral(input: string): number | null {
  const patterns = [
    /\$\s*(\d+(?:\.\d+)?)/,
    /(\d+(?:\.\d+)?)\s*(?:usd|usdc|dollars?)\b/i,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const posMatch = input.match(/(?:long|short|buy|sell)\s+\w+\s+(\d+(?:\.\d+)?)\b/i);
  if (posMatch) {
    const n = parseFloat(posMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function extractLeverage(input: string): number | null {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*x\b/i,
    /x\s*(\d+(?:\.\d+)?)\b/i,
    /(\d+(?:\.\d+)?)\s*lever/i,
    /leverage\s*(?:to\s+)?(\d+(?:\.\d+)?)/i,
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n >= 1) return n;
    }
  }
  return null;
}

function extractPercent(input: string, keyword: string): number | null {
  const patterns = [
    new RegExp(`${keyword}\\s+(?:at\\s+)?(\\d+(?:\\.\\d+)?)\\s*%`, "i"),
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*%\\s*${keyword}`, "i"),
    new RegExp(`(?:with|and)\\s+(\\d+(?:\\.\\d+)?)\\s*%\\s*${keyword}`, "i"),
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 100) return n;
    }
  }
  return null;
}

function extractPrice(input: string, keyword: string): number | null {
  const patterns = [
    new RegExp(`${keyword}\\s+(?:at\\s+)?\\$?(\\d+(?:\\.\\d+)?)`, "i"),
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function extractReducePercent(input: string): number | null {
  const m = input.match(/(?:reduce|decrease|cut)\s+(?:\w+\s+)?(?:by\s+)?(\d+(?:\.\d+)?)\s*%/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 100) return n;
  }
  if (/\bhalf\b/i.test(input)) return 50;
  return null;
}

// ---- Relative multiplier detection ----
type RelativeOp = { field: "collateral" | "leverage"; multiplier: number };

function extractRelativeOp(input: string): RelativeOp | null {
  const lower = input.toLowerCase();

  // "double leverage", "double size", "double"
  if (/\bdouble\s*(?:the\s+)?lever/i.test(lower)) return { field: "leverage", multiplier: 2 };
  if (/\bdouble\s*(?:the\s+)?(?:size|collateral|position)/i.test(lower)) return { field: "collateral", multiplier: 2 };
  if (/^double$/i.test(lower.trim())) return { field: "collateral", multiplier: 2 };

  // "triple"
  if (/\btriple\s*(?:the\s+)?lever/i.test(lower)) return { field: "leverage", multiplier: 3 };
  if (/\btriple\b/i.test(lower)) return { field: "collateral", multiplier: 3 };

  // "half leverage", "half size", "half"
  if (/\bhalf\s*(?:the\s+)?lever/i.test(lower)) return { field: "leverage", multiplier: 0.5 };
  if (/\bhalf\s*(?:the\s+)?(?:size|collateral|position)/i.test(lower)) return { field: "collateral", multiplier: 0.5 };

  // "increase size/leverage" (default: +50%)
  if (/\bincrease\s*(?:the\s+)?lever/i.test(lower)) return { field: "leverage", multiplier: 1.5 };
  if (/\bincrease\s*(?:the\s+)?(?:size|collateral|position)/i.test(lower)) return { field: "collateral", multiplier: 1.5 };
  if (/^increase$/i.test(lower.trim())) return { field: "collateral", multiplier: 1.5 };

  // "decrease" (default: -50%)
  if (/\bdecrease\s*(?:the\s+)?lever/i.test(lower)) return { field: "leverage", multiplier: 0.5 };
  if (/\bdecrease\b/i.test(lower)) return { field: "collateral", multiplier: 0.5 };

  return null;
}

// ---- Multi-intent chain detection ----
function splitChainedIntents(input: string): string[] {
  // Split on "and then", "then", "and also", "and"
  // But NOT "and" inside SL/TP phrases like "with 2% SL and 5% TP"
  const parts = input.split(/\b(?:and\s+then|then|and\s+also)\b/i);
  if (parts.length > 1) return parts.map((p) => p.trim()).filter(Boolean);

  // "and" only if both halves have action keywords
  const andParts = input.split(/\band\b/i);
  if (andParts.length === 2) {
    const left = andParts[0].trim();
    const right = andParts[1].trim();
    const leftHasAction = /\b(long|short|buy|sell|close|exit|set|sl|tp|stop|take|reduce)\b/i.test(left);
    const rightHasAction = /\b(long|short|buy|sell|close|exit|set|sl|tp|stop|take|reduce)\b/i.test(right);
    if (leftHasAction && rightHasAction) {
      return [left, right];
    }
  }

  return [input];
}

// ============================================
// Main Parser
// ============================================

const MAX_INPUT_LENGTH = 500;
const MAX_CHAIN_DEPTH = 3;

/** Tag a raw parse result with confidence and source */
function tagResult(result: Omit<ParseResult, "confidence" | "source">): ParseResult {
  const confidence = result.type === "unknown" ? 0 : 1.0;
  return { ...result, confidence, source: "grammar" as const };
}

export function parseCommand(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return tagResult({ type: "unknown", intent: { type: "QUERY", raw: input } });
  }

  // Input sanitization: reject oversized input
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return tagResult({ type: "unknown", intent: { type: "QUERY", raw: trimmed.slice(0, 100) + "..." } });
  }

  // ---- Check for chained intents (max 3 segments) ----
  const segments = splitChainedIntents(trimmed);
  if (segments.length > 1) {
    const capped = segments.slice(0, MAX_CHAIN_DEPTH);
    const primary = parseSingleIntent(capped[0]);
    const chain: ParsedIntent[] = [];
    for (let i = 1; i < capped.length; i++) {
      const sub = parseSingleIntent(capped[i]);
      chain.push(sub.intent);
    }
    return tagResult({ ...primary, chain });
  }

  return tagResult(parseSingleIntent(trimmed));
}

function parseSingleIntent(input: string): ParseResult {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  // ---- CANCEL ----
  if (/^(cancel|nevermind|nvm|abort|forget\s*it)\s*$/i.test(lower)) {
    return { type: "cancel", intent: { type: "CANCEL", raw: trimmed } };
  }

  // ---- QUERY ----
  if (/^(price|positions?|portfolio|balance|status|help)\b/i.test(lower)) {
    return {
      type: "query",
      intent: { type: "QUERY", market: extractMarket(trimmed) ?? undefined, raw: trimmed },
    };
  }

  // ---- RELATIVE MODIFICATION ("double leverage", "increase size", "half") ----
  const relOp = extractRelativeOp(trimmed);
  if (relOp) {
    return {
      type: "modify",
      intent: {
        type: "MODIFY_TRADE",
        // Store multiplier as negative collateral/leverage to signal "relative"
        // The store will resolve this against the active trade
        collateral_usd: relOp.field === "collateral" ? -relOp.multiplier : undefined,
        leverage: relOp.field === "leverage" ? -relOp.multiplier : undefined,
        raw: trimmed,
      },
    };
  }

  // ---- SET SL (standalone) ----
  if (/\b(sl|stop\s*loss)\b/i.test(lower) && !/\b(long|short|buy|sell|open)\b/i.test(lower)) {
    return {
      type: "sl",
      intent: {
        type: "SET_SL",
        market: extractMarket(trimmed) ?? undefined,
        stop_loss_pct: extractPercent(trimmed, "(?:sl|stop\\s*loss)") ?? undefined,
        stop_loss_price: extractPrice(trimmed, "(?:sl|stop\\s*loss)") ?? undefined,
        raw: trimmed,
      },
    };
  }

  // ---- SET TP (standalone) ----
  if (/\b(tp|take\s*profit)\b/i.test(lower) && !/\b(long|short|buy|sell|open)\b/i.test(lower)) {
    return {
      type: "tp",
      intent: {
        type: "SET_TP",
        market: extractMarket(trimmed) ?? undefined,
        take_profit_pct: extractPercent(trimmed, "(?:tp|take\\s*profit)") ?? undefined,
        take_profit_price: extractPrice(trimmed, "(?:tp|take\\s*profit)") ?? undefined,
        raw: trimmed,
      },
    };
  }

  // ---- FLIP ----
  if (/\bflip\b/i.test(lower)) {
    return {
      type: "close",
      intent: { type: "CLOSE_POSITION", market: extractMarket(trimmed) ?? undefined, flip: true, raw: trimmed },
    };
  }

  // ---- REDUCE ----
  const reducePct = extractReducePercent(trimmed);
  if (reducePct && /\b(reduce|decrease|cut|half)\b/i.test(lower)) {
    return {
      type: "reduce",
      intent: { type: "REDUCE_POSITION", market: extractMarket(trimmed) ?? undefined, reduce_percent: reducePct, raw: trimmed },
    };
  }

  // ---- CLOSE ----
  if (/\b(close|exit|flatten|close\s*all)\b/i.test(lower)) {
    const closeMatch = trimmed.match(/\b(?:close|exit|flatten)\b\s+(?:my\s+)?(?:(long|short)\s+)?(\w+)/i);
    let market: string | undefined;
    let side: Side | undefined;
    if (closeMatch) {
      side = closeMatch[1] ? (closeMatch[1].toUpperCase() as Side) : undefined;
      market = resolveMarket(closeMatch[2]) ?? undefined;
    }
    if (!market) market = extractMarket(trimmed) ?? undefined;
    return {
      type: "close",
      intent: { type: "CLOSE_POSITION", market, side, raw: trimmed },
    };
  }

  // ---- MODIFY (absolute: "make it 200", "change leverage to 10x") ----
  if (/\b(make\s*it|change|update|adjust)\b/i.test(lower)) {
    const collateral = extractCollateral(trimmed);
    const leverage = extractLeverage(trimmed);
    if (collateral || leverage) {
      return {
        type: "modify",
        intent: { type: "MODIFY_TRADE", collateral_usd: collateral ?? undefined, leverage: leverage ?? undefined, raw: trimmed },
      };
    }
    const bareMatch = trimmed.match(/(?:make\s*it|change\s*(?:to)?|set\s*(?:to)?)\s+(\d+(?:\.\d+)?)/i);
    if (bareMatch) {
      const n = parseFloat(bareMatch[1]);
      if (Number.isFinite(n) && n > 0) {
        return { type: "modify", intent: { type: "MODIFY_TRADE", collateral_usd: n, raw: trimmed } };
      }
    }
  }

  // ---- OPEN POSITION ----
  const side = extractSide(trimmed);
  const market = extractMarket(trimmed);
  const collateral = extractCollateral(trimmed);
  const leverage = extractLeverage(trimmed);
  const inlineSLPct = extractPercent(trimmed, "(?:sl|stop\\s*loss)");
  const inlineTPPct = extractPercent(trimmed, "(?:tp|take\\s*profit)");
  const inlineSLPrice = extractPrice(trimmed, "(?:sl|stop\\s*loss)");
  const inlineTPPrice = extractPrice(trimmed, "(?:tp|take\\s*profit)");

  if (!side && !market) {
    return { type: "unknown", intent: { type: "QUERY", raw: trimmed } };
  }

  const missing: (keyof TradeObject)[] = [];
  if (!side) missing.push("action");
  if (!market) missing.push("market");
  if (!collateral) missing.push("collateral_usd");

  const pool = market ? MARKETS[market]?.pool : undefined;
  const defaultLev = pool ? DEFAULT_LEVERAGE[pool] ?? 5 : 5;

  const trade: TradeObject = {
    id: genId(),
    action: side ?? "LONG",
    market: market ?? "",
    collateral_usd: collateral,
    leverage: leverage ?? (collateral ? defaultLev : null),
    position_size: null,
    entry_price: null,
    mark_price: null,
    liquidation_price: null,
    fees: null,
    fee_rate: null,
    slippage_bps: DEFAULT_SLIPPAGE_BPS,
    status: "INCOMPLETE",
    missing_fields: missing,
  };

  if (trade.collateral_usd && trade.leverage) {
    trade.position_size = trade.collateral_usd * trade.leverage;
  }
  if (trade.market && trade.collateral_usd && trade.leverage) {
    trade.missing_fields = [];
  }

  // Build chained SL/TP intents if inline
  const chain: ParsedIntent[] = [];
  if (inlineSLPct || inlineSLPrice) {
    chain.push({ type: "SET_SL", stop_loss_pct: inlineSLPct ?? undefined, stop_loss_price: inlineSLPrice ?? undefined, raw: trimmed });
  }
  if (inlineTPPct || inlineTPPrice) {
    chain.push({ type: "SET_TP", take_profit_pct: inlineTPPct ?? undefined, take_profit_price: inlineTPPrice ?? undefined, raw: trimmed });
  }

  return {
    type: "trade",
    intent: {
      type: "OPEN_POSITION",
      market: market ?? undefined,
      side: side ?? undefined,
      collateral_usd: collateral ?? undefined,
      leverage: leverage ?? undefined,
      stop_loss_pct: inlineSLPct ?? undefined,
      take_profit_pct: inlineTPPct ?? undefined,
      stop_loss_price: inlineSLPrice ?? undefined,
      take_profit_price: inlineTPPrice ?? undefined,
      raw: trimmed,
    },
    trade,
    chain: chain.length > 0 ? chain : undefined,
  };
}

// ============================================
// Progressive Build + Modification
// ============================================

export function parseFieldResponse(input: string, currentTrade: TradeObject): TradeObject {
  const trimmed = input.trim();
  const updated = { ...currentTrade };

  if (updated.missing_fields.includes("market")) {
    const market = resolveMarket(trimmed) ?? extractMarket(trimmed);
    if (market) {
      updated.market = market;
      updated.missing_fields = updated.missing_fields.filter((f) => f !== "market");
    }
  }

  if (updated.missing_fields.includes("action")) {
    const side = extractSide(trimmed);
    if (side) {
      updated.action = side;
      updated.missing_fields = updated.missing_fields.filter((f) => f !== "action");
    }
  }

  if (updated.missing_fields.includes("collateral_usd") || !updated.collateral_usd) {
    const num = parseFloat(trimmed.replace(/[$,]/g, ""));
    if (Number.isFinite(num) && num > 0) {
      updated.collateral_usd = num;
      updated.missing_fields = updated.missing_fields.filter((f) => f !== "collateral_usd");
    }
  }

  // Try extracting leverage (e.g. "5x", "x5")
  let lev = extractLeverage(trimmed);

  // If leverage is missing and collateral is already filled,
  // accept a bare number as leverage (e.g. user types "2" when asked for leverage).
  // IMPORTANT: only when collateral was already set BEFORE this parse step,
  // so "10" typed for collateral doesn't also get consumed as leverage.
  if (!lev && !updated.leverage && currentTrade.collateral_usd) {
    const bare = parseFloat(trimmed.replace(/x/i, ""));
    if (Number.isFinite(bare) && bare >= 1 && bare <= 100) {
      lev = bare;
    }
  }

  if (lev) updated.leverage = lev;

  // Don't auto-assign leverage in progressive flow — let getNextQuestion ask

  if (updated.collateral_usd && updated.leverage) {
    updated.position_size = updated.collateral_usd * updated.leverage;
  }

  return updated;
}

export function getNextQuestion(trade: TradeObject): string | null {
  if (!trade.market) return "Which market? (BTC, ETH, SOL...)";
  if (trade.missing_fields.includes("action")) return "Long or short?";
  if (!trade.collateral_usd) return "How much collateral? (USD)";
  if (!trade.leverage) return "Leverage? (e.g. 2x, 5x, 10x)";
  return null;
}

/**
 * Apply a MODIFY_TRADE intent to an active trade.
 * Handles both absolute values (collateral_usd > 0) and
 * relative multipliers (negative values signal relative ops).
 */
export function applyModification(trade: TradeObject, intent: ParsedIntent): TradeObject {
  const updated = { ...trade };

  // Collateral: positive = absolute, negative = relative multiplier
  if (intent.collateral_usd != null && Number.isFinite(intent.collateral_usd)) {
    if (intent.collateral_usd > 0) {
      // Absolute: "make it 200"
      updated.collateral_usd = intent.collateral_usd;
    } else if (intent.collateral_usd < 0 && updated.collateral_usd) {
      // Relative: -2 = double, -0.5 = half
      const multiplier = Math.abs(intent.collateral_usd);
      const newVal = updated.collateral_usd * multiplier;
      if (Number.isFinite(newVal) && newVal > 0) {
        updated.collateral_usd = Math.round(newVal * 100) / 100; // 2 decimal places
      }
    }
  }

  // Leverage: positive = absolute, negative = relative multiplier
  if (intent.leverage != null && Number.isFinite(intent.leverage)) {
    if (intent.leverage >= 1) {
      // Absolute: "change leverage to 10x"
      updated.leverage = intent.leverage;
    } else if (intent.leverage < 0 && updated.leverage) {
      // Relative: -2 = double, -0.5 = half
      const multiplier = Math.abs(intent.leverage);
      const newVal = Math.round(updated.leverage * multiplier);
      if (Number.isFinite(newVal) && newVal >= 1) {
        updated.leverage = newVal;
      }
    }
  }

  if (updated.collateral_usd && updated.leverage) {
    updated.position_size = updated.collateral_usd * updated.leverage;
  }

  // Force re-enrichment
  updated.status = "INCOMPLETE";
  updated.entry_price = null;
  updated.mark_price = null;
  updated.liquidation_price = null;
  updated.fees = null;
  updated.missing_fields = [];

  return updated;
}

// ============================================
// Ambiguity Detection
// ============================================

/**
 * Check if a close/reduce action is ambiguous given open positions.
 * Returns a clarification question if both LONG and SHORT exist for the market.
 */
export function checkCloseAmbiguity(
  market: string,
  side: Side | undefined,
  positions: { market: string; side: Side }[]
): string | null {
  if (side) return null; // Side explicitly specified

  const marketPositions = positions.filter((p) => p.market === market);
  if (marketPositions.length <= 1) return null; // 0 or 1 position — no ambiguity

  const hasLong = marketPositions.some((p) => p.side === "LONG");
  const hasShort = marketPositions.some((p) => p.side === "SHORT");

  if (hasLong && hasShort) {
    return `Close LONG or SHORT ${market}?`;
  }

  return null;
}
