// ============================================
// Flash UI — PnL Computation Engine
// ============================================
//
// Pure functions. No side effects. No state mutation.
// Computes PnL from mark price, entry price, and position size.
//
// Formula:
//   LONG:  pnl = (mark - entry) / entry * size
//   SHORT: pnl = (entry - mark) / entry * size
//   pnlPct = pnl / collateral * 100

import type { Position, MarketPrice } from "./types";

/** Recompute PnL for a single position given a live mark price */
export function computePositionPnl(position: Position, markPrice: number): Position {
  // Validate inputs — return unchanged if invalid
  if (
    !Number.isFinite(markPrice) ||
    markPrice <= 0 ||
    !Number.isFinite(position.entry_price) ||
    position.entry_price <= 0 ||
    !Number.isFinite(position.size_usd) ||
    position.size_usd <= 0 ||
    !Number.isFinite(position.collateral_usd) ||
    position.collateral_usd <= 0
  ) {
    return position;
  }

  let pnl: number;
  if (position.side === "LONG") {
    pnl = ((markPrice - position.entry_price) / position.entry_price) * position.size_usd;
  } else {
    pnl = ((position.entry_price - markPrice) / position.entry_price) * position.size_usd;
  }

  const pnlPct = (pnl / position.collateral_usd) * 100;

  // Final NaN guard
  if (!Number.isFinite(pnl) || !Number.isFinite(pnlPct)) {
    return position;
  }

  return {
    ...position,
    mark_price: markPrice,
    unrealized_pnl: pnl,
    unrealized_pnl_pct: pnlPct,
  };
}

/** Recompute PnL for all positions given a price map. Only updates positions whose market has a new price. */
export function recomputeAllPnl(
  positions: Position[],
  prices: Record<string, MarketPrice>,
): { positions: Position[]; changed: boolean } {
  let changed = false;
  const updated = positions.map((pos) => {
    const livePrice = prices[pos.market];
    if (!livePrice || !Number.isFinite(livePrice.price) || livePrice.price <= 0) {
      return pos;
    }

    // Skip if mark price hasn't changed
    if (pos.mark_price === livePrice.price) {
      return pos;
    }

    changed = true;
    return computePositionPnl(pos, livePrice.price);
  });

  return { positions: updated, changed };
}
