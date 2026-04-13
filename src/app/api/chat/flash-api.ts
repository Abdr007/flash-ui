// ============================================
// Flash AI — Server-Side Flash API Client
// ============================================
// Mirrors lib/api.ts patterns but for server-side use in /api/chat tools.
// Used by AI tools to fetch prices, positions, and market data.

import { updatePriceCache } from "./price-cache";

const FLASH_API_URL = process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade";
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// ---- Internal Fetch ----

async function serverGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FLASH_API_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Flash API ${res.status}: ${res.statusText}`);
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
      throw new Error(`Response too large: ${contentLength} bytes`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Safe Float Parsing ----

function safeFloat(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// ---- Public API ----

export interface ServerPrice {
  symbol: string;
  price: number;
  confidence: number;
  timestamp: number;
}

/**
 * Parse a Pyth oracle price entry.
 * Flash API returns: { price: scaled_int, exponent: -8, priceUi?: float, confidence, timestampUs }
 * Actual price = priceUi ?? (price / 10^|exponent|)
 */
function parseOraclePrice(entry: Record<string, unknown>): number {
  // Prefer priceUi (pre-computed human-readable price)
  const priceUi = safeFloat(entry.priceUi);
  if (priceUi > 0) return priceUi;

  // Fallback: apply exponent to raw scaled integer
  const rawPrice = safeFloat(entry.price);
  const exponent = safeFloat(entry.exponent, 0);
  if (rawPrice <= 0) return 0;

  // exponent is typically negative (e.g., -8), meaning price / 10^8
  const divisor = Math.pow(10, Math.abs(exponent));
  return rawPrice / divisor;
}

export async function fetchAllPrices(): Promise<Record<string, ServerPrice>> {
  const raw = await serverGet<Record<string, unknown>>("/prices");

  const result: Record<string, ServerPrice> = {};
  if (!raw || typeof raw !== "object") return result;

  // Flash API returns { SOL: {...}, BTC: {...}, ... }
  for (const [symbol, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const price = parseOraclePrice(e);
    if (!symbol || price <= 0) continue;

    result[symbol] = {
      symbol,
      price,
      confidence: safeFloat(e.confidence),
      timestamp: safeFloat(e.timestampUs) ? safeFloat(e.timestampUs) / 1000 : Date.now(),
    };
  }

  // Populate server-side price cache for fast path (non-blocking, no exceptions)
  try {
    updatePriceCache(result);
  } catch {}

  return result;
}

export async function fetchPrice(market: string): Promise<ServerPrice | null> {
  try {
    const raw = await serverGet<Record<string, unknown>>(`/prices/${encodeURIComponent(market)}`);

    const price = parseOraclePrice(raw);
    if (price <= 0) return null;

    return {
      symbol: market,
      price,
      confidence: safeFloat(raw.confidence),
      timestamp: safeFloat(raw.timestampUs) ? safeFloat(raw.timestampUs) / 1000 : Date.now(),
    };
  } catch {
    return null;
  }
}

export interface ServerPosition {
  pubkey: string;
  market: string;
  collateral_token: string;
  side: "LONG" | "SHORT";
  entry_price: number;
  mark_price: number;
  size_usd: number;
  collateral_usd: number;
  leverage: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  liquidation_price: number;
  fees: number;
  timestamp: number;
}

export async function fetchPositions(wallet: string): Promise<ServerPosition[]> {
  if (!wallet) return [];

  const raw = await serverGet<Record<string, unknown>[]>(
    `/positions/owner/${encodeURIComponent(wallet)}?includePnlInLeverageDisplay=true`,
  );

  if (!Array.isArray(raw)) return [];

  // Fetch current prices to fill mark_price (API doesn't return it)
  const priceMap: Record<string, number> = {};
  try {
    const allPrices = await fetchAllPrices();
    for (const [sym, p] of Object.entries(allPrices)) {
      priceMap[sym] = p.price;
    }
  } catch {}

  return raw
    .map((p) => {
      const market = String(p.marketSymbol || p.market || "");
      return {
        pubkey: String(p.key || p.pubkey || ""),
        market,
        collateral_token: String(p.collateralSymbol || p.marketSymbol || p.market || ""),
        side: (String(p.sideUi || p.side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
        entry_price: safeFloat(p.entryPriceUi ?? p.entryPrice),
        mark_price: safeFloat(p.markPriceUi ?? p.markPrice) || priceMap[market] || 0,
        size_usd: safeFloat(p.sizeUsdUi ?? p.sizeUsd),
        collateral_usd: safeFloat(p.collateralUsdUi ?? p.collateralUsd),
        leverage: safeFloat(p.leverageUi ?? p.leverage),
        unrealized_pnl: safeFloat(p.pnlWithFeeUsdUi ?? p.unrealizedPnl),
        unrealized_pnl_pct: safeFloat(p.pnlPercentageWithFee ?? p.unrealizedPnlPercent),
        liquidation_price: safeFloat(p.liquidationPriceUi ?? p.liquidationPrice),
        fees: safeFloat(p.fees),
        timestamp: safeFloat(p.timestamp, Date.now()),
      };
    })
    .filter((p) => p.market && p.size_usd > 0 && p.entry_price > 0);
}

export interface ServerPortfolio {
  wallet_address: string;
  positions: ServerPosition[];
  total_collateral: number;
  total_unrealized_pnl: number;
  total_exposure: number;
  position_count: number;
}

// ---- Trade Preview (uses Flash API pool data for accurate fees + liquidation) ----

export interface TradePreviewResult {
  entry_price: number;
  liquidation_price: number;
  position_size: number;
  fees: number;
  fee_rate: number;
}

export async function fetchTradePreview(
  market: string,
  side: "LONG" | "SHORT",
  collateral_usd: number,
  leverage: number,
): Promise<TradePreviewResult | null> {
  try {
    // Fetch price from Flash API
    const priceData = await fetchPrice(market);
    if (!priceData || priceData.price <= 0) return null;

    const entry_price = priceData.price;
    const position_size = collateral_usd * leverage;

    // Flash Trade fee + liquidation model:
    // - Base fee: 8 bps (0.08%) — shown in preview for transparency
    // - Maintenance margin: 0.5% at normal leverage, scaled down at high
    //   leverage (MMR must be < 1/lev or the position liquidates on open).
    //   At 500x MMR caps at 0.1%, so liq distance = 0.2% - 0.1% = 0.1%.
    //
    // Note: fees are not subtracted from collateral in the liq formula —
    // at high leverage a flat 8 bps fee would consume ~40% of collateral
    // (500x × 8 bps = 4% of position size = 40% of collateral), distorting
    // the liquidation distance. Flash charges fees as a separate accounting
    // entry, not a pre-trade collateral reduction. This matches the fast-
    // path and buildTrade fallback formulas.
    const BASE_FEE_BPS = 8;
    const MAINTENANCE_MARGIN_RATE = Math.min(0.005, 0.5 / leverage);

    const fee_rate = BASE_FEE_BPS / 10000;
    const fees = position_size * fee_rate;

    const liquidation_price =
      side === "LONG"
        ? entry_price * (1 - 1 / leverage + MAINTENANCE_MARGIN_RATE)
        : entry_price * (1 + 1 / leverage - MAINTENANCE_MARGIN_RATE);

    return {
      entry_price,
      liquidation_price: Math.max(0, liquidation_price),
      position_size,
      fees,
      fee_rate,
    };
  } catch {
    return null;
  }
}

export async function fetchPortfolio(wallet: string): Promise<ServerPortfolio> {
  const positions = await fetchPositions(wallet);

  let total_collateral = 0;
  let total_unrealized_pnl = 0;
  let total_exposure = 0;

  for (const p of positions) {
    total_collateral += p.collateral_usd;
    total_unrealized_pnl += p.unrealized_pnl;
    total_exposure += p.size_usd;
  }

  return {
    wallet_address: wallet,
    positions,
    total_collateral,
    total_unrealized_pnl,
    total_exposure,
    position_count: positions.length,
  };
}
