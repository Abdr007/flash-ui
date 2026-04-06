"use client";

import dynamic from "next/dynamic";
import MainLayout from "@/components/layout/MainLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
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
    <ErrorBoundary>
      <WalletProvider>
        <AppShell>
          <MainLayout />
        </AppShell>
      </WalletProvider>
    </ErrorBoundary>
  );
}
