"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useFlashStore } from "@/store";
import { TICKER_MARKETS, MARKETS } from "@/lib/constants";
import { formatPrice } from "@/lib/format";

export default function MarketTicker() {
  const prices = useFlashStore((s) => s.prices);
  const selectedMarket = useFlashStore((s) => s.selectedMarket);
  const selectMarket = useFlashStore((s) => s.selectMarket);
  const streamStatus = useFlashStore((s) => s.streamStatus);
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const walletAddress = useFlashStore((s) => s.walletAddress);

  const { disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const handleWalletClick = () => {
    if (walletConnected) {
      disconnect();
    } else {
      setVisible(true);
    }
  };

  return (
    <div className="flex items-center h-11 px-5 border-b border-border-subtle bg-bg-root shrink-0">
      <div className="flex items-center gap-1 overflow-x-auto">
        {TICKER_MARKETS.map((symbol) => {
          const p = prices[symbol];
          const meta = MARKETS[symbol];
          const isActive = selectedMarket === symbol;

          return (
            <button
              key={symbol}
              onClick={() => selectMarket(symbol)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-xs shrink-0 cursor-pointer ${
                isActive ? "bg-bg-card" : "hover:bg-bg-card/50"
              }`}
            >
              <span
                className="w-[7px] h-[7px] rounded-full shrink-0"
                style={{ background: meta?.dotColor ?? "#666" }}
              />
              <span className="font-semibold text-text-primary">
                {symbol}
              </span>
              <span
                className="font-medium text-text-primary"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {p ? formatPrice(p.price) : "—"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      {/* Stream status — only shown when not connected */}
      {streamStatus === "reconnecting" && (
        <span className="text-[10px] text-accent-warn mr-3">Reconnecting...</span>
      )}

      {/* Wallet button */}
      <button
        onClick={handleWalletClick}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
          walletConnected
            ? "bg-accent-long/8 text-accent-long hover:bg-accent-long/15"
            : "bg-bg-card text-text-tertiary hover:text-text-secondary"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            walletConnected ? "bg-accent-long" : "bg-text-tertiary"
          }`}
        />
        {walletConnected
          ? `${walletAddress?.slice(0, 4)}...${walletAddress?.slice(-4)}`
          : "Connect Wallet"}
      </button>
    </div>
  );
}
