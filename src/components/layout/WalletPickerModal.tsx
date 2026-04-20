"use client";

// ============================================
// Custom wallet picker — replaces @solana/wallet-adapter-react-ui modal.
// ============================================
// Why custom: the upstream modal has been a recurring source of "modal opens
// but clicking does nothing" / "modal doesn't open at all" bugs, especially
// after extension auto-updates change behavior. By owning the picker
// end-to-end we eliminate the library as a variable, control the timeout
// behavior, and can show real diagnostic state to the user.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Wallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import type { WalletName } from "@solana/wallet-adapter-base";
import { useFlashStore } from "@/store";

interface Props {
  open: boolean;
  onClose: () => void;
}

const CONNECT_TIMEOUT_MS = 12_000;

function isBrave(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
  return Boolean(nav.brave);
}

function readyStateBadge(state: WalletReadyState): { label: string; color: string } {
  switch (state) {
    case WalletReadyState.Installed:
      return { label: "Detected", color: "var(--color-brand-teal)" };
    case WalletReadyState.Loadable:
      return { label: "Loadable", color: "var(--color-accent-warn)" };
    case WalletReadyState.NotDetected:
      return { label: "Not installed", color: "rgba(255,77,77,0.85)" };
    case WalletReadyState.Unsupported:
      return { label: "Unsupported", color: "rgba(255,77,77,0.85)" };
    default:
      return { label: String(state), color: "var(--color-text-tertiary)" };
  }
}

