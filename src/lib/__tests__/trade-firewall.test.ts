// ============================================
// Trade Firewall — Unit Tests
// ============================================

import {
  validateTrade,
  TradePreviewSchema,
  enforceFirewall,
  validateClosePreview,
  type FirewallPass,
  type FirewallFail,
} from "../trade-firewall";
import type { Position } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Omit a key from an object (avoids unused-var lint warnings from rest destructuring). */
function omit<T extends Record<string, unknown>>(obj: T, key: string): Omit<T, typeof key> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

/** Builds a valid SOL LONG trade payload with sensible defaults. */
function validTrade(overrides: Record<string, unknown> = {}) {
  return {
    market: "SOL",
    side: "LONG" as const,
    collateral_usd: 100,
    leverage: 10,
    entry_price: 150,
    liquidation_price: 136,
    fees: 0.8,
    position_size: 1000,
    ...overrides,
  };
}

/** Shorthand: empty position list and dummy wallet */
const WALLET = "DummyWallet123";
const NO_POS: Position[] = [];

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    pubkey: "pos1",
    market: "SOL",
    side: "LONG",
    entry_price: 150,
    mark_price: 155,
    size_usd: 1000,
    collateral_usd: 100,
    leverage: 10,
    unrealized_pnl: 50,
    unrealized_pnl_pct: 5,
    liquidation_price: 136,
    fees: 0.8,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Valid trade
// ---------------------------------------------------------------------------

