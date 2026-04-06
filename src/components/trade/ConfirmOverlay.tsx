"use client";

import { useFlashStore } from "@/store";
import { formatUsd, formatPrice, liqDistancePct, safe } from "@/lib/format";

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
      <div className="absolute inset-0 bg-bg-root/80 backdrop-blur-sm" onClick={isInFlight ? undefined : cancelTrade} />

      <div className="relative w-[440px] glass-card overflow-hidden" style={{ animation: "slideUp 200ms ease-out" }}>
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-[16px] font-semibold text-text-primary">
            {isInFlight ? (trade.status === "SIGNING" ? "Signing" : "Building Transaction") : "Confirm Trade"}
          </span>
          <span className="text-[12px] font-bold px-3 py-1 rounded-full"
            style={{ color: accentColor, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
            {trade.action} {trade.market}
          </span>
        </div>

        {/* High leverage warning */}
        {safe(trade.leverage) > 10 && !isInFlight && (
          <div className="px-6 py-3 text-[13px] flex items-center gap-2"
            style={{ color: "var(--color-accent-warn)", background: "rgba(245,158,11,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <span>⚠</span>
            <span>{safe(trade.leverage)}x leverage — liquidation {safe(liqDist).toFixed(1)}% from entry{safe(trade.collateral_usd) >= 500 ? " · large trade" : ""}</span>
          </div>
        )}

        {/* Data */}
        <div className="px-6 py-5 flex flex-col gap-3 text-[14px]">
          <DataRow label="Collateral" value={formatUsd(trade.collateral_usd)} />
          <DataRow label="Size" value={formatUsd(trade.position_size)} />
          <DataRow label="Fees" value={formatUsd(trade.fees)} />
          <DataRow
            label="Liquidation"
            value={`${formatPrice(trade.liquidation_price)} (${safe(liqDist).toFixed(1)}%)`}
            color={liqDist < 10 ? "var(--color-accent-short)" : "var(--color-accent-warn)"}
          />
        </div>

        {/* TP/SL */}
        {(trade.take_profit_price || trade.stop_loss_price) && !isInFlight && (
          <div className="flex items-center gap-3 px-6 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {trade.take_profit_price && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold tracking-wider" style={{ color: "var(--color-accent-long)" }}>TP</span>
                <span className="text-[13px] num font-medium text-text-primary">{formatPrice(trade.take_profit_price)}</span>
              </div>
            )}
            {trade.stop_loss_price && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold tracking-wider" style={{ color: "var(--color-accent-short)" }}>SL</span>
                <span className="text-[13px] num font-medium text-text-primary">{formatPrice(trade.stop_loss_price)}</span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {isInFlight ? (
          <div className="px-6 py-4 flex items-center gap-3 text-[14px] text-text-tertiary"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="w-3.5 h-3.5 border-2 border-text-tertiary border-t-transparent rounded-full" style={{ animation: "spin 0.8s linear infinite" }} />
            {trade.status === "SIGNING" ? "Sign in wallet..." : "Building transaction..."}
          </div>
        ) : (
          <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <button
              onClick={executeTrade}
              className="flex-1 py-4 text-[14px] font-bold tracking-wide text-white transition-colors cursor-pointer"
              style={{ background: accentColor, borderRadius: "0 0 0 16px" }}
            >
              Execute
            </button>
            <button
              onClick={cancelTrade}
              className="px-8 py-4 text-[14px] text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
              style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", borderRadius: "0 0 16px 0" }}
            >
              Cancel
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
      <span className="num font-medium" style={{ color: color ?? "var(--color-text-primary)" }}>{value}</span>
    </div>
  );
}
