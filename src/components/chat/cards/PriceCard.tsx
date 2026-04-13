"use client";

import { memo } from "react";
import { TokenIcon, CRYPTO_SYMBOLS, COMMODITY_SYMBOLS, SectionHeader, PriceSection } from "./shared";
import type { PriceRow } from "./shared";
import type { ToolOutput } from "./types";
import { useFlashStore } from "@/store";
import { formatPrice } from "@/lib/format";
import { MARKETS } from "@/lib/constants";

const PriceCard = memo(function PriceCard({ toolName, output }: { toolName: string; output: ToolOutput }) {
  const data = output.data;
  const livePrices = useFlashStore((s) => s.prices);

  // ---- All-prices (markets) variant ----
  if (toolName === "get_all_prices" && data && typeof data === "object") {
    const raw = Object.values(data as Record<string, Record<string, unknown>>);
    // Merge static snapshot with live WS prices — prefer live where available
    const rows: PriceRow[] = raw
      .map((p) => {
        const sym = String(p.symbol ?? "");
        const live = livePrices[sym]?.price;
        const price = Number.isFinite(live) && (live as number) > 0 ? (live as number) : Number(p.price ?? 0);
        return { symbol: sym, price };
      })
      .filter((r) => r.symbol && r.price > 0)
      .sort((a, b) => b.price - a.price);

    const crypto = rows.filter((r) => CRYPTO_SYMBOLS.has(r.symbol));
    const commodities = rows.filter((r) => COMMODITY_SYMBOLS.has(r.symbol));
    const equities = rows.filter((r) => !CRYPTO_SYMBOLS.has(r.symbol) && !COMMODITY_SYMBOLS.has(r.symbol));

    return (
      <div className="w-full max-w-[500px] glass-card overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-text-tertiary tracking-wider uppercase mb-1">Markets</div>
            <div className="text-[20px] font-semibold text-text-primary">{rows.length} active</div>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--color-accent-long)", animation: "pulseDot 2s infinite" }}
            />
            <span className="text-[10px] tracking-wider uppercase" style={{ color: "var(--color-accent-long)" }}>
              Live
            </span>
          </div>
        </div>

        {crypto.length > 0 && <PriceSection rows={crypto} />}

        {commodities.length > 0 && (
          <>
            <SectionHeader label="Commodities" />
            <PriceSection rows={commodities} />
          </>
        )}

        {equities.length > 0 && (
          <>
            <SectionHeader label="Equities" />
            <PriceSection rows={equities} />
          </>
        )}
      </div>
    );
  }

  // ---- Single price variant ----
  if (data && typeof data === "object") {
    const p = data as Record<string, unknown>;
    const sym = String(p.symbol ?? "");
    const live = livePrices[sym]?.price;
    const price = Number.isFinite(live) && (live as number) > 0 ? (live as number) : Number(p.price ?? 0);
    const pool = (MARKETS as Record<string, { pool: string }>)[sym]?.pool ?? "—";

    return (
      <div className="w-full max-w-[320px] glass-card overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-4">
          <TokenIcon symbol={sym} size={44} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[15px] font-semibold text-text-primary">{sym}</span>
              <span className="text-[10px] text-text-tertiary tracking-wider uppercase">{pool}</span>
            </div>
            <div className="text-[22px] font-semibold num text-text-primary leading-none">{formatPrice(price)}</div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--color-accent-long)", animation: "pulseDot 2s infinite" }}
            />
            <span className="text-[9px] tracking-wider uppercase" style={{ color: "var(--color-accent-long)" }}>
              Live
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
});

export { PriceCard };
export default PriceCard;
