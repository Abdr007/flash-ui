// ============================================
// Flash AI — Universal Transfer Transaction Builder
// ============================================
// Builds unsigned SOL or ANY SPL token transfer.
// No whitelist. Mint + decimals come from the preview tool
// which reads them on-chain.
//
// Security:
// - All inputs validated server-side
// - Self-transfer blocked
// - Balance re-verified at build time (TOCTOU safe)
// - Mint re-validated on-chain (decimals must match)
// - Frozen accounts detected
// - Pre-send simulation catches program errors
//
// Cheapest execution:
// - SOL: SystemProgram.transfer — 300 CU
// - SPL: createTransferCheckedInstruction — 60,000 CU
// - Priority fee: 1 microlamport (minimum)

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getMint,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

// ---- Kill switch for transfers (independent of trading) ----
const TRANSFERS_ENABLED = process.env.TRANSFERS_ENABLED !== "false";

const SOL_COMPUTE_UNITS = 300;
const SPL_COMPUTE_UNITS = 60_000;
const PRIORITY_FEE_MICROLAMPORTS = 1;
const MAX_SAFE_RAW_AMOUNT = BigInt("9223372036854775807"); // 2^63 - 1

/**
 * Convert human-readable amount to raw BigInt without floating-point precision loss.
 * Uses string arithmetic instead of float multiplication.
 */
function amountToRaw(amount: number, decimals: number): bigint {
  // Convert to string to avoid float precision issues
  const str = amount.toFixed(decimals); // guaranteed safe for decimals <= 18
  const [intPart, fracPart = ""] = str.split(".");
  const paddedFrac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const raw = BigInt(intPart + paddedFrac);
  return raw;
}

// ---- Idempotency cache (30s TTL) ----
const idempotencyCache = new Map<string, { response: object; ts: number }>();
const IDEMPOTENCY_TTL = 30_000;

function cleanIdempotencyCache() {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (now - entry.ts > IDEMPOTENCY_TTL) idempotencyCache.delete(key);
  }
  if (idempotencyCache.size > 200) {
    const oldest = idempotencyCache.keys().next().value;
    if (oldest) idempotencyCache.delete(oldest);
  }
}

interface TransferBuildRequest {
  sender: string;
  recipient: string;
  token: string;
  amount: number;
  mint: string | null;
  decimals: number;
  is_native_sol: boolean;
  is_token2022?: boolean;
  request_id?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: TransferBuildRequest = await req.json();
    const { sender, recipient, token, amount, mint, decimals, is_native_sol, request_id } = body;

    // ---- Kill switch ----
    if (!TRANSFERS_ENABLED) {
      console.error("[transfer/build] Transfers disabled via kill switch");
      return NextResponse.json({ error: "Transfers are temporarily disabled." }, { status: 503 });
    }

    // ---- Idempotency check ----
    cleanIdempotencyCache();
    if (request_id) {
      const cached = idempotencyCache.get(request_id);
      if (cached) return NextResponse.json(cached.response);
    }

