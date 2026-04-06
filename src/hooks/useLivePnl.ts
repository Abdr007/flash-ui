"use client";

// ============================================
// Flash UI — Real-Time PnL Stream Hook
// ============================================
// Safety-net interval loop that recomputes PnL from the store's
// price map every 500ms. This catches cases where:
// - SSE stream is down and REST poll hasn't fired yet
// - Price arrived for a market but PnL wasn't recomputed
// - New position was added between SSE ticks
//
// RULES:
// - No network calls (reads store prices only)
// - No blocking (requestAnimationFrame-friendly)
// - Skip if no positions
// - Skip if no price changes since last computation

import { useEffect, useRef } from "react";
import { useFlashStore } from "@/store";
import { recomputeAllPnl } from "@/lib/pnl";

const PNL_INTERVAL_MS = 500;

export function useLivePnl() {
  const positions = useFlashStore((s) => s.positions);
  const prices = useFlashStore((s) => s.prices);
  const positionsRef = useRef(positions);
  const pricesRef = useRef(prices);
  positionsRef.current = positions;
  pricesRef.current = prices;

  // Track last price snapshot hash to skip no-op recomputations
  const lastPriceHashRef = useRef("");

  useEffect(() => {
    if (positions.length === 0) return;

    const interval = setInterval(() => {
      const currentPositions = positionsRef.current;
      const currentPrices = pricesRef.current;

      if (currentPositions.length === 0) return;

      // Quick hash: concatenate mark prices for position markets
      let hash = "";
      for (const pos of currentPositions) {
        const p = currentPrices[pos.market];
        hash += p ? `${pos.market}:${p.price},` : "";
      }

      // Skip if nothing changed
      if (hash === lastPriceHashRef.current) return;
      lastPriceHashRef.current = hash;

      // Recompute PnL (pure function, <0.1ms for typical position count)
      const { positions: updated, changed } = recomputeAllPnl(currentPositions, currentPrices);
      if (changed) {
        useFlashStore.setState({ positions: updated });
      }
    }, PNL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [positions.length > 0]); // Only re-setup when positions appear/disappear
}
