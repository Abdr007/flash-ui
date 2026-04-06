// ============================================
// Flash AI — Server-Side Price Cache (Module-Level)
// ============================================
// In-memory price cache populated by chat route warmup.
// Fast path reads this SYNCHRONOUSLY — zero network dependency.
//
// Freshness: prices <2s old are used directly.
// Stale prices (2-30s) are returned but the fast path marks them degraded.
// Expired prices (>30s) are rejected — fast path falls back to AI.
//
// Population: called from warmCache() and fetchAllPrices() in chat route.

export interface CachedPrice {
  price: number;
  timestamp: number; // Date.now() when cached
}

// Module-level — survives across requests within same serverless instance
const prices = new Map<string, CachedPrice>();

const FRESH_MS = 2_000;   // <2s = fresh, use directly
const MAX_AGE_MS = 30_000; // >30s = expired, reject

// ---- Metrics (module-level, non-blocking) ----
export const metrics = {
  hits: 0,
  misses: 0,
  stale: 0,
  expired: 0,
};

/**
 * Get a cached price synchronously. Zero network, zero async.
 * Returns null if no price or expired (>30s).
 * Returns { price, fresh } where fresh=false means 2-30s old.
 */
export function getCachedPrice(market: string): { price: number; fresh: boolean } | null {
  const entry = prices.get(market);
  if (!entry) {
    metrics.misses++;
    return null;
  }

  const age = Date.now() - entry.timestamp;
  if (age > MAX_AGE_MS) {
    metrics.expired++;
    return null; // Too old — can't trust it
  }

  if (age <= FRESH_MS) {
    metrics.hits++;
    return { price: entry.price, fresh: true };
  }

  // 2-30s: usable but stale
  metrics.stale++;
  return { price: entry.price, fresh: false };
}

/**
 * Update the price cache. Called from warmCache/fetchAllPrices.
 * Non-blocking, no exceptions.
 */
export function updatePriceCache(allPrices: Record<string, { price: number }>): void {
  const now = Date.now();
  for (const [symbol, data] of Object.entries(allPrices)) {
    if (data && Number.isFinite(data.price) && data.price > 0) {
      prices.set(symbol, { price: data.price, timestamp: now });
    }
  }
}

/**
 * Update a single market price.
 */
export function updateSinglePrice(market: string, price: number): void {
  if (Number.isFinite(price) && price > 0) {
    prices.set(market, { price, timestamp: Date.now() });
  }
}

/** Get all cached prices (for diagnostics) */
export function getCacheSnapshot(): Record<string, CachedPrice> {
  const result: Record<string, CachedPrice> = {};
  for (const [k, v] of prices) result[k] = v;
  return result;
}
