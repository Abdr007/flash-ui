"use client";

import { useEffect } from "react";
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

  // Global unhandled error/rejection handlers — prevent silent white screens
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      try { console.error("[GlobalError]", e.message, e.filename, e.lineno); } catch {}
      // Don't let unhandled errors propagate to blank screen
      e.preventDefault();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      try { console.error("[UnhandledRejection]", e.reason); } catch {}
      e.preventDefault();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return <>{children}</>;
}

export default function Home() {
  return (
    <ErrorBoundary name="root">
      <WalletProvider>
        <AppShell>
          <MainLayout />
        </AppShell>
      </WalletProvider>
    </ErrorBoundary>
  );
}
