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

const FRESH_MS = 2_000; // <2s = fresh, use directly
const MAX_AGE_MS = 30_000; // >30s = expired, reject
const MAX_ENTRIES = 200; // upper bound to prevent unbounded growth

// ---- Metrics (module-level, non-blocking) ----
export const metrics = {
  hits: 0,
  misses: 0,
  stale: 0,
  expired: 0,
  drifts: 0, // price moved >5% between cache updates
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

// ---- Drift detection: if new price deviates >5% from cached, log it ----
const DRIFT_THRESHOLD = 0.05; // 5%

/**
 * Update the price cache. Called from warmCache/fetchAllPrices.
 * Non-blocking, no exceptions.
 * Detects abnormal price drift and logs it.
 */
export function updatePriceCache(allPrices: Record<string, { price: number }>): void {
  const now = Date.now();
  for (const [symbol, data] of Object.entries(allPrices)) {
    if (data && Number.isFinite(data.price) && data.price > 0) {
      // Atomic check-and-set (JS is single-threaded for sync code blocks)
      const existing = prices.get(symbol);
      const newEntry = { price: data.price, timestamp: now };
      prices.set(symbol, newEntry); // Set first, then check drift
      if (existing && existing.price > 0 && data.price > 0) {
        const drift = Math.abs(data.price - existing.price) / existing.price;
        if (drift > DRIFT_THRESHOLD) {
          metrics.drifts++;
        }
      }
    }
  }

  // Evict oldest entries if cache exceeds cap
  if (prices.size > MAX_ENTRIES) {
    const sorted = [...prices.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = sorted.slice(0, prices.size - MAX_ENTRIES);
    for (const [key] of toDelete) {
      prices.delete(key);
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
