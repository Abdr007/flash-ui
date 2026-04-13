"use client";

// ============================================
// Flash UI — Portfolio Panel (Galileo-Style)
// ============================================

import { useEffect, useRef } from "react";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS, TICKER_MARKETS, MARKETS } from "@/lib/constants";
import { formatUsd, formatPrice, formatPnl, formatPnlPct, formatLeverage, liqDistancePct } from "@/lib/format";
import type { Position } from "@/lib/types";

// Token colors for the overlapping icon circles
const TOKEN_COLORS: Record<string, string> = {
  SOL: "#9945FF",
  BTC: "#F7931A",
  ETH: "#627EEA",
  USDC: "#2775CA",
  BONK: "#F59E0B",
  JUP: "#00D18C",
  WIF: "#A855F7",
};

export default function PortfolioPanel() {
  const positions = useFlashStore((s) => s.positions);
  const prices = useFlashStore((s) => s.prices);
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  const closePosition = useFlashStore((s) => s.closePosition);

  const refreshRef = useRef(refreshPositions);
  useEffect(() => {
    refreshRef.current = refreshPositions;
  });

  useEffect(() => {
    if (!walletConnected) return;
    refreshRef.current();
    const interval = setInterval(() => refreshRef.current(), POSITION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [walletConnected]);

  // Aggregates
  let totalExposure = 0;
  let totalPnl = 0;
  let totalCollateral = 0;
  for (const pos of positions) {
    totalExposure += pos.size_usd;
    totalPnl += pos.unrealized_pnl;
    totalCollateral += pos.collateral_usd;
  }

  const activeMarkets = TICKER_MARKETS.filter((s) => prices[s]);

  return (
    <div className="h-full flex flex-col bg-bg-root dot-grid overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-start px-6 pt-12">
        {/* ---- Hero Balance ---- */}
        {!walletConnected ? (
          <div className="text-center py-16" style={{ animation: "fadeIn 400ms ease-out" }}>
            <div className="text-[13px] text-text-tertiary tracking-widest uppercase mb-4">Total Balance</div>
            <div className="text-[42px] font-semibold text-text-primary tracking-tight leading-none mb-3">$0.00</div>
            <div className="text-[14px] text-text-tertiary">Connect wallet to start trading</div>
          </div>
        ) : (
          <div className="text-center" style={{ animation: "fadeIn 400ms ease-out" }}>
            <div className="text-[12px] text-text-tertiary tracking-widest uppercase mb-3">Total Exposure</div>
            <div className="text-[48px] font-semibold text-text-primary tracking-tight leading-none num">
              {formatUsd(totalExposure)}
            </div>

            {/* 24h-style PnL indicator */}
            <div className="flex items-center justify-center gap-4 mt-3">
              <span
                className="flex items-center gap-1.5 text-[13px]"
                style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  {totalPnl >= 0 ? (
                    <path d="M3 12C5 8 8 6 13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  ) : (
                    <path d="M3 4C5 8 8 10 13 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  )}
                </svg>
                <span className="num font-medium">{formatPnl(totalPnl)}</span>
              </span>
              <span className="text-[12px] text-text-tertiary">unrealized</span>
              <span className="text-[11px] text-text-tertiary">•</span>
              <span className="text-[13px] text-text-secondary num">{formatUsd(totalCollateral)} collateral</span>
            </div>
          </div>
        )}

        {/* ---- Token Icons Row (overlapping circles) ---- */}
        {activeMarkets.length > 0 && (
          <div
            className="mt-8 flex items-center gap-3 px-5 py-3 rounded-full"
            style={{ background: "rgba(20,26,34,0.8)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center -space-x-2">
              {activeMarkets.slice(0, 5).map((symbol) => (
                <div
                  key={symbol}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-bg-root"
                  style={{ background: TOKEN_COLORS[symbol] ?? MARKETS[symbol]?.dotColor ?? "#444" }}
                >
                  {symbol.slice(0, 1)}
                </div>
              ))}
            </div>
            <span className="text-[13px] text-text-secondary">{activeMarkets.length} markets</span>
          </div>
        )}

        {/* ---- Quick Actions (Galileo circles) ---- */}
        <div className="flex items-center gap-6 mt-8">
          <ActionButton icon="long" label="Long" />
          <ActionButton icon="short" label="Short" />
          <ActionButton icon="portfolio" label="Portfolio" />
          <ActionButton icon="markets" label="Markets" />
        </div>

        {/* ---- Trending Markets Bar ---- */}
        {activeMarkets.length > 0 && (
          <div
            className="mt-8 flex items-center gap-3 px-5 py-2.5 rounded-full"
            style={{ background: "rgba(20,26,34,0.8)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="text-[11px] text-text-tertiary tracking-wider font-medium flex items-center gap-1.5">
              MARKETS
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 12C5 8 8 6 13 4"
                  stroke="var(--color-accent-long)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            {activeMarkets.slice(0, 4).map((symbol, i) => {
              const p = prices[symbol];
              return (
                <span key={symbol} className="flex items-center gap-1.5">
                  {i > 0 && <span className="w-px h-3 bg-border-subtle" />}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: MARKETS[symbol]?.dotColor ?? "#444" }}
                  />
                  <span className="text-[12px] font-medium text-text-primary">{symbol}</span>
                  <span className="text-[12px] num text-accent-long">{formatPrice(p?.price)}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* ---- Open Positions ---- */}
        {walletConnected && positions.length > 0 && (
          <div className="w-full mt-8 max-w-[380px]">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[12px] text-text-secondary tracking-wide font-medium">Open Positions</span>
              <span className="text-[11px] text-text-tertiary num">{positions.length}</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {positions.map((pos) => (
                <PositionCard key={pos.pubkey} position={pos} onClose={() => closePosition(pos.market, pos.side)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Action Button (Galileo circle style) ----

function ActionButton({ icon, label }: { icon: string; label: string }) {
  const icons: Record<string, React.ReactNode> = {
    long: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    ),
    short: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    ),
    portfolio: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    markets: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="action-circle text-text-secondary">{icons[icon]}</div>
      <span className="text-[11px] text-text-tertiary">{label}</span>
    </div>
  );
}

// ---- Position Card ----

function PositionCard({ position, onClose }: { position: Position; onClose: () => void }) {
  const isLong = position.side === "LONG";
  const isProfit = position.unrealized_pnl >= 0;
  const sideColor = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const pnlColor = isProfit ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const liqDist = liqDistancePct(position.entry_price, position.liquidation_price, position.side);

  return (
    <div className="glass-card group overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-3 h-3 rounded-full"
            style={{ background: MARKETS[position.market]?.dotColor ?? sideColor }}
          />
          <span className="text-[14px] font-semibold text-text-primary">{position.market}</span>
          <span
            className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full"
            style={{
              color: sideColor,
              background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
            }}
          >
            {position.side}
          </span>
          <span className="text-[11px] text-text-tertiary num">{formatLeverage(position.leverage)}</span>
        </div>
        <span className="num text-[14px] font-semibold" style={{ color: pnlColor }}>
          {formatPnl(position.unrealized_pnl)}
        </span>
      </div>

      {/* Data Grid */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
        <MiniRow label="Size" value={formatUsd(position.size_usd)} />
        <MiniRow label="PnL %" value={formatPnlPct(position.unrealized_pnl_pct)} color={pnlColor} />
        <MiniRow label="Entry" value={formatPrice(position.entry_price)} />
        <MiniRow label="Mark" value={formatPrice(position.mark_price)} />
      </div>

      {/* Liq distance bar */}
      <div className="px-4 pb-3">
        <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${Math.min(liqDist, 100)}%`,
              background:
                liqDist < 10
                  ? "var(--color-accent-short)"
                  : liqDist < 20
                    ? "var(--color-accent-warn)"
                    : "var(--color-accent-long)",
            }}
          />
        </div>
      </div>

      {/* Close action */}
      <div
        className="border-t opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ borderColor: "rgba(255,255,255,0.04)" }}
      >
        <button
          onClick={onClose}
          className="w-full py-2.5 text-[12px] font-medium text-accent-short cursor-pointer
            hover:bg-accent-short/5 transition-colors"
          style={{ borderRadius: "0 0 16px 16px" }}
        >
          Close Position
        </button>
      </div>
    </div>
  );
}

// ---- Shared ----

function MiniRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-text-tertiary">{label}</span>
      <span className="num font-medium" style={{ color: color ?? "var(--color-text-secondary)" }}>
        {value}
      </span>
    </div>
  );
}
