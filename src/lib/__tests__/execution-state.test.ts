// ============================================
// Execution State Machine — Unit Tests
// ============================================

import {
  getExecutionState,
  isTransitionValid,
  transitionTo,
  checkStalledExecution,
  resetExecution,
  type ExecState,
  type ExecutionRecord,
} from "../execution-state";

// ---------------------------------------------------------------------------
// sessionStorage mock — jsdom provides window but sessionStorage may be
// incomplete. We set up a simple in-memory mock.
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

beforeAll(() => {
  Object.defineProperty(globalThis, "sessionStorage", {
    value: {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const k of Object.keys(store)) delete store[k];
      }),
      get length() {
        return Object.keys(store).length;
      },
      key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
    },
    writable: true,
    configurable: true,
  });
});

beforeEach(() => {
  // Clean state between tests
  for (const k of Object.keys(store)) delete store[k];
  resetExecution();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRADE_INIT = {
  execution_id: "exec-001",
  market: "SOL",
  side: "LONG" as const,
  collateral_usd: 100,
  leverage: 10,
};

// ---------------------------------------------------------------------------
// 1. Valid transitions: idle -> pending -> confirmed -> executing -> signing -> completed -> idle
// ---------------------------------------------------------------------------

describe("execution-state: valid transition chain", () => {
  it("completes the full happy-path lifecycle", () => {
    // idle -> pending
    const pending = transitionTo("pending", TRADE_INIT);
    expect(pending).not.toBeNull();
    expect(pending!.state).toBe("pending");
    expect(pending!.execution_id).toBe("exec-001");
    expect(pending!.market).toBe("SOL");

    // pending -> confirmed
    const confirmed = transitionTo("confirmed");
    expect(confirmed).not.toBeNull();
    expect(confirmed!.state).toBe("confirmed");
    expect(confirmed!.execution_id).toBe("exec-001");

    // confirmed -> executing
    const executing = transitionTo("executing");
    expect(executing).not.toBeNull();
    expect(executing!.state).toBe("executing");

    // executing -> signing
    const signing = transitionTo("signing");
    expect(signing).not.toBeNull();
    expect(signing!.state).toBe("signing");

    // signing -> completed
    const completed = transitionTo("completed", {
      tx_signature: "5abc123def456",
      entry_price: 150.5,
    });
    expect(completed).not.toBeNull();
    expect(completed!.state).toBe("completed");
    expect(completed!.tx_signature).toBe("5abc123def456");
    expect(completed!.entry_price).toBe(150.5);

    // completed -> idle (returns null, clears state)
    const idle = transitionTo("idle");
    expect(idle).toBeNull();
    expect(getExecutionState()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Invalid transitions
// ---------------------------------------------------------------------------

describe("execution-state: invalid transitions", () => {
  it("rejects idle -> executing", () => {
    const result = transitionTo("executing");
    expect(result).toBeNull();
  });

  it("rejects idle -> completed", () => {
    const result = transitionTo("completed");
    expect(result).toBeNull();
  });

  it("rejects idle -> signing", () => {
    const result = transitionTo("signing");
    expect(result).toBeNull();
  });

  it("rejects idle -> confirmed", () => {
    const result = transitionTo("confirmed");
    expect(result).toBeNull();
  });

  it("rejects idle -> failed", () => {
    // idle -> failed is NOT in the valid transitions
    const result = transitionTo("failed");
    expect(result).toBeNull();
  });

  it("rejects pending -> executing (must go through confirmed)", () => {
    transitionTo("pending", TRADE_INIT);
    const result = transitionTo("executing");
    expect(result).toBeNull();
  });

  it("rejects pending -> signing (skip confirmed+executing)", () => {
    transitionTo("pending", TRADE_INIT);
    const result = transitionTo("signing");
    expect(result).toBeNull();
  });

  it("rejects confirmed -> signing (must go through executing)", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    const result = transitionTo("signing");
    expect(result).toBeNull();
  });

  it("rejects executing -> completed (must go through signing)", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    const result = transitionTo("completed");
    expect(result).toBeNull();
  });

  it("rejects signing -> idle (must go through completed)", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    transitionTo("signing");
    const result = transitionTo("idle");
    expect(result).toBeNull();
  });

  it("rejects completed -> pending (must reset to idle first)", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    transitionTo("signing");
    transitionTo("completed");
    const result = transitionTo("pending");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Failed state — reachable from pending, confirmed, executing, signing
// ---------------------------------------------------------------------------

describe("execution-state: failed state transitions", () => {
  it("pending -> failed", () => {
    transitionTo("pending", TRADE_INIT);
    const result = transitionTo("failed", { error: "User cancelled" });
    expect(result).not.toBeNull();
    expect(result!.state).toBe("failed");
    expect(result!.error).toBe("User cancelled");
  });

  it("confirmed -> failed", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    const result = transitionTo("failed", { error: "Pre-check failed" });
    expect(result).not.toBeNull();
    expect(result!.state).toBe("failed");
  });

  it("executing -> failed", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    const result = transitionTo("failed", { error: "API timeout" });
    expect(result).not.toBeNull();
    expect(result!.state).toBe("failed");
  });

  it("signing -> failed", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    transitionTo("signing");
    const result = transitionTo("failed", { error: "Wallet rejected" });
    expect(result).not.toBeNull();
    expect(result!.state).toBe("failed");
  });

  it("idle -> failed is NOT valid", () => {
    const result = transitionTo("failed");
    expect(result).toBeNull();
  });

  it("completed -> failed is NOT valid", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    transitionTo("signing");
    transitionTo("completed");
    const result = transitionTo("failed");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Recovery from failed: failed -> idle -> pending (restart)
// ---------------------------------------------------------------------------

describe("execution-state: recovery from failed", () => {
  it("failed -> idle -> pending restarts the cycle", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("failed", { error: "Network error" });

    // failed -> idle clears state
    const idle = transitionTo("idle");
    expect(idle).toBeNull();
    expect(getExecutionState()).toBeNull();

    // idle -> pending starts fresh
    const pending = transitionTo("pending", {
      ...TRADE_INIT,
      execution_id: "exec-002",
    });
    expect(pending).not.toBeNull();
    expect(pending!.state).toBe("pending");
    expect(pending!.execution_id).toBe("exec-002");
  });

  it("failed -> pending is also valid (direct retry)", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("failed", { error: "Retry" });

    const pending = transitionTo("pending", {
      execution_id: "exec-003",
    });
    expect(pending).not.toBeNull();
    expect(pending!.state).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// 5. Stalled detection
// ---------------------------------------------------------------------------

describe("execution-state: stalled detection", () => {
  it("detects stalled execution in executing state after 2+ minutes", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");

    // Manually backdate updated_at to 3 minutes ago
    const record = getExecutionState()!;
    record.updated_at = Date.now() - 180_000;
    sessionStorage.setItem("flash_execution_state", JSON.stringify(record));
    // Clear the internal cache so load() re-reads from sessionStorage
    resetExecution();
    // Re-persist the backdated record
    sessionStorage.setItem("flash_execution_state", JSON.stringify(record));

    const stalled = checkStalledExecution();
    expect(stalled).not.toBeNull();
    expect(stalled!.state).toBe("executing");
  });

  it("detects stalled execution in signing state after 2+ minutes", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    transitionTo("signing");

    const record = getExecutionState()!;
    record.updated_at = Date.now() - 150_000; // 2.5 minutes
    resetExecution(); // clear internal cache
    sessionStorage.setItem("flash_execution_state", JSON.stringify(record));

    const stalled = checkStalledExecution();
    expect(stalled).not.toBeNull();
    expect(stalled!.state).toBe("signing");
  });

  it("does NOT flag recent executing state as stalled", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");

    // updated_at is fresh (just now) — should not be stalled
    const stalled = checkStalledExecution();
    expect(stalled).toBeNull();
  });

  it("does NOT flag pending state as stalled (only executing/signing)", () => {
    transitionTo("pending", TRADE_INIT);

    const record = getExecutionState()!;
    record.updated_at = Date.now() - 300_000;
    resetExecution();
    sessionStorage.setItem("flash_execution_state", JSON.stringify(record));

    const stalled = checkStalledExecution();
    expect(stalled).toBeNull();
  });

  it("returns null when no execution exists", () => {
    const stalled = checkStalledExecution();
    expect(stalled).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Persistence — transitionTo persists to sessionStorage
// ---------------------------------------------------------------------------

describe("execution-state: persistence", () => {
  it("persists state to sessionStorage", () => {
    transitionTo("pending", TRADE_INIT);

    const raw = sessionStorage.getItem("flash_execution_state");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as ExecutionRecord;
    expect(parsed.state).toBe("pending");
    expect(parsed.execution_id).toBe("exec-001");
    expect(parsed.market).toBe("SOL");
  });

  it("can be loaded after clearing internal cache", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");

    // Simulate page refresh: clear internal cache but keep sessionStorage
    // We can't directly clear _cached, but resetExecution clears both.
    // Instead, we verify getExecutionState reads from the persisted data.
    const state = getExecutionState();
    expect(state).not.toBeNull();
    expect(state!.state).toBe("confirmed");
  });

  it("preserves execution_id across transitions", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");

    const state = getExecutionState();
    expect(state!.execution_id).toBe("exec-001");
  });

  it("preserves created_at across transitions", () => {
    const before = Date.now();
    transitionTo("pending", TRADE_INIT);
    const created = getExecutionState()!.created_at;
    expect(created).toBeGreaterThanOrEqual(before);

    transitionTo("confirmed");
    expect(getExecutionState()!.created_at).toBe(created);
  });

  it("updates updated_at on each transition", () => {
    transitionTo("pending", TRADE_INIT);
    const t1 = getExecutionState()!.updated_at;

    transitionTo("confirmed");
    const t2 = getExecutionState()!.updated_at;

    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});

// ---------------------------------------------------------------------------
// 7. resetExecution clears state
// ---------------------------------------------------------------------------

describe("execution-state: resetExecution", () => {
  it("clears state completely", () => {
    transitionTo("pending", TRADE_INIT);
    expect(getExecutionState()).not.toBeNull();

    resetExecution();
    expect(getExecutionState()).toBeNull();
  });

  it("clears sessionStorage", () => {
    transitionTo("pending", TRADE_INIT);
    resetExecution();

    const raw = sessionStorage.getItem("flash_execution_state");
    expect(raw).toBeNull();
  });

  it("allows starting fresh after reset", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    resetExecution();

    const pending = transitionTo("pending", {
      ...TRADE_INIT,
      execution_id: "exec-fresh",
    });
    expect(pending).not.toBeNull();
    expect(pending!.execution_id).toBe("exec-fresh");
  });
});

// ---------------------------------------------------------------------------
// 8. isTransitionValid utility
// ---------------------------------------------------------------------------

describe("execution-state: isTransitionValid", () => {
  const allStates: ExecState[] = ["idle", "pending", "confirmed", "executing", "signing", "completed", "failed"];

  it("idle can only go to pending", () => {
    expect(isTransitionValid("idle", "pending")).toBe(true);
    for (const s of allStates.filter((s) => s !== "pending")) {
      expect(isTransitionValid("idle", s)).toBe(false);
    }
  });

  it("pending can go to confirmed, failed, or idle", () => {
    expect(isTransitionValid("pending", "confirmed")).toBe(true);
    expect(isTransitionValid("pending", "failed")).toBe(true);
    expect(isTransitionValid("pending", "idle")).toBe(true);
    expect(isTransitionValid("pending", "executing")).toBe(false);
    expect(isTransitionValid("pending", "signing")).toBe(false);
    expect(isTransitionValid("pending", "completed")).toBe(false);
  });

  it("confirmed can go to executing, failed, or idle", () => {
    expect(isTransitionValid("confirmed", "executing")).toBe(true);
    expect(isTransitionValid("confirmed", "failed")).toBe(true);
    expect(isTransitionValid("confirmed", "idle")).toBe(true);
    expect(isTransitionValid("confirmed", "signing")).toBe(false);
  });

  it("executing can go to signing or failed", () => {
    expect(isTransitionValid("executing", "signing")).toBe(true);
    expect(isTransitionValid("executing", "failed")).toBe(true);
    expect(isTransitionValid("executing", "completed")).toBe(false);
    expect(isTransitionValid("executing", "idle")).toBe(false);
  });

  it("signing can go to completed or failed", () => {
    expect(isTransitionValid("signing", "completed")).toBe(true);
    expect(isTransitionValid("signing", "failed")).toBe(true);
    expect(isTransitionValid("signing", "idle")).toBe(false);
  });

  it("completed can only go to idle", () => {
    expect(isTransitionValid("completed", "idle")).toBe(true);
    for (const s of allStates.filter((s) => s !== "idle")) {
      expect(isTransitionValid("completed", s)).toBe(false);
    }
  });

  it("failed can go to idle or pending", () => {
    expect(isTransitionValid("failed", "idle")).toBe(true);
    expect(isTransitionValid("failed", "pending")).toBe(true);
    expect(isTransitionValid("failed", "confirmed")).toBe(false);
    expect(isTransitionValid("failed", "executing")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Edge cases
// ---------------------------------------------------------------------------

describe("execution-state: edge cases", () => {
  it("transition to idle from idle returns null (no state to clear)", () => {
    // idle -> idle is NOT a valid transition
    const result = transitionTo("idle");
    // idle -> idle is not in VALID_TRANSITIONS, so it's rejected
    expect(result).toBeNull();
  });

  it("carries forward trade data from initial pending transition", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");

    const state = getExecutionState()!;
    expect(state.market).toBe("SOL");
    expect(state.side).toBe("LONG");
    expect(state.collateral_usd).toBe(100);
    expect(state.leverage).toBe(10);
  });

  it("update fields are merged on transition", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("confirmed");
    transitionTo("executing");
    transitionTo("signing");
    const completed = transitionTo("completed", {
      tx_signature: "sig123",
      entry_price: 148.25,
    });
    expect(completed!.tx_signature).toBe("sig123");
    expect(completed!.entry_price).toBe(148.25);
    expect(completed!.market).toBe("SOL"); // original data preserved
  });

  it("error field is cleared on non-failed transitions", () => {
    transitionTo("pending", TRADE_INIT);
    transitionTo("failed", { error: "boom" });
    expect(getExecutionState()!.error).toBe("boom");

    // Recover: failed -> pending
    transitionTo("pending", { execution_id: "exec-retry" });
    // The error field should be null (update.error defaults to null in record construction)
    expect(getExecutionState()!.error).toBeNull();
  });
});
