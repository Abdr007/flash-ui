// ============================================
// Flash UI — Transaction Merger
// ============================================
// Merges multiple Flash API transactions into ONE using ALTs.
// Enables open position + TP + SL in a single atomic transaction.
//
// How: deserialize each tx → extract instructions → recompile with shared ALTs.

import {
  VersionedTransaction,
  TransactionMessage,
  MessageV0,
  ComputeBudgetProgram,
  type Connection,
  type PublicKey,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";

/**
 * Merge multiple base64-encoded transactions into ONE.
 * All transactions must be for the same payer.
 * Uses ALTs to compress account addresses.
 *
 * @param txBase64s - Array of base64-encoded VersionedTransactions
 * @param payerKey - The wallet public key (payer for all)
 * @param connection - Solana RPC connection (for ALT lookups + blockhash)
 * @param altAddresses - Address Lookup Table addresses to use
 * @returns Single merged VersionedTransaction (unsigned)
 */
export async function mergeTransactions(
  txBase64s: string[],
  payerKey: PublicKey,
  connection: Connection,
  altAddresses: PublicKey[] = [],
): Promise<VersionedTransaction> {
  if (txBase64s.length === 0) throw new Error("No transactions to merge");
  if (txBase64s.length === 1) {
    // Single tx — just return it
    const bytes = Uint8Array.from(atob(txBase64s[0]), (c) => c.charCodeAt(0));
    return VersionedTransaction.deserialize(bytes);
  }

  // 1. Fetch ALTs
  const altAccounts: AddressLookupTableAccount[] = [];
  for (const addr of altAddresses) {
    try {
      const alt = await connection.getAddressLookupTable(addr);
      if (alt.value) altAccounts.push(alt.value);
    } catch {}
  }

  // 2. Deserialize and decompile each transaction to get instructions
  const allInstructions: TransactionInstruction[] = [];

  for (const base64 of txBase64s) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const tx = VersionedTransaction.deserialize(bytes);

    // Decompile the message to get instructions
    const message = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: altAccounts,
    });

    for (const ix of message.instructions) {
      // Skip compute budget instructions — we'll add our own
      const progId = ix.programId.toBase58();
      if (progId === ComputeBudgetProgram.programId.toBase58()) continue;
      allInstructions.push(ix);
    }
  }

  // 3. Add compute budget (higher for merged tx)
  const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });
  const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 75_000 });
  const finalInstructions = [cuLimit, cuPrice, ...allInstructions];

  // 4. Compile into one MessageV0 with ALTs
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = MessageV0.compile({
    payerKey,
    recentBlockhash: blockhash,
    instructions: finalInstructions,
    addressLookupTableAccounts: altAccounts,
  });

  return new VersionedTransaction(message);
}
