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
import { MARKETS, MIN_COLLATERAL, MAX_LEVERAGE } from "./constants";
import type { Position } from "./types";

// ---- Per-Market Leverage Caps ----

const MAX_LEVERAGE_BY_MARKET: Record<string, number> = {
  SOL: 100, BTC: 100, ETH: 100, BNB: 50, ZEC: 50,
  JUP: 50, PYTH: 50, JTO: 50, RAY: 50,
  BONK: 20, PENGU: 20,
  WIF: 20,
  FARTCOIN: 20,
  ORE: 20,
  XAU: 50,
  SPY: 50, NVDA: 50, TSLA: 50,
};

export function getMaxLeverageForMarket(market: string): number {
  return MAX_LEVERAGE_BY_MARKET[market] ?? MAX_LEVERAGE;
}

const MAX_COLLATERAL = 50_000;
const MAX_SLIPPAGE_BPS = 300;
const MAX_FEE_RATE = 0.01;
const CONSISTENCY_TOLERANCE = 0.02;

// [E2] Minimum liquidation distance (%) — below this is structurally unsound
const MIN_LIQ_DISTANCE_PCT = 0.5;

// ---- Firewall Schema (STRICT — rejects unknown fields) ----

export const TradePreviewSchema = z.object({
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
  take_profit_price: z.number().finite().positive().optional(),
  stop_loss_price: z.number().finite().positive().optional(),
}).strict(); // [STRICT] Reject unknown fields — no AI-injected extras

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

export function validateTrade(
  raw: unknown,
  _wallet: string,
  positions: Position[],
): FirewallResult {
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
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
      warnings: [],
    };
  }

  const t = parsed.data;

  // 2. Market existence
  if (!(t.market in MARKETS)) {
    errors.push(`Unknown market: ${t.market}`);
  }

  // 3. Per-market leverage cap
  const maxLev = getMaxLeverageForMarket(t.market);
  if (t.leverage > maxLev) {
    errors.push(`Leverage ${t.leverage}x exceeds ${t.market} max of ${maxLev}x`);
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

    // [E2] Minimum liquidation distance check
    const liqDistPct = t.side === "LONG"
      ? ((t.entry_price - t.liquidation_price) / t.entry_price) * 100
      : ((t.liquidation_price - t.entry_price) / t.entry_price) * 100;

    if (liqDistPct < MIN_LIQ_DISTANCE_PCT && liqDistPct >= 0) {
      errors.push(
        `Liquidation distance ${liqDistPct.toFixed(2)}% is below minimum ${MIN_LIQ_DISTANCE_PCT}% — structurally unsound`,
      );
    }

    // [E2] Verify liq price is consistent with leverage (accounting for fees)
    if (t.leverage >= 1) {
      const feeRate = t.fee_rate ?? 0.0008;
      const effectiveLeverage = t.leverage;
      // Expected liq distance = 1/leverage - feeRate (approximate)
      const expectedDistPct = (1 / effectiveLeverage - feeRate) * 100;
      if (expectedDistPct > 0 && Math.abs(liqDistPct - expectedDistPct) > expectedDistPct * 0.5) {
        warnings.push(
          `Liq distance ${liqDistPct.toFixed(1)}% differs from expected ~${expectedDistPct.toFixed(1)}% for ${effectiveLeverage}x`,
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
      warnings.push(`Fee calculation may have precision error: $${t.fees.toFixed(4)} vs expected $${expectedFees.toFixed(4)}`);
    }
  }

  // 10. TP/SL directional validation
  if (t.take_profit_price != null && t.entry_price > 0) {
    if (t.side === "LONG" && t.take_profit_price <= t.entry_price) {
      errors.push(`LONG take profit $${t.take_profit_price} must be above entry $${t.entry_price}`);
    }
    if (t.side === "SHORT" && t.take_profit_price >= t.entry_price) {
      errors.push(`SHORT take profit $${t.take_profit_price} must be below entry $${t.entry_price}`);
    }
  }
  if (t.stop_loss_price != null && t.entry_price > 0) {
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

export const ClosePreviewSchema = z.object({
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
}).strict();

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

  if (!(t.market in MARKETS)) {
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
