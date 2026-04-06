"use client";

import { useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction, type Connection } from "@solana/web3.js";
import { useFlashStore } from "@/store";

/**
 * FlashEdge-equivalent execution engine for the UI.
 *
 * Replicates the EXACT behavior of ultra-tx-engine.ts:
 *   1. Deserialize + fresh blockhash + wallet sign (ONCE)
 *   2. Parallel broadcast to all RPC endpoints via /api/broadcast
 *   3. WebSocket + HTTP confirmation racing
 *   4. Adaptive rebroadcast (800ms → 400ms → 280ms)
 *   5. Final status check before timeout
 *
 * Transaction bytes are NEVER modified after signing.
 * Only execution timing and routing are optimized.
 */

// ── Constants (match CLI ultra-tx-engine exactly) ──

/** Confirmation timeout — same as CLI CONFIRM_TIMEOUT_MS */
const CONFIRM_TIMEOUT_MS = 45_000;

/** HTTP poll interval — same as CLI POLL_INTERVAL_MS */
const POLL_INTERVAL_MS = 3_000;

/** Base rebroadcast interval — same as CLI DEFAULT_REBROADCAST_INTERVAL_MS */
const REBROADCAST_INTERVAL_MS = 800;

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

    const walletAddress = activeTrade.unsigned_tx
      ? useFlashStore.getState().walletAddress
      : null;

    (async () => {
      try {
        // ── Step 1: Clean transaction (strip Lighthouse assertions, fix CU) ──
        // Phantom wallet injects Lighthouse assertions during signing if the tx
        // contains them. Clean BEFORE signing so the wallet signs a clean tx.
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

        // ── Step 2: Deserialize clean transaction ──
        const txBytes = Uint8Array.from(
          atob(cleanData.txBase64),
          (c) => c.charCodeAt(0)
        );
        const transaction = VersionedTransaction.deserialize(txBytes);

        // ── Step 3: Wallet signs clean tx (no Lighthouse to trigger injection) ──
        const signed = await signTransaction(transaction);
        const signedBytes = signed.serialize();
        const signedBase64 = Buffer.from(signedBytes).toString("base64");

        // ── Step 4: Parallel broadcast via server-side fan-out ──
        // Matches CLI: broadcastToAll() → parallel send to all healthy RPCs
        const broadcastResult = await broadcastTransaction(signedBase64);

        if (!broadcastResult.signature) {
          throw new Error("All broadcast endpoints failed");
        }

        const signature = broadcastResult.signature;

        // ── Step 5: Confirmation race (WS + HTTP + adaptive rebroadcast) ──
        // Matches CLI: waitForConfirmation() with dual confirmation + rebroadcast
        const confirmed = await waitForConfirmation(
          connection,
          signature,
          signedBase64,
          CONFIRM_TIMEOUT_MS,
        );

        if (confirmed) {
          completeExecution(signature);
        } else {
          // Timeout but tx was broadcast — complete optimistically
          // Same behavior as CLI: tx was sent and rebroadcast multiple times
          completeExecution(signature);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Transaction failed";
        const isRejection =
          msg.includes("User rejected") || msg.includes("rejected");
        failExecution(
          isRejection ? "Transaction rejected by wallet." : msg
        );
      } finally {
        signingRef.current = false;
      }
    })();
  }, [
    activeTrade,
    connected,
    signTransaction,
    connection,
    completeExecution,
    failExecution,
  ]);
}

// ── Broadcast ──────────────────────────────────────────────────────────────

/**
 * Broadcast signed transaction via server-side fan-out endpoint.
 * Replicates CLI broadcastToAll(): parallel send to all RPC endpoints.
 */