export default function WalletPickerModal({ open, onClose }: Props) {
  const { wallets, select, connect, connecting, connected } = useWallet();
  const setWalletError = useFlashStore((s) => s.setWalletError);
  const [activeWallet, setActiveWallet] = useState<string | null>(null);

  // Sort: Installed first, then Loadable, then NotDetected/Unsupported.
  const sortedWallets = useMemo(() => {
    const order = (w: Wallet) => {
      switch (w.readyState) {
        case WalletReadyState.Installed:
          return 0;
        case WalletReadyState.Loadable:
          return 1;
        case WalletReadyState.NotDetected:
          return 2;
        default:
          return 3;
      }
    };
    return [...wallets].sort((a, b) => order(a) - order(b));
  }, [wallets]);

  const handlePick = useCallback(
    async (w: Wallet) => {
      setWalletError(null);

      // If the extension isn't installed, link out instead of attempting a
      // doomed connect.
      if (w.readyState === WalletReadyState.NotDetected || w.readyState === WalletReadyState.Unsupported) {
        const url = w.adapter.url || "https://solana.com/ecosystem/explore?categories=wallet";
        window.open(url, "_blank", "noopener,noreferrer");
        setWalletError(
          isBrave()
            ? `${w.adapter.name} extension not detected. In Brave, also check brave://settings/wallet → Default Solana Wallet → Extensions (no fallback), then reload.`
            : `${w.adapter.name} extension not detected. Install it from the new tab and reload this page.`,
        );
        return;
      }

      setActiveWallet(w.adapter.name);

      // select() is synchronous in the adapter — it just swaps the active
      // wallet. The connect() call is what actually opens the wallet popup.
      try {
        select(w.adapter.name as WalletName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't select wallet";
        setWalletError(msg);
        setActiveWallet(null);
        return;
      }

      // Race connect() against a 12s timeout so a hung extension popup never
      // permanently jams the UI.
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                isBrave()
                  ? `${w.adapter.name} didn't respond. Open the extension and unlock it. If Brave Wallet is set as default, switch to "Extensions (no fallback)" in brave://settings/wallet.`
                  : `${w.adapter.name} didn't respond. Open the extension, unlock it, and try again.`,
              ),
            ),
          CONNECT_TIMEOUT_MS,
        ),
      );

      try {
        await Promise.race([connect(), timeoutPromise]);
        // Successful connect — let the WalletSync effect propagate state and
        // close the modal.
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Connect failed";
        setWalletError(msg);
      } finally {
        setActiveWallet(null);
      }
    },
    [select, connect, setWalletError, onClose],
  );

  // Close modal on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auto-close on successful connection.
  useEffect(() => {
    if (open && connected) onClose();
  }, [connected, open, onClose]);

  // Hard reset button — wipes localStorage + reloads. The escape hatch when
  // an extension auto-update or stale cache leaves the adapter in a state
  // that nothing else can recover.
  const handleHardReset = useCallback(() => {
    try {
      window.localStorage.removeItem("walletName");
    } catch {
      // Storage access can be blocked.
    }
    window.location.reload();
  }, []);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // Portal to document.body so the modal escapes parent stacking contexts.
  // Backdrop is now FULLY OPAQUE (not rgba-0.78) — belt-and-braces: even if
  // some ancestor somewhere creates a stacking context we didn't anticipate,
  // an opaque full-screen element at the end of <body> will still hide the
  // page underneath. `isolation: isolate` creates a fresh stacking context
  // so descendant z-indexes can't leak out.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect wallet"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "#05080D",
        zIndex: 2147483646,
        isolation: "isolate",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        animation: "fadeIn 150ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "440px",
          background: "#0E131C",
          border: "1px solid rgba(51,201,161,0.18)",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.6), 0 0 60px -20px rgba(51,201,161,0.15)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary)" }}>
              Connect a wallet
            </div>
            <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "4px" }}>
              {sortedWallets.length === 0
                ? "No wallets configured."
                : `${sortedWallets.filter((w) => w.readyState === WalletReadyState.Installed).length} detected`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-text-tertiary)",
              fontSize: "20px",
              cursor: "pointer",
              padding: "4px 8px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {sortedWallets.map((w) => {
            const badge = readyStateBadge(w.readyState);
            const isActive = activeWallet === w.adapter.name;
            const installed = w.readyState === WalletReadyState.Installed;
            return (
              <button
                key={w.adapter.name}
                onClick={() => handlePick(w)}
                disabled={isActive}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "14px 16px",
                  background: installed ? "rgba(51,201,161,0.05)" : "rgba(255,255,255,0.02)",
                  border: installed ? "1px solid rgba(51,201,161,0.18)" : "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "12px",
                  cursor: isActive ? "wait" : "pointer",
                  color: "var(--color-text-primary)",
                  fontSize: "14px",
                  fontWeight: 600,
                  transition: "background 150ms ease, border-color 150ms ease",
                  opacity: isActive ? 0.7 : 1,
                }}
                onMouseOver={(e) => {
                  if (isActive) return;
                  e.currentTarget.style.background = installed ? "rgba(51,201,161,0.1)" : "rgba(255,255,255,0.04)";
                }}
                onMouseOut={(e) => {
                  if (isActive) return;
                  e.currentTarget.style.background = installed ? "rgba(51,201,161,0.05)" : "rgba(255,255,255,0.02)";
                }}
              >
                {w.adapter.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={w.adapter.icon}
                    alt=""
                    width={28}
                    height={28}
                    style={{ borderRadius: "6px", flexShrink: 0 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "6px",
                      background: "rgba(255,255,255,0.06)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <span style={{ flex: 1, textAlign: "left" }}>{w.adapter.name}</span>
                <span style={{ fontSize: "11px", color: badge.color, fontWeight: 600, letterSpacing: "0.04em" }}>
                  {isActive ? (connecting ? "Connecting..." : "Working...") : badge.label}
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            marginTop: "20px",
            padding: "12px 14px",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.04)",
            borderRadius: "10px",
            fontSize: "11px",
            color: "var(--color-text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          {isBrave() ? (
            <>
              <strong style={{ color: "var(--color-text-secondary)" }}>Brave detected.</strong> If your wallet
              doesn&rsquo;t appear or won&rsquo;t connect, set{" "}
              <code style={{ background: "rgba(255,255,255,0.06)", padding: "1px 4px", borderRadius: "4px" }}>
                brave://settings/wallet
              </code>{" "}
              → Default Solana Wallet → <strong>Extensions (no fallback)</strong>, then reload.
            </>
          ) : (
            <>Pick a wallet above. If nothing happens, make sure the extension is unlocked.</>
          )}
        </div>

        <button
          onClick={handleHardReset}
          style={{
            marginTop: "12px",
            width: "100%",
            padding: "10px",
            background: "transparent",
            border: "1px dashed rgba(255,255,255,0.12)",
            borderRadius: "10px",
            color: "var(--color-text-tertiary)",
            fontSize: "11px",
            cursor: "pointer",
          }}
        >
          Stuck? Clear cached wallet selection &amp; reload
        </button>
      </div>
    </div>,
    document.body,
  );
}
