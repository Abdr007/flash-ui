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

        // 2. Get a FRESH blockhash right before signing (prevents expiry)
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        transaction.message.recentBlockhash = blockhash;

        // 3. Ask wallet to sign (Phantom/Solflare popup)
        const signed = await signTransaction(transaction);

        // 4. Send to RPC — skip preflight since Flash API already simulated
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        // 5. Confirm with the fresh blockhash
        const confirmation = await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
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