async function broadcastTransaction(
  signedBase64: string
): Promise<{ signature: string; broadcastCount: number }> {
  // Primary: server-side multi-endpoint broadcast (keeps API keys private)
  const res = await fetch("/api/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedBase64 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Broadcast failed" }));
    throw new Error(err.error || `Broadcast failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Rebroadcast the same signed transaction.
 * Fire-and-forget — errors are silently ignored (same as CLI rebroadcast).
 */
function rebroadcast(signedBase64: string): void {
  fetch("/api/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedBase64 }),
  }).catch(() => {});
}

// ── Confirmation (WS + HTTP racing + adaptive rebroadcast) ────────────────

/**
 * Wait for confirmation using WebSocket + HTTP polling race.
 * Replicates CLI waitForConfirmation() exactly:
 *   - WebSocket: instant notification via onSignature
 *   - HTTP: poll getSignatureStatuses every 3s
 *   - Rebroadcast: adaptive interval (800ms → 400ms → 280ms)
 *   - Final status check before declaring timeout
 *
 * Returns true if confirmed, false if timed out.
 */
async function waitForConfirmation(
  conn: Connection,
  signature: string,
  signedBase64: string,
  timeoutMs: number
): Promise<boolean> {
  const confirmStart = Date.now();

  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let wsSubId: number | undefined;

    const cleanup = (viaWs: boolean) => {
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(rebroadcastTimer);
      clearTimeout(timeoutTimer);
      // Only unsubscribe WS if confirmation came via polling (not WS).
      // onSignature is one-shot — auto-removes after firing.
      if (wsSubId !== undefined && !viaWs) {
        try {
          conn.removeSignatureListener(wsSubId).catch(() => {});
        } catch {
          // Already cleaned up
        }
      }
    };

    const onConfirmed = (viaWs: boolean) => {
      if (settled) return;
      cleanup(viaWs);
      resolve(true);
    };

    const onError = (err: Error) => {
      if (settled) return;
      cleanup(false);
      reject(err);
    };

    // ── WebSocket Confirmation (same as CLI) ──
    try {
      wsSubId = conn.onSignature(
        signature,
        (result) => {
          if (result.err) {
            onError(
              new Error(
                `Transaction failed on-chain: ${JSON.stringify(result.err)}`
              )
            );
          } else {
            onConfirmed(true);
          }
        },
        "confirmed"
      );
    } catch {
      // WS subscription failed — rely on HTTP polling (same as CLI fallback)
    }

    // ── HTTP Polling (same interval as CLI: 3s) ──
    const pollTimer = setInterval(async () => {
      if (settled) return;
      try {
        const { value } = await conn.getSignatureStatuses([signature]);
        const status = value[0];

        if (status?.err) {
          onError(
            new Error(
              `Transaction failed on-chain: ${JSON.stringify(status.err)}`
            )
          );
          return;
        }

        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          onConfirmed(false);
        }
      } catch {
        // Network error — keep polling (same as CLI)
      }
    }, POLL_INTERVAL_MS);

    // ── Adaptive Rebroadcast (same curve as CLI) ──
    // Interval tightens with elapsed time:
    //   0-50%:  800ms (base)
    //   50-75%: 400ms (0.5x)
    //   75%+:   280ms (0.35x)
    let rebroadcastTimer: ReturnType<typeof setTimeout>;

    const scheduleRebroadcast = () => {
      if (settled) return;

      const elapsed = Date.now() - confirmStart;
      const progress = elapsed / timeoutMs;

      let interval: number;
      if (progress > 0.75) {
        interval = Math.max(300, REBROADCAST_INTERVAL_MS * 0.35);
      } else if (progress > 0.5) {
        interval = REBROADCAST_INTERVAL_MS * 0.5;
      } else {
        interval = REBROADCAST_INTERVAL_MS;
      }

      rebroadcastTimer = setTimeout(() => {
        if (settled) return;
        rebroadcast(signedBase64);
        scheduleRebroadcast();
      }, interval);
    };
    scheduleRebroadcast();

    // ── Timeout (same as CLI: final status check before declaring timeout) ──
    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      // One final status check — same as CLI
      conn
        .getSignatureStatuses([signature])
        .then(({ value }) => {
          const status = value[0];
          if (
            status &&
            !status.err &&
            (status.confirmationStatus === "confirmed" ||
              status.confirmationStatus === "finalized")
          ) {
            onConfirmed(false);
          } else {
            // Timeout — resolve false (caller handles optimistic completion)
            cleanup(false);
            resolve(false);
          }
        })
        .catch(() => {
          cleanup(false);
          resolve(false);
        });
    }, timeoutMs);
  });
}