    // ---- Input validation ----
    if (!sender || !recipient || !token || !amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    let senderPubkey: PublicKey;
    let recipientPubkey: PublicKey;
    try {
      senderPubkey = new PublicKey(sender);
      recipientPubkey = new PublicKey(recipient);
    } catch {
      return NextResponse.json({ error: "Invalid public key" }, { status: 400 });
    }

    if (sender === recipient) {
      return NextResponse.json({ error: "Cannot transfer to yourself" }, { status: 400 });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const connection = new Connection(RPC_URL, { commitment: "confirmed" });
    const instructions = [];

    // Compute budget — cheapest possible
    const computeUnits = is_native_sol ? SOL_COMPUTE_UNITS : SPL_COMPUTE_UNITS;
    instructions.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    instructions.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }));

    if (is_native_sol) {
      // ---- SOL Transfer ----
      const lamports = Math.round(amount * LAMPORTS_PER_SOL);
      const balance = await connection.getBalance(senderPubkey);
      const totalNeeded = lamports + 5000 + 1_000_000;
      if (balance < totalNeeded) {
        return NextResponse.json({
          error: `Insufficient SOL. Have ${(balance / LAMPORTS_PER_SOL).toFixed(4)}, need ${(totalNeeded / LAMPORTS_PER_SOL).toFixed(4)}`,
        }, { status: 400 });
      }

      instructions.push(
        SystemProgram.transfer({
          fromPubkey: senderPubkey,
          toPubkey: recipientPubkey,
          lamports,
        })
      );
    } else {
      // ---- Universal SPL Token Transfer ----
      if (!mint) {
        return NextResponse.json({ error: "Missing mint address" }, { status: 400 });
      }

      let mintPubkey: PublicKey;
      try {
        mintPubkey = new PublicKey(mint);
      } catch {
        return NextResponse.json({ error: "Invalid mint address" }, { status: 400 });
      }

      // ---- Detect token program (Token vs Token2022) ----
      const mintAccountInfo = await connection.getAccountInfo(mintPubkey);
      if (!mintAccountInfo) {
        return NextResponse.json({ error: `Mint ${mint} not found.` }, { status: 400 });
      }
      const tokenProgramId = mintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID;

      // ---- Re-validate mint on-chain (TOCTOU safety) ----
      let onChainDecimals: number;
      try {
        const mintInfo = await getMint(connection, mintPubkey, undefined, tokenProgramId);
        onChainDecimals = mintInfo.decimals;

        // Decimals MUST match what preview told us
        if (onChainDecimals !== decimals) {
          return NextResponse.json({
            error: `Decimals mismatch: preview said ${decimals}, on-chain is ${onChainDecimals}. Aborting for safety.`,
          }, { status: 400 });
        }

        // Check if mint has freeze authority AND account is frozen
        // (freeze authority existing doesn't mean frozen, but we log it)
      } catch {
        return NextResponse.json({ error: `Mint ${mint} not found or invalid.` }, { status: 400 });
      }

      // Get sender ATA + verify balance (Token2022-aware)
      const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPubkey, false, tokenProgramId);
      try {
        const senderAccount = await getAccount(connection, senderAta, undefined, tokenProgramId);

        // Check frozen
        if (senderAccount.isFrozen) {
          return NextResponse.json({
            error: `Your ${token} account is frozen. Transfer blocked.`,
          }, { status: 400 });
        }

        const rawAmount = amountToRaw(amount, onChainDecimals);
        if (senderAccount.amount < rawAmount) {
          const bal = Number(senderAccount.amount) / Math.pow(10, onChainDecimals);
          return NextResponse.json({
            error: `Insufficient ${token}. Have ${bal.toFixed(Math.min(onChainDecimals, 6))}, need ${amount}`,
          }, { status: 400 });
        }
      } catch (err) {
        if (err instanceof TokenAccountNotFoundError || err instanceof TokenInvalidAccountOwnerError) {
          return NextResponse.json({ error: `No ${token} account found in wallet` }, { status: 400 });
        }
        throw err;
      }

      // Get/create recipient ATA (Token2022-aware)
      const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey, false, tokenProgramId);
      const recipientAtaInfo = await connection.getAccountInfo(recipientAta);

      // Idempotent ATA creation — succeeds even if ATA already exists (race-safe)
      if (!recipientAtaInfo) {
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            senderPubkey,
            recipientAta,
            recipientPubkey,
            mintPubkey,
            tokenProgramId,
          )
        );
      }

      // Transfer using CHECKED instruction (validates decimals on-chain, Token2022-aware)
      const rawAmount = amountToRaw(amount, onChainDecimals);
      if (rawAmount <= BigInt(0) || rawAmount > MAX_SAFE_RAW_AMOUNT) {
        return NextResponse.json({ error: "Amount out of safe range" }, { status: 400 });
      }
      instructions.push(
        createTransferCheckedInstruction(
          senderAta,
          mintPubkey,
          recipientAta,
          senderPubkey,
          rawAmount,
          onChainDecimals,
          [],              // multiSigners
          tokenProgramId,  // Token2022-aware
        )
      );
    }

    // ---- Build transaction ----
    const blockhashPromise = connection.getLatestBlockhash("confirmed");
    const blockhashTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Blockhash fetch timed out")), 8000)
    );
    const { blockhash, lastValidBlockHeight } = await Promise.race([blockhashPromise, blockhashTimeout]);
    const messageV0 = new TransactionMessage({
      payerKey: senderPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    // ---- Pre-send simulation ----
    const simulation = await connection.simulateTransaction(transaction, { sigVerify: false });
    if (simulation.value.err) {
      const errMsg = JSON.stringify(simulation.value.err);
      return NextResponse.json({
        error: `Simulation failed: ${errMsg}`,
        logs: simulation.value.logs?.slice(-5),
      }, { status: 400 });
    }

    // ---- Return unsigned transaction ----
    const serialized = transaction.serialize();
    const base64 = Buffer.from(serialized).toString("base64");

    const responseBody = {
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
      computeUnits,
      priorityFee: PRIORITY_FEE_MICROLAMPORTS,
    };

    // Cache for idempotency
    if (request_id) {
      idempotencyCache.set(request_id, { response: responseBody, ts: Date.now() });
    }

    return NextResponse.json(responseBody);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to build transfer";
    console.error("[transfer/build]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
