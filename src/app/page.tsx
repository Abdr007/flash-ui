"use client";

import dynamic from "next/dynamic";
import MainLayout from "@/components/layout/MainLayout";
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
        <MainLayout />
      </AppShell>
    </WalletProvider>
  );
}
