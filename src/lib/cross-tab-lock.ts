// ============================================
// Flash UI — Cross-Tab Trade Lock
// ============================================
// Prevents simultaneous trade execution across browser tabs.
// Primary: Web Locks API (atomic, no race condition)
// Fallback: localStorage with write-verify pattern

const LOCK_NAME = "flash-trade-lock";
const STORAGE_KEY = "flash_trade_lock";
const LOCK_TTL_MS = 120_000; // 2 minutes — auto-expire stale locks

const tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Track whether THIS tab holds the lock
let _holding = false;
let _lockRelease: (() => void) | null = null;

interface LockEntry {
  tabId: string;
  timestamp: number;
}

// ---- Web Locks API (preferred — truly atomic) ----

function hasWebLocks(): boolean {
  return typeof navigator !== "undefined" && "locks" in navigator;
}

async function acquireWebLock(): Promise<boolean> {
  return new Promise((resolve) => {
    navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return undefined; // lock not acquired
      }
      _holding = true;
      // Return a promise that stays pending until we release
      return new Promise<void>((releaseLock) => {
        _lockRelease = () => {
          _holding = false;
          _lockRelease = null;
          releaseLock();
        };
        resolve(true);
      });
    });
  });
}

function releaseWebLock(): void {
  if (_lockRelease) _lockRelease();
}

// ---- localStorage fallback (write-then-verify to reduce race window) ----

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

function acquireStorageLock(): boolean {
  const existing = readLock();
  if (existing && existing.tabId !== tabId) return false;
  try {
    const entry: LockEntry = { tabId, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    // Write-then-verify: re-read to check we won the race
    const verify = readLock();
    if (!verify || verify.tabId !== tabId) return false;
    _holding = true;
    return true;
  } catch {
    // localStorage unavailable or full — allow execution (single-tab assumed)
    _holding = true;
    return true;
  }
}

function releaseStorageLock(): void {
  try {
    const existing = readLock();
    if (existing && existing.tabId === tabId) {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {}
  _holding = false;
}

// ---- Public API ----

export async function acquireCrossTabLock(): Promise<boolean> {
  if (hasWebLocks()) return acquireWebLock();
  return acquireStorageLock();
}

export function releaseCrossTabLock(): void {
  if (hasWebLocks()) {
    releaseWebLock();
  } else {
    releaseStorageLock();
  }
}

export function isOtherTabTrading(): boolean {
  if (hasWebLocks()) return false; // Web Locks handles this via acquireCrossTabLock
  const existing = readLock();
  return existing !== null && existing.tabId !== tabId;
}
