"use client";

// ============================================
// Flash AI — Portfolio Hero (Galileo-Killer)
// ============================================
// Pixel-perfect premium design:
// - Huge balance with 24h/7d changes
// - Glass asset pill with real token logos (next/image)
// - Large action circles with proper spacing
// - Trending bar with token logos
// - Ambient glow + dot grid background

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { useFlashStore } from "@/store";
import { POSITION_REFRESH_MS, TOKEN_META } from "@/lib/constants";
import { formatUsd, formatPnl, safe } from "@/lib/format";
import { useNumberSpring } from "@/hooks/useSpring";

interface PortfolioHeroProps {
  onAction: (command: string) => void;
  onFillInput?: (text: string) => void;
}

interface WalletToken {
  symbol: string;
  name: string;
  amount: number;
  usd: number;
  pricePerToken: number;
  logo: string;
  color: string;
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

  // Track 24h change via sessionStorage snapshot
  const [change24h, setChange24h] = useState<number | null>(null);

  const refreshRef = useRef(refreshPositions);
  refreshRef.current = refreshPositions;

  useEffect(() => {
    if (!walletConnected) return;
    refreshRef.current();
    const iv = setInterval(() => refreshRef.current(), POSITION_REFRESH_MS);
    return () => clearInterval(iv);
  }, [walletConnected]);

