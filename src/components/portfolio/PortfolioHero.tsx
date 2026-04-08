"use client";

// ============================================
// Flash AI — Neural Trading Interface
// ============================================
// 3-Zone Architecture:
//   ZONE 1: The Pulse — living balance + status line
//   ZONE 2: The Orbit — FAF core + action nodes
//   ZONE 3: (handled by ChatPanel — command input)
//
// Design: NOT a Galileo clone. This is a reactive system.
// Every element responds to user state. Nothing is static.

import { memo, useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  logoFallback: string;
  color: string;
  portfolioPct: number;
}

// ── MAIN COMPONENT ──
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

        try {
          const key = `flash_portfolio_${walletAddress?.slice(0, 8)}`;
          const stored = sessionStorage.getItem(key);
          if (stored) {
            const prev = JSON.parse(stored);
            if (prev.usd > 0 && total > 0) setChange24h(((total - prev.usd) / prev.usd) * 100);
          } else {
            sessionStorage.setItem(key, JSON.stringify({ usd: total, ts: Date.now() }));
          }
        } catch {}

        const toks: WalletToken[] = [];
        if (data.solBalance > 0) {
          const m = TOKEN_META["SOL"];
          toks.push({
            symbol: "SOL", name: m?.name ?? "Solana",
            amount: data.solBalance, usd: data.solUsd ?? 0,
            pricePerToken: (data.solUsd ?? 0) / data.solBalance,
            logo: m?.logo ?? "", logoFallback: "", color: m?.color ?? "#9945FF", portfolioPct: 0,
          });
        }
        for (const t of data.tokens ?? []) {
          if (t.usdValue < 0.01) continue;
          const sym = t.symbol?.toUpperCase?.() ?? t.symbol;
          const m = TOKEN_META[sym] ?? TOKEN_META[t.symbol];
          const dasLogo = t.logoUri || "";
          const primaryLogo = m?.logo || dasLogo;
          toks.push({
            symbol: sym, name: m?.name ?? sym,
            amount: t.amount, usd: t.usdValue,
            pricePerToken: t.pricePerToken ?? 0,
            logo: primaryLogo, logoFallback: primaryLogo !== dasLogo ? dasLogo : "",
            color: m?.color ?? "#3E5068", portfolioPct: 0,
          });
        }
        // Calculate portfolio percentages
        for (const t of toks) t.portfolioPct = total > 0 ? (t.usd / total) * 100 : 0;
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
  const springBalance = useNumberSpring(totalWalletUsd, { stiffness: 120, damping: 22 });
  const springPnl = useNumberSpring(totalPnl, { stiffness: 160, damping: 20 });

  const toggleAssets = useCallback(() => setAssetsExpanded((v) => !v), []);

  // Status line — state-driven, changes based on what's happening
  const statusLine = useMemo(() => {
    if (!walletConnected) return { text: "Connect wallet to begin", color: "var(--color-text-tertiary)" };
    if (walletDataError) return { text: "Balance unavailable", color: "var(--color-text-tertiary)" };
    if (positions.length > 0) {
      const pnlText = totalPnl >= 0 ? `+${formatPnl(totalPnl)}` : formatPnl(totalPnl);
      return {
        text: `${pnlText} across ${positions.length} position${positions.length > 1 ? "s" : ""}`,
        color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)",
      };
    }
    if (change24h !== null && change24h !== 0) {
      return {
        text: `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}% this session`,
        color: change24h >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)",
      };
    }
    if (totalWalletUsd > 0) return { text: "Ready to trade", color: "var(--color-text-tertiary)" };
    return { text: "Fund your wallet to start", color: "var(--color-text-tertiary)" };
  }, [walletConnected, walletDataError, positions.length, totalPnl, change24h, totalWalletUsd]);

  return (
    <div className="flex flex-col items-center w-full max-w-[560px] mx-auto pt-16 pb-4 px-6 relative">
      {/* Ambient radial glow */}
      <div className="hero-glow" />

      {/* ═══════════════════════════════════════════
          ZONE 1 — THE PULSE (Living Balance)
          ═══════════════════════════════════════════ */}
      <div className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-3"
        style={{ color: "var(--color-text-tertiary)", letterSpacing: "0.3em" }}>
        TOTAL BALANCE
      </div>

      <div className="text-[56px] font-bold tracking-[-0.03em] leading-[1] num mb-2"
        style={{ color: walletConnected && !walletDataError ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
        {!walletConnected ? "$0.00"
          : walletDataLoading && totalWalletUsd === 0 ? "···"
          : walletDataError && totalWalletUsd === 0 ? "—"
          : formatUsd(springBalance)}
      </div>

      {/* Status Line — single reactive line */}
      <div className="text-[13px] mb-8 transition-colors duration-300"
        style={{ color: statusLine.color }}>
        {statusLine.text}
      </div>

      {/* ═══════════════════════════════════════════
          ASSET CONSTELLATION
          ═══════════════════════════════════════════ */}
      {walletConnected && tokens.length > 0 && (
        <div className="w-full mb-8">
          <button onClick={toggleAssets}
            className="w-full flex items-center justify-between px-5 py-3.5 cursor-pointer
              transition-all duration-300 active:scale-[0.995]"
            style={{
              borderRadius: assetsExpanded ? "16px 16px 0 0" : "16px",
              background: "rgba(14, 19, 28, 0.5)",
              border: `1px solid ${assetsExpanded ? "rgba(200, 245, 71, 0.06)" : "rgba(255,255,255,0.05)"}`,
              borderBottom: assetsExpanded ? "1px solid rgba(255,255,255,0.03)" : undefined,
              backdropFilter: "blur(20px)",
            }}>
            <div className="flex items-center">
              {tokens.slice(0, 4).map((t, i) => (
                <TokenIcon key={t.symbol} token={t} size={32}
                  style={{
                    marginLeft: i > 0 ? "-8px" : "0",
                    zIndex: 5 - i,
                    border: "2px solid var(--color-bg-card-solid)",
                    borderRadius: "50%",
                  }}
                />
              ))}
              <span className="text-[14px] text-text-secondary ml-3 font-medium">
                {tokens.length} asset{tokens.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300"
              style={{ background: assetsExpanded ? "rgba(200, 245, 71, 0.06)" : "transparent" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke={assetsExpanded ? "var(--color-accent-lime)" : "var(--color-text-tertiary)"}
                strokeWidth="2.5" strokeLinecap="round"
                style={{
                  transform: assetsExpanded ? "rotate(180deg)" : "rotate(0)",
                  transition: "transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {/* Expanded token list — internal scroll */}
          <div className="no-scrollbar" style={{
            maxHeight: assetsExpanded ? "300px" : "0",
            opacity: assetsExpanded ? 1 : 0,
            overflowY: assetsExpanded ? "auto" : "hidden",
            overflowX: "hidden",
            transition: "max-height 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms",
            background: "rgba(14, 19, 28, 0.5)",
            border: assetsExpanded ? "1px solid rgba(200, 245, 71, 0.06)" : "1px solid transparent",
            borderTop: "none",
            borderRadius: "0 0 16px 16px",
            backdropFilter: "blur(20px)",
          }}>
            {tokens.map((t, i) => (
              <div key={t.symbol}
                className="flex items-center justify-between px-5 py-3 transition-colors duration-150 hover:bg-white/[0.02] relative"
                style={{ borderBottom: i < tokens.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                {/* Portfolio % indicator bar */}
                <div className="absolute left-0 top-1 bottom-1 rounded-r-full transition-all duration-500"
                  style={{
                    width: `${Math.max(2, Math.min(4, t.portfolioPct / 15))}px`,
                    background: t.color,
                    opacity: 0.4,
                  }} />
                <div className="flex items-center gap-3.5">
                  <TokenIcon token={t} size={i < 3 ? 42 : 36} />
                  <div>
                    <div className="text-[15px] font-semibold text-text-primary leading-tight">{t.name}</div>
                    <div className="text-[12px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                      {formatTokenAmount(t.amount)} {t.symbol}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] num font-semibold text-text-primary">{formatUsd(t.usd)}</div>
                  {t.pricePerToken > 0.001 && (
                    <div className="text-[11px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                      {formatCompactPrice(t.pricePerToken)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          ZONE 2 — THE ORBIT (Action System)
          ═══════════════════════════════════════════ */}
      <div className="flex items-end justify-center gap-5 mb-6">
        <OrbitNode label="Trade" onClick={() => onAction("I want to trade")}
          icon={<><line x1="12" y1="20" x2="12" y2="4" /><polyline points="5 11 12 4 19 11" /></>} />
        <OrbitNode label="Earn" onClick={() => onAction("I want to earn yield")}
          icon={<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />} />

        {/* FAF — THE CORE NODE */}
        <FafCoreNode onClick={() => onAction("faf")} positions={positions} />

        <OrbitNode label="Transfer" onClick={() => onAction("I want to transfer tokens")}
          icon={<path d="M5 12h14M12 5l7 7-7 7" />} />
        <OrbitNode label="Portfolio" onClick={() => onAction("show my portfolio")}
          icon={<><path d="M21 12V7H5a2 2 0 010-4h14v4" /><path d="M3 5v14a2 2 0 002 2h16v-5" /><path d="M18 12a2 2 0 000 4h4v-4h-4z" /></>} />
      </div>

      {/* Context nudge — max 1 line */}
      <ContextNudge onAction={onAction} walletConnected={walletConnected} totalUsd={totalWalletUsd} positions={positions} />
    </div>
  );
}

// ═══════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════

// ── FAF Core Node (center, dominant, breathing) ──
const FafCoreNode = memo(function FafCoreNode({ onClick, positions }: { onClick: () => void; positions: { market?: string }[] }) {
  // State-aware label
  const subLabel = positions.length > 0 ? "Dashboard" : "Stake";

  return (
    <div className="flex flex-col items-center gap-2 -mt-2">
      <button onClick={onClick}
        className="relative flex items-center justify-center cursor-pointer
          transition-transform duration-150 hover:scale-[1.04] active:scale-[0.93]"
        style={{
          width: "72px", height: "72px", borderRadius: "50%",
          background: "linear-gradient(145deg, #C8F547 0%, #a8d435 100%)",
          boxShadow: "0 0 28px rgba(200,245,71,0.14), 0 0 56px rgba(200,245,71,0.06), 0 6px 16px rgba(0,0,0,0.25)",
        }}>
        {/* Breathing ring */}
        <span className="absolute inset-[-7px] rounded-full pointer-events-none"
          style={{ border: "1px solid rgba(200,245,71,0.1)", animation: "fafBreathe 6s ease-in-out infinite" }} />
        <span className="absolute inset-[-14px] rounded-full pointer-events-none"
          style={{ border: "1px solid rgba(200,245,71,0.04)", animation: "fafBreathe 6s ease-in-out infinite 3s" }} />
        <span className="text-[18px] font-black tracking-tight select-none" style={{ color: "#070A0F" }}>
          FAF
        </span>
      </button>
      <span className="text-[11px] font-semibold" style={{ color: "var(--color-accent-lime)" }}>
        {subLabel}
      </span>
    </div>
  );
});

// ── Orbit Node (Trade, Earn, Transfer, Portfolio) ──
const OrbitNode = memo(function OrbitNode({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button onClick={onClick}
        className="flex items-center justify-center cursor-pointer text-text-secondary
          transition-all duration-150 hover:text-text-primary hover:-translate-y-[2px]
          active:scale-[0.92] active:translate-y-0"
        style={{
          width: "54px", height: "54px", borderRadius: "50%",
          background: "rgba(14, 19, 28, 0.6)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          transition: "all 150ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "rgba(200,245,71,0.15)";
          e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,0.25)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
          e.currentTarget.style.boxShadow = "none";
        }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </button>
      <span className="text-[11px] font-medium" style={{ color: "var(--color-text-tertiary)" }}>{label}</span>
    </div>
  );
});

// ── Context Nudge (single reactive line below orbit) ──
const ContextNudge = memo(function ContextNudge({ onAction, walletConnected, totalUsd, positions }: {
  onAction: (cmd: string) => void;
  walletConnected: boolean;
  totalUsd: number;
  positions: { market?: string; unrealized_pnl?: number }[];
}) {
  const nudge = useMemo(() => {
    if (!walletConnected) return null;
    const hotPos = positions.find((p) => Math.abs(safe(p.unrealized_pnl)) > 5);
    if (hotPos && safe(hotPos.unrealized_pnl) > 5) {
      return { text: `${hotPos.market} is up ${formatUsd(safe(hotPos.unrealized_pnl))}`, action: "show my positions", dot: "var(--color-accent-long)" };
    }
    if (hotPos && safe(hotPos.unrealized_pnl) < -5) {
      return { text: `${hotPos.market} needs attention`, action: "show my positions", dot: "var(--color-accent-short)" };
    }
    if (positions.length === 0 && totalUsd > 10) {
      return { text: "Open your first position", action: "I want to trade", dot: "var(--color-accent-lime)" };
    }
    return null;
  }, [walletConnected, totalUsd, positions]);

  if (!nudge) return <div className="h-4" />;

  return (
    <button onClick={() => onAction(nudge.action)}
      className="flex items-center gap-2 px-4 py-2 rounded-full cursor-pointer
        transition-all duration-200 hover:bg-white/[0.03] active:scale-[0.97]"
      style={{ animation: "fadeIn 400ms ease" }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: nudge.dot, boxShadow: `0 0 8px ${nudge.dot}50`, animation: "pulseDot 2s infinite" }} />
      <span className="text-[12px] text-text-secondary">{nudge.text}</span>
    </button>
  );
});

// ── Token Icon (with 2-tier fallback) ──
function TokenIcon({ token, size = 32, style }: {
  token: { symbol: string; logo: string; logoFallback?: string; color: string };
  size?: number;
  style?: React.CSSProperties;
}) {
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  const activeSrc = !primaryFailed ? token.logo : token.logoFallback;
  const showInitials = (!token.logo && !token.logoFallback)
    || (primaryFailed && !token.logoFallback)
    || (primaryFailed && fallbackFailed);

  if (showInitials) {
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={activeSrc}
      src={activeSrc!}
      alt={token.symbol}
      width={size}
      height={size}
      style={{ width: size, height: size, flexShrink: 0, borderRadius: "50%", objectFit: "cover", ...style }}
      onError={() => {
        if (!primaryFailed) setPrimaryFailed(true);
        else setFallbackFailed(true);
      }}
    />
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
