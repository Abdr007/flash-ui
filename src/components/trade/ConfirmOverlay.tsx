"use client";

import { useFlashStore } from "@/store";
import { formatUsd, formatPrice, liqDistancePct } from "@/lib/format";

export default function ConfirmOverlay() {
  const trade = useFlashStore((s) => s.activeTrade);
  const executeTrade = useFlashStore((s) => s.executeTrade);
  const cancelTrade = useFlashStore((s) => s.cancelTrade);

  if (!trade || (trade.status !== "CONFIRMING" && trade.status !== "EXECUTING" && trade.status !== "SIGNING")) {
    return null;
  }

  const isLong = trade.action === "LONG";
  const isInFlight = trade.status === "EXECUTING" || trade.status === "SIGNING";
  const accentColor = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const liqDist = trade.entry_price && trade.liquidation_price
    ? liqDistancePct(trade.entry_price, trade.liquidation_price, trade.action) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-bg-root/80" onClick={isInFlight ? undefined : cancelTrade} />

      <div className="relative w-[380px] border border-border-subtle bg-bg-card" style={{ borderRadius: "2px", animation: "slideUp 150ms ease-out" }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
          <span className="text-[12px] font-mono font-semibold text-text-primary tracking-wide">
            {isInFlight ? (trade.status === "SIGNING" ? "SIGNING" : "BUILDING TX") : "CONFIRM TRADE"}
          </span>
          <span className="text-[10px] font-mono font-bold tracking-widest" style={{ color: accentColor }}>
            {trade.action} {trade.market}
          </span>
        </div>

        {/* High leverage warning */}
        {(trade.leverage ?? 0) > 10 && !isInFlight && (
          <div className="px-4 py-2 text-[10px] font-mono border-b border-border-subtle" style={{ color: "var(--color-accent-warn)", background: "rgba(232, 160, 32, 0.04)" }}>
            ⚠ {trade.leverage}x leverage — liquidation {liqDist.toFixed(1)}% from entry
            {(trade.collateral_usd ?? 0) >= 500 && " · large trade"}
          </div>
        )}

        {/* Data */}
        <div className="px-4 py-3 flex flex-col gap-1.5 text-[12px] font-mono">
          <DataRow label="collateral" value={formatUsd(trade.collateral_usd)} />
          <DataRow label="size" value={formatUsd(trade.position_size)} />
          <DataRow label="fees" value={formatUsd(trade.fees)} />
          <DataRow label="liquidation" value={`${formatPrice(trade.liquidation_price)} (${liqDist.toFixed(1)}%)`} color={liqDist < 10 ? "var(--color-accent-short)" : "var(--color-accent-warn)"} />
        </div>

        {/* Actions */}
        {isInFlight ? (
          <div className="px-4 py-3 border-t border-border-subtle flex items-center gap-2 text-[11px] font-mono text-text-tertiary">
            <span className="w-2.5 h-2.5 border-2 border-text-tertiary border-t-transparent rounded-full" style={{ animation: "spin 0.8s linear infinite" }} />
            {trade.status === "SIGNING" ? "sign in wallet..." : "building transaction..."}
          </div>
        ) : (
          <div className="flex border-t border-border-subtle">
            <button
              onClick={executeTrade}
              className="flex-1 py-3 text-[12px] font-mono font-semibold tracking-wide text-white transition-colors cursor-pointer"
              style={{ background: accentColor }}
            >
              EXECUTE
            </button>
            <button
              onClick={cancelTrade}
              className="px-5 py-3 text-[12px] font-mono text-text-tertiary border-l border-border-subtle hover:text-text-secondary transition-colors cursor-pointer"
            >
              CANCEL
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DataRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-text-tertiary">{label}</span>
      <span className="num" style={{ color: color ?? "var(--color-text-primary)" }}>{value}</span>
    </div>
  );
}
