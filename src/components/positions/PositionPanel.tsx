"use client";

import { useEffect } from "react";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS } from "@/lib/constants";
import {
  formatUsd,
  formatPrice,
  formatPnl,
  formatPnlPct,
} from "@/lib/format";
import type { Position, Side } from "@/lib/types";

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
    <div className="w-[280px] shrink-0 bg-bg-root border-l border-border-subtle overflow-y-auto">
      <div className="p-4 flex flex-col gap-3">
        {/* Header */}
        <span className="text-[11px] font-semibold text-text-tertiary tracking-widest">
          POSITIONS
        </span>

        {!walletConnected ? (
          <span className="text-xs text-text-tertiary text-center py-8">
            Connect wallet to view positions
          </span>
        ) : positions.length === 0 ? (
          <span className="text-xs text-text-tertiary text-center py-8">
            No open positions
          </span>
        ) : (
          positions.map((pos) => (
            <PositionCard key={pos.pubkey} position={pos} />
          ))
        )}
      </div>
    </div>
  );
}

function PositionCard({ position }: { position: Position }) {
  const closePosition = useFlashStore((s) => s.closePosition);
  const isProfit = position.unrealized_pnl >= 0;
  const isLong = position.side === "LONG";
  const accentColor = isLong
    ? "var(--color-accent-long)"
    : "var(--color-accent-short)";
  const pnlColor = isProfit
    ? "var(--color-accent-long)"
    : "var(--color-accent-short)";

  return (
    <div className="rounded-[10px] p-3.5 border border-border-subtle bg-bg-card flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-text-primary">
          {position.market}-PERP
        </span>
        <span
          className="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider"
          style={{
            background: `${accentColor}1F`,
            color: accentColor,
          }}
        >
          {position.side}
        </span>
      </div>

      {/* Subline: collateral + leverage + size */}
      <span className="text-[11px] text-text-tertiary">
        {formatUsd(position.collateral_usd)} · {position.leverage.toFixed(1)}x · Size {formatUsd(position.size_usd)}
      </span>

      {/* PnL */}
      <span
        className="text-base font-semibold"
        style={{ color: pnlColor, fontVariantNumeric: "tabular-nums" }}
      >
        {formatPnl(position.unrealized_pnl)} ({formatPnlPct(position.unrealized_pnl_pct)})
      </span>

      {/* Data rows */}
      <div className="flex flex-col gap-1.5">
        <DataRow label="Entry" value={formatPrice(position.entry_price)} />
        <DataRow label="Mark" value={formatPrice(position.mark_price)} />
        <DataRow
          label="Liq"
          value={formatPrice(position.liquidation_price)}
          color="var(--color-accent-warn)"
        />
        {position.fees > 0 && (
          <DataRow label="Fees" value={formatUsd(position.fees)} />
        )}
      </div>

      {/* Close button */}
      <button
        onClick={() => closePosition(position.market, position.side)}
        className="w-full py-2 rounded-lg text-[11px] font-medium text-text-secondary border border-border-subtle hover:border-text-tertiary hover:text-text-primary transition-colors text-center cursor-pointer"
      >
        Close Position
      </button>
    </div>
  );
}

function DataRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span
        className="text-[11px] font-medium"
        style={{
          color: color ?? "var(--color-text-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
