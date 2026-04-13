/**
 * Shared transaction execution engine — FlashEdge-equivalent.
 *
 * Used by ALL trade operations (open, close, collateral, reverse).
 * Single execution path — no duplicate logic.
 *
 * Pipeline:
 *   1. Multi-endpoint broadcast via /api/broadcast
 *   2. WebSocket + HTTP confirmation racing
 *   3. Adaptive rebroadcast (800ms → 400ms → 280ms)
 *   4. Final status check before timeout
 */

import { type Connection } from "@solana/web3.js";

// ── Constants (match CLI ultra-tx-engine) ──

const CONFIRM_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 3_000;
const REBROADCAST_INTERVAL_MS = 800;

// ── Public API ──

/**
 * Execute a signed transaction with FlashEdge-equivalent reliability.
 * Returns the confirmed signature.
 * Throws on failure or wallet rejection.
 */
export async function executeSignedTransaction(signedBase64: string, connection: Connection): Promise<string> {
  // ── Step 1: Parallel broadcast ──
  const broadcastResult = await broadcastTransaction(signedBase64);
  if (!broadcastResult.signature) {
    throw new Error("All broadcast endpoints failed");
  }

  const signature = broadcastResult.signature;

  // ── Step 2: Confirmation race (WS + HTTP + adaptive rebroadcast) ──
  await waitForConfirmation(connection, signature, signedBase64, CONFIRM_TIMEOUT_MS);

  return signature;
}

// ── Broadcast ──

async function broadcastTransaction(signedBase64: string): Promise<{ signature: string; broadcastCount: number }> {
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

function rebroadcast(signedBase64: string): void {
  fetch("/api/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedBase64 }),
  }).catch(() => {});
}

// ── Confirmation ──

async function waitForConfirmation(
  conn: Connection,
  signature: string,
  signedBase64: string,
  timeoutMs: number,
): Promise<void> {
  const confirmStart = Date.now();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let wsSubId: number | undefined;

    const cleanup = (viaWs: boolean) => {
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(rebroadcastTimer);
      clearTimeout(timeoutTimer);
      if (wsSubId !== undefined && !viaWs) {
        try {
          conn.removeSignatureListener(wsSubId).catch(() => {});
        } catch {}
      }
    };

    const onConfirmed = (viaWs: boolean) => {
      if (settled) return;
      cleanup(viaWs);
      resolve();
    };

    const onError = (err: Error) => {
      if (settled) return;
      cleanup(false);
      reject(err);
    };

    // ── WebSocket ──
    try {
      wsSubId = conn.onSignature(
        signature,
        (result) => {
          if (result.err) {
            onError(new Error(`Transaction failed on-chain: ${JSON.stringify(result.err)}`));
          } else {
            onConfirmed(true);
          }
        },
        "confirmed",
      );
    } catch {}

    // ── HTTP Polling (3s) ──
    const pollTimer = setInterval(async () => {
      if (settled) return;
      try {
        const { value } = await conn.getSignatureStatuses([signature]);
        const status = value[0];
        if (status?.err) {
          onError(new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`));
          return;
        }
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
          onConfirmed(false);
        }
      } catch {}
    }, POLL_INTERVAL_MS);

    // ── Adaptive Rebroadcast (capped at 8 retries) ──
    let rebroadcastTimer: ReturnType<typeof setTimeout>;
    let rebroadcastCount = 0;
    const MAX_REBROADCASTS = 8;
    const scheduleRebroadcast = () => {
      if (settled || rebroadcastCount >= MAX_REBROADCASTS) return;
      const elapsed = Date.now() - confirmStart;
      const progress = elapsed / timeoutMs;
      let interval: number;
      if (progress > 0.75) interval = Math.max(300, REBROADCAST_INTERVAL_MS * 0.35);
      else if (progress > 0.5) interval = REBROADCAST_INTERVAL_MS * 0.5;
      else interval = REBROADCAST_INTERVAL_MS;

      rebroadcastTimer = setTimeout(() => {
        if (settled) return;
        rebroadcastCount++;
        rebroadcast(signedBase64);
        scheduleRebroadcast();
      }, interval);
    };
    scheduleRebroadcast();

    // ── Timeout — REJECT, never false-confirm ──
    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      // Final status check before giving up
      conn
        .getSignatureStatuses([signature])
        .then(({ value }) => {
          const status = value[0];
          if (
            status &&
            !status.err &&
            (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")
          ) {
            onConfirmed(false);
          } else {
            // CRITICAL FIX: reject on timeout — never tell user "confirmed" for unconfirmed tx
            onError(
              new Error(
                "Transaction was broadcast but not confirmed within 45 seconds. " +
                  "It may still land — check Solscan. Do NOT retry immediately to avoid double-send.",
              ),
            );
          }
        })
        .catch(() => {
          onError(
            new Error(
              "Transaction confirmation timed out and status check failed. " + "Check Solscan before retrying.",
            ),
          );
        });
    }, timeoutMs);
  });
}
