// ============================================
// Flash UI — Market Awareness Engine
// ============================================
// Generates market signals from price data to inform suggestions.
// Uses short-term price movement to detect momentum/reversal.
//
// Signals:
// - MOMENTUM_LONG: price up significantly → favor long
// - MOMENTUM_SHORT: price down significantly → favor short
// - VOLATILE: large moves → increase caution
// - STABLE: low movement → normal trading
//
// No external API calls — derives everything from PriceStream data.

import type { MarketPrice } from "./types";

// ---- Types ----

export type SignalType = "MOMENTUM_LONG" | "MOMENTUM_SHORT" | "VOLATILE" | "STABLE";

export interface MarketSignal {
  market: string;
  signal: SignalType;
  strength: number; // 0–100
  description: string;
  tradeBias: "long" | "short" | "neutral";
  priorityBoost: number; // Added to suggestion priority
}

// ---- Price History (in-memory ring buffer) ----

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

const priceHistory = new Map<string, PriceSnapshot[]>();
const MAX_HISTORY_PER_MARKET = 60; // ~5 min at 5s intervals
const MIN_SNAPSHOTS = 6; // Need at least 30s of data

/**
 * Feed a price update into the awareness engine.
 * Called from handleStreamPrices or refreshPrices.
 */
export function feedPrice(symbol: string, price: number, timestamp: number): void {
  if (!Number.isFinite(price) || price <= 0) return;

  let history = priceHistory.get(symbol);
  if (!history) {
    history = [];
    priceHistory.set(symbol, history);
  }

  // Deduplicate (skip if same timestamp)
  if (history.length > 0 && history[history.length - 1].timestamp >= timestamp) return;

  history.push({ price, timestamp });

  // Ring buffer eviction
  if (history.length > MAX_HISTORY_PER_MARKET) {
    history.shift();
  }
}

/**
 * Batch feed from price stream.
 */
export function feedPrices(prices: Record<string, MarketPrice>): void {
  for (const [symbol, p] of Object.entries(prices)) {
    feedPrice(symbol, p.price, p.timestamp);
  }
}

// ---- Signal Generation ----

// Thresholds (percentage change)
const MOMENTUM_THRESHOLD = 2.0; // >2% = momentum
const VOLATILITY_THRESHOLD = 4.0; // >4% range = volatile
const STRONG_MOMENTUM = 5.0; // >5% = strong signal

/**
 * Get market signal for a specific market.
 * Returns null if insufficient data.
 */
export function getMarketSignal(market: string): MarketSignal | null {
  const history = priceHistory.get(market);
  if (!history || history.length < MIN_SNAPSHOTS) return null;

  const oldest = history[0];
  const newest = history[history.length - 1];
  const changePct = ((newest.price - oldest.price) / oldest.price) * 100;

  // Calculate range (high - low) for volatility
  let high = -Infinity;
  let low = Infinity;
  for (const snap of history) {
    if (snap.price > high) high = snap.price;
    if (snap.price < low) low = snap.price;
  }
  const rangePct = ((high - low) / low) * 100;

  // Determine signal
  if (rangePct > VOLATILITY_THRESHOLD) {
    return {
      market,
      signal: "VOLATILE",
      strength: Math.min(Math.round(rangePct * 10), 100),
      description: `${market} volatile — ${rangePct.toFixed(1)}% range`,
      tradeBias: "neutral",
      priorityBoost: -5, // Reduce priority for volatile markets
    };
  }

  if (changePct > STRONG_MOMENTUM) {
    return {
      market,
      signal: "MOMENTUM_LONG",
      strength: Math.min(Math.round(changePct * 10), 100),
      description: `${market} +${changePct.toFixed(1)}% — strong momentum`,
      tradeBias: "long",
      priorityBoost: 15,
    };
  }

  if (changePct > MOMENTUM_THRESHOLD) {
    return {
      market,
      signal: "MOMENTUM_LONG",
      strength: Math.min(Math.round(changePct * 10), 100),
      description: `${market} +${changePct.toFixed(1)}%`,
      tradeBias: "long",
      priorityBoost: 10,
    };
  }

  if (changePct < -STRONG_MOMENTUM) {
    return {
      market,
      signal: "MOMENTUM_SHORT",
      strength: Math.min(Math.round(Math.abs(changePct) * 10), 100),
      description: `${market} ${changePct.toFixed(1)}% — consider closing longs`,
      tradeBias: "short",
      priorityBoost: 10,
    };
  }

  if (changePct < -MOMENTUM_THRESHOLD) {
    return {
      market,
      signal: "MOMENTUM_SHORT",
      strength: Math.min(Math.round(Math.abs(changePct) * 10), 100),
      description: `${market} ${changePct.toFixed(1)}%`,
      tradeBias: "short",
      priorityBoost: 5,
    };
  }

  return {
    market,
    signal: "STABLE",
    strength: 50,
    description: `${market} stable`,
    tradeBias: "neutral",
    priorityBoost: 0,
  };
}

/**
 * Get all active signals across tracked markets.
 * Returns only non-STABLE signals, sorted by strength.
 */
export function getActiveSignals(): MarketSignal[] {
  const signals: MarketSignal[] = [];

  for (const market of priceHistory.keys()) {
    const signal = getMarketSignal(market);
    if (signal && signal.signal !== "STABLE") {
      signals.push(signal);
    }
  }

  signals.sort((a, b) => b.strength - a.strength);
  return signals;
}

/**
 * Get priority boost for a specific market + side combination.
 * Momentum alignment boosts priority, misalignment reduces it.
 */
export function getMarketBiasBoost(market: string, side: "LONG" | "SHORT"): number {
  const signal = getMarketSignal(market);
  if (!signal) return 0;

  // Aligned with momentum → boost
  if (signal.tradeBias === "long" && side === "LONG") return signal.priorityBoost;
  if (signal.tradeBias === "short" && side === "SHORT") return signal.priorityBoost;

  // Counter-momentum → reduce
  if (signal.tradeBias === "long" && side === "SHORT") return -signal.priorityBoost;
  if (signal.tradeBias === "short" && side === "LONG") return -signal.priorityBoost;

  return 0;
}

/**
 * Should we warn about closing a position given market conditions?
 * Returns warning message or null.
 */
export function getPositionWarning(
  market: string,
  side: "LONG" | "SHORT",
): string | null {
  const signal = getMarketSignal(market);
  if (!signal) return null;

  // Long position in strong downtrend
  if (side === "LONG" && signal.signal === "MOMENTUM_SHORT" && signal.strength > 30) {
    return `${market} trending down — consider reducing long exposure`;
  }

  // Short position in strong uptrend
  if (side === "SHORT" && signal.signal === "MOMENTUM_LONG" && signal.strength > 30) {
    return `${market} trending up — consider reducing short exposure`;
  }

  // Volatile market
  if (signal.signal === "VOLATILE" && signal.strength > 50) {
    return `${market} highly volatile — increased liquidation risk`;
  }

  return null;
}
