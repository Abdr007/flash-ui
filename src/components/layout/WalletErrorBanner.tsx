"use client";

import { useEffect } from "react";
import { useFlashStore } from "@/store";

/**
 * Surfaces wallet-adapter errors that would otherwise be invisible:
 * - Phantom/Solflare locked or paused
 * - Extension not installed
 * - User cancelled / rejected the connect popup
 * - autoConnect failed because trust was revoked or storage cleared
 *
 * Auto-dismisses 6s after appearing, or immediately on successful connect.
 */
export default function WalletErrorBanner() {
  const walletError = useFlashStore((s) => s.walletError);
  const setWalletError = useFlashStore((s) => s.setWalletError);

  useEffect(() => {
    if (!walletError) return;
    const t = setTimeout(() => setWalletError(null), 6_000);
    return () => clearTimeout(t);
  }, [walletError, setWalletError]);

  if (!walletError) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-medium shrink-0"
      style={{
        background: "rgba(245,166,35,0.05)",
        borderBottom: "1px solid rgba(245,166,35,0.18)",
        color: "var(--color-accent-warn)",
        animation: "fadeIn 200ms ease-out",
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-accent-warn)" }} />
      {walletError}
      <button
        onClick={() => setWalletError(null)}
        aria-label="Dismiss wallet error"
        className="ml-2 underline opacity-70 hover:opacity-100 cursor-pointer"
      >
        Dismiss
      </button>
    </div>
  );
}
