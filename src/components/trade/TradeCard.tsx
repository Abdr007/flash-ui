"use client";

// ============================================
// Flash AI — Trade Card (Galileo-Style)
// ============================================

import type { TradeObject } from "@/lib/types";
import { useFlashStore } from "@/store";
import { useNumberSpring } from "@/hooks/useSpring";
import {
  formatPrice,
  formatUsd,
  formatLeverage,
  formatPercent,
  liqDistancePct,
} from "@/lib/format";
import { HIGH_LEVERAGE_THRESHOLD } from "@/lib/constants";
import { getTradeConfidence, type TradeConfidence } from "@/lib/predictive-actions";

export default function TradeCard({ trade }: { trade: TradeObject }) {
  const confirmTrade = useFlashStore((s) => s.confirmTrade);
  const cancelTrade = useFlashStore((s) => s.cancelTrade);
  const walletConnected = useFlashStore((s) => s.walletConnected);

  const isLong = trade.action === "LONG";
  const accent = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const isReady = trade.status === "READY";
  const isError = trade.status === "ERROR";
  const isExecuting = trade.status === "EXECUTING" || trade.status === "SIGNING";
  const isSuccess = trade.status === "SUCCESS";
  const highLev = (trade.leverage ?? 0) >= HIGH_LEVERAGE_THRESHOLD;

  const liqDist = trade.entry_price && trade.liquidation_price
    ? liqDistancePct(trade.entry_price, trade.liquidation_price, trade.action)
    : 0;

  const springLiqDist = useNumberSpring(liqDist);

  const confidence: TradeConfidence | null =
    trade.leverage && trade.collateral_usd && trade.entry_price && trade.liquidation_price && trade.fees && trade.position_size
      ? getTradeConfidence({
          leverage: trade.leverage,
          collateral_usd: trade.collateral_usd,
          position_size: trade.position_size,
          fees: trade.fees,
          entry_price: trade.entry_price,
          liquidation_price: trade.liquidation_price,
          side: trade.action,
        })
      : null;

  return (
    <>
      {isExecuting && <div className="focus-dim" />}

      <div
        className={`w-full max-w-[460px] glass-card overflow-hidden ${isSuccess ? "success-glow" : ""}`}
        style={{
          animation: "cardIn 200ms cubic-bezier(0.2, 0, 0, 1) both",
          position: isExecuting ? "relative" : undefined,
          zIndex: isExecuting ? 50 : undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full" style={{ background: accent }} />
            <span className="text-[15px] font-semibold text-text-primary tracking-tight">
              {trade.market ? `${trade.market}-PERP` : "—"}
            </span>
            <span className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
              style={{ color: accent, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
              {trade.action}
            </span>
          </div>
          {confidence && <ConfidenceBadge confidence={confidence} />}
        </div>

        {/* Primary Numbers */}
        <div className="grid grid-cols-2 border-b border-border-subtle">
          <div className="px-5 py-4">
            <div className="text-[11px] text-text-tertiary mb-1">Entry Price</div>
            <div className="text-[20px] font-semibold num text-text-primary leading-none">
              {formatPrice(trade.entry_price)}
            </div>
          </div>
          <div className="px-5 py-4 border-l border-border-subtle">
            <div className="text-[11px] text-text-tertiary mb-1">Liquidation</div>
            <div className="text-[20px] font-semibold num leading-none" style={{ color: "var(--color-accent-warn)" }}>
              {formatPrice(trade.liquidation_price)}
            </div>
          </div>
        </div>

        {/* Secondary Grid */}
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Size" value={formatUsd(trade.position_size)} />
          <Cell label="Leverage" value={trade.leverage ? formatLeverage(trade.leverage) : "—"} color={highLev ? "var(--color-accent-warn)" : undefined} />
          <Cell label="Collateral" value={trade.collateral_usd ? formatUsd(trade.collateral_usd) : "—"} />
          <Cell label="Fees" value={trade.fees != null && trade.fee_rate != null ? `${formatUsd(trade.fees)} (${formatPercent(trade.fee_rate)})` : "—"} />
        </div>

        {/* Risk Bar */}
        {isReady && liqDist > 0 && (
          <div className="px-5 py-3 border-t border-border-subtle">
            <div className="flex justify-between text-[12px] mb-2">
              <span className="text-text-tertiary">Distance to liquidation</span>
              <span className="num font-medium"
                style={{ color: liqDist < 10 ? "var(--color-accent-short)" : liqDist < 20 ? "var(--color-accent-warn)" : "var(--color-accent-long)" }}>
                {liqDist.toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-border-subtle rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${Math.min(springLiqDist, 100)}%`,
                background: liqDist < 10 ? "var(--color-accent-short)" : liqDist < 20 ? "var(--color-accent-warn)" : "var(--color-accent-long)",
                transition: "background-color 300ms ease-out",
              }} />
            </div>
          </div>
        )}

        {/* High Leverage Warning */}
        {highLev && isReady && (
          <div className="px-5 py-2.5 text-[12px] border-t border-border-subtle flex items-center gap-2"
            style={{ color: "var(--color-accent-warn)", background: "rgba(245,158,11,0.04)" }}>
            <span>⚠</span>
            <span>High leverage — {liqDist.toFixed(1)}% to liquidation</span>
          </div>
        )}

        {/* Confidence Factors */}
        {confidence && confidence.level !== "high" && confidence.factors.length > 0 && isReady && (
          <div className="px-5 py-2.5 border-t border-border-subtle">
            {confidence.factors.map((f, i) => (
              <div key={i} className="text-[12px] text-text-tertiary leading-relaxed">· {f}</div>
            ))}
          </div>
        )}

        {/* Actions */}
        {(isReady || trade.status === "INCOMPLETE") && (
          <div className="flex border-t border-border-subtle">
            <button
              onClick={confirmTrade}
              disabled={!isReady || !walletConnected}
              className="flex-1 py-3 text-[13px] font-bold tracking-wide
                cursor-pointer disabled:opacity-25 disabled:cursor-default
                transition-all duration-150 hover:brightness-110 rounded-none rounded-bl-xl"
              style={{
                color: isReady && walletConnected ? "#000" : "var(--color-text-tertiary)",
                background: isReady && walletConnected ? accent : "transparent",
              }}
            >
              {walletConnected ? "Confirm Trade" : "Connect Wallet"}
            </button>
            <button
              onClick={cancelTrade}
              className="px-6 py-3 text-[13px] text-text-tertiary
                border-l border-border-subtle hover:text-text-secondary
                cursor-pointer transition-colors duration-150 rounded-none rounded-br-xl"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Executing / Signing */}
        {isExecuting && (
          <div className="px-5 py-4 border-t border-border-subtle flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-t-transparent rounded-full"
              style={{ borderColor: `${accent} transparent ${accent} ${accent}`, animation: "spin 0.7s linear infinite" }} />
            <div className="flex flex-col">
              <span className="text-[13px] text-text-primary">
                {trade.status === "SIGNING" ? "Waiting for wallet..." : "Building transaction..."}
              </span>
              <span className="text-[12px] text-text-tertiary">
                {trade.status === "SIGNING" ? "Confirm in your wallet app" : "Preparing on-chain transaction"}
              </span>
            </div>
          </div>
        )}

        {/* Success */}
        {isSuccess && (
          <div className="px-5 py-3 border-t flex items-center gap-2.5"
            style={{ borderColor: `${accent}30`, background: `${accent}06` }}>
            <span className="text-[14px]" style={{ color: accent }}>✓</span>
            <span className="text-[13px] font-medium" style={{ color: accent }}>Executed</span>
            {trade.tx_signature && (
              <a href={`https://solscan.io/tx/${trade.tx_signature}`} target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-text-tertiary ml-auto hover:text-text-primary underline">
                View on Solscan →
              </a>
            )}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="px-5 py-3 border-t border-border-subtle">
            <div className="text-[13px] text-accent-short leading-relaxed">{trade.error}</div>
            <div className="flex items-center gap-3 mt-2.5">
              <button onClick={cancelTrade} className="text-[12px] text-text-tertiary hover:text-text-secondary cursor-pointer transition-colors">
                Dismiss
              </button>
              <button onClick={confirmTrade} className="text-[12px] text-accent-blue hover:text-text-primary cursor-pointer transition-colors">
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ---- Confidence Badge ----

function ConfidenceBadge({ confidence }: { confidence: TradeConfidence }) {
  const config = {
    high: { color: "var(--color-accent-long)", label: "High" },
    medium: { color: "var(--color-accent-warn)", label: "Med" },
    low: { color: "var(--color-accent-short)", label: "Low" },
  }[confidence.level];

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{ background: `${config.color}12` }}>
      <div className="w-1.5 h-1.5 rounded-full breathe" style={{ background: config.color }} />
      <span className="text-[11px] font-semibold" style={{ color: config.color }}>{config.label}</span>
    </div>
  );
}

// ---- Data Cell ----

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-card px-5 py-3">
      <div className="text-[11px] text-text-tertiary mb-0.5">{label}</div>
      <div className="num text-[15px] font-medium" style={{ color: color ?? "var(--color-text-primary)" }}>{value}</div>
    </div>
  );
}
