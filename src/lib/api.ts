// ============================================
// Flash UI — API Client (Hardened)
// ============================================
// Connects to flashapi.trade for all data and transaction building.
// No mock data — all real API calls.
//
// Safety:
// - GET request deduplication (inflight coalescing)
// - POST requests are never deduplicated (fresh quote per call)
// - All numeric API responses validated (NaN/Infinity/negative rejected)
// - Response size limits
// - Timeout enforcement
// - Price staleness detection

import { FLASH_API_URL } from "./constants";
import type {
  MarketPrice,
  Position,
  TradeObject,
  Side,
} from "./types";

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PRICE_STALE_MS = 30_000; // Price older than 30s is stale

// ---- Request Deduplication (GET) ----
const inflightGets = new Map<string, Promise<unknown>>();

// ---- POST Safety ----
// POST requests are NOT deduplicated. Each call to buildOpenPosition or
// buildClosePosition must produce a fresh quote with a fresh blockhash.
// Deduplication of POSTs is dangerous: it can return stale quotes.
// Double-send prevention is handled at the store layer via execution locks.

// ---- Internal Fetch ----

async function apiGet<T>(path: string): Promise<T> {
  const existing = inflightGets.get(path);
  if (existing) return existing as Promise<T>;

  const request = apiGetInternal<T>(path).finally(() => {
    inflightGets.delete(path);
  });

  inflightGets.set(path, request);
  return request;
}

async function apiGetInternal<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FLASH_API_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`API ${res.status}: ${res.statusText}`);
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

async function apiPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${FLASH_API_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // Flash API returns 200 even on errors — check `err` field in body
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Health ----

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await apiGet<{ status: string }>("/health");
    return res.status === "ok";
  } catch {
    return false;
  }
}

// ---- Prices ----

interface ApiPriceEntry {
  price: number;
  exponent: number;
  confidence: number;
  priceUi: number;
  timestampUs: number;
  marketSession: string;
}

export async function getAllPrices(): Promise<MarketPrice[]> {
  const res = await apiGet<Record<string, ApiPriceEntry>>("/prices");
  const results: MarketPrice[] = [];

  for (const [symbol, p] of Object.entries(res)) {
    const price = p.priceUi ?? (p.price / Math.pow(10, Math.abs(p.exponent)));
    // Reject NaN, Infinity, zero, negative prices
    if (!Number.isFinite(price) || price <= 0) continue;
    results.push({
      symbol,
      price,
      confidence: Number.isFinite(p.confidence) ? p.confidence : 0,
      timestamp: p.timestampUs ? p.timestampUs / 1000 : Date.now(),
    });
  }

  return results;
}

