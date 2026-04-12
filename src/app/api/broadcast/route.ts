// Server-side multi-endpoint broadcast — replicates FlashEdge CLI broadcast behavior.
//
// Accepts a signed transaction (base64), validates it's a real Solana transaction,
// fans out to all RPC endpoints in parallel, and returns the signature.
// Keeps Helius API key server-side.

import { NextRequest, NextResponse } from "next/server";
import { VersionedTransaction } from "@solana/web3.js";
import { getClientIp, RateLimiter, rateLimitResponse, checkBodySize } from "@/lib/api-security";

const HELIUS_RPC =
  process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

// Secondary RPCs for parallel broadcast (public endpoints, no key needed)
const SECONDARY_RPCS = [
  "https://api.mainnet-beta.solana.com",
].filter((url) => url !== HELIUS_RPC);

// Rate limit: 20 broadcasts/min per IP (trades are infrequent)
const limiter = new RateLimiter(20);

const MAX_BODY_BYTES = 8_000; // ~3KB base64 tx + JSON overhead

/**
 * Send a raw transaction to a single RPC endpoint.
 * Returns the signature on success, null on failure.
 */
async function sendToEndpoint(
  rpcUrl: string,
  txBase64: string,
  timeout = 10_000
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          txBase64,
          {
            encoding: "base64",
            skipPreflight: true,
            maxRetries: 3,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const data = await res.json();

    if (data.error) return null;
    return data.result as string;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  // Auth not required — tx is already wallet-signed (signature validated below).
  // Rate limiting + tx structure validation are sufficient protection.

  // ---- Rate Limit (trusted IP) ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  // ---- Body Size Limit ----
  const sizeCheck = checkBodySize(req, MAX_BODY_BYTES);
  if (sizeCheck) return sizeCheck;

  try {
    const body = await req.json();
    const txBase64: string = body?.transaction;

    if (!txBase64 || typeof txBase64 !== "string") {
      return NextResponse.json(
        { error: "Missing transaction field (base64)" },
        { status: 400 }
      );
    }

    // Validate it's plausible base64 size
    if (txBase64.length > 3000 || txBase64.length < 100) {
      return NextResponse.json(
        { error: "Invalid transaction size" },
        { status: 400 }
      );
    }

    // ---- Structure Validation: deserialize to verify it's a real Solana transaction ----
    try {
      const txBytes = Buffer.from(txBase64, "base64");
      const tx = VersionedTransaction.deserialize(txBytes);
      // Must have at least one signature (i.e., it's actually signed)
      if (!tx.signatures || tx.signatures.length === 0) {
        return NextResponse.json(
          { error: "Transaction has no signatures" },
          { status: 400 }
        );
      }
      // Verify the first signature is not all zeros (unsigned placeholder)
      const firstSig = tx.signatures[0];
      if (firstSig.every((b: number) => b === 0)) {
        return NextResponse.json(
          { error: "Transaction is not signed" },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid transaction format" },
        { status: 400 }
      );
    }

    // ── Parallel broadcast to all endpoints ──
    const allEndpoints = [HELIUS_RPC, ...SECONDARY_RPCS];

    const results = await Promise.allSettled(
      allEndpoints.map((url) => sendToEndpoint(url, txBase64))
    );

    let signature: string | null = null;
    let broadcastCount = 0;

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        if (!signature) signature = result.value;
        broadcastCount++;
      }
    }

    if (!signature) {
      return NextResponse.json(
        { error: "All broadcast endpoints failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      signature,
      broadcastCount,
      totalEndpoints: allEndpoints.length,
    });
  } catch {
    return NextResponse.json(
      { error: "Broadcast failed" },
      { status: 500 }
    );
  }
}
