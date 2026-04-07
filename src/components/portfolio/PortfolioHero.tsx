"use client";

import { useEffect, useRef, useState } from "react";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS, TICKER_MARKETS, MARKETS } from "@/lib/constants";
import { formatUsd, formatPnl, formatPrice, safe, formatAgo } from "@/lib/format";
import { useNumberSpring } from "@/hooks/useSpring";
import TradeFlow from "./TradeFlow";
import BadgePanel from "./BadgePanel";
import EarnPage from "@/components/earn/EarnPage";
const FSTATS = "https://fstats.io/api/v1";

const TOKEN_COLORS: Record<string, string> = {
  SOL: "#9945FF", BTC: "#F7931A", ETH: "#627EEA",
  BONK: "#F59E0B", JUP: "#00D18C", WIF: "#A855F7",
};

interface OIMarket {
  market: string;
  long_oi: number;
  short_oi: number;
  total_oi: number;
  long_positions: number;
  short_positions: number;
}

interface PortfolioHeroProps {
  onAction: (command: string) => void;
  onFillInput?: (text: string) => void;
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PortfolioHero({ onAction, onFillInput }: PortfolioHeroProps) {
  const positions = useFlashStore((s) => s.positions);
  const prices = useFlashStore((s) => s.prices);
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);

  const [solBalance, setSolBalance] = useState(0);
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [totalWalletUsd, setTotalWalletUsd] = useState(0);
  const [volume7d, setVolume7d] = useState(0);
  const [trades7d, setTrades7d] = useState(0);
  const [fees7d, setFees7d] = useState(0);
  const [oiMarkets, setOiMarkets] = useState<OIMarket[]>([]);
  const [marketsExpanded, setMarketsExpanded] = useState(false);
  const [fstatsLastOk, setFstatsLastOk] = useState(0);
  const [fstatsFromCache, setFstatsFromCache] = useState(false);
  const [walletDataLoading, setWalletDataLoading] = useState(false);
  const [walletDataError, setWalletDataError] = useState(false);

  const refreshRef = useRef(refreshPositions);
  refreshRef.current = refreshPositions;

  useEffect(() => {
    if (!walletConnected) return;
    refreshRef.current();
    const interval = setInterval(() => refreshRef.current(), POSITION_REFRESH_MS);
    return () => clearInterval(interval);
  }, [walletConnected]);