  // Wallet balances
  useEffect(() => {
    if (!walletConnected || !walletAddress) return;
    let cancelled = false;
    setWalletDataLoading(true);
    async function load() {
      try {
        const resp = await fetch("/api/token-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress }),
        });
        if (!resp.ok) { if (!cancelled) setWalletDataError(true); return; }
        const data = await resp.json().catch(() => null);
        if (!data || cancelled) return;

        const total = data.totalUsd ?? 0;
        setTotalWalletUsd(total);

        // Track portfolio change from first load
        try {
          const key = `flash_portfolio_${walletAddress?.slice(0, 8)}`;
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const prev = JSON.parse(stored);
            if (prev.usd > 0 && total > 0) {
              setChange24h(((total - prev.usd) / prev.usd) * 100);
            }
          } else {
            sessionStorage.setItem(key, JSON.stringify({ usd: total, ts: Date.now() }));
          }
        } catch {}

        // Build token list
        const toks: WalletToken[] = [];
        if (data.solBalance > 0) {
          const m = TOKEN_META["SOL"];
          toks.push({
            symbol: "SOL",
            name: m?.name ?? "Solana",
            amount: data.solBalance,
            usd: data.solUsd ?? 0,
            pricePerToken: (data.solUsd ?? 0) / data.solBalance,
            logo: m?.logo ?? "",
            color: m?.color ?? "#9945FF",
          });
        }
        for (const t of data.tokens ?? []) {
          if (t.usdValue < 0.01) continue;
          const sym = t.symbol?.toUpperCase?.() ?? t.symbol;
          const m = TOKEN_META[sym] ?? TOKEN_META[t.symbol];
          toks.push({
            symbol: sym,
            name: m?.name ?? sym,
            amount: t.amount,
            usd: t.usdValue,
            pricePerToken: t.pricePerToken ?? 0,
            logo: m?.logo ?? t.logoUri ?? "",
            color: m?.color ?? "#3E5068",
          });
        }
        toks.sort((a, b) => b.usd - a.usd);
        setTokens(toks);
        setWalletDataError(false);
        setWalletDataLoading(false);
      } catch {
        if (!cancelled) { setWalletDataError(true); setWalletDataLoading(false); }
      }
    }
    load();
    const iv = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [walletConnected, walletAddress]);

  let totalPnl = 0;
  for (const pos of positions) totalPnl += safe(pos.unrealized_pnl);
  const springPnl = useNumberSpring(totalPnl, { stiffness: 160, damping: 20 });

  const toggleAssets = useCallback(() => setAssetsExpanded((v) => !v), []);

  return (
    <div className="flex flex-col items-center w-full max-w-[560px] mx-auto pt-20 pb-6 px-6 relative">
      {/* Ambient glow */}
      <div className="hero-glow" />

      {/* ── TOTAL BALANCE ── */}
      <div className="text-[12px] font-semibold tracking-[0.25em] uppercase mb-4"
        style={{ color: "var(--color-text-tertiary)" }}>
        Total Balance
      </div>

      <div className="text-[64px] font-bold tracking-[-0.03em] leading-[1] num mb-3"
        style={{ color: walletConnected && !walletDataError ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
        {!walletConnected ? "$0.00"
          : walletDataLoading && totalWalletUsd === 0 ? "···"
          : walletDataError && totalWalletUsd === 0 ? "—"
          : formatUsd(totalWalletUsd)}
      </div>

      {/* ── 24h / PnL Change Line ── */}
      {walletConnected && !walletDataError ? (
        <div className="flex items-center gap-3 mb-10 text-[14px]">
          {positions.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <ChangeArrow positive={totalPnl >= 0} />
              <span className="num font-semibold"
                style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                {formatPnl(springPnl)}
              </span>
              <span style={{ color: "var(--color-text-tertiary)" }}>PnL</span>
            </span>
          ) : change24h !== null ? (
            <span className="flex items-center gap-1.5">
              <ChangeArrow positive={change24h >= 0} />
              <span className="num font-semibold"
                style={{ color: change24h >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
              </span>
              <span style={{ color: "var(--color-text-tertiary)" }}>session</span>
            </span>
          ) : null}
        </div>
      ) : (
        <div className="text-[14px] mb-10" style={{ color: "var(--color-text-tertiary)" }}>
          {walletConnected ? "Balance unavailable" : "Connect wallet to start trading"}
        </div>
      )}

      {/* ── ASSET PILL (Galileo-style glass) ── */}
      {walletConnected && tokens.length > 0 && (
        <div className="w-full mb-10">
          <button onClick={toggleAssets}
            className="w-full glass-card flex items-center justify-between px-5 py-4
              cursor-pointer transition-all duration-200 hover:border-border-focus"
            style={{ borderRadius: "20px" }}>
            {/* Stacked token logos */}
            <div className="flex items-center">
              {tokens.slice(0, 4).map((t, i) => (
                <TokenIcon key={t.symbol} token={t} size={36}
                  style={{
                    marginLeft: i > 0 ? "-10px" : "0",
                    zIndex: 5 - i,
                    border: "3px solid var(--color-bg-card-solid)",
                    borderRadius: "50%",
                  }}
                />
              ))}
              <span className="text-[15px] text-text-secondary ml-3.5 font-medium">
                {tokens.length} asset{tokens.length !== 1 ? "s" : ""}
              </span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round"
              style={{
                transform: assetsExpanded ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 250ms cubic-bezier(0.2, 0, 0, 1)",
              }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Expanded asset list */}
          {assetsExpanded && (
            <div className="mt-2 glass-card overflow-hidden"
              style={{ borderRadius: "20px", animation: "slideDown 200ms cubic-bezier(0.2, 0, 0, 1)" }}>
              {tokens.map((t, i) => (
                <div key={t.symbol}
                  className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-white/[0.02]"
                  style={{ borderBottom: i < tokens.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                  <div className="flex items-center gap-4">
                    <TokenIcon token={t} size={44} />
                    <div>
                      <div className="text-[16px] font-semibold text-text-primary leading-tight">{t.name}</div>
                      <div className="text-[13px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                        {formatTokenAmount(t.amount)} {t.symbol}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[16px] num font-semibold text-text-primary">{formatUsd(t.usd)}</div>
                    {t.pricePerToken > 0 && (
                      <div className="text-[12px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                        {formatCompactPrice(t.pricePerToken)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ACTION CIRCLES ── */}
      <div className="flex items-center justify-center gap-7 mb-8">
        <ActionBtn label="Trade" onClick={() => onAction("I want to trade")}
          icon={<>
            <line x1="12" y1="20" x2="12" y2="4" />
            <polyline points="5 11 12 4 19 11" />
          </>} />
        <ActionBtn label="Earn" onClick={() => onAction("I want to earn yield")}
          icon={<>
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </>} />
        {/* FAF = Primary action hub — visually dominant */}
        <FafActionBtn onClick={() => onAction("faf")} />
        <ActionBtn label="Transfer" onClick={() => onAction("I want to transfer tokens")}
          icon={<path d="M5 12h14M12 5l7 7-7 7" />} />
        <ActionBtn label="Portfolio" onClick={() => onAction("show my portfolio")}
          icon={<>
            <path d="M21 12V7H5a2 2 0 010-4h14v4" />
            <path d="M3 5v14a2 2 0 002 2h16v-5" />
            <path d="M18 12a2 2 0 000 4h4v-4h-4z" />
          </>} />
      </div>

      {/* ── TRENDING BAR (with token logos) ── */}
      <TrendingBar onAction={onAction} />
    </div>
  );
}

// ── Token Icon (next/image with fallback) ──
function TokenIcon({ token, size = 32, style }: {
  token: { symbol: string; logo: string; color: string };
  size?: number;
  style?: React.CSSProperties;
}) {
  const [err, setErr] = useState(false);

  if (!token.logo || err) {
    return (
      <span style={{
        width: size, height: size, borderRadius: "50%",
        background: token.color, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size * 0.3, fontWeight: 700,
        color: "#fff", flexShrink: 0, ...style,
      }}>
        {token.symbol.slice(0, 2)}
      </span>
    );
  }

  return (
    <Image
      src={token.logo}
      alt={token.symbol}
      width={size}
      height={size}
      className="token-logo"
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      onError={() => setErr(true)}
      unoptimized
    />
  );
}

// ── Change Arrow SVG ──
function ChangeArrow({ positive }: { positive: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke={positive ? "var(--color-accent-long)" : "var(--color-accent-short)"}
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {positive
        ? <polyline points="7 17 12 12 17 17M7 7 12 12 17 7" />
        : <polyline points="7 7 12 12 17 7M7 17 12 12 17 17" />}
    </svg>
  );
}

// ── FAF Primary Action Button (visually dominant, center position) ──
function FafActionBtn({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <button onClick={onClick}
        className="relative flex items-center justify-center cursor-pointer transition-all duration-200
          hover:scale-105 active:scale-95"
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          background: "linear-gradient(135deg, var(--color-accent-lime), rgba(200,245,71,0.7))",
          boxShadow: "0 0 20px rgba(200,245,71,0.15), 0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        <span className="text-[18px] font-black tracking-tight" style={{ color: "#070A0F" }}>
          FAF
        </span>
      </button>
      <span className="text-[12px] font-semibold" style={{ color: "var(--color-accent-lime)" }}>
        FAF
      </span>
    </div>
  );
}

// ── Action Button ──
function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <button onClick={onClick}
        className="action-circle text-text-secondary hover:text-text-primary"
        style={{ width: "60px", height: "60px" }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </button>
      <span className="text-[12px] font-medium" style={{ color: "var(--color-text-tertiary)" }}>{label}</span>
    </div>
  );
}

// ── Trending Bar ──
const TRENDING_TOKENS = [
  { symbol: "SOL", name: "SOL" },
  { symbol: "BTC", name: "BTC" },
  { symbol: "ETH", name: "ETH" },
  { symbol: "JUP", name: "JUP" },
];

function TrendingBar({ onAction }: { onAction: (cmd: string) => void }) {
  const prices = useFlashStore((s) => s.prices);
  const items = TRENDING_TOKENS
    .map((t) => {
      const p = prices[t.symbol];
      if (!p?.price) return null;
      const meta = TOKEN_META[t.symbol];
      return { ...t, price: p.price, change: 0, logo: meta?.logo ?? "", color: meta?.color ?? "#555" };
    })
    .filter(Boolean) as { symbol: string; name: string; price: number; change: number; logo: string; color: string }[];

  if (items.length === 0) return null;

  return (
    <div className="glass-card flex items-center gap-4 px-5 py-3" style={{ borderRadius: "9999px" }}>
      <span className="text-[11px] font-bold tracking-[0.15em] uppercase flex items-center gap-1.5"
        style={{ color: "var(--color-text-tertiary)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
        Trending
      </span>
      {items.map((t) => (
        <button key={t.symbol} onClick={() => onAction(`price of ${t.symbol}`)}
          className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
          <TokenIcon token={t} size={20} />
          <span className="text-[13px] font-semibold text-text-secondary">{t.name}</span>
          <span className="text-[13px] num font-bold"
            style={{ color: t.change >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
            {t.change >= 0 ? "+" : ""}{t.change.toFixed(2)}%
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Helpers ──
function formatTokenAmount(n: number): string {
  if (n < 0.0001) return n.toFixed(7);
  if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  return n.toFixed(2);
}

function formatCompactPrice(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}
