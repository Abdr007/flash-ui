"use client";

import type { TradeObject } from "@/lib/types";
import { useFlashStore } from "@/store";
import {
  formatPrice,
  formatUsd,
  formatLeverage,
  formatPercent,
  liqDistancePct,
  truncateTx,
} from "@/lib/format";
import { HIGH_LEVERAGE_THRESHOLD } from "@/lib/constants";

interface TradeCardProps {
  trade: TradeObject;
}

export default function TradeCard({ trade }: TradeCardProps) {
  const confirmTrade = useFlashStore((s) => s.confirmTrade);
  const cancelTrade = useFlashStore((s) => s.cancelTrade);
  const walletConnected = useFlashStore((s) => s.walletConnected);

  const isLong = trade.action === "LONG";
  const accentColor = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const accentClass = isLong ? "accent-long" : "accent-short";
  const accentMutedClass = isLong ? "bg-accent-long/12" : "bg-accent-short/12";
  const isReady = trade.status === "READY";
  const isExecuting = trade.status === "EXECUTING" || trade.status === "CONFIRMING";
  const isSuccess = trade.status === "SUCCESS";
  const isError = trade.status === "ERROR";
  const isIncomplete = trade.status === "INCOMPLETE";
  const highLeverage = (trade.leverage ?? 0) >= HIGH_LEVERAGE_THRESHOLD;

  return (
    <div
      className="w-full max-w-[460px] rounded-[14px] p-6 border"
      style={{
        background: "var(--color-bg-card)",
        borderColor: isSuccess
          ? `${accentColor}30`
          : isError
          ? "rgba(255, 77, 106, 0.4)"
          : "var(--color-border-subtle)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)",
        animation: "fadeInUp 200ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-lg font-semibold text-text-primary">
          {trade.market ? `${trade.market}-PERP` : "—"}
        </span>
        <span
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide ${accentMutedClass}`}
          style={{ color: accentColor }}
        >
          {trade.action}
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: accentColor }}
          />
        </span>
      </div>

      {/* Divider */}
      <div className="h-px bg-border-subtle mb-5" />

      {/* Price Row */}
      <div className="flex gap-10 mb-5">
        <DataPair
          label="ENTRY PRICE"
          value={formatPrice(trade.entry_price)}
        />
        <DataPair
          label="LIQUIDATION"
          value={isIncomplete ? "—" : formatPrice(trade.liquidation_price)}
          color={
            trade.liquidation_price
              ? "var(--color-accent-warn)"
              : "var(--color-text-tertiary)"
          }
        />
      </div>

      {/* Trade Data Row */}
      <div className="flex gap-10 mb-4">
        <DataPair
          label="SIZE"
          value={isIncomplete && !trade.position_size ? "—" : formatUsd(trade.position_size)}
          size="text-lg"
        />
        <DataPair
          label="LEVERAGE"
          value={trade.leverage ? formatLeverage(trade.leverage) : "—"}
          size="text-lg"
          color={highLeverage ? "var(--color-accent-warn)" : undefined}
        />
        <DataPair
          label="COLLATERAL"
          value={trade.collateral_usd ? formatUsd(trade.collateral_usd) : "—"}
          size="text-lg"
        />
      </div>

      {/* Fees */}
      <div className="mb-4">
        <span className="block text-[11px] font-medium text-text-tertiary tracking-wider mb-1.5">
          FEES
        </span>
        <span className="text-sm text-text-secondary">
          {trade.fees != null && trade.fee_rate != null
            ? `${formatUsd(trade.fees)} (${formatPercent(trade.fee_rate)})`
            : "—"}
        </span>
      </div>

      {/* High Leverage Warning */}
      {highLeverage && isReady && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-accent-warn/8 border border-accent-warn/20 mb-4 text-xs">
          <span className="text-accent-warn">⚠</span>
          <span className="text-accent-warn">
            High leverage ({trade.leverage}x) — Liquidation{" "}
            {trade.entry_price && trade.liquidation_price
              ? `${liqDistancePct(trade.entry_price, trade.liquidation_price, trade.action).toFixed(1)}% away`
              : "risk is elevated"}
          </span>
        </div>
      )}

      {/* Divider */}
      <div className="h-px bg-border-subtle mb-5" />

      {/* Action Area */}
      {(isReady || isIncomplete) && (
        <div className="flex items-center gap-2.5">
          <button
            onClick={confirmTrade}
            disabled={!isReady || !walletConnected}
            className="px-6 py-3 rounded-[10px] text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-default cursor-pointer"
            style={{
              background: isReady && walletConnected ? accentColor : "var(--color-text-tertiary)",
            }}
          >
            {walletConnected ? "Confirm Trade" : "Connect Wallet"}
          </button>
          <button
            onClick={cancelTrade}
            className="px-5 py-3 rounded-[10px] text-sm font-medium text-text-secondary border border-border-subtle hover:border-accent-blue hover:text-accent-blue transition-colors cursor-pointer"
          >
            Edit
          </button>
          <button
            onClick={cancelTrade}
            className="px-3.5 py-3 rounded-[10px] text-sm font-medium text-text-secondary border border-border-subtle hover:border-accent-short hover:text-accent-short transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Executing State */}
      {isExecuting && (
        <div>
          <div className="w-full h-[3px] bg-border-subtle rounded-full overflow-hidden mb-2.5">
            <div
              className="h-full rounded-full"
              style={{
                background: accentColor,
                width: trade.status === "CONFIRMING" ? "30%" : "70%",
                transition: "width 300ms ease",
              }}
            />
          </div>
          <span className="text-[13px] text-text-secondary">
            {trade.status === "CONFIRMING"
              ? "Submitting transaction..."
              : "Confirming on-chain..."}
          </span>
        </div>
      )}

      {/* Success State */}
      {isSuccess && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold" style={{ color: accentColor }}>
            ✓ Trade Executed
          </span>
          {trade.tx_signature && (
            <span className="text-xs text-text-tertiary">
              Tx: {truncateTx(trade.tx_signature)}
            </span>
          )}
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="flex flex-col gap-3">
          <span className="text-sm font-semibold text-accent-short">
            ✕ {trade.error || "Trade failed"}
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={cancelTrade}
              className="px-4 py-2.5 rounded-lg text-[13px] font-medium text-text-secondary border border-border-subtle hover:border-text-secondary transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DataPair({
  label,
  value,
  color,
  size = "text-[22px]",
}: {
  label: string;
  value: string;
  color?: string;
  size?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-tertiary tracking-wider">
        {label}
      </span>
      <span
        className={`${size} font-semibold`}
        style={{
          color: color ?? "var(--color-text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
