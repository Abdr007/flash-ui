import { NextRequest, NextResponse } from "next/server";
import {
  VersionedTransaction,
  TransactionMessage,
  MessageV0,
  PublicKey,
  ComputeBudgetProgram,
  Connection,
} from "@solana/web3.js";
import { getClientIp, RateLimiter, rateLimitResponse, checkBodySize, safeErrorResponse } from "@/lib/api-security";

const STRIP_PROGRAMS = new Set(["L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"]);
const FLASH_CU_LIMIT = 420_000;
const FLASH_CU_PRICE = 10_000;
const MAX_BODY_BYTES = 10_000; // 10KB

// Rate limit: 20 req/min per IP
const limiter = new RateLimiter(20);

export async function POST(req: NextRequest) {
  // Auth not required — tx payer validation below proves ownership.
  // Rate limiting + payer match are sufficient protection.

  // ---- Rate Limit ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  // ---- Body Size Limit ----
  const sizeCheck = checkBodySize(req, MAX_BODY_BYTES);
  if (sizeCheck) return sizeCheck;

  try {
    const { txBase64, payerKey } = await req.json();

    // ---- Input Validation ----
    if (!txBase64 || typeof txBase64 !== "string" || txBase64.length > 3000 || txBase64.length < 100) {
      return NextResponse.json({ error: "Invalid transaction data" }, { status: 400 });
    }
    if (!payerKey || typeof payerKey !== "string") {
      return NextResponse.json({ error: "Missing payer key" }, { status: 400 });
    }

    // Validate payerKey is a valid public key
    let payerPubkey: PublicKey;
    try {
      payerPubkey = new PublicKey(payerKey);
    } catch {
      return NextResponse.json({ error: "Invalid payer key" }, { status: 400 });
    }

    const connection = new Connection(process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com", {
      commitment: "confirmed",
    });

    const rawTx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
    const message = rawTx.message as MessageV0;

    // ---- Payer Validation: payerKey must match transaction's fee payer ----
    const originalPayer = message.staticAccountKeys[0];
    if (!originalPayer || !originalPayer.equals(payerPubkey)) {
      return NextResponse.json({ error: "Payer key does not match transaction fee payer" }, { status: 400 });
    }

    // Resolve ALTs
    const altAccounts = [];
    for (const lookup of message.addressTableLookups) {
      const result = await connection.getAddressLookupTable(lookup.accountKey);
      if (result.value) altAccounts.push(result.value);
    }

    // Decompile
    const decompiled = TransactionMessage.decompile(message, {
      addressLookupTableAccounts: altAccounts,
    });

    // Filter out Lighthouse/FlashLog + fix CU params
    const cleanIxs = decompiled.instructions
      .filter((ix) => !STRIP_PROGRAMS.has(ix.programId.toBase58()))
      .map((ix) => {
        if (ix.programId.toBase58() === "ComputeBudget111111111111111111111111111111") {
          if (ix.data.length >= 5 && ix.data[0] === 2) {
            return ComputeBudgetProgram.setComputeUnitLimit({ units: FLASH_CU_LIMIT });
          }
          if (ix.data.length >= 9 && ix.data[0] === 3) {
            return ComputeBudgetProgram.setComputeUnitPrice({ microLamports: FLASH_CU_PRICE });
          }
        }
        return ix;
      });

    // Rebuild
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const cleanMessage = MessageV0.compile({
      payerKey: payerPubkey,
      instructions: cleanIxs,
      recentBlockhash: blockhash,
      addressLookupTableAccounts: altAccounts,
    });

    const cleanTx = new VersionedTransaction(cleanMessage);
    const cleanBase64 = Buffer.from(cleanTx.serialize()).toString("base64");

    return NextResponse.json({ txBase64: cleanBase64, instructions: cleanIxs.length });
  } catch (err: unknown) {
    return safeErrorResponse(err, "Transaction cleaning failed");
  }
}
