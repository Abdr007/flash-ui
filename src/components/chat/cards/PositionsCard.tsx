"use client";

import { memo } from "react";
import { TokenIcon, ToolError } from "./shared";
import type { ToolOutput } from "./types";
import { formatUsd, formatPnl, formatPnlPct, formatPrice, safe } from "@/lib/format";

const PositionsCard = memo(function PositionsCard({ output }: { output: ToolOutput }) {
  const data = output.data;
  if (!data || !Array.isArray(data)) return <ToolError toolName="get_positions" error="No position data" />;
  if (data.length === 0)
    return (
      <div className="w-full max-w-[420px] glass-card overflow-hidden px-5 py-5">
        <div className="text-[14px] font-semibold text-text-primary mb-1">No Open Positions</div>
        <div className="text-[12px] text-text-tertiary mb-3">Start trading to see your positions here.</div>
      </div>
    );

  let totalPnl = 0;
  let totalSize = 0;
  for (const pos of data) {
    const pnl = Number(pos.unrealized_pnl ?? 0);
    const size = Number(pos.size_usd ?? 0);
    if (Number.isFinite(pnl)) totalPnl += pnl;
    if (Number.isFinite(size)) totalSize += size;
  }

  return (
    <div className="w-full max-w-[500px] glass-card overflow-hidden">
      {/* Header with totals */}
      <div className="px-5 py-4">
        <div className="text-[11px] text-text-tertiary tracking-wider uppercase mb-1">Open Positions</div>
        <div className="flex items-baseline gap-3">
          <span className="text-[24px] font-semibold text-text-primary num">{formatUsd(totalSize)}</span>
          <span
            className="text-[14px] font-medium num"
            style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
          >
            {formatPnl(totalPnl)}
          </span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        {data.map((pos: Record<string, unknown>, i: number) => {
          const pnl = Number(pos.unrealized_pnl ?? 0);
          const pnlPct = Number(pos.unrealized_pnl_pct ?? 0);
          const side = String(pos.side ?? "");
          const market = String(pos.market ?? "");
          const leverage = Number(pos.leverage ?? 0);
          const size = Number(pos.size_usd ?? 0);
          const entry = Number(pos.entry_price ?? 0);
          const mark = Number(pos.mark_price ?? 0);
          return (
            <div
              key={i}
              className="px-5 py-3.5 flex items-center gap-4"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              <TokenIcon symbol={market} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-semibold text-text-primary">{market}</span>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      color: side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                      background: side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                    }}
                  >
                    {side}
                  </span>
                  <span className="text-[11px] text-text-tertiary num">{safe(leverage).toFixed(1)}x</span>
                </div>
                <div className="flex items-center gap-3 text-[12px] text-text-tertiary num">
                  <span>{formatUsd(size)}</span>
                  <span>·</span>
                  <span>Entry {formatPrice(entry)}</span>
                  {mark > 0 && (
                    <>
                      <span>·</span>
                      <span>Mark {formatPrice(mark)}</span>
                    </>
                  )}
                  {Number(pos.liquidation_price ?? 0) > 0 && (
                    <>
                      <span>·</span>
                      <span style={{ color: "var(--color-accent-short)" }}>
                        Liq {formatPrice(Number(pos.liquidation_price))}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className="text-[14px] font-semibold num"
                  style={{ color: pnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
                >
                  {formatPnl(pnl)}
                </div>
                <div
                  className="text-[11px] num"
                  style={{ color: pnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
                >
                  {formatPnlPct(pnlPct)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export { PositionsCard };
export default PositionsCard;
