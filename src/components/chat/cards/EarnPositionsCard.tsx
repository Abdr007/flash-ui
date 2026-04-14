"use client";

import { memo } from "react";
import type { ToolOutput } from "./types";
import { ToolError } from "./shared";
import { formatUsd, safe } from "@/lib/format";

// ═══ EARN POSITIONS CARD — user's deposits ═══
export const EarnPositionsCard = memo(function EarnPositionsCard({ output }: { output: ToolOutput }) {
  const data = output.data as Record<string, unknown> | null;
  if (!data) return <ToolError toolName="earn_positions" error={output.error} />;
  const positions = (data.positions ?? []) as {
    pool: string;
    shares: number;
    valueUsd: number;
    apy: number;
    flpSymbol?: string;
  }[];
  const totalValue = Number(data.totalValueUsd ?? 0);

  if (positions.length === 0) {
    return (
      <div className="glass-card-solid overflow-hidden px-5 py-4 max-w-[500px]">
        <div className="text-[14px] font-semibold text-text-primary mb-1">No Earn Positions</div>
        <div className="text-[12px] text-text-tertiary">Deposit USDC into a pool to start earning yield.</div>
      </div>
    );
  }

  return (
    <div className="glass-card-solid overflow-hidden w-full max-w-[500px]">
      <div
        className="px-5 py-3.5 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <span className="text-[14px] font-semibold text-text-primary">My Earn Positions</span>
        <span className="text-[14px] num font-bold" style={{ color: "var(--color-accent-long)" }}>
          {formatUsd(totalValue)}
        </span>
      </div>
      {positions.map((p, i) => (
        <div
          key={p.pool}
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: i < positions.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}
        >
          <div>
            <div className="text-[14px] font-semibold text-text-primary">{p.pool} Pool</div>
            <div className="text-[11px] num mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
              {p.shares} {String(p.flpSymbol || "FLP")} shares
            </div>
          </div>
          <div className="text-right">
            <div className="text-[14px] num font-semibold text-text-primary">{formatUsd(safe(p.valueUsd))}</div>
            <div
              className="text-[11px] num mt-0.5"
              style={{ color: p.apy > 0 ? "var(--color-accent-long)" : "var(--color-text-tertiary)" }}
            >
              {p.apy}% APY
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

export default EarnPositionsCard;
