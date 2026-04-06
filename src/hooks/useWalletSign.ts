"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useFlashStore } from "@/store";
import { executeSignedTransaction } from "@/lib/tx-executor";

/**
 * Watches for SIGNING state on activeTrade.
 * Uses the shared FlashEdge execution engine (tx-executor).
 */
export function useWalletSign() {
  const { connection } = useConnection();
  const { signTransaction, connected } = useWallet();
  const activeTrade = useFlashStore((s) => s.activeTrade);
  const completeExecution = useFlashStore((s) => s.completeExecution);
  const failExecution = useFlashStore((s) => s.failExecution);
  const signingRef = useRef(false);

  useEffect(() => {
    if (!activeTrade || activeTrade.status !== "SIGNING") return;
    if (!activeTrade.unsigned_tx) return;
    if (!connected || !signTransaction) return;
    if (signingRef.current) return;

    signingRef.current = true;
    const walletAddress = useFlashStore.getState().walletAddress;

    (async () => {
      try {
        // 1. Clean tx (strip Lighthouse, fix CU)
        const cleanResp = await fetch("/api/clean-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txBase64: activeTrade.unsigned_tx!,
            payerKey: walletAddress,
          }),
        });
        const cleanData = await cleanResp.json();
        if (cleanData.error) throw new Error(cleanData.error);

        // 2. Deserialize clean tx
        const txBytes = Uint8Array.from(atob(cleanData.txBase64), (c) => c.charCodeAt(0));
        const transaction = VersionedTransaction.deserialize(txBytes);

        // 3. Wallet signs
        const signed = await signTransaction(transaction);
        const signedBase64 = Buffer.from(signed.serialize()).toString("base64");

        // 4. Execute via shared engine (broadcast + WS/HTTP confirm + rebroadcast)
        const signature = await executeSignedTransaction(signedBase64, connection);
        completeExecution(signature);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Transaction failed";
        const isRejection = msg.includes("User rejected") || msg.includes("rejected");
        failExecution(isRejection ? "Transaction rejected by wallet." : msg);
      } finally {
        signingRef.current = false;
      }
    })();
  }, [activeTrade, connected, signTransaction, connection, completeExecution, failExecution]);
}
