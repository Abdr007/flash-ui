"use client";

import { memo, useState, useEffect } from "react";
import { TokenIcon, ToolError } from "./shared";
import type { ToolOutput } from "./types";
import { useFlashStore } from "@/store";
import { formatUsd, formatPnl, formatPnlPct, formatPrice, safe } from "@/lib/format";

const PortfolioCard = memo(function PortfolioCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const storePrices = useFlashStore((s) => s.prices);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const [walletUsd, setWalletUsd] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const [allTokens, setAllTokens] = useState<{ symbol: string; amount: number; usdValue: number; logoUri?: string }[]>(
    [],
  );

  // Fetch ALL wallet tokens via Helius DAS API (single call, auto-priced).
  // Each token carries its logoUri from Helius metadata, so any SPL token —
  // even ones we don't have in TOKEN_ICONS — renders with its real logo.
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/token-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress }),
        });
        if (!resp.ok) return;
        const data = await resp.json().catch(() => null);
        if (!data) return;

        const tokens: { symbol: string; amount: number; usdValue: number; logoUri?: string }[] = [];

        // Native SOL — use curated icon from TOKEN_ICONS map
        tokens.push({
          symbol: "SOL",
          amount: data.solBalance ?? 0,
          usdValue: data.solUsd ?? 0,
        });

        // All SPL tokens — forward Helius metadata logoUri
        for (const t of data.tokens ?? []) {
          tokens.push({
            symbol: t.symbol,
            amount: t.amount,
            usdValue: t.usdValue,
            logoUri: t.logoUri,
          });
        }

        // Filter dust, sort by value
        const meaningful = tokens.filter((t) => t.usdValue >= 0.01);
        meaningful.sort((a, b) => b.usdValue - a.usdValue);

        if (!cancelled) {
          setAllTokens(meaningful);
          setWalletUsd(data.totalUsd ?? 0);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);  

  if (!d) return <ToolError toolName="get_portfolio" error="No portfolio data returned" />;

  const pnl = Number(d.total_unrealized_pnl ?? 0);
  const exposure = Number(d.total_exposure ?? 0);
  const collateral = Number(d.total_collateral ?? 0);
  const positions = (d.positions as Record<string, unknown>[]) ?? [];
  const netWorth = walletUsd + collateral;

  return (
    <div
      className="w-full max-w-[520px] overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(17,24,32,0.95), rgba(20,30,40,0.85))",
        borderRadius: "20px",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* NET WORTH */}
      <div className="px-6 pt-6 pb-4">
        <div className="text-[12px] font-medium tracking-wider mb-2" style={{ color: "var(--color-accent-long)" }}>
          NET WORTH
        </div>
        <div className="text-[40px] font-semibold text-text-primary tracking-tight leading-none num">
          {formatUsd(netWorth)}
        </div>
      </div>

      {/* Divider */}
      <div
        className="mx-6"
        style={{ height: "1px", background: "linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))" }}
      />

      {/* Wallet token balances — all tokens */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-4 flex-wrap">
          {allTokens
            .filter((t) => t.usdValue >= 0.01)
            .map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <TokenIcon symbol={t.symbol} size={20} src={t.logoUri} />
                <span className="text-[14px] font-medium text-text-primary num">{formatUsd(t.usdValue)}</span>
              </div>
            ))}
          {collateral > 0 && (
            <div className="flex items-center gap-2">
              <TokenIcon symbol="Positions" size={20} />
              <span className="text-[14px] font-medium text-text-primary num">{formatUsd(collateral)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div
        className="mx-6"
        style={{ height: "1px", background: "linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))" }}
      />

      {/* Positions section */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[12px] text-text-tertiary tracking-wider">POSITIONS</span>
          <span className="text-[14px] font-semibold text-text-primary num">{formatUsd(exposure)}</span>
          <span
            className="text-[13px] num font-medium"
            style={{ color: pnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
          >
            {formatPnl(pnl)}
          </span>
        </div>

        {positions.map((pos, i) => {
          const side = String(pos.side ?? "");
          const market = String(pos.market ?? "");
          const posPnl = Number(pos.unrealized_pnl ?? 0);
          const pnlPct = Number(pos.unrealized_pnl_pct ?? 0);
          const leverage = Number(pos.leverage ?? 0);
          const entry = Number(pos.entry_price ?? 0);
          return (
            <div key={i} className="flex items-center gap-3 py-2">
              <TokenIcon symbol={market} size={28} />
              <div className="flex-1">
                <span className="text-[14px] font-medium text-text-primary">{market}</span>
                <span className="text-[11px] text-text-tertiary ml-2 num">
                  {safe(leverage).toFixed(1)}x · {formatPrice(entry)}
                </span>
              </div>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full mr-2"
                style={{
                  color: side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                  background: side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                }}
              >
                {side}
              </span>
              <div className="text-right">
                <div
                  className="text-[13px] num font-medium"
                  style={{ color: posPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
                >
                  {formatPnl(posPnl)}
                </div>
                <div
                  className="text-[10px] num"
                  style={{ color: posPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
                >
                  {formatPnlPct(pnlPct)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* View More */}
      <div className="px-6 pb-5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-5 py-2 text-[13px] font-semibold rounded-lg cursor-pointer transition-all hover:brightness-110"
          style={{ background: "var(--color-accent-lime)", color: "#0A0E13" }}
        >
          {expanded ? "Show Less" : "View More"}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2">
            {allTokens
              .filter((t) => t.amount > 0)
              .map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <TokenIcon symbol={t.symbol} size={20} src={t.logoUri} />
                  <span className="text-[13px] text-text-primary flex-1">{t.symbol}</span>
                  <span className="text-[12px] text-text-secondary num">
                    {safe(t.amount) < 1 ? safe(t.amount).toFixed(6) : safe(t.amount).toFixed(2)}
                  </span>
                  <span className="text-[12px] text-text-primary num w-16 text-right">{formatUsd(t.usdValue)}</span>
                </div>
              ))}
            <div
              className="pt-2 text-[12px] text-text-tertiary"
              style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
            >
              <div>In Positions: {formatUsd(collateral)}</div>
              <div>
                Exposure: {formatUsd(exposure)} · PnL: {formatPnl(pnl)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export { PortfolioCard };
export default PortfolioCard;
