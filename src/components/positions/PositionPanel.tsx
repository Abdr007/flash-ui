"use client";

import { useEffect, useRef, useState } from "react";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS } from "@/lib/constants";
import { formatUsd, formatPrice, formatPnl, formatPnlPct, safe, liqDistancePct } from "@/lib/format";
import { useNumberSpring } from "@/hooks/useSpring";
import type { Position } from "@/lib/types";

export default function PositionPanel() {
  const positions = useFlashStore((s) => s.positions);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  const walletConnected = useFlashStore((s) => s.walletConnected);

  const refreshRef = useRef(refreshPositions);
  useEffect(() => { refreshRef.current = refreshPositions; });

  useEffect(() => {
    if (!walletConnected) return;
    refreshRef.current();
    const interval = setInterval(() => refreshRef.current(), POSITION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [walletConnected]);

  return (
    <div className="w-[280px] shrink-0 bg-bg-root border-l border-border-subtle overflow-y-auto">
      <div className="px-4 py-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-text-secondary tracking-wide">Positions</span>
          {positions.length > 0 && (
            <span className="text-[11px] text-text-tertiary num">{positions.length}</span>
          )}
        </div>

        {!walletConnected ? (
          <span className="text-[13px] text-text-tertiary py-8 text-center">
            Connect wallet
          </span>
        ) : positions.length === 0 ? (
          <span className="text-[13px] text-text-tertiary py-8 text-center">
            No positions
          </span>
        ) : (
          positions.map((pos) => <PositionRow key={pos.pubkey} position={pos} />)
        )}
      </div>
    </div>
  );
}

function PositionRow({ position }: { position: Position }) {
  const closePosition = useFlashStore((s) => s.closePosition);
  const pnl = safe(position.unrealized_pnl);
  const pnlPct = safe(position.unrealized_pnl_pct);
  const isProfit = pnl >= 0;
  const isLong = position.side === "LONG";
  const sideColor = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const pnlColor = isProfit ? "var(--color-accent-long)" : "var(--color-accent-short)";

  // Spring-animated PnL (smooth transitions, no jumps)
  const springPnl = useNumberSpring(pnl, { stiffness: 180, damping: 22 });
  const springPnlPct = useNumberSpring(pnlPct, { stiffness: 180, damping: 22 });

  // Liquidation distance
  const liqDist = liqDistancePct(position.mark_price || position.entry_price, position.liquidation_price, position.side);

  // Flash on PnL direction change
  const [flash, setFlash] = useState(false);
  const prevProfitRef = useRef(isProfit);
  useEffect(() => {
    if (prevProfitRef.current !== isProfit) {
      prevProfitRef.current = isProfit;
      const raf = requestAnimationFrame(() => setFlash(true));
      const t = setTimeout(() => setFlash(false), 400);
      return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    }
  }, [isProfit]);

  return (
    <div className="glass-card overflow-hidden" style={{
      transition: "box-shadow 400ms ease-out",
      boxShadow: flash ? `inset 0 0 12px ${pnlColor}20` : "none",
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text-primary">{position.market}</span>
          <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full"
            style={{ color: sideColor, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
            {position.side}
          </span>
        </div>
        <span className="num text-[13px] font-semibold" style={{ color: pnlColor, transition: "color 300ms" }}>
          {formatPnl(springPnl)}
        </span>
      </div>

      {/* Data */}
      <div className="px-3.5 py-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
        <Row label="Size" value={formatUsd(position.size_usd)} />
        <Row label="Lev" value={`${safe(position.leverage).toFixed(1)}x`} />
        <Row label="Entry" value={formatPrice(position.entry_price)} />
        <Row label="Mark" value={formatPrice(position.mark_price)} />
        <Row label="Liq" value={formatPrice(position.liquidation_price)} color="var(--color-accent-warn)" />
        <Row label="PnL %" value={formatPnlPct(springPnlPct)} color={pnlColor} />
      </div>

      {/* Liquidation distance bar */}
      {liqDist > 0 && (
        <div className="px-3.5 pb-2 pt-0.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 bg-border-subtle rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${Math.min(safe(liqDist), 100)}%`,
                background: liqDist < 10 ? "var(--color-accent-short)" : liqDist < 25 ? "var(--color-accent-warn)" : "var(--color-accent-long)",
                transition: "width 500ms ease-out, background-color 300ms",
              }} />
            </div>
            <span className="text-[10px] num" style={{
              color: liqDist < 10 ? "var(--color-accent-short)" : liqDist < 25 ? "var(--color-accent-warn)" : "var(--color-text-tertiary)",
            }}>{safe(liqDist).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Close */}
      <button
        onClick={() => closePosition(position.market, position.side)}
        className="w-full py-2 text-[12px] font-medium text-text-tertiary border-t border-border-subtle hover:text-accent-short hover:bg-accent-short/5 transition-colors cursor-pointer rounded-b-xl"
      >
        Close
      </button>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-text-tertiary">{label}</span>
      <span className="num font-medium" style={{ color: color ?? "var(--color-text-secondary)" }}>{value}</span>
    </div>
  );
}
