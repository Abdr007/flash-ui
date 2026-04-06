"use client";

// ============================================
// Flash UI — Earn Deposit/Withdraw Modal
// ============================================
// Uses flash-sdk via earn-sdk.ts to build transactions.
// Signs with wallet adapter. Broadcasts via tx-executor.
// Matches CLI behavior exactly.

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction, ComputeBudgetProgram, MessageV0 } from "@solana/web3.js";
import { formatUsd, safe } from "@/lib/format";

interface EarnModalProps {
  mode: "deposit" | "withdraw";
  poolAlias: string;
  poolName: string;
  flpPrice: number;
  onClose: () => void;
  onSuccess: () => void;
}

export default function EarnModal({ mode, poolAlias, poolName, flpPrice, onClose, onSuccess }: EarnModalProps) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"input" | "building" | "signing" | "confirming" | "success" | "error">("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");

  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const numAmount = parseFloat(amount);
  const isValid = Number.isFinite(numAmount) && numAmount > 0 && (mode === "deposit" ? numAmount >= 1 : numAmount >= 1 && numAmount <= 100);

  // Preview (display only — final values from protocol)
  const previewShares = mode === "deposit" && flpPrice > 0 ? numAmount / flpPrice : 0;
  const previewValue = mode === "withdraw" && flpPrice > 0 ? (numAmount / 100) * flpPrice : 0;

  async function handleExecute() {
    if (!isValid || !publicKey || !signTransaction || !connected) return;
    setStatus("building");
    setErrorMsg("");

    try {
      // Dynamic import to keep earn-sdk out of main bundle
      const { buildEarnDeposit, buildEarnWithdraw } = await import("@/lib/earn-sdk");

      // Wallet adapter as Anchor-compatible wallet
      const wallet = {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs: VersionedTransaction[]) => {
          const signed = [];
          for (const tx of txs) signed.push(await signTransaction(tx));
          return signed;
        },
      };

      // Build instructions via Flash SDK (IDENTICAL to CLI)
      const result = mode === "deposit"
        ? await buildEarnDeposit(connection, wallet as never, numAmount, poolAlias)
        : await buildEarnWithdraw(connection, wallet as never, numAmount, poolAlias);

      // Add compute budget (matching CLI: 400k CU limit)
      const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
      const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
      const allIxs = [cuLimit, cuPrice, ...result.instructions];

      // Resolve ALTs from pool config
      const altAddresses = result.poolConfig.addressLookupTableAddresses ?? [];
      const altAccounts = [];
      for (const addr of altAddresses) {
        try {
          const alt = await connection.getAddressLookupTable(addr);
          if (alt.value) altAccounts.push(alt.value);
        } catch {}
      }

      // Build versioned transaction
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const message = MessageV0.compile({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: allIxs,
        addressLookupTableAccounts: altAccounts,
      });
      const transaction = new VersionedTransaction(message);

      // Sign additional signers (ephemeral keypairs from SDK)
      if (result.additionalSigners.length > 0) {
        transaction.sign(result.additionalSigners);
      }

      // Wallet signs
      setStatus("signing");
      const signed = await signTransaction(transaction);

      // Broadcast via existing tx-executor
      setStatus("confirming");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);

      setTxSig(signature);
      setStatus("success");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setErrorMsg(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ animation: "fadeIn 150ms ease-out" }}>
      <div className="absolute inset-0 bg-bg-root/80 backdrop-blur-sm" onClick={status === "input" || status === "error" ? onClose : undefined} />

      <div className="relative w-[420px] glass-card overflow-hidden" style={{ animation: "slideUp 200ms ease-out" }}>
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between border-b border-border-subtle">
          <span className="text-[16px] font-semibold text-text-primary">
            {mode === "deposit" ? "Deposit" : "Withdraw"} — {poolName}
          </span>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary cursor-pointer text-[16px]">✕</button>
        </div>

        {/* Success */}
        {status === "success" && (
          <div className="px-6 py-8 text-center">
            <div className="text-[24px] mb-2" style={{ color: "var(--color-accent-long)" }}>✓</div>
            <div className="text-[16px] font-semibold text-text-primary mb-1">
              {mode === "deposit" ? "Deposited" : "Withdrawn"} successfully
            </div>
            {txSig && (
              <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-accent-blue underline">View on Solscan →</a>
            )}
          </div>
        )}

        {/* Input / Building / Signing / Confirming */}
        {status !== "success" && (
          <>
            <div className="px-6 py-5">
              {/* Amount input */}
              <div className="mb-4">
                <label className="text-[12px] text-text-tertiary mb-2 block">
                  {mode === "deposit" ? "Amount (USDC)" : "Withdraw (%)"}
                </label>
                <input
                  type="number"
                  min={mode === "deposit" ? 1 : 1}
                  max={mode === "withdraw" ? 100 : undefined}
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={mode === "deposit" ? "100" : "50"}
                  disabled={status !== "input" && status !== "error"}
                  className="w-full text-[20px] font-semibold num bg-transparent text-text-primary outline-none border-b-2 pb-2"
                  style={{ borderColor: isValid ? "var(--color-accent-lime)" : "var(--color-border-subtle)" }}
                  autoFocus
                />
              </div>

              {/* Preview */}
              {isValid && (
                <div className="flex items-center justify-between text-[13px] text-text-tertiary">
                  {mode === "deposit" ? (
                    <>
                      <span>≈ {safe(previewShares).toFixed(4)} FLP</span>
                      <span className="text-[11px]">@ ${safe(flpPrice).toFixed(4)}/FLP</span>
                    </>
                  ) : (
                    <span>Withdrawing {numAmount}% of your FLP</span>
                  )}
                </div>
              )}

              {/* Error */}
              {status === "error" && errorMsg && (
                <div className="mt-3 text-[13px] text-accent-short">{errorMsg}</div>
              )}
            </div>

            {/* Action */}
            <div className="flex border-t border-border-subtle">
              <button
                onClick={handleExecute}
                disabled={!isValid || (status !== "input" && status !== "error") || !connected}
                className="btn-primary flex-1 py-4 text-[14px] font-bold tracking-wide
                  cursor-pointer disabled:opacity-25 disabled:cursor-default"
                style={{ color: "#000", background: "var(--color-accent-lime)", borderRadius: "0 0 0 16px" }}
              >
                {status === "building" ? "Building tx..."
                  : status === "signing" ? "Sign in wallet..."
                  : status === "confirming" ? "Confirming..."
                  : status === "error" ? "Retry"
                  : !connected ? "Connect Wallet"
                  : mode === "deposit" ? `Deposit ${formatUsd(numAmount || 0)}`
                  : `Withdraw ${numAmount || 0}%`}
              </button>
              <button
                onClick={onClose}
                disabled={status === "building" || status === "signing" || status === "confirming"}
                className="px-8 py-4 text-[14px] text-text-tertiary hover:text-text-secondary cursor-pointer
                  disabled:opacity-25 disabled:cursor-default"
                style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", borderRadius: "0 0 16px 0" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
