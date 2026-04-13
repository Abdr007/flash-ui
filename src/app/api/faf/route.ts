// ============================================
// Flash UI — FAF Staking API
// ============================================
// Reads on-chain FAF staking state and builds transactions.
// Uses Flash SDK PerpetualsClient for all operations.
//
// Actions:
//   GET:  ?action=info&wallet=...  → stake info + rewards + tier
//   GET:  ?action=requests&wallet=... → unstake requests
//   POST: { action: "stake", wallet, amount }  → unsigned tx
//   POST: { action: "unstake", wallet, amount } → unsigned tx
//   POST: { action: "claim_rewards", wallet }   → unsigned tx
//   POST: { action: "claim_revenue", wallet }   → unsigned tx
//   POST: { action: "cancel_unstake", wallet, index } → unsigned tx

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";
import {
  getClientIp,
  RateLimiter,
  rateLimitResponse,
  checkBodySize,
  safeErrorResponse,
  enforceWalletMatch,
} from "@/lib/api-security";

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";
const COMPUTE_UNITS = 220_000;
const PRIORITY_FEE = 50_000;
const MAX_BODY_BYTES = 4_000;

// Rate limit: 15 req/min per IP (staking is infrequent)
const limiter = new RateLimiter(15);

const FafPostBody = z.object({
  action: z.enum(["stake", "unstake", "claim_rewards", "claim_revenue", "cancel_unstake"]),
  wallet: z.string().min(32).max(50),
  amount: z.number().positive().optional(),
  index: z.number().int().min(0).optional(),
});

// Dummy wallet for read-only operations (SDK requires Wallet but we only read)
function makeDummyWallet(pubkey: PublicKey): Wallet {
  const kp = Keypair.generate();
  return {
    publicKey: pubkey,
    signTransaction: async (tx: unknown) => tx,
    signAllTransactions: async (txs: unknown[]) => txs,
    payer: kp,
  } as unknown as Wallet;
}

// ---- GET: Read state ----

export async function GET(req: NextRequest) {
  // ---- Rate Limit ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const walletStr = url.searchParams.get("wallet");

  if (!walletStr || !action) {
    return NextResponse.json({ error: "Missing action or wallet" }, { status: 400 });
  }

  // Wallet impersonation check (permissive for read-only GET)
  const walletCheck = enforceWalletMatch(req, walletStr, false);
  if (walletCheck) return walletCheck;

  let userPubkey: PublicKey;
  try {
    userPubkey = new PublicKey(walletStr);
  } catch {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  const connection = new Connection(RPC_URL, { commitment: "confirmed" });
  const dummyWallet = makeDummyWallet(userPubkey);

  try {
    // Dynamic import to avoid SSR issues with flash-sdk
    const { getFafStakeInfo, getFafUnstakeRequests } = await import("@/lib/faf-sdk");

    if (action === "info") {
      const info = await getFafStakeInfo(connection, dummyWallet, userPubkey);
      return NextResponse.json({ data: info });
    }

    if (action === "requests") {
      const requests = await getFafUnstakeRequests(connection, dummyWallet, userPubkey);
      return NextResponse.json({ data: requests });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read FAF state";
    console.error("[faf/GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---- POST: Build transactions ----

export async function POST(req: NextRequest) {
  // ---- Rate Limit ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  // ---- Body Size Limit ----
  const sizeCheck = checkBodySize(req, MAX_BODY_BYTES);
  if (sizeCheck) return sizeCheck;

  try {
    const rawBody = await req.json();
    let action: string, wallet: string, amount: number | undefined, index: number | undefined;
    try {
      ({ action, wallet, amount, index } = FafPostBody.parse(rawBody));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
      }
      throw err;
    }

    // Wallet impersonation check (permissive — tx signature is the real auth)
    const walletCheck = enforceWalletMatch(req, wallet, false);
    if (walletCheck) return walletCheck;

    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    const connection = new Connection(RPC_URL, { commitment: "confirmed" });
    const dummyWallet = makeDummyWallet(userPubkey);

    const {
      buildStakeInstructions,
      buildUnstakeInstructions,
      buildClaimRewardsInstructions,
      buildClaimRevenueInstructions,
      buildCancelUnstakeInstructions,
    } = await import("@/lib/faf-sdk");

    let instructions;
    let additionalSigners: import("@solana/web3.js").Signer[] = [];

    switch (action) {
      case "stake": {
        if (!amount || !Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: "Invalid stake amount" }, { status: 400 });
        }
        const result = await buildStakeInstructions(connection, dummyWallet, userPubkey, amount);
        instructions = result.instructions;
        additionalSigners = result.additionalSigners;
        break;
      }

      case "unstake": {
        if (!amount || !Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: "Invalid unstake amount" }, { status: 400 });
        }
        const result = await buildUnstakeInstructions(connection, dummyWallet, userPubkey, amount);
        instructions = result.instructions;
        additionalSigners = result.additionalSigners;
        break;
      }

      case "claim_rewards": {
        const result = await buildClaimRewardsInstructions(connection, dummyWallet, userPubkey);
        instructions = result.instructions;
        additionalSigners = result.additionalSigners;
        break;
      }

      case "claim_revenue": {
        const result = await buildClaimRevenueInstructions(connection, dummyWallet, userPubkey);
        instructions = result.instructions;
        additionalSigners = result.additionalSigners;
        break;
      }

      case "cancel_unstake": {
        if (index == null || !Number.isInteger(index) || index < 0) {
          return NextResponse.json({ error: "Invalid request index" }, { status: 400 });
        }
        const result = await buildCancelUnstakeInstructions(connection, dummyWallet, userPubkey, index);
        instructions = result.instructions;
        additionalSigners = result.additionalSigners;
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Add compute budget
    const allInstructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE }),
      ...instructions,
    ];

    // Build versioned transaction
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const messageV0 = new TransactionMessage({
      payerKey: userPubkey,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    // Sign with additionalSigners (ephemeral keypairs the SDK may require)
    if (additionalSigners.length > 0) {
      transaction.sign(additionalSigners);
    }

    // Simulate
    const sim = await connection.simulateTransaction(transaction, { sigVerify: false });
    if (sim.value.err) {
      const errStr = JSON.stringify(sim.value.err);
      // Humanize common errors — never expose raw simulation logs to client
      let msg = "Transaction simulation failed. Please try again.";
      if (errStr.includes("AccountNotFound")) {
        msg = "You don't have FAF tokens in your wallet. Buy FAF first to start staking.";
      } else if (errStr.includes("InstructionError")) {
        msg = "Transaction would fail. Check your FAF balance and try again.";
      } else if (errStr.includes("InsufficientFunds")) {
        msg = "Insufficient funds for this operation.";
      }
      // Log details server-side for debugging, NOT in response
      console.error("[faf/sim]", errStr, sim.value.logs?.slice(-3));
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const serialized = transaction.serialize();
    const base64 = Buffer.from(serialized).toString("base64");

    return NextResponse.json({
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
    });
  } catch (err) {
    console.error("[faf/POST]", err instanceof Error ? err.message : err);
    return safeErrorResponse(err, "Failed to build FAF transaction");
  }
}
