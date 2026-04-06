"use client";

// ============================================
// Flash UI — Earn Deposit/Withdraw Modal (Hardened)
// ============================================
// flash-sdk via earn-sdk.ts → wallet sign → tx-executor.
// Slippage protection: 0.5% default.
// Execution lock: prevents double-submit.

import { useState, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction, ComputeBudgetProgram, MessageV0 } from "@solana/web3.js";
import { formatUsd, safe } from "@/lib/format";

interface EarnModalProps {
  mode: "deposit" | "withdraw";
  poolAlias: string;
  poolName: string;
  flpPrice: number;
  poolApy: number; // 7d APY — used for dynamic slippage
  onClose: () => void;
  onSuccess: () => void;
}

type Status = "input" | "building" | "simulating" | "signing" | "confirming" | "success" | "error";

// ---- Simulation log parser: extracts precise failure reason ----
function parseSimulationError(errJson: string, logs: string[]): string {
  // Join last N logs for pattern matching
  const tail = logs.slice(-5).join(" ");
  const allLogs = logs.join(" ");

  // Balance-specific: extract amounts if present
  const balMatch = allLogs.match(/insufficient.*?(\d[\d,.]*)/i);
  if (balMatch) return `Insufficient balance — need ${balMatch[1]} more`;
  if (tail.includes("insufficient") || tail.includes("Insufficient")) return "Insufficient balance for this transaction";

  // Slippage
  if (tail.includes("SlippageExceeded") || tail.includes("slippage") || tail.includes("Slippage")) {
    const slipMatch = allLogs.match(/expected.*?(\d[\d,.]*?).*?got.*?(\d[\d,.]*)/i);
    if (slipMatch) return `Slippage exceeded — expected ${slipMatch[1]}, got ${slipMatch[2]}. Price moved too fast.`;
    return "Slippage exceeded — pool price moved. Try again or increase tolerance.";
  }

  // Pool capacity
  if (tail.includes("ExceededMaxEntries") || tail.includes("MaxEntriesExceeded")) return "Pool is at maximum capacity";

  // Account errors
  if (tail.includes("AccountNotFound") || tail.includes("account not found")) return "Token account not found — you may need to create an FLP token account first";
  if (tail.includes("OwnerMismatch")) return "Token account ownership error — contact support";

  // Instruction index extraction
  const ixMatch = errJson.match(/InstructionError.*?(\d+)/);
  const ixNum = ixMatch ? ` (instruction #${ixMatch[1]})` : "";

  // Custom program error code
  const codeMatch = errJson.match(/Custom.*?(\d+)/);
  if (codeMatch) {
    const code = parseInt(codeMatch[1]);
    // Common Flash program error codes
    if (code === 6000) return "Invalid pool state" + ixNum;
    if (code === 6001) return "Math overflow in pool calculation" + ixNum;
    if (code === 6006) return "Slippage tolerance exceeded" + ixNum;
    return `Program error ${code}${ixNum}`;
  }

  // Fallback
  if (errJson.length > 100) return `Simulation failed${ixNum}: ${errJson.slice(0, 80)}...`;
  return `Simulation failed${ixNum}: ${errJson}`;
}

// ---- User-friendly error mapping ----
function friendlyError(msg: string): string {
  if (msg.includes("rejected")) return "Transaction rejected by wallet.";
  if (msg.includes("insufficient") || msg.includes("Insufficient")) return "Insufficient balance. Check your USDC.";
  if (msg.includes("No FLP")) return "No FLP tokens found. Deposit first.";
  if (msg.includes("too small") || msg.includes("rounds to zero")) return "Amount too small. Try a larger value.";
  if (msg.includes("slippage") || msg.includes("Slippage")) return "Price moved too much. Try again.";
  if (msg.includes("timeout") || msg.includes("Timeout")) return "Transaction timed out. It may still land — check Solscan.";
  if (msg.includes("blockhash")) return "Network congestion. Try again in a moment.";
  if (msg.length > 120) return msg.slice(0, 120) + "...";
  return msg;
}

// Dynamic slippage: higher APY = more trading activity = wider slippage
function computeSlippage(apy: number): number {
  if (!Number.isFinite(apy) || apy <= 0) return 0.5;
  if (apy > 100) return 2.0;  // Very high APY pools (Ore, etc) — volatile
  if (apy > 50) return 1.5;   // High activity pools
  if (apy > 20) return 0.75;  // Moderate
  return 0.5;                  // Stable pools
}

