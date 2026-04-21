"use client";

import { useMemo, useEffect, useCallback, useRef, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError, WalletNotReadyError, WalletConnectionError, WalletReadyState } from "@solana/wallet-adapter-base";
import { useFlashStore } from "@/store";

// wallet-adapter CSS is imported in app/layout.tsx (Turbopack requires CSS imports in route files).

// Wallet-adapter persists the last selected wallet here.
const WALLET_NAME_KEY = "walletName";

// How long we wait for wallet.connect() to settle before declaring it stuck.
// In practice an unlocked Solflare/Phantom resolves in ~1-3 seconds. 12s is
// enough for slow networks but short enough that the user knows something is
// wrong and can act.
const CONNECT_TIMEOUT_MS = 12_000;

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

  // When the user picks a wallet from the modal, surface a clear message if
  // the extension isn't actually installed (which happens regularly in Brave
  // because Brave Wallet hides extension wallets when set as default).
  useEffect(() => {
    if (!wallet) return;
    const state = wallet.readyState;
    if (state === WalletReadyState.NotDetected || state === WalletReadyState.Unsupported) {
      setWalletError(
        `${wallet.adapter.name} extension not detected${
          isBrave()
            ? ". Brave Wallet can hide it — open brave://settings/wallet → Default Solana Wallet → Extensions (no fallback), then reload."
            : ". Install it from solflare.com / phantom.app and reload."
        }`,
      );
    }
  }, [wallet, setWalletError]);

  return null;
}

// Watchdog: when wallet.connecting is true for longer than CONNECT_TIMEOUT_MS,
// the connect call has hung (extension is paused, popup never appeared, or
// something else is intercepting). Force-disconnect so the UI doesn't sit
// in "Connecting..." forever, and surface a clear error.
function ConnectWatchdog() {
  const { connecting, disconnect, wallet } = useWallet();
  const setWalletError = useFlashStore((s) => s.setWalletError);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending timer when connecting flips back to false.
    if (!connecting) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const walletName = wallet?.adapter.name ?? "wallet";
    timerRef.current = setTimeout(async () => {
      setWalletError(
        isBrave()
          ? `${walletName} didn't respond. Open the extension and unlock it. If Brave Wallet is set as default, switch to "Extensions (no fallback)" in brave://settings/wallet.`
          : `${walletName} didn't respond. Open the extension, unlock it, and click Connect again.`,
      );
      // Force-reset adapter state so the button becomes clickable again.
      try {
        await disconnect();
      } catch {
        // disconnect() can throw on a half-attached adapter; nothing to do.
      }
      clearStaleWalletName();
    }, CONNECT_TIMEOUT_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [connecting, disconnect, wallet, setWalletError]);

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

  // Empty wallets array — we rely entirely on the Wallet Standard discovery
  // that @solana/wallet-adapter-react performs automatically. Modern Solflare
  // (>=1.37), Phantom, and Brave Wallet all register via Wallet Standard and
  // talk to the extension directly via postMessage. The legacy
  // SolflareWalletAdapter used the @solflare-wallet/sdk, which opens a popup
  // to solflare.com — Brave blocks that popup, which is why Solflare hung
  // forever in Brave even with the standard modal. Using only the Wallet
  // Standard path removes the popup from the flow entirely.
  const wallets = useMemo(() => [], []);

  const setWalletError = useFlashStore((s) => s.setWalletError);

  const handleError = useCallback(
    (error: WalletError) => {
      // WalletNotReadyError: the selected wallet's extension isn't loaded.
      if (error instanceof WalletNotReadyError) {
        clearStaleWalletName();
        setWalletError(
          isBrave()
            ? "Wallet extension not detected. In Brave: brave://settings/wallet → Default Solana Wallet → Extensions (no fallback), then reload."
            : "Wallet extension not detected. Install Solflare or Phantom and reload.",
        );
        return;
      }

      // WalletConnectionError: trust was revoked, popup was dismissed, or the
      // wallet is locked. Clearing walletName forces the modal next time.
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
      */}
      <SolanaWalletProvider wallets={wallets} autoConnect={false} onError={handleError}>
        {/*
          Standard @solana/wallet-adapter-react-ui modal — same UX that
          Jupiter, Drift, marginfi, Phantom.app, Solflare.com use. Handles
          Wallet Standard discovery (important for Brave, which registers
          its built-in wallet via Wallet Standard rather than a legacy
          window injection).
        */}
        <WalletModalProvider>
          <WalletSync />
          <ConnectWatchdog />
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
