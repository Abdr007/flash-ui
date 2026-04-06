"use client";

// ============================================
// Flash UI — Real-Time PnL State Engine
// ============================================
// Interval-based safety net that recomputes PnL from cached prices.
// Guarantees live PnL updates even when SSE stream is down.
//
// ARCHITECTURE:
//   SSE stream (primary, sub-second) → handleStreamPrices → recomputeAllPnl
//   This hook (fallback, 300-800ms)  → recomputeAllPnl (same function)
//
// Both paths use the SAME pure computation engine.
// Both paths apply the SAME timestamp guards against data regression.
//
// GUARANTEES:
//   - Zero network calls (reads Zustand store only)
//   - Skip if no positions
//   - Skip if no price changes (hash comparison)
//   - Adaptive interval: faster during high volatility
//   - Single batch store update per tick
//   - Never crashes (try/catch wrapper)

import { useEffect, useRef, useMemo } from "react";
import { useFlashStore } from "@/store";
import { recomputeAllPnl } from "@/lib/pnl";

// ---- Adaptive Interval Config ----
const INTERVAL_FAST_MS = 300;   // High volatility (>1% move detected)
const INTERVAL_NORMAL_MS = 500; // Normal market conditions
const INTERVAL_SLOW_MS = 800;   // No recent price changes
const VOLATILITY_THRESHOLD = 0.01; // 1% price change = "volatile"
const FAST_MODE_DURATION_MS = 10_000; // Stay fast for 10s after volatility spike

export function useLivePnl() {
  const hasPositions = useFlashStore((s) => s.positions.length > 0);
  const streamStatus = useFlashStore((s) => s.streamStatus);

  // Refs for interval callback (avoid stale closures)
  const storeRef = useRef(useFlashStore);
  const lastHashRef = useRef("");
  const lastPricesRef = useRef<Record<string, number>>({});
  const lastVolatileSpikeRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Determine if SSE is healthy — if so, interval can be slower
  const sseHealthy = streamStatus === "connected";

  // Compute current target interval
  const targetInterval = useMemo(() => {
    if (!hasPositions) return INTERVAL_NORMAL_MS;
    const timeSinceSpike = Date.now() - lastVolatileSpikeRef.current;
    if (timeSinceSpike < FAST_MODE_DURATION_MS) return INTERVAL_FAST_MS;
    if (sseHealthy) return INTERVAL_SLOW_MS; // SSE doing the heavy lifting
    return INTERVAL_NORMAL_MS;
  }, [hasPositions, sseHealthy]);

  useEffect(() => {
    if (!hasPositions) return;

    function tick() {
      try {
        const store = storeRef.current;
        const state = store.getState();
        const positions = state.positions;
        const prices = state.prices;

        if (positions.length === 0) return;

        // ---- Hash: market:price pairs for position markets only ----
        let hash = "";
        for (const pos of positions) {
          const p = prices[pos.market];
          if (p) hash += `${pos.market}:${p.price},`;
        }

        // Skip if nothing changed since last tick
        if (hash === lastHashRef.current) return;
        lastHashRef.current = hash;

        // ---- Volatility detection: check for >1% moves ----
        for (const pos of positions) {
          const p = prices[pos.market];
          if (!p) continue;
          const prev = lastPricesRef.current[pos.market];
          if (prev && prev > 0) {
            const change = Math.abs(p.price - prev) / prev;
            if (change > VOLATILITY_THRESHOLD) {
              lastVolatileSpikeRef.current = Date.now();
              break;
            }
          }
          lastPricesRef.current[pos.market] = p.price;
        }

        // ---- Recompute PnL (single source of truth: recomputeAllPnl) ----
        const { positions: updated, changed } = recomputeAllPnl(positions, prices);
        if (changed) {
          store.setState({ positions: updated });
        }
      } catch {
        // Never crash — silent recovery
      }
    }

    // Clear any existing interval before setting new one
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(tick, targetInterval);

    // Run immediately on mount
    tick();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasPositions, targetInterval]);
}
