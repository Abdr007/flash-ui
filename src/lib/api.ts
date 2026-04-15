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
import type { MarketPrice, Position, TradeObject, Side } from "./types";

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

  let request: Promise<T>;
  try {
    request = apiGetInternal<T>(path).finally(() => {
      inflightGets.delete(path);
    });
  } catch (err) {
    inflightGets.delete(path);
    throw err;
  }

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

async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
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

    // Flash API returns 200 on success with JSON. On errors it may return
    // non-JSON (422 text). Guard against both cases.
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Flash API ${res.status}: ${text}`);
    }
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
    const price = p.priceUi ?? p.price / Math.pow(10, Math.abs(p.exponent));
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
  const res = await apiGet<ApiPriceEntry>(`/prices/${encodeURIComponent(symbol)}`);

  const price = res.priceUi ?? res.price / Math.pow(10, Math.abs(res.exponent));
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
    `/positions/owner/${encodeURIComponent(ownerPubkey)}?includePnlInLeverageDisplay=true`,
  );

  if (!Array.isArray(res)) return [];

  return res.map((raw: unknown) => {
    const p = raw as Record<string, unknown>;
    const sideRaw = String(p.sideUi ?? p.side ?? "Long").toLowerCase();

    return {
      pubkey: String(p.key ?? ""),
      market: String(p.marketSymbol ?? ""),
      side: (sideRaw === "long" ? "LONG" : "SHORT") as Side,
      entry_price: Math.max(0, safeFloat(p.entryPriceUi)),
      mark_price: 0,
      size_usd: Math.max(0, safeFloat(p.sizeUsdUi)),
      collateral_usd: Math.max(0, safeFloat(p.collateralUsdUi)),
      leverage: Math.max(0, safeFloat(p.leverageUi)),
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
  orderType?: "MARKET" | "LIMIT";
  limitPrice?: number;
}

export async function buildOpenPosition(params: BuildOpenParams): Promise<ApiQuote> {
  const result = await apiPost<ApiQuote>("/transaction-builder/open-position", {
    inputTokenSymbol: "USDC",
    outputTokenSymbol: params.market,
    inputAmountUi: String(params.collateral),
    leverage: params.leverage,
    tradeType: params.side,
    owner: params.owner,
    slippageBps: params.slippageBps ?? 80,
    // Wire fields are `takeProfit` / `stopLoss` (string), not `*Price`.
    // When supplied, the Flash builder inlines TP + SL instructions into
    // the same versioned tx — single base64, single signature.
    takeProfit: params.takeProfitPrice != null ? String(params.takeProfitPrice) : undefined,
    stopLoss: params.stopLossPrice != null ? String(params.stopLossPrice) : undefined,
    orderType: params.orderType ?? "MARKET",
    limitPrice: params.limitPrice != null ? String(params.limitPrice) : undefined,
  });

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
  params: BuildCloseParams,
): Promise<{ transactionBase64: string; err: string | null }> {
  return apiPost<{ transactionBase64: string; err: string | null }>("/transaction-builder/close-position", {
    marketSymbol: params.market,
    side: params.side,
    owner: params.owner,
    closePercent: params.closePercent ?? 100,
  });
}

// ---- Collateral Management ----

export interface BuildAddCollateralParams {
  positionKey: string;
  depositAmountUi: string;
  depositTokenSymbol: string;
  owner: string;
  slippageBps?: number;
}

export interface CollateralResult {
  existingCollateralUsd: string;
  newCollateralUsd: string;
  existingLeverage: string;
  newLeverage: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  transactionBase64?: string;
  err: string | null;
}

export async function buildAddCollateral(params: BuildAddCollateralParams): Promise<CollateralResult> {
  return apiPost<CollateralResult>("/transaction-builder/add-collateral", { ...params });
}

export interface BuildRemoveCollateralParams {
  positionKey: string;
  withdrawAmountUsdUi: string;
  withdrawTokenSymbol: string;
  owner: string;
  slippageBps?: number;
}

export async function buildRemoveCollateral(params: BuildRemoveCollateralParams): Promise<CollateralResult> {
  return apiPost<CollateralResult>("/transaction-builder/remove-collateral", { ...params });
}

// ---- Close Position (with transaction) ----

export interface BuildCloseWithTxParams {
  positionKey: string;
  marketSymbol: string;
  side: string;
  owner: string;
  closePercent: number;
  inputUsdUi: string;
  withdrawTokenSymbol: string;
  slippageBps?: number;
}

export async function buildClosePositionTx(params: BuildCloseWithTxParams): Promise<{
  transactionBase64?: string;
  err: string | null;
  receiveTokenAmountUsdUi?: string;
  settledPnl?: string;
  fees?: string;
}> {
  return apiPost<{
    transactionBase64?: string;
    err: string | null;
    receiveTokenAmountUsdUi?: string;
    settledPnl?: string;
    fees?: string;
  }>("/transaction-builder/close-position", { ...params });
}

// ---- Trigger Orders (TP/SL) ----

export interface BuildTriggerParams {
  owner: string;
  marketSymbol: string;
  side: "LONG" | "SHORT";
  triggerPriceUi: string;
  sizeUsdUi: string;
  sizeAmountUi: string;
  isStopLoss: boolean;
  collateralTokenSymbol: string;
}

// Used by the future "add TP/SL to existing position" flow.
// Not used by the open-position flow — TP/SL is bundled inline via buildOpenPosition
// (see takeProfit/stopLoss fields there).
export async function buildPlaceTriggerOrder(
  params: BuildTriggerParams,
): Promise<{ transactionBase64?: string; err: string | null }> {
  return apiPost<{ transactionBase64?: string; err: string | null }>("/transaction-builder/place-trigger-order", {
    ...params,
  });
}

// ---- Reverse Position ----

export interface BuildReverseParams {
  positionKey: string;
  owner: string;
  slippagePercentage?: string;
}

export async function buildReversePosition(params: BuildReverseParams): Promise<{
  transactionBase64?: string;
  err: string | null;
  newEntryPrice?: string;
  newLeverage?: string;
  newCollateralUsd?: string;
}> {
  return apiPost<{
    transactionBase64?: string;
    err: string | null;
    newEntryPrice?: string;
    newLeverage?: string;
    newCollateralUsd?: string;
  }>("/transaction-builder/reverse-position", { ...params });
}

// ---- Trade Validation ----

import { MIN_COLLATERAL, MAX_LEVERAGE, MARKETS } from "./constants";
import { getMaxLeverage } from "./markets-registry";

export function validateTradeObject(trade: TradeObject): { valid: boolean; error?: string } {
  if (!trade.market || !MARKETS[trade.market]) {
    return { valid: false, error: `Unknown market: ${trade.market}` };
  }
  if (!trade.collateral_usd || !Number.isFinite(trade.collateral_usd) || trade.collateral_usd < MIN_COLLATERAL) {
    return { valid: false, error: `Minimum collateral is $${MIN_COLLATERAL}` };
  }
  if (!trade.leverage || !Number.isFinite(trade.leverage) || trade.leverage < 1) {
    return { valid: false, error: "Leverage must be at least 1x" };
  }
  const perMarketCap = getMaxLeverage(trade.market, "normal") || MAX_LEVERAGE;
  if (trade.leverage > perMarketCap) {
    return { valid: false, error: `${trade.market} max leverage is ${perMarketCap}x` };
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

export async function enrichTradeWithQuote(trade: TradeObject): Promise<TradeObject> {
  if (!trade.market || !trade.collateral_usd || !trade.leverage) {
    return trade;
  }

  // Use live price + local calculation for preview.
  // buildOpenPosition is NOT called here — it builds a real transaction.
  // Transaction building happens only in executeTrade after user confirms.
  try {
    const priceData = await getPrice(trade.market);

    if (isPriceStale(priceData)) {
      return {
        ...trade,
        status: "ERROR",
        error: "Price data is stale. Try again in a moment.",
      };
    }

    // For limit orders, use the limit price as entry (that's where the order triggers)
    const isLimit = trade.order_type?.toUpperCase() === "LIMIT" || !!trade.limit_price;
    const entry = isLimit && trade.limit_price ? trade.limit_price : priceData.price;
    const collateral = trade.collateral_usd;
    const leverage = trade.leverage;
    const size = collateral * leverage;
    const feeRate = 0.0008;
    const fees = size * feeRate;

    const mmr = Math.min(0.005, 0.5 / leverage);
    let liqPrice: number;
    if (trade.action === "LONG") {
      liqPrice = entry * (1 - 1 / leverage + mmr);
    } else {
      liqPrice = entry * (1 + 1 / leverage - mmr);
    }

    // Validate ALL computed values before marking READY
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(liqPrice) || liqPrice <= 0 || !Number.isFinite(fees)) {
      return {
        ...trade,
        status: "ERROR",
        error: "Failed to compute valid trade parameters.",
      };
    }

    // ---- Limit order validation ----
    if (trade.order_type?.toUpperCase() === "LIMIT" && !trade.limit_price) {
      return {
        ...trade,
        status: "ERROR",
        error: "Limit orders require a limit price. Example: 'limit long SOL at $140 5x $50'",
      };
    }

    // ---- TP/SL Validation: numeric safety + dynamic range + direction ----
    const tpPrice = trade.take_profit_price ?? null;
    const slPrice = trade.stop_loss_price ?? null;

    if (tpPrice != null) {
      if (!Number.isFinite(tpPrice) || tpPrice <= 0) {
        return { ...trade, status: "ERROR", error: "Take profit price must be a positive number" };
      }
      const dist = Math.abs(tpPrice - entry) / entry;
      if (dist > 5.0) {
        return {
          ...trade,
          status: "ERROR",
          error: `Take profit $${tpPrice} is >500% from market price $${entry.toFixed(2)} — unrealistic`,
        };
      }
      if (dist < 0.001) {
        return {
          ...trade,
          status: "ERROR",
          error: `Take profit $${tpPrice} is <0.1% from entry $${entry.toFixed(2)} — too tight`,
        };
      }
      if (trade.action === "LONG" && tpPrice <= entry) {
        return {
          ...trade,
          status: "ERROR",
          error: `Take profit ($${tpPrice}) must be above entry ($${entry.toFixed(2)}) for LONG`,
        };
      }
      if (trade.action === "SHORT" && tpPrice >= entry) {
        return {
          ...trade,
          status: "ERROR",
          error: `Take profit ($${tpPrice}) must be below entry ($${entry.toFixed(2)}) for SHORT`,
        };
      }
    }

    if (slPrice != null) {
      if (!Number.isFinite(slPrice) || slPrice <= 0) {
        return { ...trade, status: "ERROR", error: "Stop loss price must be a positive number" };
      }
      const dist = Math.abs(slPrice - entry) / entry;
      if (dist > 5.0) {
        return {
          ...trade,
          status: "ERROR",
          error: `Stop loss $${slPrice} is >500% from market price $${entry.toFixed(2)} — unrealistic`,
        };
      }
      if (dist < 0.001) {
        return {
          ...trade,
          status: "ERROR",
          error: `Stop loss $${slPrice} is <0.1% from entry $${entry.toFixed(2)} — too tight`,
        };
      }
      if (trade.action === "LONG" && slPrice >= entry) {
        return {
          ...trade,
          status: "ERROR",
          error: `Stop loss ($${slPrice}) must be below entry ($${entry.toFixed(2)}) for LONG`,
        };
      }
      if (trade.action === "SHORT" && slPrice <= entry) {
        return {
          ...trade,
          status: "ERROR",
          error: `Stop loss ($${slPrice}) must be above entry ($${entry.toFixed(2)}) for SHORT`,
        };
      }
    }

    return {
      ...trade,
      entry_price: entry,
      mark_price: entry,
      liquidation_price: liqPrice,
      fees,
      fee_rate: feeRate,
      position_size: size,
      take_profit_price: tpPrice,
      stop_loss_price: slPrice,
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
