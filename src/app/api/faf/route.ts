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
import {
  Connection,
  PublicKey,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";
const COMPUTE_UNITS = 100_000;
const PRIORITY_FEE = 50_000; // microlamports

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
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const walletStr = url.searchParams.get("wallet");

  if (!walletStr || !action) {
    return NextResponse.json({ error: "Missing action or wallet" }, { status: 400 });
  }

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
  try {
    const body = await req.json();
    const { action, wallet, amount, index } = body;

    if (!action || !wallet) {
      return NextResponse.json({ error: "Missing action or wallet" }, { status: 400 });
    }

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

    switch (action) {
      case "stake": {
        if (!amount || !Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: "Invalid stake amount" }, { status: 400 });
        }
        const result = await buildStakeInstructions(connection, dummyWallet, userPubkey, amount);
        instructions = result.instructions;
        break;
      }

      case "unstake": {
        if (!amount || !Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: "Invalid unstake amount" }, { status: 400 });
        }
        const result = await buildUnstakeInstructions(connection, dummyWallet, userPubkey, amount);
        instructions = result.instructions;
        break;
      }

      case "claim_rewards": {
        const result = await buildClaimRewardsInstructions(connection, dummyWallet, userPubkey);
        instructions = result.instructions;
        break;
      }

      case "claim_revenue": {
        const result = await buildClaimRevenueInstructions(connection, dummyWallet, userPubkey);
        instructions = result.instructions;
        break;
      }

      case "cancel_unstake": {
        if (index == null || !Number.isInteger(index) || index < 0) {
          return NextResponse.json({ error: "Invalid request index" }, { status: 400 });
        }
        const result = await buildCancelUnstakeInstructions(connection, dummyWallet, userPubkey, index);
        instructions = result.instructions;
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

    // Simulate
    const sim = await connection.simulateTransaction(transaction, { sigVerify: false });
    if (sim.value.err) {
      return NextResponse.json({
        error: `Simulation failed: ${JSON.stringify(sim.value.err)}`,
        logs: sim.value.logs?.slice(-5),
      }, { status: 400 });
    }

    const serialized = transaction.serialize();
    const base64 = Buffer.from(serialized).toString("base64");

    return NextResponse.json({
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to build FAF transaction";
    console.error("[faf/POST]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
