/**
 * Strip extra instructions from Flash API transactions to match
 * Flash Trade's official website transaction format exactly.
 *
 * Operates at the compiled instruction level — no decompile needed.
 * Strips FlashLog/Lighthouse instructions and fixes CU limit.
 */

import {
  Connection,
  VersionedTransaction,
  TransactionMessage,
  MessageV0,
  PublicKey,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
} from "@solana/web3.js";

// Programs to strip (FlashLog / Lighthouse — same program, different Solscan labels)
const STRIP_PROGRAMS = new Set([
  "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
]);

// Match Flash Trade website CU limit exactly
const FLASH_CU_LIMIT = 420_000;

export async function cleanFlashTransaction(
  txBase64: string,
  payerKey: PublicKey,
  connection: Connection,
): Promise<VersionedTransaction> {
  const rawTx = VersionedTransaction.deserialize(Buffer.from(txBase64, "base64"));
  const message = rawTx.message as MessageV0;
  const staticKeys = message.staticAccountKeys;

  // Resolve ALTs
  const altAccounts: AddressLookupTableAccount[] = [];
  for (const lookup of message.addressTableLookups) {
    const result = await connection.getAddressLookupTable(lookup.accountKey);
    if (result.value) altAccounts.push(result.value);
  }

  // Decompile to get full TransactionInstruction objects
  const decompiled = TransactionMessage.decompile(message, {
    addressLookupTableAccounts: altAccounts,
  });

  // Filter out strip-listed programs and fix CU limit
  const cleanInstructions = decompiled.instructions
    .filter((ix) => !STRIP_PROGRAMS.has(ix.programId.toBase58()))
    .map((ix) => {
      // Fix CU limit to match Flash Trade website
      if (
        ix.programId.toBase58() === "ComputeBudget111111111111111111111111111111" &&
        ix.data.length >= 5 &&
        ix.data[0] === 2
      ) {
        return ComputeBudgetProgram.setComputeUnitLimit({ units: FLASH_CU_LIMIT });
      }
      return ix;
    });

  // Rebuild with fresh blockhash
  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const cleanMessage = MessageV0.compile({
    payerKey,
    instructions: cleanInstructions,
    recentBlockhash: blockhash,
    addressLookupTableAccounts: altAccounts,
  });

  return new VersionedTransaction(cleanMessage);
}
