"use client";

import dynamic from "next/dynamic";
import MarketTicker from "@/components/layout/MarketTicker";
import ChatPanel from "@/components/chat/ChatPanel";
import PositionPanel from "@/components/positions/PositionPanel";
import InputBar from "@/components/layout/InputBar";
import ConfirmOverlay from "@/components/trade/ConfirmOverlay";
import SystemStatus from "@/components/layout/SystemStatus";
import { usePriceStream } from "@/hooks/usePriceStream";
import { useWalletSign } from "@/hooks/useWalletSign";

const WalletProvider = dynamic(
  () => import("@/components/layout/WalletProvider"),
  { ssr: false }
);

function AppShell({ children }: { children: React.ReactNode }) {
  usePriceStream();
  useWalletSign();
  return <>{children}</>;
}

export default function Home() {
  return (
    <WalletProvider>
      <AppShell>
        <div className="h-screen flex flex-col bg-bg-root overflow-hidden">
          {/* System Status + Market Ticker */}
          <div className="flex items-center border-b border-border-subtle shrink-0">
            <SystemStatus />
            <div className="w-px h-5 bg-border-subtle" />
            <MarketTicker />
          </div>

          {/* Main Content */}
          <div className="flex-1 flex min-h-0">
            {/* Chat + Input */}
            <div className="flex-1 flex flex-col min-w-0 bg-bg-surface">
              <ChatPanel />
              <InputBar />
            </div>

            {/* Positions */}
            <PositionPanel />
          </div>

          <ConfirmOverlay />
        </div>
      </AppShell>
    </WalletProvider>
  );
}
