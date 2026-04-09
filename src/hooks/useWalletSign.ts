"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useFlashStore } from "@/store";
import { executeSignedTransaction } from "@/lib/tx-executor";

/**
 * Watches for SIGNING state on activeTrade.
 *
 * Flow WITH TP/SL:
 *   1. Sign + broadcast open position → confirmed
 *   2. Build TP trigger order via Flash API (position now exists on-chain)
 *   3. Sign + broadcast TP → confirmed
 *   4. Build SL trigger order via Flash API
 *   5. Sign + broadcast SL → confirmed
 *
 * Flow WITHOUT TP/SL:
 *   1. Sign + broadcast → confirmed (unchanged)
 *
 * TP/SL failures don't fail the main trade.
 */
export function useWalletSign() {
  const { connection } = useConnection();
  const { signTransaction, connected, publicKey } = useWallet();
  const activeTrade = useFlashStore((s) => s.activeTrade);
  const completeExecution = useFlashStore((s) => s.completeExecution);
  const failExecution = useFlashStore((s) => s.failExecution);
  const signingRef = useRef(false);

  useEffect(() => {
    // Trade signing is now handled directly in TradePreviewCard (same pattern as earn/FAF)
    // This hook only handles TP/SL trigger orders after the main trade confirms
    if (!activeTrade || activeTrade.status !== "SIGNING") return;
    if (!activeTrade.unsigned_tx) return;
    if (!connected || !signTransaction || !publicKey) return;
    if (signingRef.current) return;

    signingRef.current = true;
    const walletAddress = useFlashStore.getState().walletAddress;

    (async () => {
      try {
        // ---- STEP 1: Sign + broadcast the main trade ----
        const cleanBase64 = await cleanTx(activeTrade.unsigned_tx!, walletAddress);
        const txBytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
        const transaction = VersionedTransaction.deserialize(txBytes);

        const signed = await signTransaction(transaction);
        const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
        const signature = await executeSignedTransaction(signedBase64, connection);

        // ---- STEP 2: Place TP/SL trigger orders (position now exists on-chain) ----
        if (activeTrade.take_profit_price || activeTrade.stop_loss_price) {
          // Wait for position to be readable on-chain
          await new Promise((r) => setTimeout(r, 2000));

          const { buildPlaceTriggerOrder } = await import("@/lib/api");
          const posSize = activeTrade.position_size ?? 0;
          const entry = activeTrade.entry_price ?? 1;
          const sizeAmount = entry > 0 ? String(Math.round((posSize / entry) * 10000) / 10000) : "0";

          // Place TP
          if (activeTrade.take_profit_price) {
            await placeTriggerAndSign({
              owner: walletAddress!,
              marketSymbol: activeTrade.market,
              side: activeTrade.action,
              triggerPriceUi: String(activeTrade.take_profit_price),
              sizeUsdUi: String(posSize),
              sizeAmountUi: sizeAmount,
              isStopLoss: false,
              collateralTokenSymbol: "USDC",
            }, walletAddress, signTransaction, connection, buildPlaceTriggerOrder);
          }

          // Place SL
          if (activeTrade.stop_loss_price) {
            await placeTriggerAndSign({
              owner: walletAddress!,
              marketSymbol: activeTrade.market,
              side: activeTrade.action,
              triggerPriceUi: String(activeTrade.stop_loss_price),
              sizeUsdUi: String(posSize),
              sizeAmountUi: sizeAmount,
              isStopLoss: true,
              collateralTokenSymbol: "USDC",
            }, walletAddress, signTransaction, connection, buildPlaceTriggerOrder);
          }
        }

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

async function placeTriggerAndSign(
  params: import("@/lib/api").BuildTriggerParams,
  walletAddress: string | null,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  connection: import("@solana/web3.js").Connection,
  buildPlaceTriggerOrder: typeof import("@/lib/api").buildPlaceTriggerOrder,
): Promise<void> {
  try {
    const result = await buildPlaceTriggerOrder(params);
    if (result.err || !result.transactionBase64) {
      console.warn(`[TP/SL] Build failed: ${result.err ?? "no tx"}`);
      return; // Don't fail the main trade
    }

    const cleaned = await cleanTx(result.transactionBase64, walletAddress);
    const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
    const tx = VersionedTransaction.deserialize(bytes);
    const signed = await signTransaction(tx);
    const base64 = Buffer.from(signed.serialize()).toString("base64");
    await executeSignedTransaction(base64, connection);
  } catch (e) {
    // TP/SL failure must NOT fail the main trade
    console.warn(`[TP/SL] ${params.isStopLoss ? "SL" : "TP"} failed:`, e instanceof Error ? e.message : e);
  }
}
