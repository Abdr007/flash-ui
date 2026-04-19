"use client";

import { useMemo, useEffect, useCallback, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError, WalletNotReadyError, WalletConnectionError } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useFlashStore } from "@/store";

// wallet-adapter CSS is imported in app/layout.tsx (Turbopack requires CSS imports in route files).

// Wallet-adapter persists the last selected wallet here. Stale entries are the
// #1 cause of "I came back after a few days and connect does nothing": Phantom
// rotates its silent-trust grant, autoConnect fails, the modal never reopens.
// Clearing this key forces the user back through the wallet picker, which
// always works.
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

function WalletSync() {
  const { publicKey, connected } = useWallet();
  const setWallet = useFlashStore((s) => s.setWallet);

  useEffect(() => {
    if (connected && publicKey) {
      setWallet(publicKey.toBase58());
    } else {
      setWallet(null);
    }
  }, [connected, publicKey, setWallet]);

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
      // Solflare first — user reported it's their primary. autoConnect respects
      // selection order only when localStorage.walletName is empty; otherwise
      // the persisted name wins.
      new SolflareWalletAdapter(),
      new PhantomWalletAdapter(),
    ],
    [],
  );

  const setWalletError = useFlashStore((s) => s.setWalletError);

  const handleError = useCallback(
    (error: WalletError) => {
      // WalletNotReadyError: extension isn't installed / loaded yet. We must
      // clear the persisted walletName, otherwise autoConnect will keep
      // throwing this on every page load forever.
      if (error instanceof WalletNotReadyError) {
        clearStaleWalletName();
        setWalletError(
          `${error.name === "WalletNotReadyError" ? "Wallet extension not detected." : error.message} Install or unlock Solflare/Phantom and reload.`,
        );
        return;
      }

      // WalletConnectionError: trust was revoked, popup was dismissed, or the
      // wallet is locked. Clearing walletName forces the modal next time so
      // the user gets a fresh connect prompt.
      if (error instanceof WalletConnectionError) {
        clearStaleWalletName();
        setWalletError("Couldn't connect to your wallet. Open Solflare/Phantom, unlock it, and click Connect again.");
        return;
      }

      // Generic fallback — surface a short message and log full details.
      const msg = error?.message?.trim() || error?.name || "Wallet error";
      setWalletError(msg.length > 160 ? `${msg.slice(0, 157)}...` : msg);
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
      <SolanaWalletProvider wallets={wallets} autoConnect onError={handleError}>
        <WalletModalProvider>
          <WalletSync />
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
