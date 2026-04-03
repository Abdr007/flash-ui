"use client";

import type { TradeObject } from "@/lib/types";
import { useFlashStore } from "@/store";
import { formatPrice, formatUsd, formatLeverage, formatPercent, liqDistancePct } from "@/lib/format";
import { HIGH_LEVERAGE_THRESHOLD } from "@/lib/constants";

export default function TradeCard({ trade }: { trade: TradeObject }) {
  const confirmTrade = useFlashStore((s) => s.confirmTrade);
  const cancelTrade = useFlashStore((s) => s.cancelTrade);
  const walletConnected = useFlashStore((s) => s.walletConnected);

  const isLong = trade.action === "LONG";
  const accentColor = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const isReady = trade.status === "READY";
  const isError = trade.status === "ERROR";
  const isExecuting = trade.status === "EXECUTING" || trade.status === "SIGNING";
  const isSuccess = trade.status === "SUCCESS";
  const highLev = (trade.leverage ?? 0) >= HIGH_LEVERAGE_THRESHOLD;

  return (
    <div
      className="w-full max-w-[440px] border bg-bg-card"
      style={{
        borderColor: isSuccess ? `${accentColor}40` : isError ? "var(--color-accent-short)30" : "var(--color-border-subtle)",
        borderRadius: "2px",
        animation: "slideUp 150ms ease-out",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-[12px] font-mono font-medium text-text-primary tracking-wide">
          {trade.market ? `${trade.market}-PERP` : "—"}
        </span>
        <span
          className="text-[10px] font-mono font-bold tracking-widest px-1.5 py-0.5"
          style={{
            color: accentColor,
            background: `${accentColor}12`,
          }}
        >
          {trade.action}
        </span>
      </div>

      {/* Data Grid */}
      <div className="grid grid-cols-2 gap-px bg-border-subtle">
        <Cell label="ENTRY" value={formatPrice(trade.entry_price)} />
        <Cell label="LIQ" value={formatPrice(trade.liquidation_price)} color="var(--color-accent-warn)" />
        <Cell label="SIZE" value={formatUsd(trade.position_size)} />
        <Cell label="LEV" value={trade.leverage ? formatLeverage(trade.leverage) : "—"} color={highLev ? "var(--color-accent-warn)" : undefined} />
        <Cell label="COLLATERAL" value={trade.collateral_usd ? formatUsd(trade.collateral_usd) : "—"} />
        <Cell label="FEES" value={trade.fees != null && trade.fee_rate != null ? `${formatUsd(trade.fees)} (${formatPercent(trade.fee_rate)})` : "—"} />
      </div>

      {/* High leverage warning */}
      {highLev && isReady && (
        <div className="px-3 py-1.5 text-[10px] font-mono border-t border-border-subtle" style={{ color: "var(--color-accent-warn)" }}>
          ⚠ high leverage — liq {trade.entry_price && trade.liquidation_price ? `${liqDistancePct(trade.entry_price, trade.liquidation_price, trade.action).toFixed(1)}%` : "?"} from entry
        </div>
      )}

      {/* Actions */}
      {(isReady || trade.status === "INCOMPLETE") && (
        <div className="flex border-t border-border-subtle">
          <button
            onClick={confirmTrade}
            disabled={!isReady || !walletConnected}
            className="flex-1 py-2 text-[11px] font-mono font-semibold tracking-wide transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
            style={{
              color: isReady && walletConnected ? "#fff" : "var(--color-text-tertiary)",
              background: isReady && walletConnected ? accentColor : "transparent",
            }}
          >
            {walletConnected ? "CONFIRM" : "CONNECT WALLET"}
          </button>
          <button
            onClick={cancelTrade}
            className="px-4 py-2 text-[11px] font-mono text-text-tertiary border-l border-border-subtle hover:text-text-secondary transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Executing */}
      {isExecuting && (
        <div className="px-3 py-2 text-[11px] font-mono text-text-tertiary border-t border-border-subtle flex items-center gap-2">
          <span className="w-2 h-2 border border-text-tertiary border-t-transparent rounded-full" style={{ animation: "spin 0.8s linear infinite" }} />
          {trade.status === "SIGNING" ? "sign in wallet..." : "building tx..."}
        </div>
      )}

      {/* Success */}
      {isSuccess && (
        <div className="px-3 py-2 text-[11px] font-mono border-t border-border-subtle" style={{ color: accentColor }}>
          ✓ executed {trade.tx_signature && `· ${trade.tx_signature.slice(0, 8)}..`}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="px-3 py-2 border-t border-border-subtle">
          <div className="text-[11px] font-mono text-accent-short">{trade.error}</div>
          <button onClick={cancelTrade} className="text-[10px] font-mono text-text-tertiary hover:text-text-secondary mt-1 cursor-pointer">dismiss</button>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-card px-3 py-2 flex flex-col gap-0.5">
      <span className="text-[9px] font-mono text-text-tertiary tracking-widest">{label}</span>
      <span className="num text-[13px] font-medium" style={{ color: color ?? "var(--color-text-primary)" }}>
        {value}
      </span>
    </div>
  );
}
