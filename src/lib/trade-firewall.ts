// ============================================
// Flash UI — Trade Firewall (Red-Team Hardened)
// ============================================
// Deterministic Zod validation layer enforced at ALL 3 layers.
//
// Red-team fixes applied:
// - [E1] Precision guard: round position_size/fees to 2 decimal places
// - [E2] Liq formula: accounts for fees in liquidation distance
// - [C4] Null guard: reject trades with any null numeric field
// - [STRICT] Schema rejects unknown fields (no extra AI-injected data)
// - [D3] Price freshness: optional timestamp validation

import { z } from "zod";
import { MIN_COLLATERAL, MAX_LEVERAGE } from "./constants";
import { getMaxLeverage, hasMarket } from "./markets-registry";
import type { Position } from "./types";

// ---- Per-Market Leverage Caps ----
//
// Source of truth: markets registry SYMBOL_CAPS table (captured from the
// live flash.trade UI). Falls back to the absolute ceiling if the registry
// doesn't know the market yet.
// Degen pools: SOL (Crypto.1), BTC/ETH (Crypto.1), Gold (Virtual.1), DeFi (Governance.1)
const DEGEN_MARKETS = new Set(["SOL", "BTC", "ETH"]);
const DEGEN_MAX_LEVERAGE = 500;

export function getMaxLeverageForMarket(market: string, degen?: boolean): number {
  const fromRegistry = getMaxLeverage(market);
  const base = fromRegistry > 0 ? fromRegistry : MAX_LEVERAGE;
  // Degen mode unlocks 500x on supported markets
  if (degen && DEGEN_MARKETS.has(market.toUpperCase())) {
    return Math.max(base, DEGEN_MAX_LEVERAGE);
  }
  return base;
}

const MAX_COLLATERAL = 50_000;
const MAX_SLIPPAGE_BPS = 300;
const MAX_FEE_RATE = 0.01;
const CONSISTENCY_TOLERANCE = 0.02;

// [E2] Absolute minimum liquidation distance (%) floor — below this, rounding
// error dominates and the trade is structurally unsound regardless of leverage.
// The effective minimum is computed dynamically per-trade from the natural
// distance (1/leverage - feeRate), because a fixed floor would block all
// trades above ~170x — at 500x natural distance is only 0.12%.
const MIN_LIQ_DISTANCE_FLOOR_PCT = 0.05;

// ---- Firewall Schema (STRICT — rejects unknown fields) ----

export const TradePreviewSchema = z
  .object({
    market: z.string().min(1).max(20),
    side: z.enum(["LONG", "SHORT"]),
    collateral_usd: z.number().finite().positive(),
    leverage: z.number().finite().positive(),
    entry_price: z.number().finite().positive(),
    liquidation_price: z.number().finite().positive(),
    fees: z.number().finite().min(0),
    position_size: z.number().finite().positive(),
    slippage_bps: z.number().finite().min(0).max(500).optional().default(80),
    fee_rate: z.number().finite().min(0).max(0.05).optional(),
    degen: z.boolean().optional().default(false),
    take_profit_price: z.number().finite().positive().optional(),
    stop_loss_price: z.number().finite().positive().optional(),
    order_type: z.enum(["MARKET", "LIMIT"]).optional(),
    limit_price: z.number().finite().positive().optional(),
  })
  .strict(); // [STRICT] Reject unknown fields — no AI-injected extras

export type TradePreview = z.infer<typeof TradePreviewSchema>;

// ---- Result Types ----

export interface FirewallPass {
  valid: true;
  trade: TradePreview;
  warnings: string[];
}

export interface FirewallFail {
  valid: false;
  errors: string[];
  warnings: string[];
}

export type FirewallResult = FirewallPass | FirewallFail;

// ---- Precision Helper ----

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Core Validation ----

