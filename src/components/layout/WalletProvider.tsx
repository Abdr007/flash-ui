"use client";

import { useMemo, useEffect, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { useFlashStore } from "@/store";

// wallet-adapter CSS is imported in app/layout.tsx (Turbopack requires CSS imports in route files)

// Use proxy endpoint to keep Helius API key server-side.
// Fallback to public RPC if no proxy configured.
const RPC_ENDPOINT =
  typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : "https://api.mainnet-beta.solana.com";

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
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletSync />
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
