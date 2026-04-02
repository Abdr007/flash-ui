// ============================================
// Rate Limiter — Multi-layer protection
// ============================================
// Layer 1: IP-based (RPC proxy — already in /api/rpc)
// Layer 2: Wallet-based execution limiter
// Layer 3: Command spam detector
//
// All in-memory. Resets on deploy. Acceptable for Vercel serverless.

interface RateEntry {
  count: number;
  resetAt: number;
}

const walletExecLimits = new Map<string, RateEntry>();
const commandLimits = new Map<string, RateEntry>();

const EXEC_LIMIT_PER_MIN = 5;
const COMMAND_LIMIT_PER_MIN = 20;
const WINDOW_MS = 60_000;

function check(
  map: Map<string, RateEntry>,
  key: string,
  max: number
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = map.get(key);

  if (!entry || now >= entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: max - 1 };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: max - entry.count };
}

/** Check if wallet can execute a trade (5/min) */
export function checkWalletExecLimit(wallet: string): { allowed: boolean; remaining: number } {
  return check(walletExecLimits, wallet, EXEC_LIMIT_PER_MIN);
}

/** Check if a user can send a command (20/min) */
export function checkCommandLimit(sessionId: string): { allowed: boolean; remaining: number } {
  return check(commandLimits, sessionId, COMMAND_LIMIT_PER_MIN);
}

// Cleanup stale entries every 5 minutes
if (typeof globalThis !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of walletExecLimits) if (now >= v.resetAt) walletExecLimits.delete(k);
    for (const [k, v] of commandLimits) if (now >= v.resetAt) commandLimits.delete(k);
  }, 300_000);
}
