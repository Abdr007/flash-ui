"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import { executeSignedTransaction } from "@/lib/tx-executor";

/**
 * Watches for SIGNING state on activeTrade.
 * If trigger_txs exist (TP/SL), merges ALL into ONE transaction using ALTs.
 * Otherwise, signs and broadcasts the single trade tx.
 */
export function useWalletSign() {
  const { connection } = useConnection();
  const { signTransaction, connected, publicKey } = useWallet();
  const activeTrade = useFlashStore((s) => s.activeTrade);
  const completeExecution = useFlashStore((s) => s.completeExecution);
  const failExecution = useFlashStore((s) => s.failExecution);
  const signingRef = useRef(false);

  useEffect(() => {
    if (!activeTrade || activeTrade.status !== "SIGNING") return;
    if (!activeTrade.unsigned_tx) return;
    if (!connected || !signTransaction || !publicKey) return;
    if (signingRef.current) return;

    signingRef.current = true;
    const walletAddress = useFlashStore.getState().walletAddress;

    (async () => {
      try {
        const hasTriggers = activeTrade.trigger_txs && activeTrade.trigger_txs.length > 0;

        if (hasTriggers) {
          // ---- MERGED PATH: open + TP/SL in ONE transaction ----
          // 1. Clean the main tx
          const mainClean = await cleanTx(activeTrade.unsigned_tx!, walletAddress);

          // 2. Clean each trigger tx
          const triggerCleans: string[] = [];
          for (const trigBase64 of activeTrade.trigger_txs!) {
            try {
              const cleaned = await cleanTx(trigBase64, walletAddress);
              if (cleaned) triggerCleans.push(cleaned);
            } catch {}
          }

          // 3. Merge all into one tx using ALTs
          const { mergeTransactions } = await import("@/lib/tx-merge");
          const { PoolConfig } = await import("flash-sdk/dist/PoolConfig");

          // Get ALTs from pool config
          const pc = PoolConfig.fromIdsByName(
            getPoolName(activeTrade.market),
            "mainnet-beta",
          );
          const altAddresses = [
            ...pc.addressLookupTableAddresses,
            pc.pusherAddressLookupTableAddress,
          ];

          const merged = await mergeTransactions(
            [mainClean, ...triggerCleans],
            publicKey,
            connection,
            altAddresses,
          );

          // 4. Sign once
          const signed = await signTransaction(merged);
          const signedBase64 = Buffer.from(signed.serialize()).toString("base64");

          // 5. Broadcast once
          const signature = await executeSignedTransaction(signedBase64, connection);
          completeExecution(signature);

        } else {
          // ---- SINGLE TX PATH: no TP/SL, just the trade ----
          const cleanBase64 = await cleanTx(activeTrade.unsigned_tx!, walletAddress);

          const { VersionedTransaction } = await import("@solana/web3.js");
          const txBytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
          const transaction = VersionedTransaction.deserialize(txBytes);

          const signed = await signTransaction(transaction);
          const signedBase64 = Buffer.from(signed.serialize()).toString("base64");

          const signature = await executeSignedTransaction(signedBase64, connection);
          completeExecution(signature);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Transaction failed";
        const isRejection = msg.includes("User rejected") || msg.includes("rejected");

        // If merge failed (tx too large), fall back to separate signing
        if (msg.includes("too large") || msg.includes("1232") || msg.includes("Transaction too large")) {
          try {
            await fallbackSeparateSigning(activeTrade, walletAddress, signTransaction, connection, completeExecution);
            return;
          } catch (fallbackErr) {
            const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : "Fallback failed";
            failExecution(fbMsg.includes("rejected") ? "Transaction rejected by wallet." : fbMsg);
            return;
          }
        }

        failExecution(isRejection ? "Transaction rejected by wallet." : msg);
      } finally {
        signingRef.current = false;
      }
    })();
  }, [activeTrade, connected, signTransaction, publicKey, connection, completeExecution, failExecution]);
}

// ---- Helpers ----

async function cleanTx(txBase64: string, walletAddress: string | null): Promise<string> {
  const resp = await fetch("/api/clean-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txBase64, payerKey: walletAddress }),
  });
  if (!resp.ok) throw new Error(`Clean-tx failed: ${resp.status}`);
  const data = await resp.json().catch(() => { throw new Error("Invalid clean-tx response"); });
  if (data.error) throw new Error(data.error);
  if (!data.txBase64) throw new Error("No cleaned transaction returned");
  return data.txBase64;
}

const POOL_MAP: Record<string, string> = {
  SOL: "Crypto.1", BTC: "Crypto.1", ETH: "Crypto.1", BNB: "Crypto.1", ZEC: "Crypto.1",
  JUP: "Governance.1", PYTH: "Governance.1", JTO: "Governance.1", RAY: "Governance.1",
  BONK: "Community.1", PENGU: "Community.1",
  WIF: "Community.2",
  FARTCOIN: "Trump.1",
  ORE: "Ore.1",
  XAU: "Virtual.1",
  SPY: "Equity.1", NVDA: "Equity.1", TSLA: "Equity.1",
};

function getPoolName(market: string): string {
  return POOL_MAP[market] ?? "Crypto.1";
}

// Fallback: if merged tx is too large, sign them separately
async function fallbackSeparateSigning(
  activeTrade: { unsigned_tx?: string; trigger_txs?: string[]; market: string },
  walletAddress: string | null,
  signTransaction: (tx: import("@solana/web3.js").VersionedTransaction) => Promise<import("@solana/web3.js").VersionedTransaction>,
  connection: import("@solana/web3.js").Connection,
  completeExecution: (sig: string) => void,
) {
  const { VersionedTransaction } = await import("@solana/web3.js");

  // Sign main trade
  const mainClean = await cleanTx(activeTrade.unsigned_tx!, walletAddress);
  const mainBytes = Uint8Array.from(atob(mainClean), (c) => c.charCodeAt(0));
  const mainTx = VersionedTransaction.deserialize(mainBytes);
  const mainSigned = await signTransaction(mainTx);
  const mainSig = await executeSignedTransaction(Buffer.from(mainSigned.serialize()).toString("base64"), connection);

  // Sign trigger orders
  for (const trigBase64 of activeTrade.trigger_txs ?? []) {
    try {
      const cleaned = await cleanTx(trigBase64, walletAddress);
      const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(bytes);
      const signed = await signTransaction(tx);
      await executeSignedTransaction(Buffer.from(signed.serialize()).toString("base64"), connection);
    } catch {}
  }

  completeExecution(mainSig);
}
