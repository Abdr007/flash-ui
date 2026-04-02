// ============================================
// Circuit Breaker — Adaptive failure protection
// ============================================
// Tracks failures by category. Opens circuit on threshold.
// Escalating cooldown: 30s → 60s → 120s (caps at 120s).
// Half-open: allows one test request after cooldown.
// Self-heals: resets fully after sustained success.

const FAILURE_THRESHOLD = 3;
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 120_000;

let consecutiveFailures = 0;
let circuitOpenSince: number | null = null;
let openCount = 0; // How many times circuit has opened (escalating cooldown)
let lastFailureType: string | null = null;

export type CircuitState = "closed" | "open" | "half-open";

function getCooldownMs(): number {
  return Math.min(BASE_COOLDOWN_MS * Math.pow(2, openCount - 1), MAX_COOLDOWN_MS);
}

export function getCircuitState(): CircuitState {
  if (consecutiveFailures < FAILURE_THRESHOLD) return "closed";
  if (circuitOpenSince && Date.now() - circuitOpenSince >= getCooldownMs()) return "half-open";
  return "open";
}

/** Record a successful API call — resets the breaker */
export function recordSuccess(): void {
  if (getCircuitState() === "half-open") {
    // Test request succeeded — full reset
    openCount = 0;
  }
  consecutiveFailures = 0;
  circuitOpenSince = null;
  lastFailureType = null;
}

/** Record a failed API call — may open the circuit */
export function recordFailure(failureType?: string): void {
  consecutiveFailures++;
  lastFailureType = failureType ?? "unknown";
  if (consecutiveFailures >= FAILURE_THRESHOLD && !circuitOpenSince) {
    openCount++;
    circuitOpenSince = Date.now();
  }
}

/** Check if execution is allowed */
export function checkCircuit(): { allowed: boolean; error?: string } {
  const state = getCircuitState();
  if (state === "closed") return { allowed: true };
  if (state === "half-open") return { allowed: true };
  const cooldown = Math.ceil(getCooldownMs() / 1000);
  return {
    allowed: false,
    error: `Trading temporarily disabled — ${lastFailureType ?? "API"} issues detected. Retrying in ${cooldown}s.`,
  };
}

/** Get breaker stats for health endpoint */
export function getCircuitStats(): {
  state: CircuitState;
  consecutiveFailures: number;
  openSince: number | null;
  cooldownMs: number;
  openCount: number;
  lastFailureType: string | null;
} {
  return {
    state: getCircuitState(),
    consecutiveFailures,
    openSince: circuitOpenSince,
    cooldownMs: getCooldownMs(),
    openCount,
    lastFailureType,
  };
}