export default function EarnModal({ mode, poolAlias, poolName, flpPrice, poolApy, onClose, onSuccess }: EarnModalProps) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>("input");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const [receivedInfo, setReceivedInfo] = useState("");
  const [latencyInfo, setLatencyInfo] = useState("");

  // Execution lock — prevents double-submit
  const executingRef = useRef(false);
  const retryCountRef = useRef(0);

  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const numAmount = parseFloat(amount);
  const isValid = Number.isFinite(numAmount) && numAmount > 0 &&
    (mode === "deposit" ? numAmount >= 1 : numAmount >= 1 && numAmount <= 100);

  // Dynamic slippage based on pool volatility
  const slippagePct = computeSlippage(poolApy);

  // Previews (display only — final values from protocol)
  const previewShares = mode === "deposit" && flpPrice > 0 ? numAmount / flpPrice : 0;
  const previewUsdc = mode === "withdraw" && flpPrice > 0 ? numAmount * flpPrice / 100 : 0;
  const minShares = previewShares * (1 - slippagePct / 100);

  const isInFlight = status === "building" || status === "simulating" || status === "signing" || status === "confirming";

  async function handleExecute() {
    // Execution lock
    if (executingRef.current) return;
    if (!isValid || !publicKey || !signTransaction || !connected) return;

    executingRef.current = true;
    setStatus("building");
    setErrorMsg("");
    setLatencyInfo("");

    const t0 = performance.now();
    let tBuild = 0, tSim = 0, tConfirm = 0;

    try {
      const { buildEarnDeposit, buildEarnWithdraw } = await import("@/lib/earn-sdk");

      const wallet = {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs: VersionedTransaction[]) => {
          const signed = [];
          for (const tx of txs) signed.push(await signTransaction(tx));
          return signed;
        },
      };

      // Build instructions via Flash SDK (with slippage protection)
      const result = mode === "deposit"
        ? await buildEarnDeposit(connection, wallet as never, numAmount, poolAlias, flpPrice, slippagePct)
        : await buildEarnWithdraw(connection, wallet as never, numAmount, poolAlias, flpPrice, slippagePct);

      // Compute budget (matching CLI)
      const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
      const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
      const allIxs = [cuLimit, cuPrice, ...result.instructions];

      // Resolve ALTs
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

      tBuild = Math.round(performance.now() - t0);

      // ---- PRE-BROADCAST SIMULATION ----
      setStatus("simulating");
      const tSimStart = performance.now();
      const simResult = await connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      tSim = Math.round(performance.now() - tSimStart);

      if (simResult.value.err) {
        const simErr = JSON.stringify(simResult.value.err);
        const logs = simResult.value.logs ?? [];
        throw new Error(parseSimulationError(simErr, logs));
      }

      // Wallet signs (only after successful simulation)
      setStatus("signing");
      const signed = await signTransaction(transaction);

      // Broadcast via existing tx-executor
      setStatus("confirming");
      const tConfirmStart = performance.now();
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);
      tConfirm = Math.round(performance.now() - tConfirmStart);

      // Build success info
      setTxSig(signature);
      if (mode === "deposit") {
        setReceivedInfo(`≈ ${safe(previewShares).toFixed(4)} FLP received`);
      } else {
        setReceivedInfo(`≈ ${formatUsd(previewUsdc)} USDC received`);
      }
      const totalMs = Math.round(performance.now() - t0);
      setLatencyInfo(`Build ${tBuild}ms · Sim ${tSim}ms · Confirm ${tConfirm}ms · Total ${totalMs}ms`);
      setStatus("success");
      retryCountRef.current = 0;
      onSuccess();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Transaction failed";
      const friendly = friendlyError(raw);

      // ---- SMART RETRY: transient failures get one automatic retry ----
      const isTransient = raw.includes("blockhash") || raw.includes("Blockhash")
        || raw.includes("timeout") || raw.includes("Timeout")
        || raw.includes("socket") || raw.includes("ECONNREFUSED");

      if (isTransient && retryCountRef.current < 1) {
        retryCountRef.current++;
        executingRef.current = false;
        setStatus("input");
        setErrorMsg("");
        // Small delay then auto-retry
        setTimeout(() => handleExecute(), 500);
        return;
      }

      setErrorMsg(friendly);
      setStatus("error");
      retryCountRef.current = 0;
    } finally {
      executingRef.current = false;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ animation: "fadeIn 150ms ease-out" }}>
      <div className="absolute inset-0 bg-bg-root/80 backdrop-blur-sm"
        onClick={!isInFlight ? onClose : undefined} />

      <div className="relative w-[420px] glass-card overflow-hidden" style={{ animation: "slideUp 200ms ease-out" }}>
        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between border-b border-border-subtle">
          <span className="text-[16px] font-semibold text-text-primary">
            {mode === "deposit" ? "Deposit" : "Withdraw"} — {poolName}
          </span>
          {!isInFlight && (
            <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary cursor-pointer text-[16px]">✕</button>
          )}
        </div>

        {/* Success */}
        {status === "success" && (
          <div className="px-6 py-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.12)" }}>
                <span className="text-[18px]" style={{ color: "var(--color-accent-long)" }}>✓</span>
              </div>
              <div>
                <div className="text-[15px] font-semibold text-text-primary">
                  {mode === "deposit" ? "Deposited" : "Withdrawn"} successfully
                </div>
                {receivedInfo && (
                  <div className="text-[13px] text-text-secondary num">{receivedInfo}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1">
              {txSig && (
                <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer"
                  className="text-[12px] text-accent-blue underline">View on Solscan →</a>
              )}
            </div>
            {latencyInfo && (
              <div className="mt-3 text-[10px] num text-text-tertiary">{latencyInfo}</div>
            )}
            <button
              onClick={onClose}
              className="w-full mt-4 py-3 text-[14px] font-medium text-text-primary rounded-xl cursor-pointer"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Done
            </button>
          </div>
        )}

        {/* Input / Building / Signing / Confirming / Error */}
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
                  min={1}
                  max={mode === "withdraw" ? 100 : undefined}
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={mode === "deposit" ? "100" : "50"}
                  disabled={isInFlight}
                  className="w-full text-[20px] font-semibold num bg-transparent text-text-primary outline-none border-b-2 pb-2"
                  style={{ borderColor: isValid ? "var(--color-accent-lime)" : "var(--color-border-subtle)" }}
                  autoFocus
                />
              </div>

              {/* Preview */}
              {isValid && (
                <div className="space-y-1.5 text-[13px]">
                  {mode === "deposit" ? (
                    <>
                      <div className="flex items-center justify-between text-text-tertiary">
                        <span>Expected FLP</span>
                        <span className="num text-text-secondary">≈ {safe(previewShares).toFixed(4)}</span>
                      </div>
                      <div className="flex items-center justify-between text-text-tertiary">
                        <span>Min after slippage ({slippagePct}%)</span>
                        <span className="num">{safe(minShares).toFixed(4)}</span>
                      </div>
                      <div className="flex items-center justify-between text-text-tertiary">
                        <span>FLP Price</span>
                        <span className="num">${safe(flpPrice).toFixed(4)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-text-tertiary">
                        <span>Withdrawing</span>
                        <span className="num text-text-secondary">{numAmount}% of your FLP</span>
                      </div>
                      <div className="flex items-center justify-between text-text-tertiary">
                        <span>Expected USDC</span>
                        <span className="num text-text-secondary">≈ {formatUsd(previewUsdc)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Error */}
              {status === "error" && errorMsg && (
                <div className="mt-4 px-4 py-3 rounded-xl text-[13px]"
                  style={{ color: "var(--color-accent-short)", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)" }}>
                  {errorMsg}
                </div>
              )}

              {/* In-flight indicator */}
              {isInFlight && (
                <div className="mt-4 flex items-center gap-3 text-[13px] text-text-tertiary">
                  <span className="w-3.5 h-3.5 border-2 border-text-tertiary border-t-transparent rounded-full"
                    style={{ animation: "spin 0.8s linear infinite" }} />
                  {status === "building" ? "Building transaction..."
                    : status === "simulating" ? "Simulating — checking for errors..."
                    : status === "signing" ? "Sign in your wallet..."
                    : "Confirming on-chain..."}
                </div>
              )}
            </div>

            {/* Action */}
            <div className="flex border-t border-border-subtle">
              <button
                onClick={handleExecute}
                disabled={!isValid || isInFlight || !connected}
                className="btn-primary flex-1 py-4 text-[14px] font-bold tracking-wide
                  cursor-pointer disabled:opacity-25 disabled:cursor-default"
                style={{ color: "#000", background: "var(--color-accent-lime)", borderRadius: "0 0 0 16px" }}
              >
                {isInFlight ? "Processing..."
                  : status === "error" ? "Retry"
                  : !connected ? "Connect Wallet"
                  : mode === "deposit" ? `Deposit ${formatUsd(numAmount || 0)}`
                  : `Withdraw ${numAmount || 0}%`}
              </button>
              <button
                onClick={onClose}
                disabled={isInFlight}
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
