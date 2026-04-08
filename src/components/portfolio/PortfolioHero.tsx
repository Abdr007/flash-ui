"use client";

// ============================================
// Flash AI — Home Screen (Neural Interface)
// ============================================
// NOT a Galileo clone. NOT a wallet viewer.
// This is an AI-first trading terminal.
//
// Layout: Compact top bar → Smart surface → Orbit actions
// The chat input (in ChatPanel) is the real hero.
// The home screen SERVES the input — context above, actions around.

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
            amount: t.amount, usd: t.usdValue, pricePerToken: t.pricePerToken ?? 0,
            logo: primaryLogo, logoFallback: primaryLogo !== dasLogo ? dasLogo : "",
            color: m?.color ?? "#3E5068", portfolioPct: 0,
          });
        }
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

  const toggleAssets = useCallback(() => setAssetsExpanded((v) => !v), []);

  // Smart greeting based on time
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  return (
    <div className="flex flex-col items-center w-full max-w-[600px] mx-auto pt-10 pb-4 px-5 relative">
      {/* Ambient glow */}
      <div className="hero-glow" />

      {/* ═══════════════════════════════════════
          GREETING + BALANCE (Compact, not hero-sized)
          ═══════════════════════════════════════ */}
      <div className="w-full mb-6" style={{ animation: "fadeIn 300ms ease" }}>
        <div className="text-[14px] text-text-secondary mb-1">{greeting}</div>
        <div className="flex items-baseline gap-3">
          <span className="text-[36px] font-bold tracking-[-0.02em] num leading-none"
            style={{ color: walletConnected && !walletDataError ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
            {!walletConnected ? "$0.00"
              : walletDataLoading && totalWalletUsd === 0 ? "···"
              : walletDataError && totalWalletUsd === 0 ? "—"
              : formatUsd(springBalance)}
          </span>
          {walletConnected && !walletDataError && (
            <span className="text-[13px] num font-medium" style={{
              color: totalPnl >= 0 ? "var(--color-accent-long)" : totalPnl < 0 ? "var(--color-accent-short)" : "var(--color-text-tertiary)",
            }}>
              {positions.length > 0
                ? `${totalPnl >= 0 ? "+" : ""}${formatPnl(totalPnl)} PnL`
                : change24h !== null && change24h !== 0
                  ? `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`
                  : ""}
            </span>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════
          SMART SURFACE — Reactive cards grid
          Shows what matters based on user state
          ═══════════════════════════════════════ */}
      <div className="w-full grid grid-cols-2 gap-2.5 mb-6" style={{ animation: "fadeIn 400ms ease 100ms both" }}>
        {/* FAF Card — always present, state-aware */}
        <SmartCard
          onClick={() => onAction("faf")}
          accent="#C8F547"
          icon={<span className="text-[16px] font-black" style={{ color: "#070A0F" }}>F</span>}
          iconBg="linear-gradient(135deg, #C8F547, #a8d435)"
          title={positions.length > 0 ? "FAF Dashboard" : "Start Earning"}
          subtitle="Stake FAF for fee discounts"
          glow
        />

        {/* Trade Card */}
        <SmartCard
          onClick={() => onAction("I want to trade")}
          accent="#3B82F6"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>}
          title="Trade"
          subtitle={positions.length > 0 ? `${positions.length} open position${positions.length > 1 ? "s" : ""}` : "Perpetuals up to 100x"}
        />

        {/* Earn Card */}
        <SmartCard
          onClick={() => onAction("I want to earn yield")}
          accent="#00D26A"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00D26A" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>}
          title="Earn"
          subtitle="Yield on USDC pools"
        />

        {/* Transfer Card */}
        <SmartCard
          onClick={() => onAction("I want to transfer tokens")}
          accent="#8B5CF6"
          icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>}
          title="Transfer"
          subtitle="Send any token"
        />
      </div>

      {/* ═══════════════════════════════════════
          ASSET STRIP — Horizontal token preview
          ═══════════════════════════════════════ */}
      {walletConnected && tokens.length > 0 && (
        <div className="w-full mb-4" style={{ animation: "fadeIn 400ms ease 200ms both" }}>
          <button onClick={toggleAssets}
            className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer
              transition-all duration-200 active:scale-[0.995]"
            style={{
              borderRadius: assetsExpanded ? "14px 14px 0 0" : "14px",
              background: "rgba(14, 19, 28, 0.4)",
              border: "1px solid rgba(255,255,255,0.04)",
              borderBottom: assetsExpanded ? "1px solid rgba(255,255,255,0.03)" : undefined,
            }}>
            {/* Horizontal token strip */}
            <div className="flex items-center flex-1 gap-1 overflow-hidden">
              {tokens.slice(0, 6).map((t, i) => (
                <TokenIcon key={t.symbol} token={t} size={28}
                  style={{
                    marginLeft: i > 0 ? "-4px" : "0",
                    zIndex: 10 - i,
                    border: "2px solid #0E131C",
                    borderRadius: "50%",
                  }}
                />
              ))}
              <span className="text-[13px] text-text-tertiary ml-2 font-medium whitespace-nowrap">
                {tokens.length} assets
              </span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--color-text-tertiary)" strokeWidth="2.5" strokeLinecap="round"
              style={{
                transform: assetsExpanded ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {/* Expanded list */}
          <div className="no-scrollbar" style={{
            maxHeight: assetsExpanded ? "280px" : "0",
            opacity: assetsExpanded ? 1 : 0,
            overflowY: assetsExpanded ? "auto" : "hidden",
            overflowX: "hidden",
            transition: "max-height 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms",
            background: "rgba(14, 19, 28, 0.4)",
            border: assetsExpanded ? "1px solid rgba(255,255,255,0.04)" : "1px solid transparent",
            borderTop: "none",
            borderRadius: "0 0 14px 14px",
          }}>
            {tokens.map((t, i) => (
              <div key={t.symbol}
                className="flex items-center justify-between px-4 py-2.5 transition-colors duration-100 hover:bg-white/[0.02] relative"
                style={{ borderBottom: i < tokens.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                {/* Portfolio % bar */}
                <div className="absolute left-0 top-1.5 bottom-1.5 rounded-r-full"
                  style={{ width: `${Math.max(2, Math.min(3, t.portfolioPct / 20))}px`, background: t.color, opacity: 0.5 }} />
                <div className="flex items-center gap-3">
                  <TokenIcon token={t} size={36} />
                  <div>
                    <div className="text-[14px] font-semibold text-text-primary leading-tight">{t.name}</div>
                    <div className="text-[11px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                      {formatTokenAmount(t.amount)} {t.symbol}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] num font-semibold text-text-primary">{formatUsd(t.usd)}</div>
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

      {/* ═══════════════════════════════════════
          CONTEXT NUDGE — Single smart line
          ═══════════════════════════════════════ */}
      <ContextNudge onAction={onAction} walletConnected={walletConnected}
        totalUsd={totalWalletUsd} positions={positions} />
    </div>
  );
}

// ═══════════════════════════════════════════
// SMART CARD — The core interaction unit
// ═══════════════════════════════════════════
const SmartCard = memo(function SmartCard({ onClick, accent, icon, iconBg, title, subtitle, glow }: {
  onClick: () => void;
  accent: string;
  icon: React.ReactNode;
  iconBg?: string;
  title: string;
  subtitle: string;
  glow?: boolean;
}) {
  return (
    <button onClick={onClick}
      className="relative flex flex-col items-start p-4 rounded-2xl cursor-pointer
        transition-all duration-150 hover:-translate-y-[1px] active:scale-[0.97] active:translate-y-0
        text-left w-full"
      style={{
        background: "rgba(14, 19, 28, 0.5)",
        border: "1px solid rgba(255,255,255,0.05)",
        backdropFilter: "blur(16px)",
        boxShadow: glow ? `0 0 40px ${accent}08, 0 2px 12px rgba(0,0,0,0.2)` : "0 2px 8px rgba(0,0,0,0.15)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${accent}25`;
        e.currentTarget.style.boxShadow = `0 0 30px ${accent}10, 0 8px 24px rgba(0,0,0,0.25)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
        e.currentTarget.style.boxShadow = glow ? `0 0 40px ${accent}08, 0 2px 12px rgba(0,0,0,0.2)` : "0 2px 8px rgba(0,0,0,0.15)";
      }}>
      {/* Icon */}
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
        style={{
          background: iconBg ?? `${accent}12`,
          boxShadow: glow ? `0 0 16px ${accent}15` : "none",
        }}>
        {icon}
      </div>
      <div className="text-[14px] font-semibold text-text-primary leading-tight">{title}</div>
      <div className="text-[11px] mt-1" style={{ color: "var(--color-text-tertiary)" }}>{subtitle}</div>
    </button>
  );
});

// ── Context Nudge ──
const ContextNudge = memo(function ContextNudge({ onAction, walletConnected, totalUsd, positions }: {
  onAction: (cmd: string) => void;
  walletConnected: boolean;
  totalUsd: number;
  positions: { market?: string; unrealized_pnl?: number }[];
}) {
  const nudge = useMemo(() => {
    if (!walletConnected) return null;
    const hotPos = positions.find((p) => Math.abs(safe(p.unrealized_pnl)) > 5);
    if (hotPos && safe(hotPos.unrealized_pnl) > 5)
      return { text: `${hotPos.market} +${formatUsd(safe(hotPos.unrealized_pnl))}`, action: "show my positions", dot: "var(--color-accent-long)" };
    if (hotPos && safe(hotPos.unrealized_pnl) < -5)
      return { text: `${hotPos.market} needs attention`, action: "show my positions", dot: "var(--color-accent-short)" };
    if (positions.length === 0 && totalUsd > 10)
      return { text: "Try: long SOL 5x $25", action: "long SOL 5x $25", dot: "var(--color-accent-lime)" };
    return null;
  }, [walletConnected, totalUsd, positions]);

  if (!nudge) return null;

  return (
    <button onClick={() => onAction(nudge.action)}
      className="flex items-center gap-2 px-3.5 py-2 rounded-full cursor-pointer
        transition-all duration-150 hover:bg-white/[0.03] active:scale-[0.97]"
      style={{ animation: "fadeIn 500ms ease 300ms both" }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: nudge.dot, boxShadow: `0 0 6px ${nudge.dot}50`, animation: "pulseDot 2s infinite" }} />
      <span className="text-[12px] text-text-tertiary">{nudge.text}</span>
    </button>
  );
});

// ── Token Icon ──
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
