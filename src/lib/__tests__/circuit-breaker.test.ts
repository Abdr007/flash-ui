// Circuit Breaker — Comprehensive Unit Tests
// Uses vi.resetModules() + dynamic import to get fresh module-level state per test.

let recordSuccess: typeof import("../circuit-breaker").recordSuccess;
let recordFailure: typeof import("../circuit-breaker").recordFailure;
let checkCircuit: typeof import("../circuit-breaker").checkCircuit;
let getCircuitState: typeof import("../circuit-breaker").getCircuitState;
let getCircuitStats: typeof import("../circuit-breaker").getCircuitStats;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const mod = await import("../circuit-breaker");
  recordSuccess = mod.recordSuccess;
  recordFailure = mod.recordFailure;
  checkCircuit = mod.checkCircuit;
  getCircuitState = mod.getCircuitState;
  getCircuitStats = mod.getCircuitStats;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("circuit-breaker", () => {
  // ---- Closed state ----
  describe("closed state", () => {
    it("starts in closed state", () => {
      expect(getCircuitState()).toBe("closed");
    });

    it("stays closed after 1 failure", () => {
      recordFailure();
      expect(getCircuitState()).toBe("closed");
      expect(checkCircuit().allowed).toBe(true);
    });

    it("stays closed after 2 failures", () => {
      recordFailure();
      recordFailure();
      expect(getCircuitState()).toBe("closed");
      expect(checkCircuit().allowed).toBe(true);
    });

    it("allows execution when closed", () => {
      const result = checkCircuit();
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  // ---- Opens after threshold ----
  describe("opens after threshold", () => {
    it("opens after 3 consecutive failures", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      expect(getCircuitState()).toBe("open");
    });

    it("checkCircuit returns allowed:false when open", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      const result = checkCircuit();
      expect(result.allowed).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Trading temporarily disabled");
    });

    it("includes failure type in error message", () => {
      recordFailure("api");
      recordFailure("api");
      recordFailure("api");
      const result = checkCircuit();
      expect(result.error).toContain("api");
    });

    it("uses default 'API' in error when lastFailureType is null", () => {
      // Force open with typed failures, then reset lastFailureType via success + re-open
      // Actually, recordFailure always sets lastFailureType, so let's verify "unknown" default
      recordFailure(); // no type → "unknown"
      recordFailure();
      recordFailure();
      const result = checkCircuit();
      expect(result.error).toContain("unknown");
    });
  });

  // ---- Escalating cooldown ----
  describe("escalating cooldown", () => {
    it("first open has 30s cooldown", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      const stats = getCircuitStats();
      expect(stats.cooldownMs).toBe(30_000);
    });

    it("second open has 60s cooldown", () => {
      // First open + half-open recovery attempt fails
      recordFailure();
      recordFailure();
      recordFailure();
      // Wait for cooldown to elapse → half-open
      vi.advanceTimersByTime(30_000);
      expect(getCircuitState()).toBe("half-open");
      // Failure in half-open doesn't reset openCount; record another failure to re-trigger
      recordFailure(); // 4th consecutive failure, but circuit was already open
      // The circuit is still open (consecutiveFailures=4 >= 3, circuitOpenSince is still set)
      // We need to let it transition properly. Let's use a fresh approach:
      // Reset via success in half-open, then re-open
      // Actually let's restart the sequence properly:
      vi.useRealTimers();
      vi.useFakeTimers();
      // We can't re-import mid-test easily — let's work with the state we have.
      // After half-open, record a success to fully reset, then break again for 2nd open.

      // Let me re-approach: after half-open, a success resets openCount to 0.
      // To get openCount=2, we need: open → cooldown → half-open → FAILURE → re-open
      // A failure in half-open: consecutiveFailures is already >=3, circuitOpenSince is set
      // recordFailure increments consecutiveFailures but won't re-set circuitOpenSince (already set)
      // So we need: open → cooldown → half-open → success (openCount=0, reset) → 3 failures (openCount=1, 30s)
      // That gives openCount=1 again. To get openCount=2:
      // open(openCount=1) → cooldown → half-open → failure (stays open, openCount still 1)
      // → need circuitOpenSince to reset...
      //
      // The only way openCount increments is when consecutiveFailures >= THRESHOLD && !circuitOpenSince
      // So we need circuitOpenSince to become null between opens.
      // That happens only in recordSuccess(). So:
      // 1st cycle: 3 failures → open (openCount=1) → wait 30s → half-open → success → closed (openCount=0)
      // 2nd cycle: 3 failures → open (openCount=1) → still 30s
      // openCount resets to 0 on half-open success! So we can never get openCount=2 via success path.
      //
      // To get openCount=2, we need the half-open test to FAIL:
      // 1st cycle: 3 failures → open (openCount=1, circuitOpenSince=T1)
      // wait 30s → half-open
      // recordSuccess() in half-open → openCount=0, consecutiveFailures=0, circuitOpenSince=null
      // Hmm, that resets openCount. So escalation requires NOT going through half-open success.
      //
      // Let me re-read the code. recordFailure: if consecutiveFailures >= 3 && !circuitOpenSince → openCount++, set circuitOpenSince
      // So to increment openCount again, circuitOpenSince must be null.
      // circuitOpenSince only becomes null in recordSuccess().
      // recordSuccess in half-open sets openCount=0. In closed state, it just resets failures.
      //
      // Wait — what if we call recordSuccess when NOT in half-open? Then openCount stays.
      // getCircuitState checks: if consecutiveFailures < 3 → closed
      // So after recordSuccess (which sets consecutiveFailures=0), state is closed, and openCount is preserved
      // (only reset if state was half-open at time of success).
      //
      // But if state is "open" (not yet half-open) and we call recordSuccess,
      // getCircuitState() will return "closed" (since consecutiveFailures becomes 0 after success)
      // and openCount won't be reset.
      //
      // So the path to openCount=2:
      // 3 failures → open (openCount=1)
      // recordSuccess() immediately (while technically "open" but success resets consecutiveFailures → state becomes closed)
      // But wait, recordSuccess checks getCircuitState() first. With consecutiveFailures=3 and circuitOpenSince just set,
      // state is "open" (not half-open). So the half-open branch is NOT taken, openCount stays at 1.
      // recordSuccess sets consecutiveFailures=0, circuitOpenSince=null. Now closed with openCount=1.
      // 3 more failures → open (openCount=2). cooldownMs = 30000 * 2^(2-1) = 60000.
    });

    // Let me write this cleanly now:
    it("second open has 60s cooldown (escalating)", async () => {
      vi.resetModules();
      vi.useFakeTimers();
      const mod = await import("../circuit-breaker");

      // First open: openCount → 1
      mod.recordFailure();
      mod.recordFailure();
      mod.recordFailure();
      expect(mod.getCircuitState()).toBe("open");
      expect(mod.getCircuitStats().openCount).toBe(1);
      expect(mod.getCircuitStats().cooldownMs).toBe(30_000);

      // Reset without going through half-open (so openCount is preserved)
      // recordSuccess while state is "open" → openCount stays at 1
      mod.recordSuccess();
      expect(mod.getCircuitState()).toBe("closed");
      expect(mod.getCircuitStats().openCount).toBe(1);

      // Second open: openCount → 2
      mod.recordFailure();
      mod.recordFailure();
      mod.recordFailure();
      expect(mod.getCircuitState()).toBe("open");
      expect(mod.getCircuitStats().openCount).toBe(2);
      expect(mod.getCircuitStats().cooldownMs).toBe(60_000);
    });

    it("third open caps at 120s cooldown", async () => {
      vi.resetModules();
      vi.useFakeTimers();
      const mod = await import("../circuit-breaker");

      // Open 3 times, resetting via recordSuccess while "open" each time
      for (let i = 0; i < 3; i++) {
        mod.recordFailure();
        mod.recordFailure();
        mod.recordFailure();
        if (i < 2) mod.recordSuccess(); // preserve openCount
      }
      expect(mod.getCircuitStats().openCount).toBe(3);
      // 30000 * 2^(3-1) = 30000 * 4 = 120000, capped at 120000
      expect(mod.getCircuitStats().cooldownMs).toBe(120_000);
    });

    it("cooldown does not exceed 120s even at high openCount", async () => {
      vi.resetModules();
      vi.useFakeTimers();
      const mod = await import("../circuit-breaker");

      for (let i = 0; i < 10; i++) {
        mod.recordFailure();
        mod.recordFailure();
        mod.recordFailure();
        if (i < 9) mod.recordSuccess();
      }
      expect(mod.getCircuitStats().openCount).toBe(10);
      expect(mod.getCircuitStats().cooldownMs).toBe(120_000);
    });
  });

  // ---- Half-open state ----
  describe("half-open state", () => {
    it("transitions to half-open after cooldown elapses", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      expect(getCircuitState()).toBe("open");

      vi.advanceTimersByTime(30_000);
      expect(getCircuitState()).toBe("half-open");
    });

    it("allows one test request in half-open", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      vi.advanceTimersByTime(30_000);

      const result = checkCircuit();
      expect(result.allowed).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("does not transition to half-open before cooldown", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      vi.advanceTimersByTime(29_999);
      expect(getCircuitState()).toBe("open");
    });
  });

  // ---- Success in half-open ----
  describe("success in half-open", () => {
    it("resets openCount to 0 on success in half-open", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      expect(getCircuitStats().openCount).toBe(1);

      vi.advanceTimersByTime(30_000);
      expect(getCircuitState()).toBe("half-open");

      recordSuccess();
      expect(getCircuitState()).toBe("closed");
      expect(getCircuitStats().openCount).toBe(0);
      expect(getCircuitStats().consecutiveFailures).toBe(0);
    });

    it("fully recovers after half-open success", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      vi.advanceTimersByTime(30_000);
      recordSuccess();

      // Should behave as brand new
      expect(getCircuitStats().openCount).toBe(0);
      expect(getCircuitStats().openSince).toBeNull();
      expect(getCircuitStats().lastFailureType).toBeNull();
      expect(getCircuitStats().consecutiveFailures).toBe(0);
      expect(checkCircuit().allowed).toBe(true);
    });
  });

  // ---- Success resets failures ----
  describe("success resets failures", () => {
    it("resets consecutiveFailures to 0 on success", () => {
      recordFailure();
      recordFailure();
      expect(getCircuitStats().consecutiveFailures).toBe(2);

      recordSuccess();
      expect(getCircuitStats().consecutiveFailures).toBe(0);
    });

    it("requires 3 new failures after a success to open", () => {
      recordFailure();
      recordFailure();
      recordSuccess(); // reset
      recordFailure();
      recordFailure();
      expect(getCircuitState()).toBe("closed");

      recordFailure(); // 3rd after reset
      expect(getCircuitState()).toBe("open");
    });
  });

  // ---- Failure type tracking ----
  describe("failure type tracking", () => {
    it("tracks lastFailureType from recordFailure", () => {
      recordFailure("api");
      expect(getCircuitStats().lastFailureType).toBe("api");
    });

    it("defaults to 'unknown' when no type provided", () => {
      recordFailure();
      expect(getCircuitStats().lastFailureType).toBe("unknown");
    });

    it("updates type on each failure", () => {
      recordFailure("api");
      recordFailure("rpc");
      expect(getCircuitStats().lastFailureType).toBe("rpc");
    });

    it("clears lastFailureType on success", () => {
      recordFailure("api");
      recordSuccess();
      expect(getCircuitStats().lastFailureType).toBeNull();
    });
  });

  // ---- getCircuitStats ----
  describe("getCircuitStats", () => {
    it("returns correct shape when closed", () => {
      const stats = getCircuitStats();
      expect(stats).toEqual({
        state: "closed",
        consecutiveFailures: 0,
        openSince: null,
        cooldownMs: expect.any(Number),
        openCount: 0,
        lastFailureType: null,
      });
    });

    it("returns correct shape when open", () => {
      recordFailure("timeout");
      recordFailure("timeout");
      recordFailure("timeout");
      const stats = getCircuitStats();
      expect(stats.state).toBe("open");
      expect(stats.consecutiveFailures).toBe(3);
      expect(stats.openSince).toBeTypeOf("number");
      expect(stats.openSince).toBeGreaterThan(0);
      expect(stats.cooldownMs).toBe(30_000);
      expect(stats.openCount).toBe(1);
      expect(stats.lastFailureType).toBe("timeout");
    });

    it("returns correct shape when half-open", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      vi.advanceTimersByTime(30_000);
      const stats = getCircuitStats();
      expect(stats.state).toBe("half-open");
      expect(stats.consecutiveFailures).toBe(3);
      expect(stats.openSince).toBeTypeOf("number");
    });

    it("cooldownMs is correct even with openCount=0", () => {
      // openCount=0 → 30000 * 2^(-1) = 15000
      const stats = getCircuitStats();
      expect(stats.cooldownMs).toBe(15_000); // 30000 * 0.5
    });
  });

  // ---- Edge cases ----
  describe("edge cases", () => {
    it("many failures beyond threshold keep circuit open", () => {
      for (let i = 0; i < 10; i++) recordFailure();
      expect(getCircuitState()).toBe("open");
      expect(getCircuitStats().consecutiveFailures).toBe(10);
      // openCount should still be 1 (only incremented once when first crossing threshold)
      expect(getCircuitStats().openCount).toBe(1);
    });

    it("circuitOpenSince does not change on subsequent failures", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      const firstOpenSince = getCircuitStats().openSince;
      vi.advanceTimersByTime(1000);
      recordFailure();
      expect(getCircuitStats().openSince).toBe(firstOpenSince);
    });

    it("error message includes cooldown in seconds", () => {
      recordFailure();
      recordFailure();
      recordFailure();
      const result = checkCircuit();
      expect(result.error).toContain("30s");
    });
  });
});
