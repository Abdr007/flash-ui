// ============================================
// Flash UI — Cross-Tab Trade Lock
// ============================================
// Prevents simultaneous trade execution across browser tabs.
// Uses BroadcastChannel + localStorage for coordination.

const CHANNEL_NAME = "flash-trade-lock";
const STORAGE_KEY = "flash_trade_lock";
const LOCK_TTL_MS = 120_000; // 2 minutes — auto-expire stale locks

interface LockEntry {
  tabId: string;
  timestamp: number;
}

const tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      return null;
    }
  }
  return channel;
}

function readLock(): LockEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const entry: LockEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > LOCK_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

/**
 * Acquire the cross-tab trade lock. Returns true if acquired.
 * Only one tab can hold the lock at a time.
 */
export function acquireCrossTabLock(): boolean {
  const existing = readLock();
  if (existing && existing.tabId !== tabId) {
    return false; // another tab holds the lock
  }
  try {
    const entry: LockEntry = { tabId, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    getChannel()?.postMessage({ type: "lock-acquired", tabId });
    return true;
  } catch {
    return true; // localStorage unavailable — allow (single-tab fallback)
  }
}

/**
 * Release the cross-tab trade lock.
 */
export function releaseCrossTabLock(): void {
  try {
    const existing = readLock();
    if (existing && existing.tabId === tabId) {
      localStorage.removeItem(STORAGE_KEY);
      getChannel()?.postMessage({ type: "lock-released", tabId });
    }
  } catch {
    // Ignore — lock will expire via TTL
  }
}

/**
 * Check if another tab is currently trading.
 */
export function isOtherTabTrading(): boolean {
  const existing = readLock();
  return existing !== null && existing.tabId !== tabId;
}
