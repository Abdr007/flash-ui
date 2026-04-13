"use client";

import { memo } from "react";
import { Cell, ToolError } from "./shared";
import type { ToolOutput } from "./types";

const MarketInfoCard = memo(function MarketInfoCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  if (!d) return <ToolError toolName="get_market_info" error="No market data returned" />;
  return (
    <div className="w-full max-w-[380px] glass-card overflow-hidden">
      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Market" value={String(d.market ?? "")} />
        <Cell label="Pool" value={String(d.pool ?? "")} />
        <Cell label="Default Lev" value={`${d.default_leverage ?? "—"}x`} />
        <Cell label="Max Lev" value={`${d.max_leverage ?? "—"}x`} />
      </div>
    </div>
  );
});

export { MarketInfoCard };
export default MarketInfoCard;
