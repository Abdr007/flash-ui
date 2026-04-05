"use client";

// ============================================
// Flash UI — Portfolio Hero (Galileo-Style)
// ============================================
// Centered hero: balance → token icons → action circles → trending bar
// Action buttons send commands to the chat.

import { useEffect, useRef } from "react";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS, TICKER_MARKETS, MARKETS } from "@/lib/constants";
import { formatUsd, formatPnl, formatPrice } from "@/lib/format";

const TOKEN_COLORS: Record<string, string> = {
  SOL: "#9945FF", BTC: "#F7931A", ETH: "#627EEA",
  BONK: "#F59E0B", JUP: "#00D18C", WIF: "#A855F7",
};

interface PortfolioHeroProps {
  onAction: (command: string) => void;
  onFillInput?: (text: string) => void;
}

export default function PortfolioHero({ onAction, onFillInput }: PortfolioHeroProps) {
  const positions = useFlashStore((s) => s.positions);
  const prices = useFlashStore((s) => s.prices);
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);

  const refreshRef = useRef(refreshPositions);
  refreshRef.current = refreshPositions;

  useEffect(() => {
    if (!walletConnected) return;
    refreshRef.current();
    const interval = setInterval(() => refreshRef.current(), POSITION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [walletConnected]);

  let totalExposure = 0;
  let totalPnl = 0;
  let totalCollateral = 0;
  for (const pos of positions) {
    totalExposure += pos.size_usd;
    totalPnl += pos.unrealized_pnl;
    totalCollateral += pos.collateral_usd;
  }

  const activeMarkets = TICKER_MARKETS.filter((s) => prices[s]);
  const balance = walletConnected ? totalExposure : 0;

  return (
    <div className="flex flex-col items-center pt-16 pb-8 px-6 w-full" style={{ animation: "fadeIn 500ms ease-out" }}>

      {/* ---- TOTAL BALANCE ---- */}
      <div className="text-[12px] text-text-tertiary tracking-[0.2em] uppercase mb-4">
        {walletConnected ? "Total Exposure" : "Total Balance"}
      </div>
      <div className="text-[56px] font-semibold text-text-primary tracking-tight leading-none num mb-4"
        style={{ fontFamily: "var(--font-geist-sans), -apple-system, sans-serif" }}>
        {formatUsd(balance)}
      </div>

      {/* ---- PnL indicators ---- */}
      {walletConnected && positions.length > 0 && (
        <div className="flex items-center gap-4 mb-10">
          <span className="flex items-center gap-1.5 text-[14px]"
            style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              {totalPnl >= 0 ? (
                <path d="M4 15C7 10 10 7 16 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M4 5C7 10 10 13 16 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
            <span className="num font-medium">{formatPnl(totalPnl)}</span>
          </span>
          <span className="text-[13px] text-text-tertiary">unrealized</span>
          <span className="text-text-tertiary">·</span>
          <span className="text-[13px] text-text-secondary num">{formatUsd(totalCollateral)} collateral</span>
        </div>
      )}

      {!walletConnected && (
        <div className="text-[14px] text-text-tertiary mb-10">Connect wallet to start trading</div>
      )}

      {/* ---- Token Icons Pill ---- */}
      {activeMarkets.length > 0 && (
        <div className="flex items-center gap-4 px-6 py-3.5 rounded-full mb-10"
          style={{ background: "rgba(20,26,34,0.9)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center" style={{ marginLeft: "4px" }}>
            {activeMarkets.slice(0, 5).map((symbol, i) => (
              <div key={symbol}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                style={{
                  background: TOKEN_COLORS[symbol] ?? MARKETS[symbol]?.dotColor ?? "#444",
                  border: "2.5px solid var(--color-bg-root)",
                  marginLeft: i > 0 ? "-8px" : "0",
                  zIndex: 10 - i,
                  position: "relative",
                }}>
                {symbol.slice(0, 1)}
              </div>
            ))}
          </div>
          <span className="text-[14px] text-text-secondary">{activeMarkets.length} markets</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      )}

      {/* ---- Action Circles ---- */}
      <div className="flex items-center gap-8 mb-10">
        <ActionCircle
          label="Long"
          onClick={() => onFillInput?.("long SOL 5x $")}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>}
        />
        <ActionCircle
          label="Short"
          onClick={() => onFillInput?.("short SOL 5x $")}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>}
        />
        <ActionCircle
          label="Portfolio"
          onClick={() => onAction("portfolio")}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>}
        />
        <ActionCircle
          label="Markets"
          onClick={() => onAction("prices")}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
        />
      </div>

      {/* ---- Trending Markets Bar ---- */}
      {activeMarkets.length > 0 && (
        <div className="flex items-center gap-4 px-5 py-3 rounded-full"
          style={{ background: "rgba(20,26,34,0.9)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <span className="text-[11px] text-text-tertiary tracking-wider font-medium flex items-center gap-1.5">
            TRENDING
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M4 15C7 10 10 7 16 5" stroke="var(--color-accent-long)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          {activeMarkets.slice(0, 4).map((symbol, i) => {
            const p = prices[symbol];
            return (
              <span key={symbol} className="flex items-center gap-2">
                {i > 0 && <span className="w-px h-4" style={{ background: "rgba(255,255,255,0.06)" }} />}
                <span className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: MARKETS[symbol]?.dotColor ?? "#444" }} />
                <span className="text-[13px] font-medium text-text-primary">{symbol}</span>
                <span className="text-[13px] num text-accent-long">{formatPrice(p?.price)}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionCircle({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <button
        onClick={onClick}
        className="action-circle text-text-secondary hover:text-text-primary"
        style={{ width: "64px", height: "64px" }}
      >
        {icon}
      </button>
      <span className="text-[12px] text-text-tertiary">{label}</span>
    </div>
  );
}
