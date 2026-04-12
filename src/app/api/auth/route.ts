// ============================================
// Flash UI — Wallet Authentication API
// ============================================
// GET  /api/auth?wallet=<pubkey>  → { nonce, message }
// POST /api/auth { wallet, signature, nonce } → { token, expires_in }
//
// The client signs a human-readable message (no tx cost) and sends the
// signature back. The server verifies using ed25519 and issues a
// short-lived HMAC token for subsequent authenticated requests.

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  generateNonce,
  consumeNonce,
  getSignMessage,
  createAuthToken,
} from "@/lib/wallet-auth";
import {
  getClientIp,
  RateLimiter,
  rateLimitResponse,
  checkBodySize,
  isValidSolanaAddress,
} from "@/lib/api-security";

// Rate limits — tighter than data endpoints since auth is infrequent
const nonceLimiter = new RateLimiter(10); // 10 nonce requests/min
const verifyLimiter = new RateLimiter(10); // 10 verify attempts/min

// ---- GET: Request a nonce ----

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!nonceLimiter.check(ip)) return rateLimitResponse();

  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet || !isValidSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  // Validate it's a real public key
  try {
    new PublicKey(wallet);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  const nonce = generateNonce(wallet);
  const message = getSignMessage(nonce);

  return NextResponse.json({ nonce, message });
}

// ---- POST: Verify signature and issue token ----

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!verifyLimiter.check(ip)) return rateLimitResponse();

  const sizeCheck = checkBodySize(req, 2_000);
  if (sizeCheck) return sizeCheck;

  try {
    const { wallet, signature, nonce } = await req.json();

    // Validate inputs
    if (!wallet || typeof wallet !== "string" || !isValidSolanaAddress(wallet)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }
    if (!signature || typeof signature !== "string") {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }
    if (!nonce || typeof nonce !== "string") {
      return NextResponse.json({ error: "Missing nonce" }, { status: 400 });
    }

    // Validate nonce was issued and hasn't expired
    if (!consumeNonce(wallet, nonce)) {
      return NextResponse.json(
        { error: "Invalid or expired nonce. Request a new one." },
        { status: 401 }
      );
    }

    // Verify the ed25519 signature
    const message = getSignMessage(nonce);
    const messageBytes = new TextEncoder().encode(message);

    let pubkeyBytes: Uint8Array;
    try {
      pubkeyBytes = new PublicKey(wallet).toBytes();
    } catch {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    let signatureBytes: Uint8Array;
    try {
      signatureBytes = bs58.decode(signature);
    } catch {
      return NextResponse.json({ error: "Invalid signature format" }, { status: 400 });
    }

    const verified = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
    if (!verified) {
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 401 }
      );
    }

    // Issue auth token
    const token = createAuthToken(wallet);

    return NextResponse.json({
      token,
      wallet,
      expires_in: 30 * 60, // 30 minutes in seconds
    });
  } catch {
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