describe("trade-firewall: valid trade", () => {
  it("returns valid:true with trade object for a well-formed trade", () => {
    const result = validateTrade(validTrade(), WALLET, NO_POS);
    expect(result.valid).toBe(true);
    const pass = result as FirewallPass;
    expect(pass.trade).toBeDefined();
    expect(pass.trade.market).toBe("SOL");
    expect(pass.trade.side).toBe("LONG");
    expect(pass.trade.leverage).toBe(10);
    expect(pass.trade.collateral_usd).toBe(100);
  });

  it("applies default slippage_bps when omitted", () => {
    const result = validateTrade(validTrade(), WALLET, NO_POS);
    expect(result.valid).toBe(true);
    expect((result as FirewallPass).trade.slippage_bps).toBe(80);
  });

  it("applies default degen=false when omitted", () => {
    const result = validateTrade(validTrade(), WALLET, NO_POS);
    expect(result.valid).toBe(true);
    expect((result as FirewallPass).trade.degen).toBe(false);
  });

  it("accepts a valid SHORT trade", () => {
    const result = validateTrade(
      validTrade({
        side: "SHORT",
        liquidation_price: 165, // above entry for short
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Missing required fields
// ---------------------------------------------------------------------------

describe("trade-firewall: missing required fields", () => {
  it("rejects when market is missing", () => {
    const result = validateTrade(omit(validTrade(), "market"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("market"))).toBe(true);
  });

  it("rejects when side is missing", () => {
    const result = validateTrade(omit(validTrade(), "side"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("side"))).toBe(true);
  });

  it("rejects when collateral_usd is missing", () => {
    const result = validateTrade(omit(validTrade(), "collateral_usd"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("collateral_usd"))).toBe(true);
  });

  it("rejects when leverage is missing", () => {
    const result = validateTrade(omit(validTrade(), "leverage"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("leverage"))).toBe(true);
  });

  it("rejects when entry_price is missing", () => {
    const result = validateTrade(omit(validTrade(), "entry_price"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("entry_price"))).toBe(true);
  });

  it("rejects when liquidation_price is missing", () => {
    const result = validateTrade(omit(validTrade(), "liquidation_price"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("liquidation_price"))).toBe(true);
  });

  it("rejects when fees is missing", () => {
    const result = validateTrade(omit(validTrade(), "fees"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("fees"))).toBe(true);
  });

  it("rejects when position_size is missing", () => {
    const result = validateTrade(omit(validTrade(), "position_size"), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("position_size"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Unknown fields rejected (.strict())
// ---------------------------------------------------------------------------

describe("trade-firewall: strict schema rejects unknown fields", () => {
  it("rejects extra fields via .strict()", () => {
    const result = validateTrade(validTrade({ secret_hack: "injected" }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => e.includes("Unrecognized"))).toBe(true);
  });

  it("Zod schema safeParse rejects unknown keys directly", () => {
    const parsed = TradePreviewSchema.safeParse({
      ...validTrade(),
      extra_field: 42,
    });
    expect(parsed.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Leverage too high
// ---------------------------------------------------------------------------

describe("trade-firewall: leverage limits", () => {
  it("rejects leverage above market max (SOL max = 500)", () => {
    const result = validateTrade(
      validTrade({
        leverage: 501,
        position_size: 100 * 501,
        liquidation_price: 150 - 150 / 501,
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /exceeds.*max/i.test(e))).toBe(true);
  });

  it("allows leverage at market max (SOL 500x with degen)", () => {
    // SOL max is 500x. Position size = 100 * 500 = 50000
    const result = validateTrade(
      validTrade({
        leverage: 500,
        position_size: 50000,
        liquidation_price: 150 - 150 * 0.001, // tight but scaled correctly for 500x
        degen: true,
      }),
      WALLET,
      NO_POS,
    );
    // Should not contain a leverage-exceeds error
    if (!result.valid) {
      expect((result as FirewallFail).errors.some((e) => /exceeds.*max/i.test(e))).toBe(false);
    }
  });

  // 5. Leverage too low
  it("rejects leverage below 1", () => {
    const result = validateTrade(validTrade({ leverage: 0.5, position_size: 50 }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /leverage must be >= 1/i.test(e))).toBe(true);
  });

  it("rejects zero leverage at the schema level", () => {
    const result = validateTrade(validTrade({ leverage: 0 }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });

  it("rejects negative leverage at the schema level", () => {
    const result = validateTrade(validTrade({ leverage: -5 }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Collateral bounds
// ---------------------------------------------------------------------------

describe("trade-firewall: collateral bounds", () => {
  it("rejects collateral below minimum ($10)", () => {
    const result = validateTrade(validTrade({ collateral_usd: 5, position_size: 50 }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /below minimum/i.test(e))).toBe(true);
  });

  it("rejects collateral above maximum ($50,000)", () => {
    const result = validateTrade(
      validTrade({
        collateral_usd: 60000,
        position_size: 600000,
        fees: 480,
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /exceeds maximum/i.test(e))).toBe(true);
  });

  it("accepts collateral at minimum ($10)", () => {
    const result = validateTrade(validTrade({ collateral_usd: 10, position_size: 100, fees: 0.08 }), WALLET, NO_POS);
    // Should not have a collateral-below error
    if (!result.valid) {
      expect((result as FirewallFail).errors.some((e) => /below minimum/i.test(e))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. TP/SL direction checks
// ---------------------------------------------------------------------------

describe("trade-firewall: TP/SL direction", () => {
  it("LONG TP must be above entry — rejects TP below entry", () => {
    const result = validateTrade(
      validTrade({ take_profit_price: 140 }), // below entry 150
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /LONG take profit.*must be above/i.test(e))).toBe(true);
  });

  it("LONG TP above entry passes direction check", () => {
    const result = validateTrade(
      validTrade({ take_profit_price: 165 }), // 10% above entry
      WALLET,
      NO_POS,
    );
    if (!result.valid) {
      expect((result as FirewallFail).errors.some((e) => /LONG take profit.*must be above/i.test(e))).toBe(false);
    }
  });

  it("SHORT TP must be below entry — rejects TP above entry", () => {
    const result = validateTrade(
      validTrade({
        side: "SHORT",
        liquidation_price: 165,
        take_profit_price: 160, // above entry 150
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /SHORT take profit.*must be below/i.test(e))).toBe(true);
  });

  it("LONG SL must be below entry — rejects SL above entry", () => {
    const result = validateTrade(
      validTrade({ stop_loss_price: 160 }), // above entry 150
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /LONG stop loss.*must be below/i.test(e))).toBe(true);
  });

  it("SHORT SL must be above entry — rejects SL below entry", () => {
    const result = validateTrade(
      validTrade({
        side: "SHORT",
        liquidation_price: 165,
        stop_loss_price: 140, // below entry 150
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /SHORT stop loss.*must be above/i.test(e))).toBe(true);
  });

  it("TP too far from entry (>500%) is rejected", () => {
    const result = validateTrade(
      validTrade({ take_profit_price: 1500 }), // 900% from entry
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /500%.*unrealistic/i.test(e))).toBe(true);
  });

  it("TP too close to entry (<0.1%) is rejected", () => {
    const result = validateTrade(
      validTrade({ take_profit_price: 150.01 }), // ~0.007% away
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /0\.1%.*too tight/i.test(e))).toBe(true);
  });

  it("SL too far from entry (>500%) is rejected", () => {
    // Use a value that's actually >500% away
    const result2 = validateTrade(
      validTrade({
        side: "SHORT",
        liquidation_price: 165,
        stop_loss_price: 1200, // 700% from entry
      }),
      WALLET,
      NO_POS,
    );
    expect(result2.valid).toBe(false);
    expect((result2 as FirewallFail).errors.some((e) => /500%.*unrealistic/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Liquidation distance
// ---------------------------------------------------------------------------

describe("trade-firewall: liquidation distance", () => {
  it("rejects LONG liq price >= entry (structurally impossible)", () => {
    const result = validateTrade(
      validTrade({ liquidation_price: 155 }), // above entry 150
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /LONG liq price.*>= entry/i.test(e))).toBe(true);
  });

  it("rejects SHORT liq price <= entry", () => {
    const result = validateTrade(
      validTrade({
        side: "SHORT",
        liquidation_price: 140, // below entry 150
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /SHORT liq price.*<= entry/i.test(e))).toBe(true);
  });

  it("rejects liq distance below structural minimum for high leverage", () => {
    // At 100x, natural distance = 1%, min allowed = max(0.05%, 1% * 0.4) = 0.4%
    // entry = 150, liq at 149.5 = 0.33% distance — below 0.4%
    const result = validateTrade(
      validTrade({
        leverage: 100,
        position_size: 10000,
        entry_price: 150,
        liquidation_price: 149.5,
        fees: 8,
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /structurally unsound/i.test(e))).toBe(true);
  });

  it("warns when liq distance deviates significantly from expected", () => {
    // At 10x, expected distance ~= (1/10 - 0.0008) * 100 = 9.92%
    // We set liq at 140 → distance = (150-140)/150 * 100 = 6.67%
    // Deviation = |6.67 - 9.92| / 9.92 = 32.8% — under 60%, may not warn.
    // Use a bigger deviation: liq at 147 → 2% distance, expected ~9.92%, deviation ~80%
    const result = validateTrade(
      validTrade({
        leverage: 10,
        position_size: 1000,
        entry_price: 150,
        liquidation_price: 147,
        fees: 0.8,
      }),
      WALLET,
      NO_POS,
    );
    // With such deviation from expected, we should get a warning
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => /liq distance/i.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Position conflict detection
// ---------------------------------------------------------------------------

describe("trade-firewall: position conflicts", () => {
  it("warns about averaging into same market/side", () => {
    const existing = [makePosition({ market: "SOL", side: "LONG" })];
    const result = validateTrade(validTrade(), WALLET, existing);
    expect(result.warnings.some((w) => /average into it/i.test(w))).toBe(true);
  });

  it("warns about hedge when opening opposite side", () => {
    const existing = [makePosition({ market: "SOL", side: "SHORT" })];
    const result = validateTrade(validTrade(), WALLET, existing);
    expect(result.warnings.some((w) => /hedge/i.test(w))).toBe(true);
  });

  it("no position warnings when no existing positions", () => {
    const result = validateTrade(validTrade(), WALLET, NO_POS);
    expect(result.warnings.every((w) => !/average|hedge/i.test(w))).toBe(true);
  });

  it("no conflict warning for different market", () => {
    const existing = [makePosition({ market: "BTC", side: "LONG" })];
    const result = validateTrade(validTrade(), WALLET, existing);
    expect(result.warnings.every((w) => !/average|hedge/i.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Null/undefined inputs
// ---------------------------------------------------------------------------

describe("trade-firewall: null/undefined/non-object inputs", () => {
  it("rejects null input gracefully", () => {
    const result = validateTrade(null, WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors[0]).toMatch(/null or not an object/i);
  });

  it("rejects undefined input gracefully", () => {
    const result = validateTrade(undefined, WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors[0]).toMatch(/null or not an object/i);
  });

  it("rejects a string input", () => {
    const result = validateTrade("not an object", WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });

  it("rejects a number input", () => {
    const result = validateTrade(42, WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });

  it("rejects an empty object (missing all fields)", () => {
    const result = validateTrade({}, WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Invalid field types
// ---------------------------------------------------------------------------

describe("trade-firewall: invalid field types", () => {
  it("rejects non-numeric leverage", () => {
    const result = validateTrade(validTrade({ leverage: "high" }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });

  it("rejects NaN entry_price", () => {
    const result = validateTrade(validTrade({ entry_price: NaN }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });

  it("rejects Infinity position_size", () => {
    const result = validateTrade(validTrade({ position_size: Infinity }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });

  it("rejects invalid side enum value", () => {
    const result = validateTrade(validTrade({ side: "UP" }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });

  it("rejects empty market string", () => {
    const result = validateTrade(validTrade({ market: "" }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Unknown market
// ---------------------------------------------------------------------------

describe("trade-firewall: unknown market", () => {
  it("rejects a market not in the registry", () => {
    const result = validateTrade(validTrade({ market: "FAKECOIN" }), WALLET, NO_POS);
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /unknown market/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 13. Fee reasonableness
// ---------------------------------------------------------------------------

describe("trade-firewall: fee checks", () => {
  it("rejects fees exceeding 1% of position size", () => {
    const result = validateTrade(
      validTrade({ fees: 15, position_size: 1000 }), // 1.5% > 1%
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /fees/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 14. Size consistency check
// ---------------------------------------------------------------------------

describe("trade-firewall: size consistency", () => {
  it("rejects position_size that deviates too much from collateral * leverage", () => {
    const result = validateTrade(
      validTrade({
        collateral_usd: 100,
        leverage: 10,
        position_size: 2000, // expected ~1000
      }),
      WALLET,
      NO_POS,
    );
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /deviates/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. enforceFirewall wrapper
// ---------------------------------------------------------------------------

describe("trade-firewall: enforceFirewall", () => {
  it("blocks invalid build_trade calls", () => {
    const result = enforceFirewall("build_trade", null, WALLET, NO_POS);
    expect(result.blocked).toBe(true);
    expect(result.errors).toBeDefined();
  });

  it("passes valid build_trade calls", () => {
    const result = enforceFirewall("build_trade", validTrade(), WALLET, NO_POS);
    expect(result.blocked).toBe(false);
  });

  it("returns blocked:false for unknown tool names", () => {
    const result = enforceFirewall("unknown_tool", {}, WALLET, NO_POS);
    expect(result.blocked).toBe(false);
  });

  it("validates close_position_preview", () => {
    const result = enforceFirewall(
      "close_position_preview",
      { market: "SOL", side: "LONG", close_percent: 100, estimated_pnl: 10, estimated_fees: 0.5, exit_price: 155 },
      WALLET,
      NO_POS,
    );
    expect(result.blocked).toBe(false);
  });

  it("blocks invalid close_position_preview", () => {
    const result = enforceFirewall("close_position_preview", null, WALLET, NO_POS);
    expect(result.blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 16. Close preview validation
// ---------------------------------------------------------------------------

describe("trade-firewall: validateClosePreview", () => {
  it("accepts a valid close preview", () => {
    const result = validateClosePreview({
      market: "SOL",
      side: "LONG",
      close_percent: 50,
      estimated_pnl: 25,
      estimated_fees: 0.4,
      exit_price: 160,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects null input", () => {
    const result = validateClosePreview(null);
    expect(result.valid).toBe(false);
  });

  it("rejects unknown market in close preview", () => {
    const result = validateClosePreview({
      market: "FAKECOIN",
      side: "LONG",
      close_percent: 50,
      estimated_pnl: 25,
      estimated_fees: 0.4,
      exit_price: 160,
    });
    expect(result.valid).toBe(false);
    expect((result as FirewallFail).errors.some((e) => /unknown market/i.test(e))).toBe(true);
  });

  it("rejects close_percent > 100", () => {
    const result = validateClosePreview({
      market: "SOL",
      side: "LONG",
      close_percent: 150,
      estimated_pnl: 10,
      estimated_fees: 0.5,
      exit_price: 155,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects extra fields in close preview (.strict())", () => {
    const result = validateClosePreview({
      market: "SOL",
      side: "LONG",
      close_percent: 50,
      estimated_pnl: 10,
      estimated_fees: 0.5,
      exit_price: 155,
      injected: true,
    });
    expect(result.valid).toBe(false);
  });
});
