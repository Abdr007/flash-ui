"use client";

import { memo } from "react";
import { Cell, ToolError } from "./shared";
import type { ToolOutput } from "./types";
import { formatLeverage } from "@/lib/format";

const MarketInfoCard = memo(function MarketInfoCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  if (!d) return <ToolError toolName="get_market_info" error="No market data returned" />;
  return (
    <div className="w-full max-w-[380px] glass-card overflow-hidden">
      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Market" value={String(d.market ?? "")} />
        <Cell label="Pool" value={String(d.pool ?? "")} />
        <Cell label="Default Lev" value={formatLeverage(Number(d.default_leverage))} />
        <Cell label="Max Lev" value={formatLeverage(Number(d.max_leverage))} />
      </div>
    </div>
  );
});

export { MarketInfoCard };
export default MarketInfoCard;
