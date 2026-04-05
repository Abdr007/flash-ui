// ============================================
// Flash AI — L3 Server Cache (Wallet-Isolated)
// ============================================
// ALL cache keys are wallet-scoped to prevent cross-wallet leakage.
// Format: ${tool}:${wallet}:${paramsHash}
//
// Stale data returned as degraded fallback when API fails.

import { logInfo, logWarn } from "@/lib/logger";

interface CacheEntry<T = unknown> {
  data: T;
  expires: number;
  stale: boolean;
  wallet: string;
}

const store = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500; // [F1] Prevent unbounded growth

export const TTL = {
  prices: 3_000,
  positions: 5_000,
  portfolio: 10_000,
  market_info: 15_000,
} as const;

const LATENCY_DEGRADED_MS = 2_000;

// ---- Wallet-Scoped Key Builder ----

export function cacheKey(tool: string, wallet: string, extra?: string): string {
  const suffix = extra ? `:${extra}` : "";
  return `${tool}:${wallet}${suffix}`;
}

// ---- Core Operations ----

export function cacheGet<T>(key: string): CacheEntry<T> | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;

  if (Date.now() > entry.expires) {
    entry.stale = true;
    return entry;
  }

  entry.stale = false;
  return entry;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number, wallet: string): void {
  // [F1] Evict oldest if at capacity
  if (store.size >= MAX_CACHE_ENTRIES && !store.has(key)) {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
  store.set(key, {
    data,
    expires: Date.now() + ttlMs,
    stale: false,
    wallet,
  });
}

// ---- Fetch-Through with Latency Guard ----

/**
 * Get from cache or fetch fresh. Enforces:
 * - Wallet isolation (key includes wallet)
 * - Stale fallback on API failure
 * - Latency guard: >2s returns degraded with cached data
 */
export async function cacheFetchThrough<T>(
  key: string,
  ttlMs: number,
  wallet: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; status: "success" | "degraded" | "error"; latency_ms: number }> {
  const start = performance.now();

  // Check cache first
  const cached = cacheGet<T>(key);
  if (cached && !cached.stale) {
    logInfo("cache_hit", { data: { key }, wallet });
    return {
      data: cached.data,
      status: "success",
      latency_ms: Math.round(performance.now() - start),
    };
  }

  // Cache miss or stale — fetch fresh with latency guard
  try {
    const fresh = await fetcher();
    const latency_ms = Math.round(performance.now() - start);

    cacheSet(key, fresh, ttlMs, wallet);

    // Latency guard: if fetch took >2s, mark as degraded
    if (latency_ms > LATENCY_DEGRADED_MS) {
      logWarn("cache_miss", {
        data: { key, latency_ms, degraded: true },
        wallet,
      });
      return { data: fresh, status: "degraded", latency_ms };
    }

    logInfo("cache_miss", { data: { key, fresh: true }, wallet });
    return { data: fresh, status: "success", latency_ms };
  } catch (err) {
    const latency_ms = Math.round(performance.now() - start);

    // Stale fallback
    if (cached) {
      logWarn("cache_miss", {
        data: { key, stale_fallback: true },
        error: err instanceof Error ? err.message : String(err),
        wallet,
      });
      return { data: cached.data, status: "degraded", latency_ms };
    }

    return { data: null as T, status: "error", latency_ms };
  }
}

// ---- Cache Warmup (Wallet-Scoped) ----

export async function warmCache(
  wallet: string,
  fetchPrices: () => Promise<unknown>,
  fetchPositions: (wallet: string) => Promise<unknown>,
): Promise<void> {
  if (!wallet) return;

  const priceKey = cacheKey("prices", wallet);
  const posKey = cacheKey("positions", wallet);

  const pricesCached = cacheGet(priceKey);
  const positionsCached = cacheGet(posKey);

  const tasks: Promise<void>[] = [];

  if (!pricesCached || pricesCached.stale) {
    tasks.push(
      fetchPrices()
        .then((data) => cacheSet(priceKey, data, TTL.prices, wallet))
        .catch(() => {}),
    );
  }

  if (!positionsCached || positionsCached.stale) {
    tasks.push(
      fetchPositions(wallet)
        .then((data) => cacheSet(posKey, data, TTL.positions, wallet))
        .catch(() => {}),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}