  // Wallet balances via Helius DAS API
  useEffect(() => {
    if (!walletConnected || !walletAddress) return;
    let cancelled = false;
    setWalletDataLoading(true);
    async function fetch_() {
      try {
        const resp = await fetch("/api/token-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress }),
        });
        if (!resp.ok) { if (!cancelled) setWalletDataError(true); return; }
        const data = await resp.json().catch(() => null);
        if (!data) { if (!cancelled) setWalletDataError(true); return; }
        if (!cancelled) {
          setSolBalance(data.solBalance ?? 0);
          setTotalWalletUsd(data.totalUsd ?? 0);
          const usdc = (data.tokens ?? []).find((t: { symbol: string }) => t.symbol === "USDC");
          setUsdcBalance(usdc?.amount ?? 0);
          setWalletDataError(false);
          setWalletDataLoading(false);
        }
      } catch {
        if (!cancelled) { setWalletDataError(true); setWalletDataLoading(false); }
      }
    }
    fetch_();
    const interval = setInterval(fetch_, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [walletConnected, walletAddress]);

  // fstats — load from sessionStorage instantly, then refresh in background
  useEffect(() => {
    let cancelled = false;

    // Restore cached data instantly (no flash of empty) — marked as stale
    try {
      const cached = sessionStorage.getItem("fstats_cache");
      if (cached) {
        const c = JSON.parse(cached);
        if (c.volume7d) setVolume7d(c.volume7d);
        if (c.trades7d) setTrades7d(c.trades7d);
        if (c.fees7d) setFees7d(c.fees7d);
        if (c.oiMarkets) setOiMarkets(c.oiMarkets);
        setFstatsFromCache(true);
      }
    } catch {}

    async function fetch_() {
      try {
        const [statsR, oiR] = await Promise.all([
          fetch(`/api/fstats?path=overview/stats&period=7d`),
          fetch(`/api/fstats?path=positions/open-interest`),
        ]);
        let v = 0, t = 0, f = 0;
        if (statsR.ok) {
          const s = await statsR.json().catch(() => null);
          if (!s) return;
          v = s.volume_usd ?? 0; t = s.trades ?? 0; f = s.fees_usd ?? 0;
          if (!cancelled) { setVolume7d(v); setTrades7d(t); setFees7d(f); }
        }
        let oi: OIMarket[] = [];
        if (oiR.ok) {
          const data = await oiR.json().catch(() => null);
          if (!data) return;
          oi = (data.markets ?? data ?? []).sort((a: OIMarket, b: OIMarket) => b.total_oi - a.total_oi);
          if (!cancelled) setOiMarkets(oi);
        }
        // Cache for instant load next time
        try { sessionStorage.setItem("fstats_cache", JSON.stringify({ volume7d: v, trades7d: t, fees7d: f, oiMarkets: oi })); } catch {}
        if (!cancelled) { setFstatsLastOk(Date.now()); setFstatsFromCache(false); }
      } catch {}
    }
    fetch_();
    const interval = setInterval(fetch_, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const [activeFlow, setActiveFlow] = useState<"LONG" | "SHORT" | "portfolio" | "markets" | "earn" | null>(null);

  let totalPnl = 0;
  let totalCollateral = 0;
  for (const pos of positions) {
    totalPnl += safe(pos.unrealized_pnl);
    totalCollateral += safe(pos.collateral_usd);
  }

  // Spring-animated total PnL (smooth transitions)
  const springTotalPnl = useNumberSpring(totalPnl, { stiffness: 160, damping: 20 });

  const walletUsd = totalWalletUsd;

  // ── Guided Trade Flow ──
  if (activeFlow === "LONG" || activeFlow === "SHORT") {
    return (
      <div className="flex flex-col items-center pt-12 pb-6 px-6 w-full" style={{ animation: "fadeIn 300ms ease-out" }}>
        <TradeFlow
          side={activeFlow}
          onComplete={(cmd) => { setActiveFlow(null); setTimeout(() => onAction(cmd), 0); }}
          onCancel={() => setActiveFlow(null)}
        />
      </div>
    );
  }

  // ── Portfolio View ──
  if (activeFlow === "portfolio") {
    return (
      <div className="flex flex-col items-center pt-10 pb-6 px-6 w-full max-w-[520px] mx-auto" style={{ animation: "fadeIn 300ms ease-out" }}>
        <button onClick={() => setActiveFlow(null)} className="self-start text-[12px] text-text-tertiary hover:text-text-secondary cursor-pointer mb-4">← Back</button>
        <div className="text-[12px] text-text-tertiary tracking-[0.2em] uppercase mb-2">Portfolio</div>
        <div className="text-[42px] font-semibold text-text-primary tracking-tight leading-none num mb-2">{formatUsd(walletUsd)}</div>
        <div className="flex items-center gap-4 mb-6 text-[13px]">
          <span className="num text-text-secondary">{safe(solBalance).toFixed(2)} SOL</span>
          <span className="text-text-tertiary">·</span>
          <span className="num text-text-secondary">{formatUsd(usdcBalance)} USDC</span>
        </div>

        {positions.length > 0 ? (
          <div className="w-full glass-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
              <span className="text-[12px] text-text-tertiary tracking-wider uppercase">Open Positions</span>
              <span className="text-[13px] num font-medium" style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                {formatPnl(springTotalPnl)}
              </span>
            </div>
            {positions.map((pos) => (
              <div key={pos.pubkey} className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-text-primary">{pos.market}</span>
                  <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{ color: pos.side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                      background: pos.side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
                    {pos.side} {(pos.leverage ?? 0).toFixed(1)}x
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[12px]">
                  <span className="num text-text-secondary">{formatUsd(pos.size_usd)}</span>
                  <span className="num font-medium" style={{ color: safe(pos.unrealized_pnl) >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                    {formatPnl(pos.unrealized_pnl)}
                  </span>
                </div>
              </div>
            ))}
            <div className="px-4 py-3 flex items-center justify-between text-[12px] text-text-tertiary">
              <span>Total Collateral</span>
              <span className="num">{formatUsd(totalCollateral)}</span>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-text-tertiary py-8">No open positions</div>
        )}

        {/* Badge Panel */}
        <div className="w-full mt-6">
          <BadgePanel />
        </div>
      </div>
    );
  }

  // ── Earn View ──
  if (activeFlow === "earn") {
    return <EarnPage onBack={() => setActiveFlow(null)} />;
  }

  // ── Markets View ──
  if (activeFlow === "markets") {
    return (
      <div className="flex flex-col items-center pt-10 pb-6 px-6 w-full max-w-[520px] mx-auto" style={{ animation: "fadeIn 300ms ease-out" }}>
        <button onClick={() => setActiveFlow(null)} className="self-start text-[12px] text-text-tertiary hover:text-text-secondary cursor-pointer mb-4">← Back</button>
        <div className="text-[12px] text-text-tertiary tracking-[0.2em] uppercase mb-4">Markets</div>
        <div className="w-full glass-card overflow-hidden">
          {oiMarkets.length > 0 ? oiMarkets.slice(0, 12).map((m) => {
            const longPct = m.total_oi > 0 ? (m.long_oi / m.total_oi) * 100 : 50;
            const p = prices[m.market];
            return (
              <button key={m.market}
                onClick={() => { setActiveFlow(null); onFillInput?.(`long ${m.market} 5x $`); }}
                className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="flex items-center gap-2.5 w-20">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: MARKETS[m.market]?.dotColor ?? "#555" }} />
                  <span className="text-[13px] font-semibold text-text-primary">{m.market}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-1 mx-4">
                  <span className="text-[10px] num text-accent-long">{safe(longPct).toFixed(0)}%</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(239,68,68,0.3)" }}>
                    <div className="h-full rounded-full" style={{ width: `${longPct}%`, background: "var(--color-accent-long)" }} />
                  </div>
                  <span className="text-[10px] num text-accent-short">{safe(100 - longPct).toFixed(0)}%</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] num text-text-tertiary">{formatCompact(m.total_oi)}</span>
                  {p && <span className="text-[12px] num text-text-secondary w-24 text-right">{formatPrice(p.price)}</span>}
                </div>
              </button>
            );
          }) : (
            <div className="text-[13px] text-text-tertiary py-8 text-center">Loading markets...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-8 pb-4 px-6 w-full" style={{ animation: "fadeIn 300ms ease-out" }}>

      {/* ---- BALANCE ---- */}
      <div className="text-[11px] text-text-tertiary tracking-[0.2em] uppercase mb-2">Total Balance</div>
      <div className="text-[44px] font-bold tracking-tight leading-none num mb-2"
        style={{ color: walletConnected && walletDataError ? "var(--color-text-tertiary)" : "var(--color-text-primary)" }}>
        {!walletConnected ? "$0.00"
          : walletDataLoading && totalWalletUsd === 0 ? "..."
          : walletDataError && totalWalletUsd === 0 ? "—"
          : formatUsd(walletUsd)}
      </div>

      {walletConnected ? (
        <div className="flex items-center gap-3 mb-6 text-[13px]">
          {walletDataError && totalWalletUsd === 0 ? (
            <span className="text-text-tertiary">Balance unavailable</span>
          ) : (
            <>
              <span className="num text-text-secondary">{safe(solBalance).toFixed(2)} SOL</span>
              <span className="text-text-tertiary">·</span>
              <span className="num text-text-secondary">{formatUsd(usdcBalance)} USDC</span>
              {positions.length > 0 && (
                <>
                  <span className="text-text-tertiary">·</span>
                  <span className="num font-medium" style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                    {formatPnl(springTotalPnl)}
                  </span>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="text-[13px] text-text-tertiary mb-6">Connect wallet to start trading</div>
      )}

      {/* ---- Action Circles ---- */}
      <div className="flex items-center gap-5 mb-6 flex-wrap justify-center">
        <ActionCircle label="Long" onClick={() => setActiveFlow("LONG")}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>} />
        <ActionCircle label="Short" onClick={() => setActiveFlow("SHORT")}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12l7 7 7-7" /></svg>} />
        <ActionCircle label="Earn" onClick={() => setActiveFlow("earn")}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v12M8 10l4-4 4 4M8 14l4 4 4-4" /></svg>} />
        <ActionCircle label="Portfolio" onClick={() => setTimeout(() => onAction("portfolio"), 0)}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>} />
        <ActionCircle label="Markets" onClick={() => setTimeout(() => onAction("show all prices"), 0)}
          icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>} />
      </div>

      {/* ---- Protocol Stats (fstats) ---- */}
      {volume7d > 0 && (
        <div className="flex items-center gap-4 px-5 py-2.5 rounded-full mb-5"
          style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-subtle)" }}>
          <StatPill label="7d Vol" value={formatCompact(volume7d)} color="var(--color-accent-long)" />
          <span className="w-px h-4" style={{ background: "rgba(255,255,255,0.08)" }} />
          <StatPill label="Trades" value={safe(trades7d).toLocaleString()} />
          <span className="w-px h-4" style={{ background: "rgba(255,255,255,0.08)" }} />
          <StatPill label="Fees" value={formatCompact(fees7d)} />
          {fstatsFromCache && (
            <>
              <span className="w-px h-4" style={{ background: "rgba(255,255,255,0.08)" }} />
              <span className="text-[10px] text-text-tertiary">cached</span>
            </>
          )}
          {!fstatsFromCache && fstatsLastOk > 0 && Date.now() - fstatsLastOk > 120_000 && (
            <>
              <span className="w-px h-4" style={{ background: "rgba(255,255,255,0.08)" }} />
              <span className="text-[10px] text-text-tertiary">{formatAgo(fstatsLastOk)}</span>
            </>
          )}
        </div>
      )}

      {/* ---- Markets with OI (expandable) ---- */}
      {oiMarkets.length > 0 && (
        <div className="w-full max-w-[520px]">
          <button
            onClick={() => setMarketsExpanded(!marketsExpanded)}
            className="w-full flex items-center justify-between px-5 py-3 rounded-full cursor-pointer transition-all hover:scale-[1.01]"
            style={{ background: "rgba(20,26,34,0.9)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-[12px] text-text-tertiary tracking-wider">TOP MARKETS BY OI</span>
            <div className="flex items-center gap-3">
              {oiMarkets.slice(0, 3).map((m) => (
                <span key={m.market} className="text-[12px] num text-text-secondary">{m.market}</span>
              ))}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round"
                style={{ transform: marketsExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms" }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {marketsExpanded && (
            <div className="mt-2 glass-card overflow-hidden" style={{ animation: "fadeIn 150ms ease-out" }}>
              {oiMarkets.slice(0, 8).map((m) => {
                const longPct = m.total_oi > 0 ? (m.long_oi / m.total_oi) * 100 : 50;
                const p = prices[m.market];
                return (
                  <div key={m.market} className="flex items-center justify-between px-4 py-2.5"
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div className="flex items-center gap-2.5 w-16">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: MARKETS[m.market]?.dotColor ?? "#555" }} />
                      <span className="text-[13px] font-medium text-text-primary">{m.market}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 mx-4">
                      <span className="text-[10px] num text-accent-long">{safe(longPct).toFixed(0)}%</span>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(239,68,68,0.3)" }}>
                        <div className="h-full rounded-full" style={{ width: `${longPct}%`, background: "var(--color-accent-long)" }} />
                      </div>
                      <span className="text-[10px] num text-accent-short">{safe(100 - longPct).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] num text-text-tertiary">{formatCompact(m.total_oi)}</span>
                      {p && <span className="text-[12px] num text-text-secondary w-24 text-right">{formatPrice(p.price)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionCircle({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <button onClick={onClick} className="action-circle text-text-secondary hover:text-text-primary"
        style={{ width: "64px", height: "64px" }}>{icon}</button>
      <span className="text-[12px] text-text-tertiary">{label}</span>
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span className="text-[13px] font-medium num" style={{ color: color ?? "var(--color-text-primary)" }}>{value}</span>
    </div>
  );
}
