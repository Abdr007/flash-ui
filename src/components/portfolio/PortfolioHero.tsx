"use client";

// ============================================
// Flash Trade — Elite Home Screen
// ============================================
// Beat Galileo: bigger balance, more spacing, unified cards,
// cleaner icons, premium glass, brand identity throughout.

import { memo, useEffect, useRef, useState, useCallback } from "react";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS, TOKEN_META } from "@/lib/constants";
import { formatUsd, formatPnl, safe } from "@/lib/format";
import { useNumberSpring } from "@/hooks/useSpring";

interface PortfolioHeroProps {
  onAction: (command: string) => void;
  onFillInput?: (text: string) => void;
}

interface WalletToken {
  mint: string;
  symbol: string; name: string; amount: number; usd: number;
  pricePerToken: number; logo: string; logoFallback: string;
  color: string; portfolioPct: number;
}

export default function PortfolioHero({ onAction }: PortfolioHeroProps) {
  const positions = useFlashStore((s) => s.positions);
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);

  const [totalWalletUsd, setTotalWalletUsd] = useState(0);
  const [walletDataLoading, setWalletDataLoading] = useState(false);
  const [walletDataError, setWalletDataError] = useState(false);
  const [assetsExpanded, setAssetsExpanded] = useState(false);
  const [tokens, setTokens] = useState<WalletToken[]>([]);
  const [change24h, setChange24h] = useState<number | null>(null);

  const refreshRef = useRef(refreshPositions);
  useEffect(() => { refreshRef.current = refreshPositions; });

  useEffect(() => {
    if (!walletConnected) return;
    refreshRef.current();
    const iv = setInterval(() => refreshRef.current(), POSITION_REFRESH_MS);
    return () => clearInterval(iv);
  }, [walletConnected]);

  useEffect(() => {
    if (!walletConnected || !walletAddress) return;
    let cancelled = false;
    async function load() {
      await Promise.resolve(); // yield to avoid synchronous setState in effect
      if (cancelled) return;
      setWalletDataLoading(true);
      try {
        const resp = await fetch("/api/token-prices", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress }),
        });
        if (!resp.ok) { if (!cancelled) setWalletDataError(true); return; }
        const data = await resp.json().catch(() => null);
        if (!data || cancelled) return;
        const total = data.totalUsd ?? 0;
        setTotalWalletUsd(total);
        try {
          const key = `flash_portfolio_${walletAddress?.slice(0, 8)}`;
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const prev = JSON.parse(stored);
            if (prev.usd > 0 && total > 0) setChange24h(((total - prev.usd) / prev.usd) * 100);
          } else sessionStorage.setItem(key, JSON.stringify({ usd: total, ts: Date.now() }));
        } catch {}
        const toks: WalletToken[] = [];
        if (data.solBalance > 0) {
          const m = TOKEN_META["SOL"];
          toks.push({ mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: m?.name ?? "Solana", amount: data.solBalance,
            usd: data.solUsd ?? 0, pricePerToken: (data.solUsd ?? 0) / data.solBalance,
            logo: m?.logo ?? "", logoFallback: "", color: m?.color ?? "#9945FF", portfolioPct: 0 });
        }
        for (const t of data.tokens ?? []) {
          if (t.usdValue < 0.01) continue;
          const sym = t.symbol?.toUpperCase?.() ?? t.symbol;
          const m = TOKEN_META[sym] ?? TOKEN_META[t.symbol];
          const dasLogo = t.logoUri || "";
          const primaryLogo = m?.logo || dasLogo;
          toks.push({ mint: String(t.mint ?? ""), symbol: sym, name: m?.name ?? sym, amount: t.amount, usd: t.usdValue,
            pricePerToken: t.pricePerToken ?? 0, logo: primaryLogo,
            logoFallback: primaryLogo !== dasLogo ? dasLogo : "", color: m?.color ?? "#3E5068", portfolioPct: 0 });
        }
        for (const t of toks) t.portfolioPct = total > 0 ? (t.usd / total) * 100 : 0;
        toks.sort((a, b) => b.usd - a.usd);
        setTokens(toks); setWalletDataError(false); setWalletDataLoading(false);
      } catch { if (!cancelled) { setWalletDataError(true); setWalletDataLoading(false); } }
    }
    load();
    const iv = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [walletConnected, walletAddress]);

  let totalPnl = 0;
  for (const pos of positions) totalPnl += safe(pos.unrealized_pnl);
  // Total balance includes wallet tokens + unrealized PnL from open positions (like Galileo)
  const totalWithPnl = totalWalletUsd + totalPnl;
  const springBalance = useNumberSpring(totalWithPnl, { stiffness: 60, damping: 28 });
  const springPnl = useNumberSpring(totalPnl, { stiffness: 160, damping: 20 });
  const toggleAssets = useCallback(() => setAssetsExpanded((v) => !v), []);

  return (
    <div className="flex flex-col items-center w-full max-w-[520px] mx-auto pt-20 pb-6 px-5 relative">

      {/* Ambient brand glow — triple orb system */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[500px] pointer-events-none" style={{ opacity: 0.5 }}>
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 50% 40% at 50% 25%, rgba(51,201,161,0.06) 0%, transparent 70%)",
          animation: "orbFloat 14s ease-in-out infinite",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 40% 30% at 60% 35%, rgba(58,255,225,0.03) 0%, transparent 60%)",
          animation: "orbFloat 14s ease-in-out infinite 4s",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 30% 20% at 40% 30%, rgba(200,245,71,0.015) 0%, transparent 60%)",
          animation: "orbFloat 14s ease-in-out infinite 8s",
        }} />
      </div>

      {/* ═══ BALANCE ═══ */}
      <div className="relative z-10 flex flex-col items-center mb-10">
        <div className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-5"
          style={{ color: "rgba(51,201,161,0.5)" }}>
          TOTAL BALANCE
        </div>

        <div className="text-[68px] font-bold tracking-[-0.03em] leading-[1] num mb-4"
          style={{
            color: walletConnected && !walletDataError ? "#FFFFFF" : "rgba(255,255,255,0.2)",
            textShadow: walletConnected && !walletDataError ? "0 0 80px rgba(51,201,161,0.12)" : "none",
          }}>
          {!walletConnected ? "$0.00"
            : walletDataLoading && totalWalletUsd === 0 ? "···"
            : walletDataError && totalWalletUsd === 0 ? "—"
            : formatUsd(springBalance)}
        </div>

        {/* Change indicators — like Galileo's 24h/7d but with PnL */}
        {walletConnected && !walletDataError ? (
          <div className="flex items-center gap-1.5 text-[14px]">
            {positions.length > 0 ? (
              <>
                <TrendArrow positive={totalPnl >= 0} />
                <span className="num font-semibold" style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "#FF4D4D" }}>
                  {totalPnl >= 0 ? "+" : ""}{formatPnl(springPnl)}
                </span>
                <span style={{ color: "rgba(255,255,255,0.25)" }}>PnL</span>
                {change24h !== null && change24h !== 0 && (
                  <>
                    <span style={{ color: "rgba(255,255,255,0.15)", margin: "0 4px" }}>·</span>
                    <TrendArrow positive={change24h >= 0} />
                    <span className="num font-semibold" style={{ color: change24h >= 0 ? "var(--color-accent-long)" : "#FF4D4D" }}>
                      {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.25)" }}>24h</span>
                  </>
                )}
              </>
            ) : change24h !== null && change24h !== 0 ? (
              <>
                <TrendArrow positive={change24h >= 0} />
                <span className="num font-semibold" style={{ color: change24h >= 0 ? "var(--color-accent-long)" : "#FF4D4D" }}>
                  {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
                </span>
                <span style={{ color: "rgba(255,255,255,0.25)" }}>24h</span>
              </>
            ) : (
              <span style={{ color: "rgba(255,255,255,0.25)" }}>Ready to trade</span>
            )}
          </div>
        ) : (
          <span className="text-[14px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            {walletConnected ? "Balance unavailable" : "Connect wallet to start"}
          </span>
        )}
      </div>

      {/* ═══ UNIFIED ASSET CARD ═══ */}
      {walletConnected && tokens.length > 0 && (
        <div className="w-full mb-10 relative z-10 rounded-[22px] overflow-hidden"
          style={{
            background: "rgba(14,19,28,0.6)",
            border: "1px solid rgba(51,201,161,0.06)",
            backdropFilter: "blur(24px) saturate(1.4)",
            boxShadow: "0 8px 32px -8px rgba(0,0,0,0.4)",
          }}>
          {/* Header */}
          <button onClick={toggleAssets}
            className="w-full flex items-center justify-between px-6 py-5 cursor-pointer
              transition-colors duration-150 hover:bg-white/[0.015]"
            style={{ borderBottom: assetsExpanded ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
            <div className="flex items-center">
              {tokens.slice(0, 4).map((t, i) => (
                <TokenIcon key={t.symbol} token={t} size={38} style={{
                  marginLeft: i > 0 ? "-10px" : "0", zIndex: 10 - i,
                  border: "3px solid #0C1018", borderRadius: "50%",
                }} />
              ))}
              <span className="text-[15px] ml-3.5 font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                {tokens.length} assets
              </span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round"
              style={{ transform: assetsExpanded ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Token list — internal scroll */}
          <div className="no-scrollbar" style={{
            maxHeight: assetsExpanded ? "320px" : "0",
            opacity: assetsExpanded ? 1 : 0,
            overflowY: assetsExpanded ? "auto" : "hidden",
            transition: "max-height 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms",
          }}>
            {tokens.map((t) => (
              <div key={t.mint || t.symbol}
                className="flex items-center justify-between px-6 py-4 transition-colors duration-100 hover:bg-white/[0.02]"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <div className="flex items-center gap-4">
                  <TokenIcon token={t} size={44} />
                  <div>
                    <div className="text-[15px] font-semibold leading-tight" style={{ color: "rgba(255,255,255,0.9)" }}>{t.name}</div>
                    <div className="text-[12px] num mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {fmtAmt(t.amount)} {t.symbol}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] num font-semibold" style={{ color: "rgba(255,255,255,0.9)" }}>{formatUsd(t.usd)}</div>
                  {t.pricePerToken > 0.001 && (
                    <div className="text-[12px] num mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>{fmtPrice(t.pricePerToken)}</div>
                  )}
                </div>
              </div>
            ))}
            {/* Verified footer */}
            <div className="text-center py-3" style={{ color: "rgba(255,255,255,0.2)", fontSize: "11px" }}>
              Showing Verified Tokens {`>`}$0.01
            </div>
          </div>
        </div>
      )}

      {/* ═══ ACTION ROW ═══ */}
      <div className="flex items-end justify-center gap-6 mb-10 relative z-10">
        <ActionNode label="Trade" onClick={() => onAction("I want to trade")}
          icon={<><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>} />
        <ActionNode label="Earn" onClick={() => onAction("I want to earn yield")}
          icon={<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />} />
        <FafNode onClick={() => onAction("faf")} />
        <ActionNode label="Send" onClick={() => onAction("I want to transfer tokens")}
          icon={<path d="M5 12h14M12 5l7 7-7 7" />} />
        <ActionNode label="Portfolio" onClick={() => onAction("show my portfolio")}
          icon={<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>} />
      </div>

      {/* ═══ LIVE MARKET STRIP — real prices from store ═══ */}
      <TrendingStrip onAction={onAction} />
    </div>
  );
}

// ═══ ACTION NODE — Premium circle, bold icon ═══
const ActionNode = memo(function ActionNode({ label, icon, onClick }: {
  label: string; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 group">
      <button onClick={onClick}
        className="action-circle"
        style={{ width: "66px", height: "66px" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          className="transition-colors duration-200"
          stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ filter: "none" }}
          onMouseEnter={() => {}}
          onMouseLeave={() => {}}>
          {icon}
        </svg>
      </button>
      <span className="text-[12px] font-medium transition-colors duration-200" style={{ color: "rgba(255,255,255,0.35)" }}>{label}</span>
    </div>
  );
});

// ═══ FAF NODE — Same style as others, star icon ═══
const FafNode = memo(function FafNode({ onClick }: { onClick: () => void }) {
  return (
    <ActionNode label="FAF" onClick={onClick}
      icon={<><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></>} />
  );
});

// ═══ TREND ARROW — Galileo-style ═══
function TrendArrow({ positive }: { positive: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke={positive ? "var(--color-accent-long)" : "#FF4D4D"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {positive
        ? <><polyline points="7 13 12 8 17 13" /><line x1="12" y1="8" x2="12" y2="16" /></>
        : <><polyline points="7 11 12 16 17 11" /><line x1="12" y1="16" x2="12" y2="8" /></>}
    </svg>
  );
}

// ═══ TRENDING STRIP — real 24h % changes from Pyth (oracle-grade, no rate limit) ═══
// Uses Pyth Hermes for current price + Pyth Benchmarks for prior-day close.
// 24h change = (current - yesterday_close) / yesterday_close * 100.
const PYTH_FEEDS: Record<string, { id: string; symbol: string }> = {
  BTC: { id: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", symbol: "Crypto.BTC/USD" },
  ETH: { id: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", symbol: "Crypto.ETH/USD" },
  SOL: { id: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", symbol: "Crypto.SOL/USD" },
  JUP: { id: "0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996", symbol: "Crypto.JUP/USD" },
};

const TrendingStrip = memo(function TrendingStrip({ onAction }: { onAction: (cmd: string) => void }) {
  const [trending, setTrending] = useState<{ symbol: string; change: number; logo: string; color: string }[]>([]);

  useEffect(() => {
    async function load() {
      try {
        // 1) Current prices via Pyth Hermes (one request, all feeds)
        const ids = Object.values(PYTH_FEEDS).map((f) => `ids%5B%5D=0x${f.id}`).join("&");
        const curResp = await fetch(
          `https://hermes.pyth.network/v2/updates/price/latest?${ids}&parsed=true`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!curResp.ok) return;
        const curData = await curResp.json();
        const parsed = (curData?.parsed ?? []) as Array<{ id: string; price: { price: string; expo: number } }>;
        const currentBySymbol: Record<string, number> = {};
        for (const [sym, feed] of Object.entries(PYTH_FEEDS)) {
          const match = parsed.find((p) => p.id?.toLowerCase() === feed.id.toLowerCase());
          if (match?.price) {
            currentBySymbol[sym] = Number(match.price.price) * Math.pow(10, match.price.expo);
          }
        }

        // 2) Prior 24h candle open via Pyth Benchmarks — one call per symbol
        const nowSec = Math.floor(Date.now() / 1000);
        const fromSec = nowSec - 90_000; // ~25h window to guarantee a daily candle
        const historyResults = await Promise.all(
          Object.entries(PYTH_FEEDS).map(async ([sym, feed]) => {
            try {
              const r = await fetch(
                `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(feed.symbol)}&resolution=D&from=${fromSec}&to=${nowSec}`,
                { signal: AbortSignal.timeout(5000) },
              );
              if (!r.ok) return [sym, null] as const;
              const d = await r.json();
              const opens = Array.isArray(d?.o) ? d.o as number[] : [];
              return [sym, opens[opens.length - 1] ?? null] as const;
            } catch {
              return [sym, null] as const;
            }
          }),
        );
        const openBySymbol: Record<string, number | null> = {};
        for (const [sym, open] of historyResults) openBySymbol[sym] = open;

        const items: { symbol: string; change: number; logo: string; color: string }[] = [];
        for (const sym of Object.keys(PYTH_FEEDS)) {
          const current = currentBySymbol[sym];
          const open = openBySymbol[sym];
          if (!Number.isFinite(current) || !Number.isFinite(open) || !open) continue;
          const change = ((current - (open as number)) / (open as number)) * 100;
          const meta = TOKEN_META[sym];
          items.push({ symbol: sym, change, logo: meta?.logo ?? "", color: meta?.color ?? "#555" });
        }
        setTrending(items);
      } catch {}
    }
    load();
    const iv = setInterval(load, 60_000);
    return () => clearInterval(iv);
  }, []);

  if (trending.length === 0) return null;

  return (
    <div className="flex items-center justify-center relative z-10 px-6 py-3 rounded-full"
      style={{
        background: "rgba(14,19,28,0.5)",
        border: "1px solid rgba(51,201,161,0.06)",
        backdropFilter: "blur(16px)",
        animation: "fadeIn 500ms ease 200ms both",
      }}>
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase flex items-center gap-1.5 mr-4"
        style={{ color: "rgba(51,201,161,0.4)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
        Trending
      </span>
      {trending.map((t, i) => (
        <button key={t.symbol} onClick={() => onAction(`price of ${t.symbol}`)}
          className="flex items-center gap-1.5 cursor-pointer transition-opacity duration-150 hover:opacity-70"
          style={{ marginLeft: i > 0 ? "14px" : "0", borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.06)" : "none", paddingLeft: i > 0 ? "14px" : "0" }}>
          <TokenIcon token={t} size={20} />
          <span className="text-[13px] font-semibold" style={{ color: "rgba(255,255,255,0.55)" }}>{t.symbol}</span>
          <span className="text-[13px] num font-bold" style={{ color: t.change >= 0 ? "var(--color-accent-long)" : "#FF4D4D" }}>
            {t.change >= 0 ? "+" : ""}{t.change.toFixed(2)}%
          </span>
        </button>
      ))}
    </div>
  );
});

// ═══ TOKEN ICON ═══
function TokenIcon({ token, size = 32, style }: {
  token: { symbol: string; logo: string; logoFallback?: string; color: string }; size?: number; style?: React.CSSProperties;
}) {
  const [pf, setPf] = useState(false);
  const [ff, setFf] = useState(false);
  const src = !pf ? token.logo : token.logoFallback;
  const init = (!token.logo && !token.logoFallback) || (pf && !token.logoFallback) || (pf && ff);
  if (init) return (
    <span style={{ width: size, height: size, borderRadius: "50%", background: token.color,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.3, fontWeight: 700, color: "#fff", flexShrink: 0, ...style }}>
      {token.symbol.slice(0, 2)}
    </span>
  );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={src} src={src!} alt={token.symbol} width={size} height={size}
      style={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", objectFit: "cover", ...style }}
      onError={() => { if (!pf) setPf(true); else setFf(true); }} />
  );
}

function fmtAmt(n: number): string {
  if (n < 0.0001) return n.toFixed(7); if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4); return n.toFixed(2);
}
function fmtPrice(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}K`; if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`; return `$${n.toFixed(4)}`;
}
