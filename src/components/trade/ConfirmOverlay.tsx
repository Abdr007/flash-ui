"use client";

import { useFlashStore } from "@/store";
import { formatUsd, formatPrice, liqDistancePct } from "@/lib/format";

export default function ConfirmOverlay() {
  const trade = useFlashStore((s) => s.activeTrade);
  const executeTrade = useFlashStore((s) => s.executeTrade);
  const cancelTrade = useFlashStore((s) => s.cancelTrade);

  // Show during CONFIRMING, EXECUTING, and SIGNING
  if (!trade || (trade.status !== "CONFIRMING" && trade.status !== "EXECUTING" && trade.status !== "SIGNING")) {
    return null;
  }

  const isLong = trade.action === "LONG";
  const isExecuting = trade.status === "EXECUTING" || trade.status === "SIGNING";
  const accentColor = isLong
    ? "var(--color-accent-long)"
    : "var(--color-accent-short)";
  const liqDist =
    trade.entry_price && trade.liquidation_price
      ? liqDistancePct(trade.entry_price, trade.liquidation_price, trade.action)
      : 0;
  const liqDanger = liqDist < 10;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Dim overlay — only dismissible if not executing */}
      <div
        className="absolute inset-0 bg-bg-root/70 backdrop-blur-sm"
        onClick={isExecuting ? undefined : cancelTrade}
      />

      {/* Card */}
      <div
        className="relative w-[400px] rounded-2xl p-7 border border-border-subtle"
        style={{
          background: "var(--color-bg-card)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
          animation: "fadeInUp 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-5">
          <span className="text-lg text-accent-warn">⚠</span>
          <span className="text-base font-bold text-text-primary tracking-wide">
            {isExecuting ? "EXECUTING" : "CONFIRM TRADE"}
          </span>
        </div>

        <p className="text-sm text-text-secondary mb-5">
          {isExecuting ? (
            trade.status === "SIGNING"
              ? "Sign the transaction in your wallet..."
              : "Building transaction..."
          ) : (
            <>
              You are opening a{" "}
              <span style={{ color: accentColor }} className="font-medium">
                {trade.action}
              </span>{" "}
              position on{" "}
              <span className="text-text-primary font-medium">
                {trade.market}
              </span>
            </>
          )}
        </p>

        {/* High leverage warning */}
        {(trade.leverage ?? 0) > 10 && !isExecuting && (
          <div className="flex items-center gap-2 p-3 rounded-lg mb-4 text-xs border"
            style={{
              background: "rgba(255, 176, 32, 0.06)",
              borderColor: "rgba(255, 176, 32, 0.2)",
              color: "var(--color-accent-warn)",
            }}>
            <span>⚠</span>
            <span>
              High leverage ({trade.leverage}x). Liquidation is {liqDist.toFixed(1)}% from entry.
              {(trade.collateral_usd ?? 0) >= 500 && " Large trade — verify before executing."}
            </span>
          </div>
        )}

        {/* Data */}
        <div className="flex flex-col gap-2.5 mb-5">
          <ConfirmRow
            label="Collateral"
            value={formatUsd(trade.collateral_usd)}
          />
          <ConfirmRow
            label="Position Size"
            value={formatUsd(trade.position_size)}
          />
          <ConfirmRow
            label="Fees"
            value={formatUsd(trade.fees)}
          />
          <ConfirmRow
            label="Liquidation"
            value={`${formatPrice(trade.liquidation_price)}  ←  ${liqDist.toFixed(1)}% away`}
            color={
              liqDanger
                ? "var(--color-accent-short)"
                : "var(--color-accent-warn)"
            }
          />
        </div>

        {/* Execute / Progress */}
        {isExecuting ? (
          <div className="w-full py-3.5 rounded-[10px] text-sm font-semibold text-center text-text-tertiary bg-bg-card-hover mb-3">
            <span className="inline-block w-3 h-3 border-2 border-text-tertiary border-t-transparent rounded-full mr-2" style={{ animation: "spin 0.8s linear infinite" }} />
            {trade.status === "SIGNING" ? "Sign in wallet..." : "Building tx..."}
          </div>
        ) : (
          <button
            onClick={executeTrade}
            className="w-full py-3.5 rounded-[10px] text-sm font-semibold text-white mb-3 transition-all hover:brightness-110 cursor-pointer"
            style={{ background: accentColor }}
          >
            Execute Trade
          </button>
        )}

        {/* Cancel — hidden during execution */}
        {!isExecuting && (
          <button
            onClick={cancelTrade}
            className="w-full text-center text-[13px] font-medium text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function ConfirmRow({
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
      <span className="text-[13px] text-text-tertiary">{label}</span>
      <span
        className="text-[13px] font-semibold"
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