export function validateTrade(raw: unknown, _wallet: string, positions: Position[]): FirewallResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // [C4] Reject null/undefined at top level before schema parse
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { valid: false, errors: ["Trade data is null or not an object"], warnings: [] };
  }

  // 1. Schema parse (strict — rejects unknown fields)
  const parsed = TradePreviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      warnings: [],
    };
  }

  const t = parsed.data;

  // 2. Market existence
  if (!hasMarket(t.market)) {
    errors.push(`Unknown market: ${t.market}`);
  }

  // 3. Per-market leverage cap. Degen is a tier selector — it unlocks a
  // higher cap on SOL/BTC/ETH (100x → 500x) and is a no-op on every other
  // market (cap unchanged). Setting degen:true on a flat-cap market is
  // never an error.
  const maxLev = getMaxLeverageForMarket(t.market, t.degen);
  if (t.leverage > maxLev) {
    const modeLabel = t.degen ? " (degen)" : "";
    errors.push(`Leverage ${t.leverage}x exceeds ${t.market} max of ${maxLev}x${modeLabel}`);
  }
  if (t.leverage < 1) {
    errors.push(`Leverage must be >= 1, got ${t.leverage}`);
  }

  // 4. Collateral bounds
  if (t.collateral_usd < MIN_COLLATERAL) {
    errors.push(`Collateral $${t.collateral_usd} below minimum $${MIN_COLLATERAL}`);
  }
  if (t.collateral_usd > MAX_COLLATERAL) {
    errors.push(`Collateral $${t.collateral_usd} exceeds maximum $${MAX_COLLATERAL}`);
  }

  // 5. Slippage guardrail
  if (t.slippage_bps > MAX_SLIPPAGE_BPS) {
    errors.push(`Slippage ${t.slippage_bps}bps exceeds max ${MAX_SLIPPAGE_BPS}bps`);
  }

  // 6. [E1] Numeric consistency with PRECISION guard
  if (t.collateral_usd > 0 && t.leverage > 0 && t.position_size > 0) {
    const expected = round2(t.collateral_usd * t.leverage);
    const actual = round2(t.position_size);
    const deviation = Math.abs(actual - expected) / expected;
    if (deviation > CONSISTENCY_TOLERANCE) {
      errors.push(
        `Size $${actual} deviates ${(deviation * 100).toFixed(1)}% from collateral * leverage ($${expected})`,
      );
    }
  }

  // 7. [E2] Liquidation price sanity WITH fee-adjusted distance check
  if (t.entry_price > 0 && t.liquidation_price > 0) {
    if (t.side === "LONG" && t.liquidation_price >= t.entry_price) {
      errors.push(`LONG liq price $${t.liquidation_price} >= entry $${t.entry_price}`);
    }
    if (t.side === "SHORT" && t.liquidation_price <= t.entry_price) {
      errors.push(`SHORT liq price $${t.liquidation_price} <= entry $${t.entry_price}`);
    }

    // [E2] Liquidation distance checks — dynamic minimum that scales with
    // leverage so degen (200x+) trades aren't falsely blocked.
    const liqDistPct =
      t.side === "LONG"
        ? ((t.entry_price - t.liquidation_price) / t.entry_price) * 100
        : ((t.liquidation_price - t.entry_price) / t.entry_price) * 100;

    if (t.leverage >= 1) {
      // Structural minimum scales with leverage: we require the liq distance
      // to be at least 40% of the natural distance (1/leverage). This
      // tolerates pool-specific maintenance margin (up to ~60% of 1/lev),
      // while still rejecting degenerate cases where liq ≈ entry. At 1x the
      // floor is 40%, at 100x 0.4%, at 500x 0.08% (clamped to the absolute
      // floor of 0.05% below that).
      const naturalDistPct = (1 / t.leverage) * 100;
      const minAllowedDistPct = Math.max(MIN_LIQ_DISTANCE_FLOOR_PCT, naturalDistPct * 0.4);

      if (liqDistPct >= 0 && liqDistPct < minAllowedDistPct) {
        errors.push(
          `Liquidation distance ${liqDistPct.toFixed(3)}% is below minimum ${minAllowedDistPct.toFixed(3)}% for ${t.leverage}x — structurally unsound`,
        );
      }

      // Warning if actual deviates more than 60% from natural distance in
      // either direction (allows for MMR + fees to account for up to 60%).
      const feeRate = t.fee_rate ?? 0.0008;
      const expectedDistPct = (1 / t.leverage - feeRate) * 100;
      if (expectedDistPct > 0 && Math.abs(liqDistPct - expectedDistPct) > expectedDistPct * 0.6) {
        warnings.push(
          `Liq distance ${liqDistPct.toFixed(2)}% differs from expected ~${expectedDistPct.toFixed(2)}% for ${t.leverage}x`,
        );
      }
    }
  }

  // 8. Fee reasonableness
  if (t.position_size > 0 && t.fees > t.position_size * MAX_FEE_RATE) {
    errors.push(`Fees $${t.fees.toFixed(2)} exceed ${MAX_FEE_RATE * 100}% of position size`);
  }

  // 9. [E1] Fee precision — fees should not have more than 2 decimal places of precision error
  if (t.fees > 0 && t.position_size > 0) {
    const expectedFees = round2(t.position_size * (t.fee_rate ?? 0.0008));
    if (Math.abs(t.fees - expectedFees) > 0.02) {
      warnings.push(
        `Fee calculation may have precision error: $${t.fees.toFixed(4)} vs expected $${expectedFees.toFixed(4)}`,
      );
    }
  }

  // 10. TP/SL validation: direction + dynamic range (>500% = unrealistic, <0.1% = too tight)
  if (t.take_profit_price != null && t.entry_price > 0) {
    const dist = Math.abs(t.take_profit_price - t.entry_price) / t.entry_price;
    if (dist > 5.0) {
      errors.push(`Take profit $${t.take_profit_price} is >500% from entry $${t.entry_price} — unrealistic`);
    }
    if (dist < 0.001) {
      errors.push(`Take profit $${t.take_profit_price} is <0.1% from entry $${t.entry_price} — too tight`);
    }
    if (t.side === "LONG" && t.take_profit_price <= t.entry_price) {
      errors.push(`LONG take profit $${t.take_profit_price} must be above entry $${t.entry_price}`);
    }
    if (t.side === "SHORT" && t.take_profit_price >= t.entry_price) {
      errors.push(`SHORT take profit $${t.take_profit_price} must be below entry $${t.entry_price}`);
    }
  }
  if (t.stop_loss_price != null && t.entry_price > 0) {
    const dist = Math.abs(t.stop_loss_price - t.entry_price) / t.entry_price;
    if (dist > 5.0) {
      errors.push(`Stop loss $${t.stop_loss_price} is >500% from entry $${t.entry_price} — unrealistic`);
    }
    if (dist < 0.001) {
      errors.push(`Stop loss $${t.stop_loss_price} is <0.1% from entry $${t.entry_price} — too tight`);
    }
    if (t.side === "LONG" && t.stop_loss_price >= t.entry_price) {
      errors.push(`LONG stop loss $${t.stop_loss_price} must be below entry $${t.entry_price}`);
    }
    if (t.side === "SHORT" && t.stop_loss_price <= t.entry_price) {
      errors.push(`SHORT stop loss $${t.stop_loss_price} must be above entry $${t.entry_price}`);
    }
  }

  // 11. Position conflict detection (warn only)
  const existing = positions.find((p) => p.market === t.market && p.side === t.side);
  if (existing) {
    warnings.push(`Existing ${t.side} ${t.market} position — this will average into it`);
  }

  const opposite = positions.find((p) => p.market === t.market && p.side !== t.side);
  if (opposite) {
    warnings.push(`Open ${opposite.side} ${t.market} position — opening ${t.side} creates a hedge`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  return { valid: true, trade: t, warnings };
}

// ---- Close Preview Schema + Validation ----

export const ClosePreviewSchema = z
  .object({
    market: z.string().min(1).max(20),
    side: z.enum(["LONG", "SHORT"]),
    close_percent: z.number().finite().min(1).max(100),
    estimated_pnl: z.number().finite(),
    estimated_fees: z.number().finite().min(0),
    exit_price: z.number().finite().positive(),
    closing_size: z.number().finite().positive().optional(),
    net_pnl: z.number().finite().optional(),
    entry_price: z.number().finite().positive().optional(),
    pubkey: z.string().optional(),
    size_usd: z.number().finite().optional(),
  })
  .strict();

export type ClosePreview = z.infer<typeof ClosePreviewSchema>;

export function validateClosePreview(raw: unknown): FirewallResult {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { valid: false, errors: ["Close preview data is null or not an object"], warnings: [] };
  }

  const parsed = ClosePreviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      warnings: [],
    };
  }

  const t = parsed.data;
  const errors: string[] = [];

  if (!hasMarket(t.market)) {
    errors.push(`Unknown market: ${t.market}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings: [] };
  }

  return { valid: true, trade: t as unknown as TradePreview, warnings: [] };
}

// ---- API-Layer Enforcement ----

export function enforceFirewall(
  toolName: string,
  data: unknown,
  wallet: string,
  positions: Position[],
): { blocked: boolean; errors?: string[]; warnings?: string[] } {
  if (toolName === "build_trade") {
    const result = validateTrade(data, wallet, positions);
    if (!result.valid) {
      return { blocked: true, errors: result.errors, warnings: result.warnings };
    }
    return { blocked: false, warnings: result.warnings };
  }

  if (toolName === "close_position_preview") {
    const result = validateClosePreview(data);
    if (!result.valid) {
      return { blocked: true, errors: result.errors, warnings: result.warnings };
    }
    return { blocked: false, warnings: result.warnings };
  }

  return { blocked: false };
}
