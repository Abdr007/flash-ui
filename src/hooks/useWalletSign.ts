"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useFlashStore } from "@/store";
import { executeSignedTransaction } from "@/lib/tx-executor";

/**
 * Watches for SIGNING state on activeTrade.
 *
 * TP/SL are bundled into the open-position tx by the Flash builder (see
 * buildOpenPosition in src/lib/api.ts — `takeProfit` / `stopLoss` wire
 * fields). The hook signs and broadcasts ONE versioned transaction that
 * contains open + optional TP + optional SL in a single atomic step.
 * No second or third signatures, no orphaned trigger orders.
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
        const cleanBase64 = await cleanTx(activeTrade.unsigned_tx!, walletAddress);
        const txBytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
        const transaction = VersionedTransaction.deserialize(txBytes);

        const signed = await signTransaction(transaction);

        // POST-SIGN SAFETY: check if trade was cancelled while wallet was open.
        // If user clicked Cancel in the UI during the wallet popup, activeTrade
        // will have been cleared. Do NOT broadcast a signed tx for a cancelled trade.
        const currentTrade = useFlashStore.getState().activeTrade;
        if (!currentTrade || currentTrade.status !== "SIGNING") {
          console.warn("[useWalletSign] Trade cancelled during signing — NOT broadcasting");
          return;
        }

        const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
        const signature = await executeSignedTransaction(signedBase64, connection);

        // Decouple state update from React — use double rAF + setTimeout for maximum safety
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              try { completeExecution(signature); } catch (e) {
                console.error("[useWalletSign] completeExecution error:", e);
              }
            }, 200);
          });
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Transaction failed";
        const isRejection = msg.includes("User rejected") || msg.includes("rejected");
        requestAnimationFrame(() => {
          setTimeout(() => {
            try { failExecution(isRejection ? "Transaction rejected by wallet." : msg); } catch {}
          }, 200);
        });
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
