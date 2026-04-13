"use client";

import { memo } from "react";
import type { ToolOutput } from "./types";
import { ToolError } from "./shared";

// ═══ EARN POOLS CARD — live pool data ═══
export const EarnPoolsCard = memo(function EarnPoolsCard({
  output,
  onAction,
}: {
  output: ToolOutput;
  onAction?: (cmd: string) => void;
}) {
  const data = output.data as Record<string, unknown> | null;
  if (!data) return <ToolError toolName="earn_pools" error={output.error} />;
  const pools = (data.pools ?? []) as {
    name: string;
    symbol: string;
    apy: number;
    tvl: number;
    flpPrice: number;
    markets: string;
  }[];

  if (pools.length === 0)
    return (
      <div className="glass-card-solid overflow-hidden px-5 py-5 max-w-[500px]">
        <div className="text-[14px] font-semibold text-text-primary mb-1">No Earn Pools Available</div>
        <div className="text-[12px] text-text-tertiary">Pool data is temporarily unavailable. Try again shortly.</div>
      </div>
    );

  const fmtTvl = (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n}`;

  return (
    <div className="glass-card-solid overflow-hidden w-full max-w-[500px]">
      <div
        className="px-5 py-3.5 text-[14px] font-semibold text-text-primary"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        Earn Pools — Live Data
      </div>
      {pools.map((p, i) => (
        <button
          key={p.symbol}
          onClick={() => onAction?.(`deposit to ${p.name.split(" ")[0].toLowerCase()} pool`)}
          className="w-full flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-white/[0.02] cursor-pointer text-left"
          style={{ borderBottom: i < pools.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}
        >
          <div>
            <div className="text-[14px] font-semibold text-text-primary">{p.name}</div>
            <div className="text-[11px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
              {p.markets}
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[14px] num font-bold"
              style={{ color: p.apy > 0 ? "#2CE800" : "var(--color-text-secondary)" }}
            >
              {p.apy >= 0.01 ? `${p.apy}%` : "—"}{" "}
              <span className="text-[10px] font-normal text-text-tertiary">APY</span>
            </div>
            <div className="text-[11px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
              TVL {fmtTvl(p.tvl)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
});

export default EarnPoolsCard;
