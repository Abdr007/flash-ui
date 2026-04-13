// ============================================
// Flash UI — Tool Deduplication + Replay Protection (Red-Team Hardened)
// ============================================
// Red-team fixes:
// - [F1] Bounded maps: max 1000 entries per map, LRU eviction
// - [RACE] Error propagation: failed in-flight promises removed from cache
// - [RACE] Dedup failure isolation: errors don't cache as successful results

// ---- Types ----

interface CachedResult {
  result: unknown;
  timestamp: number;
}

// ---- Configuration ----

const DEDUP_TTL_MS = 3_000;
const EVICTION_INTERVAL_MS = 60_000;
const REPLAY_TTL_MS = 30_000;
const MAX_MAP_SIZE = 1000; // [F1] Prevent unbounded growth

// ---- State ----

const recentCalls = new Map<string, CachedResult>();
const inFlight = new Map<string, Promise<unknown>>();
const processedRequestIds = new Map<string, number>();

let lastEviction = Date.now();

// ---- Bounded Map Helper ----

function boundedSet<V>(map: Map<string, V>, key: string, value: V): void {
  // [F1] If map is at capacity, delete oldest entry
  if (map.size >= MAX_MAP_SIZE && !map.has(key)) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
  map.set(key, value);
}

// ---- Eviction ----

function evictStale(): void {
  const now = Date.now();
  if (now - lastEviction < EVICTION_INTERVAL_MS) return;
  lastEviction = now;

  for (const [key, entry] of recentCalls) {
    if (now - entry.timestamp > EVICTION_INTERVAL_MS) {
      recentCalls.delete(key);
    }
  }

  for (const [id, ts] of processedRequestIds) {
    if (now - ts > REPLAY_TTL_MS) {
      processedRequestIds.delete(id);
    }
  }
}

// ---- Public API ----

export function makeDedupKey(toolName: string, params: Record<string, unknown>, wallet: string): string {
  const payload = `${toolName}:${JSON.stringify(params)}:${wallet}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `dedup_${Math.abs(hash).toString(36)}`;
}

export function makeRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Execute with dedup + in-flight locking.
 *
 * Red-team hardened:
 * - Failed promises are NOT cached as results
 * - Failed promises are removed from inFlight immediately
 * - Concurrent callers sharing a failed promise all get the error
 */
export async function dedup<T>(dedupKey: string, fn: () => Promise<T>): Promise<T> {
  evictStale();

  // Layer 1: In-flight locking
  const existing = inFlight.get(dedupKey);
  if (existing) {
    return existing as Promise<T>;
  }

  // Layer 2: TTL cache
  const cached = recentCalls.get(dedupKey);
  if (cached && Date.now() - cached.timestamp < DEDUP_TTL_MS) {
    return cached.result as T;
  }

  // Layer 3: Execute with error-safe in-flight tracking
  const promise = fn()
    .then((result) => {
      // Only cache successful results
      boundedSet(recentCalls, dedupKey, { result, timestamp: Date.now() });
      return result;
    })
    .catch((err) => {
      // [RACE] Do NOT cache failed results — allow retry
      recentCalls.delete(dedupKey);
      throw err;
    })
    .finally(() => {
      inFlight.delete(dedupKey);
    });

  inFlight.set(dedupKey, promise);
  return promise;
}

// ---- Replay Protection ----

export function isReplay(requestId: string): boolean {
  evictStale();

  if (processedRequestIds.has(requestId)) {
    return true;
  }

  boundedSet(processedRequestIds, requestId, Date.now());
  return false;
}

// ---- Tool Classification ----

const NO_DEDUP_TOOLS = new Set(["build_trade", "close_position_preview"]);

export function shouldDedup(toolName: string): boolean {
  return !NO_DEDUP_TOOLS.has(toolName);
}

export function isTradeTool(toolName: string): boolean {
  return NO_DEDUP_TOOLS.has(toolName);
}
