"use client";

// ============================================
// Privy-backed compatibility shim for @solana/wallet-adapter-react's useWallet
// and useConnection hooks. All existing call sites keep working unchanged —
// just change the import path. Under the hood, Privy drives the connection
// flow (including WalletConnect, which makes Solflare work smoothly even
// when the extension is locked).
// ============================================

import { useCallback, useMemo } from "react";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useConnectWallet } from "@privy-io/react-auth";
import {
  useWallets as usePrivyWallets,
  useSignTransaction as usePrivySignTransaction,
  useSignMessage as usePrivySignMessage,
  useSignAndSendTransaction as usePrivySignAndSend,
} from "@privy-io/react-auth/solana";

type AnyTx = Transaction | VersionedTransaction;

function serializeTx(tx: AnyTx): Uint8Array {
  // VersionedTransaction.serialize() returns Uint8Array directly.
  // Legacy Transaction.serialize() returns Buffer; we must allow partial
  // (unsigned) serialization for tx that haven't been signed yet.
  if (tx instanceof VersionedTransaction) {
    return tx.serialize();
  }
  const buf = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return new Uint8Array(buf);
}

function deserializeTx<T extends AnyTx>(bytes: Uint8Array, original: T): T {
  if (original instanceof VersionedTransaction) {
    return VersionedTransaction.deserialize(bytes) as T;
  }
  return Transaction.from(bytes) as T;
}

export function useWallet() {
  const { ready, wallets } = usePrivyWallets();
  const { connectWallet } = useConnectWallet();
  const { signTransaction: privySignTx } = usePrivySignTransaction();
  const { signMessage: privySignMsg } = usePrivySignMessage();
  const { signAndSendTransaction: privySignAndSend } = usePrivySignAndSend();

  // Pick the first connected Solana wallet. Multi-wallet support isn't wired
  // in the UI, so single-wallet semantics match the old adapter exactly.
  const activeWallet = wallets[0] ?? null;

  const publicKey = useMemo<PublicKey | null>(() => {
    if (!activeWallet) return null;
    try {
      return new PublicKey(activeWallet.address);
    } catch {
      return null;
    }
  }, [activeWallet]);

  // "Connected" here is pure wallet connection — no Privy user / SIWS auth
  // is required. The Privy auth flow was failing with "Could not log in
  // with wallet" because we don't need it; we just need the wallet handle.
  const connected = Boolean(activeWallet);
  const connecting = !ready;

  const disconnect = useCallback(async () => {
    if (!activeWallet) return;
    try {
      // ConnectedStandardSolanaWallet exposes disconnect via the wallet
      // standard. Falls back silently if unsupported.
      const w = activeWallet as unknown as { disconnect?: () => Promise<void> };
      if (typeof w.disconnect === "function") await w.disconnect();
    } catch {
      // Disconnect can throw on half-attached sessions; ignore.
    }
  }, [activeWallet]);

  const connect = useCallback(async () => {
    // Opens Privy's modal to pick and connect an external wallet. No SIWS
    // signature is required because we aren't using Privy for auth.
    connectWallet();
  }, [connectWallet]);

  const signTransaction = useCallback(
    async <T extends AnyTx>(tx: T): Promise<T> => {
      if (!activeWallet) throw new Error("Wallet not connected");
      const bytes = serializeTx(tx);
      const { signedTransaction } = await privySignTx({
        transaction: bytes,
        wallet: activeWallet,
      });
      return deserializeTx(signedTransaction, tx);
    },
    [activeWallet, privySignTx],
  );

  const signAllTransactions = useCallback(
    async <T extends AnyTx>(txs: T[]): Promise<T[]> => {
      // Privy signs sequentially to preserve user-gesture semantics — this
      // matches the Solflare/Phantom adapter behavior (wallets show one
      // approval popup per tx in a chain).
      const signed: T[] = [];
      for (const tx of txs) {
        signed.push(await signTransaction(tx));
      }
      return signed;
    },
    [signTransaction],
  );

  const signMessage = useCallback(
    async (msg: Uint8Array): Promise<Uint8Array> => {
      if (!activeWallet) throw new Error("Wallet not connected");
      const { signature } = await privySignMsg({
        message: msg,
        wallet: activeWallet,
      });
      return signature;
    },
    [activeWallet, privySignMsg],
  );

  const sendTransaction = useCallback(
    async (tx: AnyTx, _connection: Connection): Promise<string> => {
      if (!activeWallet) throw new Error("Wallet not connected");
      const bytes = serializeTx(tx);
      const { signature } = await privySignAndSend({
        transaction: bytes,
        wallet: activeWallet,
      });
      // Solana signatures are base58-encoded. Wrong encoding here means
      // downstream Solscan links / confirmation lookups all 404.
      return bs58.encode(signature);
    },
    [activeWallet, privySignAndSend],
  );

  // Mimic the wallet shape wallet-adapter-react's useWallet() returns. Some
  // call sites read `wallet.adapter.name` for logging/UX only.
  const walletShim = activeWallet
    ? {
        adapter: {
          name: (activeWallet as unknown as { meta?: { name?: string } }).meta?.name ?? "Wallet",
          publicKey,
        },
        readyState: 0, // Installed
      }
    : null;

  return {
    publicKey,
    connected,
    connecting,
    connect,
    disconnect,
    signTransaction,
    signAllTransactions,
    signMessage,
    sendTransaction,
    wallet: walletShim,
    wallets: [],
    select: (_name: unknown) => {
      // Selection is handled by Privy's modal; exposed for API compat only.
    },
  };
}

// useConnection shim — returns a Connection bound to our RPC proxy.
// The old ConnectionProvider context wraps this; we build it directly to
// avoid needing the provider when the app is rendered under PrivyProvider.
let cachedConnection: Connection | null = null;
function getConnection(): Connection {
  if (cachedConnection) return cachedConnection;
  const endpoint =
    typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : "https://api.mainnet-beta.solana.com";
  cachedConnection = new Connection(endpoint, "confirmed");
  return cachedConnection;
}

export function useConnection() {
  return { connection: getConnection() };
}
