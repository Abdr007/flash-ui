"use client";

import { useMemo, useEffect, useCallback, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError, WalletNotReadyError, WalletConnectionError, WalletReadyState } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useFlashStore } from "@/store";

// wallet-adapter CSS is imported in app/layout.tsx (Turbopack requires CSS imports in route files).

// Wallet-adapter persists the last selected wallet here. Stale entries are the
// #1 cause of "I came back after a few days and connect does nothing" — when
// autoConnect tries to silently reconnect with a wallet whose trust grant has
// expired (Solflare/Phantom rotate trust, Brave's storage policy can wipe it),
// the connection rejects and the adapter sticks in a half-broken state.
const WALLET_NAME_KEY = "walletName";

function clearStaleWalletName() {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(WALLET_NAME_KEY);
    }
  } catch {
    // Storage access can throw in private mode / strict cookie settings.
  }
}

// Brave Wallet ships built into Brave and aliases itself as window.solana,
// hijacking Phantom's namespace. Solflare uses window.solflare which Brave
// usually doesn't touch, but the user's Brave Wallet setting can still
// intercept the modal selection. We detect Brave here so we can show a more
// actionable hint when a connect attempt fails.
function isBrave(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
  return Boolean(nav.brave);
}

function WalletSync() {
  const { publicKey, connected, wallet } = useWallet();
  const setWallet = useFlashStore((s) => s.setWallet);
  const setWalletError = useFlashStore((s) => s.setWalletError);

  useEffect(() => {
    if (connected && publicKey) {
      setWallet(publicKey.toBase58());
    } else {
      setWallet(null);
    }
  }, [connected, publicKey, setWallet]);

  // When the user picks a wallet from the modal, log its readyState so a
  // failed connect has a clear diagnostic. NotDetected → "install Solflare";
  // Installed → real connect failure.
  useEffect(() => {
    if (!wallet) return;
    const state = wallet.readyState;
    if (state === WalletReadyState.NotDetected || state === WalletReadyState.Unsupported) {
      setWalletError(
        `${wallet.adapter.name} extension not detected${isBrave() ? " (Brave can hide it — check brave://settings/wallet → Default Wallet → Extensions (no fallback))" : ""}. Install it and reload.`,
      );
    }
  }, [wallet, setWalletError]);

  return null;
}

export default function WalletProviderWrapper({ children }: { children: ReactNode }) {
  // RPC endpoint must be computed inside the component, not at module scope —
  // module-scope evaluation freezes the value to whichever origin loaded the
  // bundle first, which breaks preview deployments and custom-domain switches.
  const rpcEndpoint = useMemo(() => {
    if (typeof window === "undefined") return "https://api.mainnet-beta.solana.com";
    return `${window.location.origin}/api/rpc`;
  }, []);

  const wallets = useMemo(
    () => [
      // Solflare first — primary wallet for this user. Order only matters when
      // autoConnect is enabled (which we no longer do); the modal still shows
      // both. The wallet adapter ALSO auto-discovers any Wallet Standard
      // wallet (Backpack, Glow, etc.) that's installed.
      new SolflareWalletAdapter(),
      new PhantomWalletAdapter(),
    ],
    [],
  );

  const setWalletError = useFlashStore((s) => s.setWalletError);

  const handleError = useCallback(
    (error: WalletError) => {
      // WalletNotReadyError: the selected wallet's extension isn't loaded.
      // Clear the persisted walletName so autoConnect (if ever re-enabled)
      // doesn't keep retrying the same broken target.
      if (error instanceof WalletNotReadyError) {
        clearStaleWalletName();
        setWalletError(
          isBrave()
            ? "Wallet extension not detected. In Brave: brave://settings/wallet → Default Wallet → Extensions (no fallback), then reload."
            : "Wallet extension not detected. Install Solflare or Phantom and reload.",
        );
        return;
      }

      // WalletConnectionError: trust was revoked, popup was dismissed, or the
      // wallet is locked. Clearing walletName forces the modal next time so
      // the user gets a fresh connect prompt.
      if (error instanceof WalletConnectionError) {
        clearStaleWalletName();
        setWalletError(
          isBrave()
            ? "Couldn't connect. Open Solflare/Phantom and unlock it. If Brave Wallet is set as default, switch to Extensions in brave://settings/wallet."
            : "Couldn't connect to your wallet. Open Solflare/Phantom, unlock it, and click Connect again.",
        );
        return;
      }

      // Generic fallback — surface a short message and log full details.
      const msg = error?.message?.trim() || error?.name || "Wallet error";
      setWalletError(msg.length > 200 ? `${msg.slice(0, 197)}...` : msg);
      try {
        console.warn("[WalletProvider] error:", error);
      } catch {
        // No console in some embed contexts.
      }
    },
    [setWalletError],
  );

  return (
    <ConnectionProvider endpoint={rpcEndpoint}>
      {/*
        autoConnect is INTENTIONALLY OFF.
        With autoConnect on, every page load attempted a silent reconnect
        using the persisted walletName. That silently failed in Brave and
        for users whose wallets had rotated trust, surfacing the error
        banner on every visit even when the user hadn't clicked anything.
        Forcing one explicit click per session is the industry-standard
        fix and makes the connect flow predictable.
      */}
      <SolanaWalletProvider wallets={wallets} autoConnect={false} onError={handleError}>
        <WalletModalProvider>
          <WalletSync />
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
