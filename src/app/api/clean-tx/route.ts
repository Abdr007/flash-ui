import { NextRequest, NextResponse } from "next/server";
import {
  VersionedTransaction,
  TransactionMessage,
  MessageV0,
  PublicKey,
  ComputeBudgetProgram,
  Connection,
} from "@solana/web3.js";

const STRIP_PROGRAMS = new Set([
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
]);
const FLASH_CU_LIMIT = 420_000;

export async function POST(req: NextRequest) {
  try {
    const { txBase64, payerKey } = await req.json();

    const connection = new Connection(
      process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com",
      { commitment: "confirmed" }
    );

    const rawTx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
    const message = rawTx.message as MessageV0;

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

    // Filter out Lighthouse/FlashLog + fix CU limit
    const cleanIxs = decompiled.instructions
      .filter((ix) => !STRIP_PROGRAMS.has(ix.programId.toBase58()))
      .map((ix) => {
        if (
          ix.programId.toBase58() === "ComputeBudget111111111111111111111111111111" &&
          ix.data.length >= 5 &&
          ix.data[0] === 2
        ) {
          return ComputeBudgetProgram.setComputeUnitLimit({ units: FLASH_CU_LIMIT });
        }
        return ix;
      });

    // Rebuild
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const cleanMessage = MessageV0.compile({
      payerKey: new PublicKey(payerKey),
      instructions: cleanIxs,
      recentBlockhash: blockhash,
      addressLookupTableAccounts: altAccounts,
    });

    const cleanTx = new VersionedTransaction(cleanMessage);
    const cleanBase64 = Buffer.from(cleanTx.serialize()).toString("base64");

    return NextResponse.json({ txBase64: cleanBase64, instructions: cleanIxs.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Clean failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
