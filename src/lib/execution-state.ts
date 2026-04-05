// ============================================
// Flash UI — Execution State Machine
// ============================================
// Deterministic state transitions for trade execution.
// Persists to sessionStorage to survive page refresh during signing.
//
// States:
//   idle → pending → confirmed → executing → signing → completed | failed
//
// Rules:
// - Each state transition is validated (no skipping)
// - State includes execution_id for trace correlation
// - Persisted atomically

export type ExecState =
  | "idle"
  | "pending"      // Trade preview accepted, waiting confirm
  | "confirmed"    // User confirmed, pre-execution checks running
  | "executing"    // API call in flight
  | "signing"      // Wallet signing in progress
  | "completed"    // Transaction confirmed on-chain
  | "failed";      // Any step failed

export interface ExecutionRecord {
  state: ExecState;
  execution_id: string;
  market: string;
  side: "LONG" | "SHORT";
  collateral_usd: number;
  leverage: number;
  entry_price: number | null;
  tx_signature: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const STORAGE_KEY = "flash_execution_state";

// Valid transitions
const VALID_TRANSITIONS: Record<ExecState, ExecState[]> = {
  idle: ["pending"],
  pending: ["confirmed", "failed", "idle"],
  confirmed: ["executing", "failed", "idle"],
  executing: ["signing", "failed"],
  signing: ["completed", "failed"],
  completed: ["idle"],
  failed: ["idle", "pending"],
};

// ---- Persistence ----

let _cached: ExecutionRecord | null = null;

function load(): ExecutionRecord | null {
  if (_cached) return _cached;
  try {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExecutionRecord;
    if (parsed.state && parsed.execution_id) {
      _cached = parsed;
      return _cached;
    }
  } catch {
    // Corrupt — clear
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* */ }
  }
  return null;
}

function persist(record: ExecutionRecord): void {
  _cached = record;
  try {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    }
  } catch { /* Storage full — silent */ }
}

function clear(): void {
  _cached = null;
  try {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* */ }
}

// ---- Public API ----

export function getExecutionState(): ExecutionRecord | null {
  return load();
}

export function isTransitionValid(from: ExecState, to: ExecState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionTo(
  to: ExecState,
  update?: Partial<Omit<ExecutionRecord, "state" | "updated_at">>,
): ExecutionRecord | null {
  const current = load();
  const from = current?.state ?? "idle";

  if (!isTransitionValid(from, to)) {
    return null; // Invalid transition — rejected
  }

  if (to === "idle") {
    clear();
    return null;
  }

  const record: ExecutionRecord = {
    state: to,
    execution_id: current?.execution_id ?? update?.execution_id ?? "",
    market: current?.market ?? update?.market ?? "",
    side: current?.side ?? update?.side ?? "LONG",
    collateral_usd: current?.collateral_usd ?? update?.collateral_usd ?? 0,
    leverage: current?.leverage ?? update?.leverage ?? 0,
    entry_price: update?.entry_price ?? current?.entry_price ?? null,
    tx_signature: update?.tx_signature ?? current?.tx_signature ?? null,
    error: update?.error ?? null,
    created_at: current?.created_at ?? Date.now(),
    updated_at: Date.now(),
    ...update,
  };

  persist(record);
  return record;
}

/**
 * Check if there's an in-flight execution that survived a page refresh.
 * If found in signing/executing state, it may need recovery.
 */
export function checkStalledExecution(): ExecutionRecord | null {
  const record = load();
  if (!record) return null;

  // If in executing/signing and older than 2 minutes, it's stalled
  if (
    (record.state === "executing" || record.state === "signing") &&
    Date.now() - record.updated_at > 120_000
  ) {
    return record;
  }

  return null;
}

export function resetExecution(): void {
  clear();
}
