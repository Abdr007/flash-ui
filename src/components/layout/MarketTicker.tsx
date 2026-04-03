"use client";

import { useFlashStore } from "@/store";
import { TICKER_MARKETS, MARKETS } from "@/lib/constants";
import { formatPrice } from "@/lib/format";

export default function MarketTicker() {
  const prices = useFlashStore((s) => s.prices);
  const selectedMarket = useFlashStore((s) => s.selectedMarket);
  const selectMarket = useFlashStore((s) => s.selectMarket);

  return (
    <div className="flex items-center gap-0.5 px-3 h-9 overflow-x-auto bg-bg-root flex-1">
      {TICKER_MARKETS.map((symbol) => {
        const p = prices[symbol];
        const meta = MARKETS[symbol];
        const isActive = selectedMarket === symbol;

        return (
          <button
            key={symbol}
            onClick={() => selectMarket(symbol)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] shrink-0 cursor-pointer transition-colors ${
              isActive
                ? "bg-bg-card text-text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: meta?.dotColor ?? "#444" }}
            />
            <span className="font-medium tracking-wide">{symbol}</span>
            <span className="num text-[11px]">
              {p ? formatPrice(p.price) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
