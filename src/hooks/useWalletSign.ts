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

  // Track the trade ID currently being signed — a single ref per trade ID
  // prevents the "effect re-runs because activeTrade reference changed but
  // it's still the same trade" double-sign case, while still allowing a NEW
  // trade (different id) to start signing immediately.
  const signingTradeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeTrade || activeTrade.status !== "SIGNING") return;
    if (!activeTrade.unsigned_tx) return;
    if (!connected || !signTransaction || !publicKey) return;
    if (signingTradeIdRef.current === activeTrade.id) return;

    signingTradeIdRef.current = activeTrade.id;
    const walletAddress = useFlashStore.getState().walletAddress;
    const tradeIdAtStart = activeTrade.id;

    (async () => {
      try {
        const cleanBase64 = await cleanTx(activeTrade.unsigned_tx!, walletAddress);

        // Defensive deserialize — a malformed clean-tx response should not
        // dump base64 garbage into the failExecution message shown to the
        // user. We catch and replace with a friendly error.
        let transaction: VersionedTransaction;
        try {
          const txBytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
          transaction = VersionedTransaction.deserialize(txBytes);
        } catch {
          throw new Error("Couldn't decode transaction. Please retry.");
        }

        const signed = await signTransaction(transaction);

        // POST-SIGN SAFETY: check if trade was cancelled while wallet was open.
        // If user clicked Cancel in the UI during the wallet popup, activeTrade
        // will have been cleared. Do NOT broadcast a signed tx for a cancelled trade.
        const currentTrade = useFlashStore.getState().activeTrade;
        if (!currentTrade || currentTrade.status !== "SIGNING" || currentTrade.id !== tradeIdAtStart) {
          console.warn("[useWalletSign] Trade cancelled or replaced during signing — NOT broadcasting");
          return;
        }

        const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
        const signature = await executeSignedTransaction(signedBase64, connection);

        // Decouple state update from React — use double rAF + setTimeout for maximum safety
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                completeExecution(signature);
              } catch (e) {
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
            try {
              failExecution(isRejection ? "Transaction rejected by wallet." : msg);
            } catch {
              // failExecution may throw if state was cleared; nothing to do.
            }
          }, 200);
        });
      } finally {
        // Clear only if we still own this trade ID — otherwise a newer trade
        // already started signing and we shouldn't stomp its lock.
        if (signingTradeIdRef.current === tradeIdAtStart) {
          signingTradeIdRef.current = null;
        }
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
  const data = await resp.json().catch(() => {
    throw new Error("Invalid clean-tx response");
  });
  if (data.error) throw new Error(data.error);
  if (!data.txBase64) throw new Error("No cleaned transaction returned");
  return data.txBase64;
}
