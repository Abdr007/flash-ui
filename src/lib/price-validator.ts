// ============================================
// Flash UI — Multi-Source Price Validation
// ============================================
// Compares primary oracle price against store's live price feed.
// Rejects if deviation exceeds threshold — prevents oracle manipulation.
//
// Sources:
// 1. Primary: Flash API /prices/{market} (used in build_trade)
// 2. Fallback: Store prices (Pyth SSE stream)
//
// If only one source available, accept with warning.
// If both available and deviate > threshold, HARD REJECT.

import { logInfo, logError } from "./logger";

// Max acceptable deviation between oracle sources (percentage)
const MAX_PRICE_DEVIATION_PCT = 1.5;

export interface PriceValidationResult {
  valid: boolean;
  price: number;
  source: "primary" | "fallback" | "both";
  deviation_pct?: number;
  warning?: string;
  error?: string;
}

/**
 * Validate a price against a secondary source.
 * Returns the validated price or an error.
 */
export function validatePrice(
  primaryPrice: number,
  fallbackPrice: number | null,
  market: string,
): PriceValidationResult {
  // Primary must be valid
  if (!Number.isFinite(primaryPrice) || primaryPrice <= 0) {
    if (fallbackPrice && Number.isFinite(fallbackPrice) && fallbackPrice > 0) {
      logInfo("system", {
        data: { action: "price_fallback", market, reason: "primary_invalid" },
      });
      return {
        valid: true,
        price: fallbackPrice,
        source: "fallback",
        warning: `Primary price invalid — using fallback ($${fallbackPrice.toFixed(2)})`,
      };
    }
    return {
      valid: false,
      price: 0,
      source: "primary",
      error: `No valid price available for ${market}`,
    };
  }

  // No fallback — accept primary with note
  if (!fallbackPrice || !Number.isFinite(fallbackPrice) || fallbackPrice <= 0) {
    return {
      valid: true,
      price: primaryPrice,
      source: "primary",
      warning: "Single price source — no cross-validation available",
    };
  }

  // Both available — cross-validate
  const deviation = (Math.abs(primaryPrice - fallbackPrice) / fallbackPrice) * 100;

  if (deviation > MAX_PRICE_DEVIATION_PCT) {
    logError("system", {
      data: {
        action: "price_deviation_rejected",
        market,
        primary: primaryPrice,
        fallback: fallbackPrice,
        deviation_pct: deviation.toFixed(2),
        threshold: MAX_PRICE_DEVIATION_PCT,
      },
    });
    return {
      valid: false,
      price: 0,
      source: "both",
      deviation_pct: deviation,
      error:
        `Price deviation ${deviation.toFixed(1)}% exceeds ${MAX_PRICE_DEVIATION_PCT}% threshold — ` +
        `primary $${primaryPrice.toFixed(2)} vs stream $${fallbackPrice.toFixed(2)}`,
    };
  }

  logInfo("system", {
    data: {
      action: "price_validated",
      market,
      deviation_pct: deviation.toFixed(2),
    },
  });

  return {
    valid: true,
    price: primaryPrice,
    source: "both",
    deviation_pct: deviation,
  };
}

// ---- Volatility Circuit Breaker ----

interface VolatilityEntry {
  prices: number[];
  timestamps: number[];
}

const volatilityHistory = new Map<string, VolatilityEntry>();
const VOLATILITY_WINDOW_MS = 60_000; // 1 minute window
const VOLATILITY_SPIKE_THRESHOLD_PCT = 8; // >8% move in 1 min = spike
const MAX_VOLATILITY_ENTRIES = 100;

/**
 * Feed a price tick into the volatility tracker.
 */
export function trackVolatility(market: string, price: number, timestamp: number): void {
  if (!Number.isFinite(price) || price <= 0) return;

  let entry = volatilityHistory.get(market);
  if (!entry) {
    if (volatilityHistory.size >= MAX_VOLATILITY_ENTRIES) {
      const firstKey = volatilityHistory.keys().next().value;
      if (firstKey !== undefined) volatilityHistory.delete(firstKey);
    }
    entry = { prices: [], timestamps: [] };
    volatilityHistory.set(market, entry);
  }

  // Evict data older than window
  const cutoff = timestamp - VOLATILITY_WINDOW_MS;
  while (entry.timestamps.length > 0 && entry.timestamps[0] < cutoff) {
    entry.timestamps.shift();
    entry.prices.shift();
  }

  entry.prices.push(price);
  entry.timestamps.push(timestamp);
}

/**
 * Check if a market is in a volatility spike.
 * Returns true if trading should be blocked.
 */
export function isVolatilitySpike(market: string): { spiked: boolean; range_pct: number } {
  const entry = volatilityHistory.get(market);
  if (!entry || entry.prices.length < 3) {
    return { spiked: false, range_pct: 0 };
  }

  let high = -Infinity;
  let low = Infinity;
  for (const p of entry.prices) {
    if (p > high) high = p;
    if (p < low) low = p;
  }

  const range_pct = ((high - low) / low) * 100;
  return {
    spiked: range_pct > VOLATILITY_SPIKE_THRESHOLD_PCT,
    range_pct,
  };
}
