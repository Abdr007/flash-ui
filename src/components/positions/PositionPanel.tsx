"use client";

import { useEffect } from "react";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS } from "@/lib/constants";
import { formatUsd, formatPrice, formatPnl, formatPnlPct } from "@/lib/format";
import type { Position } from "@/lib/types";

export default function PositionPanel() {
  const positions = useFlashStore((s) => s.positions);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  const walletConnected = useFlashStore((s) => s.walletConnected);

  useEffect(() => {
    if (!walletConnected) return;
    refreshPositions();
    const interval = setInterval(refreshPositions, POSITION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [walletConnected, refreshPositions]);

  return (
    <div className="w-[260px] shrink-0 bg-bg-root border-l border-border-subtle overflow-y-auto">
      <div className="px-3 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-text-tertiary tracking-widest">POSITIONS</span>
          {positions.length > 0 && (
            <span className="text-[10px] font-mono text-text-tertiary">{positions.length}</span>
          )}
        </div>

        {!walletConnected ? (
          <span className="text-[11px] font-mono text-text-tertiary py-6 text-center">
            connect wallet
          </span>
        ) : positions.length === 0 ? (
          <span className="text-[11px] font-mono text-text-tertiary py-6 text-center">
            no positions
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
  const isProfit = position.unrealized_pnl >= 0;
  const isLong = position.side === "LONG";
  const sideColor = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const pnlColor = isProfit ? "var(--color-accent-long)" : "var(--color-accent-short)";

  return (
    <div className="border border-border-subtle bg-bg-card" style={{ borderRadius: "2px" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border-subtle">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono font-medium text-text-primary">{position.market}</span>
          <span className="text-[9px] font-mono font-bold tracking-widest" style={{ color: sideColor }}>
            {position.side}
          </span>
        </div>
        <span className="num text-[12px] font-semibold" style={{ color: pnlColor }}>
          {formatPnl(position.unrealized_pnl)}
        </span>
      </div>

      {/* Data */}
      <div className="px-2.5 py-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono">
        <Row label="size" value={formatUsd(position.size_usd)} />
        <Row label="lev" value={`${position.leverage.toFixed(1)}x`} />
        <Row label="entry" value={formatPrice(position.entry_price)} />
        <Row label="mark" value={formatPrice(position.mark_price)} />
        <Row label="liq" value={formatPrice(position.liquidation_price)} color="var(--color-accent-warn)" />
        <Row label="pnl%" value={formatPnlPct(position.unrealized_pnl_pct)} color={pnlColor} />
      </div>

      {/* Close */}
      <button
        onClick={() => closePosition(position.market, position.side)}
        className="w-full py-1 text-[10px] font-mono text-text-tertiary border-t border-border-subtle hover:text-accent-short hover:bg-accent-short/5 transition-colors cursor-pointer"
      >
        CLOSE
      </button>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-text-tertiary">{label}</span>
      <span className="num" style={{ color: color ?? "var(--color-text-secondary)" }}>{value}</span>
    </div>
  );
}
