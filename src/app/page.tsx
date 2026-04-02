"use client";

import dynamic from "next/dynamic";
import MarketTicker from "@/components/layout/MarketTicker";
import ChatPanel from "@/components/chat/ChatPanel";
import PositionPanel from "@/components/positions/PositionPanel";
import InputBar from "@/components/layout/InputBar";
import ConfirmOverlay from "@/components/trade/ConfirmOverlay";
import { usePriceStream } from "@/hooks/usePriceStream";

// Dynamic import to avoid SSR issues with wallet adapter
const WalletProvider = dynamic(
  () => import("@/components/layout/WalletProvider"),
  { ssr: false }
);

/** Hosts the price stream — must be inside WalletProvider for store access */
function StreamHost({ children }: { children: React.ReactNode }) {
  usePriceStream();
  return <>{children}</>;
}

export default function Home() {
  return (
    <WalletProvider>
      <StreamHost>
        <div className="h-screen flex flex-col bg-bg-root overflow-hidden">
          {/* Top: Market Ticker */}
          <MarketTicker />

          {/* Middle: Chat + Positions */}
          <div className="flex-1 flex min-h-0">
            {/* Chat Column */}
            <div className="flex-1 flex flex-col min-w-0 bg-bg-surface">
              <ChatPanel />
            </div>

            {/* Position Panel */}
            <PositionPanel />
          </div>

          {/* Bottom: Input Bar */}
          <InputBar />

          {/* Confirmation overlay (renders over everything when CONFIRMING) */}
          <ConfirmOverlay />
        </div>
      </StreamHost>
    </WalletProvider>
  );
}
