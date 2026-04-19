"use client";

// ============================================
// Flash UI — Wallet Auth Hook
// ============================================
// Handles the client-side auth flow:
// 1. Requests a nonce from /api/auth
// 2. Signs the message with the connected wallet
// 3. Sends signature to /api/auth for verification
// 4. Stores the token in memory (NOT localStorage — security)
// 5. Auto-refreshes before expiry
// 6. Clears on wallet disconnect
//
// Token + refresh-timer state lives at module scope so multiple components
// mounting `useWalletAuth` share the SAME token + the SAME timer. Previously
// each consumer installed its own setTimeout, all racing to refresh the same
// token — wasteful and a potential nonce-hammer source.

import { useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";

// Token stored in memory only — never persisted to disk
let authToken: string | null = null;
let authWallet: string | null = null;
let authExpiry = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
// In-flight authentication to dedupe parallel callers (e.g. multiple effects
// firing on the same render tick).
let inflight: Promise<boolean> | null = null;

export function getAuthToken(): string | null {
  if (!authToken || Date.now() > authExpiry) return null;
  return authToken;
}

export function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function clearAuth() {
  authToken = null;
  authWallet = null;
  authExpiry = 0;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh(expiresInSec: number, doAuth: () => Promise<boolean>) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(
    () => {
      doAuth().catch(() => clearAuth());
    },
    Math.max((expiresInSec - 120) * 1000, 60_000), // Refresh 2 min before expiry, no sooner than 1 min from now
  );
}

export function useWalletAuth() {
  const { publicKey, signMessage, connected } = useWallet();
  const walletAddress = useFlashStore((s) => s.walletAddress);

  const authenticate = useCallback(async (): Promise<boolean> => {
    if (!publicKey || !signMessage || !walletAddress) return false;

    // Already authenticated for this wallet
    if (authToken && authWallet === walletAddress && Date.now() < authExpiry) {
      return true;
    }

    // Coalesce parallel callers onto the same in-flight request.
    if (inflight) return inflight;

    const run = async (): Promise<boolean> => {
      try {
        // Step 1: Request nonce
        const nonceRes = await fetch(`/api/auth?wallet=${walletAddress}`);
        if (!nonceRes.ok) return false;
        const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string };

        // Step 2: Sign with wallet (user sees a popup, NOT a transaction)
        const messageBytes = new TextEncoder().encode(message);
        const signature = await signMessage(messageBytes);

        // Step 3: Convert signature to base58 for transport
        const { default: bs58 } = await import("bs58");
        const sigBase58 = bs58.encode(signature);

        // Step 4: Verify with server
        const verifyRes = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress, signature: sigBase58, nonce }),
        });

        if (!verifyRes.ok) return false;
        const { token, expires_in } = (await verifyRes.json()) as { token: string; expires_in: number };

        // Store in memory
        authToken = token;
        authWallet = walletAddress;
        authExpiry = Date.now() + expires_in * 1000 - 60_000; // Refresh 1 min early

        scheduleRefresh(expires_in, () => authenticate());
        return true;
      } catch {
        clearAuth();
        return false;
      }
    };

    inflight = run().finally(() => {
      inflight = null;
    });
    return inflight;
  }, [publicKey, signMessage, walletAddress]);

  // Clear auth on wallet disconnect or change
  useEffect(() => {
    if (!connected || !walletAddress) {
      clearAuth();
    } else if (authWallet && authWallet !== walletAddress) {
      // Wallet changed
      clearAuth();
    }
  }, [connected, walletAddress]);

  return {
    authenticate,
    isAuthenticated: !!authToken && authWallet === walletAddress && Date.now() < authExpiry,
    getToken: getAuthToken,
    getHeaders: getAuthHeaders,
    clearAuth,
  };
}
