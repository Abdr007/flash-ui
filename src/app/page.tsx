"use client";

import { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import MainLayout from "@/components/layout/MainLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
import { usePriceStream } from "@/hooks/usePriceStream";
import { useWalletSign } from "@/hooks/useWalletSign";
import { useLivePnl } from "@/hooks/useLivePnl";

const WalletProvider = dynamic(() => import("@/components/layout/WalletProvider"), { ssr: false });

function AppShell({ children }: { children: React.ReactNode }) {
  usePriceStream();
  useWalletSign();
  useLivePnl();

  // Global unhandled error/rejection handlers — prevent silent white screens
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      try {
        console.error("[GlobalError]", e.message, e.filename, e.lineno);
      } catch {}
      // Don't let unhandled errors propagate to blank screen
      e.preventDefault();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      try {
        console.error("[UnhandledRejection]", e.reason);
      } catch {}
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
      <Suspense
        fallback={
          <div className="h-full flex items-center justify-center">
            <div
              className="w-8 h-8 border-2 border-text-tertiary border-t-brand-teal rounded-full"
              style={{ animation: "spin 0.8s linear infinite" }}
            />
          </div>
        }
      >
        <WalletProvider>
          <AppShell>
            <MainLayout />
          </AppShell>
        </WalletProvider>
      </Suspense>
    </ErrorBoundary>
  );
}
