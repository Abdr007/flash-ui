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
        if (!cleanResp.ok) throw new Error(`Clean-tx failed: ${cleanResp.status}`);
        const cleanData = await cleanResp.json().catch(() => { throw new Error("Invalid clean-tx response"); });
        if (cleanData.error) throw new Error(cleanData.error);
        if (!cleanData.txBase64) throw new Error("No cleaned transaction returned");

        // 2. Deserialize clean tx
        const txBytes = Uint8Array.from(atob(cleanData.txBase64), (c) => c.charCodeAt(0));
        const transaction = VersionedTransaction.deserialize(txBytes);

        // 3. Wallet signs
        const signed = await signTransaction(transaction);
        const signedBase64 = Buffer.from(signed.serialize()).toString("base64");

        // 4. Execute via shared engine (broadcast + WS/HTTP confirm + rebroadcast)
        const signature = await executeSignedTransaction(signedBase64, connection);

        // 5. Sign + broadcast TP/SL trigger orders (if any)
        if (activeTrade.trigger_txs && activeTrade.trigger_txs.length > 0) {
          for (const triggerBase64 of activeTrade.trigger_txs) {
            try {
              // Clean the trigger tx
              const tCleanResp = await fetch("/api/clean-tx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ txBase64: triggerBase64, payerKey: walletAddress }),
              });
              if (!tCleanResp.ok) continue;
              const tClean = await tCleanResp.json().catch(() => null);
              if (!tClean?.txBase64) continue;

              const tBytes = Uint8Array.from(atob(tClean.txBase64), (c) => c.charCodeAt(0));
              const tTx = VersionedTransaction.deserialize(tBytes);
              const tSigned = await signTransaction(tTx);
              const tBase64 = Buffer.from(tSigned.serialize()).toString("base64");
              await executeSignedTransaction(tBase64, connection);
            } catch (e) {
              // TP/SL failure shouldn't fail the main trade
              try { console.warn("[TP/SL trigger]", e instanceof Error ? e.message : e); } catch {}
            }
          }
        }

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
