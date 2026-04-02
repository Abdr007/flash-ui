"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useFlashStore } from "@/store";

/**
 * Watches for SIGNING state on activeTrade.
 * When detected, deserializes the unsigned tx, asks wallet to sign,
 * sends to RPC, waits for confirmation, then calls completeExecution or failExecution.
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
    if (signingRef.current) return; // Prevent double-fire

    signingRef.current = true;

    (async () => {
      try {
        // 1. Deserialize the base64 transaction
        const txBuffer = Buffer.from(activeTrade.unsigned_tx!, "base64");
        const transaction = VersionedTransaction.deserialize(txBuffer);

        // 2. Ask wallet to sign (Phantom/Solflare popup)
        const signed = await signTransaction(transaction);

        // 3. Send to RPC
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });

        // 4. Confirm
        const confirmation = await connection.confirmTransaction(signature, "confirmed");

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        // 5. Success
        completeExecution(signature);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Transaction failed";
        // User rejected = wallet popup closed
        const isRejection = msg.includes("User rejected") || msg.includes("rejected");
        failExecution(isRejection ? "Transaction rejected by wallet." : msg);
      } finally {
        signingRef.current = false;
      }
    })();
  }, [activeTrade, connected, signTransaction, connection, completeExecution, failExecution]);
}
