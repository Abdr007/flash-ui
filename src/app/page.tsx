"use client";

import { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import MainLayout from "@/components/layout/MainLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
import { usePriceStream } from "@/hooks/usePriceStream";
import { useWalletSign } from "@/hooks/useWalletSign";
import { useLivePnl } from "@/hooks/useLivePnl";
import { useFlashStore } from "@/store";

const WalletProvider = dynamic(() => import("@/components/layout/WalletProvider"), { ssr: false });

// Detect wallet-related errors from the global error/unhandledrejection
// channels so they can be surfaced via the wallet error banner instead of
// being silently swallowed (which made the "I clicked Connect and nothing
// happened" bug invisible).
function isWalletRelatedError(reason: unknown): { walletMessage: string } | null {
  if (!reason) return null;
  const obj = reason as { name?: unknown; message?: unknown; constructor?: { name?: unknown } };
  const name = typeof obj.name === "string" ? obj.name : "";
  const ctorName = typeof obj.constructor?.name === "string" ? obj.constructor.name : "";
  const message = typeof obj.message === "string" ? obj.message : "";
  const haystack = `${name} ${ctorName} ${message}`.toLowerCase();
  if (
    haystack.includes("wallet") ||
    haystack.includes("phantom") ||
    haystack.includes("solflare") ||
    haystack.includes("user rejected")
  ) {
    return { walletMessage: message || name || "Wallet error" };
  }
  return null;
}

function AppShell({ children }: { children: React.ReactNode }) {
  usePriceStream();
  useWalletSign();
  useLivePnl();

  // Global error/rejection handlers. We DO NOT swallow everything blindly
  // anymore — wallet errors get routed to the WalletErrorBanner so the user
  // can act on them, and other errors are logged but not suppressed (so React
  // dev tools, error reporters, and Vercel can still see them in production).
  useEffect(() => {
    const setWalletError = useFlashStore.getState().setWalletError;

    const onError = (e: ErrorEvent) => {
      const wallet = isWalletRelatedError(e.error ?? e.message);
      if (wallet) {
        setWalletError(wallet.walletMessage);
        e.preventDefault();
        return;
      }
      try {
        console.error("[GlobalError]", e.message, e.filename, e.lineno);
      } catch {
        // Some embed contexts lack console; ignore.
      }
      // Don't preventDefault — let the browser/devtools see real errors.
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const wallet = isWalletRelatedError(e.reason);
      if (wallet) {
        setWalletError(wallet.walletMessage);
        e.preventDefault();
        return;
      }
      try {
        console.error("[UnhandledRejection]", e.reason);
      } catch {
        // No console — nothing else to do.
      }
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
