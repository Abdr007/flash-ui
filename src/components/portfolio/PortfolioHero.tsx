"use client";

// ============================================
// Flash Trade — Premium Home Screen
// ============================================
// Brand colors: #3AFFE1 (teal) · #FFEB00 (yellow) · #2CE800 (green)
// FT lightning mark as background watermark
// Premium glassmorphism + brand gradient accents

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
          toks.push({ symbol: "SOL", name: m?.name ?? "Solana", amount: data.solBalance,
            usd: data.solUsd ?? 0, pricePerToken: (data.solUsd ?? 0) / data.solBalance,
            logo: m?.logo ?? "", logoFallback: "", color: m?.color ?? "#9945FF", portfolioPct: 0 });
        }
        for (const t of data.tokens ?? []) {
          if (t.usdValue < 0.01) continue;
          const sym = t.symbol?.toUpperCase?.() ?? t.symbol;
          const m = TOKEN_META[sym] ?? TOKEN_META[t.symbol];
          const dasLogo = t.logoUri || "";
          const primaryLogo = m?.logo || dasLogo;
          toks.push({ symbol: sym, name: m?.name ?? sym, amount: t.amount, usd: t.usdValue,
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
  const springBalance = useNumberSpring(totalWalletUsd, { stiffness: 120, damping: 22 });
  const springPnl = useNumberSpring(totalPnl, { stiffness: 160, damping: 20 });
  const toggleAssets = useCallback(() => setAssetsExpanded((v) => !v), []);

  return (
    <div className="flex flex-col items-center w-full max-w-[540px] mx-auto pt-10 pb-4 px-5 relative">

      {/* ═══ FT LOGO WATERMARK — large, centered, ultra subtle ═══ */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none select-none"
        style={{ width: "320px", height: "320px", opacity: 0.025 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ft-mark.svg" alt="" width={320} height={320}
          style={{ width: "100%", height: "100%", filter: "brightness(3)" }} />
      </div>

      {/* ═══ BRAND GRADIENT ORBS — teal + yellow + green (from brand kit) ═══ */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[450px] pointer-events-none" style={{ opacity: 0.5 }}>
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 45% 35% at 50% 20%, rgba(58,255,225,0.05) 0%, transparent 70%)",
          animation: "orbFloat 10s ease-in-out infinite",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 35% 30% at 40% 30%, rgba(255,235,0,0.03) 0%, transparent 60%)",
          animation: "orbFloat 10s ease-in-out infinite 3.3s",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 30% 25% at 60% 25%, rgba(44,232,0,0.03) 0%, transparent 60%)",
          animation: "orbFloat 10s ease-in-out infinite 6.6s",
        }} />
      </div>

      {/* ═══ BALANCE HERO ═══ */}
      <div className="relative z-10 flex flex-col items-center mb-7">
        <div className="text-[10px] font-bold tracking-[0.35em] uppercase mb-4"
          style={{ color: "rgba(58,255,225,0.45)" }}>
          TOTAL BALANCE
        </div>

        <div className="text-[56px] font-bold tracking-[-0.03em] leading-[1] num mb-3"
          style={{ color: walletConnected && !walletDataError ? "#fff" : "var(--color-text-tertiary)" }}>
          {!walletConnected ? "$0.00"
            : walletDataLoading && totalWalletUsd === 0 ? "···"
            : walletDataError && totalWalletUsd === 0 ? "—"
            : formatUsd(springBalance)}
        </div>

        {/* Brand gradient line */}
        <div className="w-36 h-[1.5px] mb-4 rounded-full" style={{
          background: "linear-gradient(90deg, transparent, #3AFFE1, #FFEB00, #2CE800, transparent)",
          opacity: 0.5,
        }} />

        {/* PnL / Status */}
        {walletConnected && !walletDataError ? (
          <div className="flex items-center gap-2 text-[13px]">
            {positions.length > 0 ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full" style={{
                  background: totalPnl >= 0 ? "#2CE800" : "var(--color-accent-short)",
                  boxShadow: totalPnl >= 0 ? "0 0 8px rgba(44,232,0,0.5)" : "0 0 8px rgba(255,77,77,0.5)",
                }} />
                <span className="num font-semibold" style={{ color: totalPnl >= 0 ? "#2CE800" : "var(--color-accent-short)" }}>
                  {totalPnl >= 0 ? "+" : ""}{formatPnl(springPnl)}
                </span>
                <span style={{ color: "var(--color-text-tertiary)" }}>
                  across {positions.length} position{positions.length > 1 ? "s" : ""}
                </span>
              </>
            ) : change24h !== null && change24h !== 0 ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full" style={{
                  background: change24h >= 0 ? "#2CE800" : "var(--color-accent-short)" }} />
                <span className="num font-semibold" style={{ color: change24h >= 0 ? "#2CE800" : "var(--color-accent-short)" }}>
                  {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
                </span>
                <span style={{ color: "var(--color-text-tertiary)" }}>this session</span>
              </>
            ) : (
              <span style={{ color: "var(--color-text-tertiary)" }}>Ready to trade</span>
            )}
          </div>
        ) : (
          <span className="text-[13px]" style={{ color: "var(--color-text-tertiary)" }}>
            {walletConnected ? "Balance unavailable" : "Connect wallet to start"}
          </span>
        )}
      </div>

      {/* ═══ ASSET STRIP ═══ */}
      {walletConnected && tokens.length > 0 && (
        <div className="w-full mb-7 relative z-10">
          <button onClick={toggleAssets}
            className="w-full flex items-center justify-between px-4 py-3 cursor-pointer
              transition-all duration-200 active:scale-[0.997]"
            style={{
              borderRadius: assetsExpanded ? "14px 14px 0 0" : "14px",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
              borderBottom: assetsExpanded ? "1px solid rgba(255,255,255,0.03)" : undefined,
              backdropFilter: "blur(20px)",
            }}>
            <div className="flex items-center flex-1">
              {tokens.slice(0, 5).map((t, i) => (
                <TokenIcon key={t.symbol} token={t} size={28} style={{
                  marginLeft: i > 0 ? "-5px" : "0", zIndex: 10 - i,
                  border: "2px solid #0E131C", borderRadius: "50%",
                }} />
              ))}
              <span className="text-[13px] text-text-tertiary ml-2.5 font-medium">{tokens.length} assets</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--color-text-tertiary)" strokeWidth="2.5" strokeLinecap="round"
              style={{ transform: assetsExpanded ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div className="no-scrollbar" style={{
            maxHeight: assetsExpanded ? "280px" : "0", opacity: assetsExpanded ? 1 : 0,
            overflowY: assetsExpanded ? "auto" : "hidden", overflowX: "hidden",
            transition: "max-height 280ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms",
            background: "rgba(255,255,255,0.02)", backdropFilter: "blur(20px)",
            border: assetsExpanded ? "1px solid rgba(255,255,255,0.04)" : "1px solid transparent",
            borderTop: "none", borderRadius: "0 0 14px 14px",
          }}>
            {tokens.map((t, i) => (
              <div key={t.symbol} className="flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] relative"
                style={{ borderBottom: i < tokens.length - 1 ? "1px solid rgba(255,255,255,0.025)" : "none" }}>
                <div className="absolute left-0 top-2 bottom-2 rounded-r-full"
                  style={{ width: `${Math.max(2, Math.min(3, t.portfolioPct / 20))}px`, background: t.color, opacity: 0.5 }} />
                <div className="flex items-center gap-3">
                  <TokenIcon token={t} size={36} />
                  <div>
                    <div className="text-[14px] font-semibold text-text-primary leading-tight">{t.name}</div>
                    <div className="text-[11px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                      {fmtAmt(t.amount)} {t.symbol}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] num font-semibold text-text-primary">{formatUsd(t.usd)}</div>
                  {t.pricePerToken > 0.001 && (
                    <div className="text-[11px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>{fmtPrice(t.pricePerToken)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ ACTION ROW — Brand-colored glow cards ═══ */}
      <div className="w-full grid grid-cols-5 gap-2.5 mb-5 relative z-10">
        <BrandCard label="Trade" accent="#3AFFE1" onClick={() => onAction("I want to trade")}
          icon={<><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></>} />
        <BrandCard label="Earn" accent="#2CE800" onClick={() => onAction("I want to earn yield")}
          icon={<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />} />
        <FafBrandCard onClick={() => onAction("faf")} />
        <BrandCard label="Send" accent="#FFEB00" onClick={() => onAction("I want to transfer tokens")}
          icon={<path d="M5 12h14M12 5l7 7-7 7" />} />
        <BrandCard label="Portfolio" accent="#3AFFE1" onClick={() => onAction("show my portfolio")}
          icon={<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>} />
      </div>

      {/* Context nudge */}
      <ContextNudge onAction={onAction} walletConnected={walletConnected} totalUsd={totalWalletUsd} positions={positions} />
    </div>
  );
}

// ═══ BRAND CARD — Glass card with brand-colored top glow ═══
const BrandCard = memo(function BrandCard({ label, accent, icon, onClick }: {
  label: string; accent: string; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="group relative flex flex-col items-center gap-2.5 py-4 rounded-2xl cursor-pointer
        transition-all duration-200 hover:-translate-y-[2px] active:scale-[0.92] active:translate-y-0"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.04)",
        backdropFilter: "blur(12px)",
        overflow: "hidden",
      }}>
      {/* Top glow line — brand colored */}
      <div className="absolute top-0 left-2 right-2 h-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      {/* Hover radial glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: `radial-gradient(circle at 50% -20%, ${accent}0A 0%, transparent 70%)` }} />
      <div className="w-10 h-10 rounded-xl flex items-center justify-center relative z-10"
        style={{ background: `${accent}0D`, border: `1px solid ${accent}15` }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke={accent} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </div>
      <span className="text-[11px] font-medium relative z-10 group-hover:text-text-primary transition-colors"
        style={{ color: "var(--color-text-tertiary)" }}>{label}</span>
    </button>
  );
});

// ═══ FAF BRAND CARD — Center, dominant, brand gradient ═══
const FafBrandCard = memo(function FafBrandCard({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="group relative flex flex-col items-center gap-2.5 py-4 rounded-2xl cursor-pointer
        transition-all duration-200 hover:-translate-y-[2px] active:scale-[0.92] active:translate-y-0"
      style={{
        background: "rgba(58,255,225,0.03)",
        border: "1px solid rgba(58,255,225,0.08)",
        backdropFilter: "blur(12px)",
        overflow: "hidden",
      }}>
      {/* Permanent top glow — brand gradient */}
      <div className="absolute top-0 left-1 right-1 h-[1.5px]"
        style={{ background: "linear-gradient(90deg, transparent, #3AFFE1, #FFEB00, transparent)", opacity: 0.6 }} />
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(circle at 50% -10%, rgba(58,255,225,0.06) 0%, transparent 70%)" }} />
      {/* Breathing */}
      <div className="absolute inset-0 pointer-events-none rounded-2xl"
        style={{ animation: "fafBreathe 6s ease-in-out infinite" }} />
      {/* FT Logo icon */}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center relative z-10 overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #33C9A1, #13644E)",
          boxShadow: "0 0 16px rgba(58,255,225,0.15), 0 2px 8px rgba(0,0,0,0.3)",
          border: "1px solid rgba(58,255,225,0.2)",
        }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ft-logo.svg" alt="FT" width={28} height={28} style={{ width: 28, height: 28 }} />
      </div>
      <span className="text-[11px] font-bold relative z-10" style={{ color: "#3AFFE1" }}>FAF</span>
    </button>
  );
});

// ═══ CONTEXT NUDGE ═══
const ContextNudge = memo(function ContextNudge({ onAction, walletConnected, totalUsd, positions }: {
  onAction: (cmd: string) => void; walletConnected: boolean; totalUsd: number;
  positions: { market?: string; unrealized_pnl?: number }[];
}) {
  const nudge = useMemo(() => {
    if (!walletConnected) return null;
    const hot = positions.find((p) => Math.abs(safe(p.unrealized_pnl)) > 5);
    if (hot && safe(hot.unrealized_pnl) > 5)
      return { text: `${hot.market} +${formatUsd(safe(hot.unrealized_pnl))}`, action: "show my positions", dot: "#2CE800" };
    if (hot && safe(hot.unrealized_pnl) < -5)
      return { text: `${hot.market} needs attention`, action: "show my positions", dot: "#FF4D4D" };
    if (positions.length === 0 && totalUsd > 10)
      return { text: "Try: long SOL 5x $25", action: "long SOL 5x $25", dot: "#3AFFE1" };
    return null;
  }, [walletConnected, totalUsd, positions]);
  if (!nudge) return null;
  return (
    <button onClick={() => onAction(nudge.action)}
      className="flex items-center gap-2 px-4 py-2 rounded-full cursor-pointer
        transition-all duration-150 hover:bg-white/[0.03] active:scale-[0.97] relative z-10">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: nudge.dot, boxShadow: `0 0 8px ${nudge.dot}60`, animation: "pulseDot 2s infinite" }} />
      <span className="text-[12px] text-text-tertiary">{nudge.text}</span>
    </button>
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
