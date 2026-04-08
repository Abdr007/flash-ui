"use client";

// ============================================
// Flash Trade — Elite Home Screen
// ============================================
// Beat Galileo: bigger balance, more spacing, unified cards,
// cleaner icons, premium glass, brand identity throughout.

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
    <div className="flex flex-col items-center w-full max-w-[520px] mx-auto pt-20 pb-6 px-5 relative">

      {/* Ambient brand glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] pointer-events-none" style={{ opacity: 0.4 }}>
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 50% 40% at 50% 25%, rgba(58,255,225,0.04) 0%, transparent 70%)",
          animation: "orbFloat 12s ease-in-out infinite",
        }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 40% 30% at 55% 30%, rgba(255,235,0,0.02) 0%, transparent 60%)",
          animation: "orbFloat 12s ease-in-out infinite 4s",
        }} />
      </div>

      {/* ═══ BALANCE ═══ */}
      <div className="relative z-10 flex flex-col items-center mb-10">
        <div className="text-[11px] font-semibold tracking-[0.25em] uppercase mb-5"
          style={{ color: "rgba(58,255,225,0.4)" }}>
          TOTAL BALANCE
        </div>

        <div className="text-[62px] font-bold tracking-[-0.03em] leading-[1] num mb-4"
          style={{ color: walletConnected && !walletDataError ? "#FFFFFF" : "rgba(255,255,255,0.2)" }}>
          {!walletConnected ? "$0.00"
            : walletDataLoading && totalWalletUsd === 0 ? "···"
            : walletDataError && totalWalletUsd === 0 ? "—"
            : formatUsd(springBalance)}
        </div>

        {/* Status */}
        {walletConnected && !walletDataError ? (
          <div className="flex items-center gap-2.5 text-[14px]">
            {positions.length > 0 ? (
              <>
                <span className="num font-semibold" style={{
                  color: totalPnl >= 0 ? "#2CE800" : "var(--color-accent-short)" }}>
                  {totalPnl >= 0 ? "+" : ""}{formatPnl(springPnl)}
                </span>
                <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                  {positions.length} position{positions.length > 1 ? "s" : ""}
                </span>
              </>
            ) : change24h !== null && change24h !== 0 ? (
              <>
                <span className="num font-semibold" style={{
                  color: change24h >= 0 ? "#2CE800" : "var(--color-accent-short)" }}>
                  {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
                </span>
                <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>this session</span>
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
        <div className="w-full mb-10 relative z-10 rounded-[20px] overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.05)",
            backdropFilter: "blur(20px)",
          }}>
          {/* Header */}
          <button onClick={toggleAssets}
            className="w-full flex items-center justify-between px-5 py-4 cursor-pointer
              transition-colors duration-150 hover:bg-white/[0.015]"
            style={{ borderBottom: assetsExpanded ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
            <div className="flex items-center">
              {tokens.slice(0, 4).map((t, i) => (
                <TokenIcon key={t.symbol} token={t} size={32} style={{
                  marginLeft: i > 0 ? "-8px" : "0", zIndex: 10 - i,
                  border: "2.5px solid #0C1018", borderRadius: "50%",
                }} />
              ))}
              <span className="text-[14px] ml-3 font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
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
            {tokens.map((t, i) => (
              <div key={t.symbol}
                className="flex items-center justify-between px-5 py-3.5 transition-colors duration-100 hover:bg-white/[0.015]"
                style={{ borderBottom: i < tokens.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                <div className="flex items-center gap-4">
                  <TokenIcon token={t} size={40} />
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
          </div>
        </div>
      )}

      {/* ═══ ACTION ROW ═══ */}
      <div className="flex items-end justify-center gap-4 mb-8 relative z-10">
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
    </div>
  );
}

// ═══ ACTION NODE — Clean circle, white icon, premium glass ═══
const ActionNode = memo(function ActionNode({ label, icon, onClick }: {
  label: string; icon: React.ReactNode; onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <button onClick={onClick}
        className="flex items-center justify-center cursor-pointer
          transition-all duration-200 hover:-translate-y-[2px] hover:border-white/[0.12]
          active:scale-[0.92] active:translate-y-0"
        style={{
          width: "56px", height: "56px", borderRadius: "50%",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="rgba(255,255,255,0.6)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {icon}
        </svg>
      </button>
      <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</span>
    </div>
  );
});

// ═══ FAF NODE — Same size as others, FT logo inside ═══
const FafNode = memo(function FafNode({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <button onClick={onClick}
        className="flex items-center justify-center cursor-pointer
          transition-all duration-200 hover:-translate-y-[2px] hover:border-white/[0.12]
          active:scale-[0.92] active:translate-y-0"
        style={{
          width: "56px", height: "56px", borderRadius: "50%",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ft-logo.svg" alt="FT" width={30} height={30} style={{ width: 30, height: 30 }} />
      </button>
      <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.3)" }}>FAF</span>
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