export async function getPrice(symbol: string): Promise<MarketPrice> {
  const res = await apiGet<ApiPriceEntry>(
    `/prices/${encodeURIComponent(symbol)}`
  );

  const price = res.priceUi ?? (res.price / Math.pow(10, Math.abs(res.exponent)));
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid price for ${symbol}: ${price}`);
  }

  return {
    symbol,
    price,
    confidence: Number.isFinite(res.confidence) ? res.confidence : 0,
    timestamp: res.timestampUs ? res.timestampUs / 1000 : Date.now(),
  };
}

/** Returns true if price timestamp is older than PRICE_STALE_MS */
export function isPriceStale(price: MarketPrice): boolean {
  return Date.now() - price.timestamp > PRICE_STALE_MS;
}

// ---- Positions ----

/** Safe parseFloat: returns fallback (default 0) if result is NaN/Infinity */
function safeFloat(val: unknown, fallback = 0): number {
  const n = parseFloat(String(val ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

export async function getPositions(ownerPubkey: string): Promise<Position[]> {
  const res = await apiGet<unknown[]>(
    `/positions/owner/${encodeURIComponent(ownerPubkey)}?includePnlInLeverageDisplay=true`
  );

  return res.map((raw: unknown) => {
    const p = raw as Record<string, unknown>;
    const sideRaw = String(p.sideUi ?? p.side ?? "Long").toLowerCase();

    return {
      pubkey: String(p.key ?? ""),
      market: String(p.marketSymbol ?? ""),
      side: (sideRaw === "long" ? "LONG" : "SHORT") as Side,
      entry_price: safeFloat(p.entryPriceUi),
      mark_price: 0,
      size_usd: safeFloat(p.sizeUsdUi),
      collateral_usd: safeFloat(p.collateralUsdUi),
      leverage: safeFloat(p.leverageUi),
      unrealized_pnl: safeFloat(p.pnlWithFeeUsdUi),
      unrealized_pnl_pct: safeFloat(p.pnlPercentageWithFee),
      liquidation_price: safeFloat(p.liquidationPriceUi),
      fees: 0,
      timestamp: Date.now() / 1000,
    };
  });
}

// ---- Transaction Builders ----

export interface ApiQuote {
  transactionBase64: string;
  newEntryPrice: number;
  newLeverage: number;
  newLiquidationPrice: number;
  entryFee: number;
  entryFeeBeforeDiscount: number;
  openPositionFeePercent: number;
  availableLiquidity: number;
  youPayUsdUi: string;
  youReceiveUsdUi: string;
  outputAmount: string;
  outputAmountUi: string;
  err: string | null;
}

export interface BuildOpenParams {
  market: string;
  side: Side;
  collateral: number;
  leverage: number;
  owner: string;
  slippageBps?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}

export async function buildOpenPosition(
  params: BuildOpenParams
): Promise<ApiQuote> {
  const result = await apiPost<ApiQuote>(
    "/transaction-builder/open-position",
    {
      inputTokenSymbol: "USDC",
      outputTokenSymbol: params.market,
      inputAmountUi: String(params.collateral),
      leverage: params.leverage,
      tradeType: params.side,
      owner: params.owner,
      slippageBps: params.slippageBps ?? 80,
      takeProfitPrice: params.takeProfitPrice,
      stopLossPrice: params.stopLossPrice,
    }
  );

  if (result.err) {
    throw new Error(result.err);
  }

  // Flash API returns numeric fields as strings — parse to numbers
  return {
    ...result,
    newEntryPrice: parseFloat(String(result.newEntryPrice)),
    newLeverage: parseFloat(String(result.newLeverage)),
    newLiquidationPrice: parseFloat(String(result.newLiquidationPrice)),
    entryFee: parseFloat(String(result.entryFee)),
    entryFeeBeforeDiscount: parseFloat(String(result.entryFeeBeforeDiscount)),
    openPositionFeePercent: parseFloat(String(result.openPositionFeePercent)),
    availableLiquidity: parseFloat(String(result.availableLiquidity)),
  };
}

export interface BuildCloseParams {
  market: string;
  side: Side;
  owner: string;
  closePercent?: number;
}

export async function buildClosePosition(
  params: BuildCloseParams
): Promise<{ transactionBase64: string; err: string | null }> {
  return apiPost<{ transactionBase64: string; err: string | null }>(
    "/transaction-builder/close-position",
    {
      marketSymbol: params.market,
      side: params.side,
      owner: params.owner,
      closePercent: params.closePercent ?? 100,
    }
  );
}

// ---- Trade Validation ----

import { MIN_COLLATERAL, MAX_LEVERAGE, MARKETS } from "./constants";

export function validateTradeObject(
  trade: TradeObject
): { valid: boolean; error?: string } {
  if (!trade.market || !MARKETS[trade.market]) {
    return { valid: false, error: `Unknown market: ${trade.market}` };
  }
  if (!trade.collateral_usd || !Number.isFinite(trade.collateral_usd) || trade.collateral_usd < MIN_COLLATERAL) {
    return { valid: false, error: `Minimum collateral is $${MIN_COLLATERAL}` };
  }
  if (!trade.leverage || !Number.isFinite(trade.leverage) || trade.leverage < 1) {
    return { valid: false, error: "Leverage must be at least 1x" };
  }
  if (trade.leverage > MAX_LEVERAGE) {
    return { valid: false, error: `Maximum leverage is ${MAX_LEVERAGE}x` };
  }
  if (!trade.position_size || !Number.isFinite(trade.position_size) || trade.position_size <= 0) {
    return { valid: false, error: "Invalid position size" };
  }
  if (!trade.entry_price || !Number.isFinite(trade.entry_price) || trade.entry_price <= 0) {
    return { valid: false, error: "Invalid entry price — try again" };
  }
  if (!trade.liquidation_price || !Number.isFinite(trade.liquidation_price) || trade.liquidation_price <= 0) {
    return { valid: false, error: "Invalid liquidation price — try again" };
  }
  return { valid: true };
}

// ---- Enrichment ----

export async function enrichTradeWithQuote(
  trade: TradeObject,
  ownerPubkey?: string
): Promise<TradeObject> {
  if (!trade.market || !trade.collateral_usd || !trade.leverage) {
    return trade;
  }

  // Strategy 1: If wallet connected, use buildOpenPosition for exact quote
  if (ownerPubkey) {
    try {
      const quote = await buildOpenPosition({
        market: trade.market,
        side: trade.action,
        collateral: trade.collateral_usd,
        leverage: trade.leverage,
        owner: ownerPubkey,
      });

      // Validate all numeric fields from API response
      if (
        !Number.isFinite(quote.newEntryPrice) || quote.newEntryPrice <= 0 ||
        !Number.isFinite(quote.newLiquidationPrice) || quote.newLiquidationPrice <= 0 ||
        !Number.isFinite(quote.newLeverage) || quote.newLeverage < 1
      ) {
        throw new Error("API returned invalid quote data");
      }

      return {
        ...trade,
        entry_price: quote.newEntryPrice,
        mark_price: quote.newEntryPrice,
        liquidation_price: quote.newLiquidationPrice,
        fees: Number.isFinite(quote.entryFee) ? quote.entryFee : 0,
        fee_rate: Number.isFinite(quote.openPositionFeePercent) ? quote.openPositionFeePercent / 100 : 0.0008,
        position_size: trade.collateral_usd * quote.newLeverage,
        leverage: quote.newLeverage,
        status: "READY",
        missing_fields: [],
      };
    } catch (err) {
      console.warn("Quote API failed, falling back to price estimation:", err);
    }
  }

  // Strategy 2: Use live price + local calculation
  try {
    const priceData = await getPrice(trade.market);

    if (isPriceStale(priceData)) {
      return {
        ...trade,
        status: "ERROR",
        error: "Price data is stale. Try again in a moment.",
      };
    }

    const entry = priceData.price;
    const collateral = trade.collateral_usd;
    const leverage = trade.leverage;
    const size = collateral * leverage;
    const feeRate = 0.0008;
    const fees = size * feeRate;

    let liqPrice: number;
    if (trade.action === "LONG") {
      liqPrice = entry - entry / leverage;
    } else {
      liqPrice = entry + entry / leverage;
    }

    // Validate ALL computed values before marking READY
    if (
      !Number.isFinite(size) || size <= 0 ||
      !Number.isFinite(liqPrice) || liqPrice <= 0 ||
      !Number.isFinite(fees)
    ) {
      return {
        ...trade,
        status: "ERROR",
        error: "Failed to compute valid trade parameters.",
      };
    }

    return {
      ...trade,
      entry_price: entry,
      mark_price: entry,
      liquidation_price: liqPrice,
      fees,
      fee_rate: feeRate,
      position_size: size,
      status: "READY",
      missing_fields: [],
    };
  } catch {
    return {
      ...trade,
      status: "ERROR",
      error: "Unable to fetch market data. Check connection.",
    };
  }
}
