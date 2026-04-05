"use client";

import { useFlashStore } from "@/store";
import { TICKER_MARKETS, MARKETS } from "@/lib/constants";
import { formatPrice } from "@/lib/format";

export default function MarketTicker() {
  const prices = useFlashStore((s) => s.prices);
  const selectedMarket = useFlashStore((s) => s.selectedMarket);
  const selectMarket = useFlashStore((s) => s.selectMarket);

  return (
    <div className="flex items-center gap-1.5 px-4 h-14 overflow-x-auto bg-bg-root flex-1">
      {TICKER_MARKETS.map((symbol) => {
        const p = prices[symbol];
        const meta = MARKETS[symbol];
        const isActive = selectedMarket === symbol;

        return (
          <button
            key={symbol}
            onClick={() => selectMarket(symbol)}
            className="flex items-center gap-2 px-3 py-1.5 shrink-0 cursor-pointer transition-all duration-150"
            style={{
              borderRadius: "10px",
              background: isActive ? "var(--color-bg-card)" : "transparent",
              border: isActive ? "1px solid var(--color-border-subtle)" : "1px solid transparent",
            }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: meta?.dotColor ?? "#444" }}
            />
            <span className="text-[13px] font-medium text-text-primary">{symbol}</span>
            <span className="num text-[13px] text-text-secondary">
              {p ? formatPrice(p.price) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
