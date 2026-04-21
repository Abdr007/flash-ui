"use client";

import { type ReactNode, useEffect } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { useWallet } from "@/lib/wallet";
import { useFlashStore } from "@/store";

const PRIVY_APP_ID = "cmo94g9z700d70bihg0jhotz2";

// Mirror of the previous WalletSync component — keeps the global store's
// walletAddress in sync with the currently connected wallet.
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
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Solana-only app — disable Ethereum paths entirely.
        appearance: {
          walletChainType: "solana-only",
          theme: "dark",
          accentColor: "#33c9a1",
        },
        loginMethods: ["wallet"],
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors({
              // Don't auto-reconnect loudly on page load — avoids the same
              // silent-reconnect error banner problem we hit with the
              // wallet-adapter-react setup.
              shouldAutoConnect: false,
            }),
          },
        },
      }}
    >
      <WalletSync />
      {children}
    </PrivyProvider>
  );
}
