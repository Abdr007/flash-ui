"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useFlashStore } from "@/store";

/**
 * Watches for SIGNING state on activeTrade.
 * When detected: deserialize tx → wallet signs → send to RPC → poll for confirmation.
 *
 * Uses HTTP polling (getSignatureStatuses) instead of WebSocket (confirmTransaction)
 * because WS subscriptions often fail through RPC proxies.
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

    (async () => {
      try {
        // 1. Deserialize
        const txBuffer = Buffer.from(activeTrade.unsigned_tx!, "base64");
        const transaction = VersionedTransaction.deserialize(txBuffer);

        // 2. Fresh blockhash
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transaction.message.recentBlockhash = blockhash;

        // 3. Wallet signs
        const signed = await signTransaction(transaction);

        // 4. Send
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        // 5. Poll for confirmation (HTTP, not WebSocket)
        const confirmed = await pollConfirmation(connection, signature, 45_000);

        if (confirmed) {
          completeExecution(signature);
        } else {
          // Timeout but tx was sent — complete optimistically
          // The position likely already changed on-chain
          completeExecution(signature);
        }
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

/**
 * Poll getSignatureStatuses every 2s until confirmed or timeout.
 * Returns true if confirmed, false if timed out.
 */
async function pollConfirmation(
  connection: { getSignatureStatuses: (sigs: string[]) => Promise<{ value: Array<{ confirmationStatus?: string; err?: unknown } | null> }> },
  signature: string,
  timeoutMs: number,
): Promise<boolean> {
  const start = Date.now();
  const POLL_INTERVAL = 2_000;

  while (Date.now() - start < timeoutMs) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];

      if (status?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }

      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return true;
      }
    } catch (err) {
      // If it's a real tx error (not network), rethrow
      if (err instanceof Error && err.message.includes("Transaction failed")) {
        throw err;
      }
      // Network error — keep polling
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  return false; // Timeout
}
