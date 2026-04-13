"use client";

import { memo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import { formatUsd, safe } from "@/lib/format";
import type { ToolOutput } from "./types";
import { Cell, ToolError } from "./shared";

export const EarnDepositCard = memo(function EarnDepositCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "signing" | "confirming" | "success" | "error">(
    "preview",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { connection } = useConnection();
  const { signTransaction, connected } = useWallet();

  if (!d) return <ToolError toolName="earn_deposit" error="No deposit data returned" />;

  const poolName = String(d.pool_name ?? d.pool ?? "");
  const poolAlias = String(d.pool ?? "");
  const amountUsdc = Number(d.amount_usdc ?? 0);
  const flpPrice = Number(d.flp_price ?? 0);
  const expectedShares = Number(d.expected_shares ?? 0);
  const apy = Number(d.apy ?? 0);

  async function handleDeposit() {
    if (status !== "preview" || !walletAddress || !connected || !signTransaction) return;
    setStatus("executing");

    try {
      const { buildEarnDeposit } = await import("@/lib/earn-sdk");
      const { VersionedTransaction, ComputeBudgetProgram, MessageV0, PublicKey } = await import("@solana/web3.js");

      const pubkey = new PublicKey(walletAddress);
      const walletObj = {
        publicKey: pubkey,
        signTransaction,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signAllTransactions: async (txs: any[]) => {
          const signed = [];
          for (const t of txs) signed.push(await signTransaction(t));
          return signed;
        },
      };

      const result = await buildEarnDeposit(connection, walletObj as never, amountUsdc, poolAlias, flpPrice, 0.75);

      const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
      const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
      const allIxs = [cuLimit, cuPrice, ...result.instructions];

      const altAccounts = [];
      for (const addr of result.poolConfig.addressLookupTableAddresses ?? []) {
        try {
          const alt = await connection.getAddressLookupTable(addr);
          if (alt.value) altAccounts.push(alt.value);
        } catch {}
      }

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const message = MessageV0.compile({
        payerKey: pubkey,
        recentBlockhash: blockhash,
        instructions: allIxs,
        addressLookupTableAccounts: altAccounts,
      });
      const transaction = new VersionedTransaction(message);
      if (result.additionalSigners.length > 0) transaction.sign(result.additionalSigners);

      // Simulate before signing
      const simResult = await connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      if (simResult.value.err) {
        const logs = simResult.value.logs?.slice(-3)?.join(" ") ?? "";
        throw new Error(
          logs.includes("insufficient")
            ? "Insufficient USDC balance"
            : logs.includes("AccountNotFound")
              ? "Token account not initialized — try the Earn page instead"
              : `Simulation failed: ${JSON.stringify(simResult.value.err).slice(0, 80)}`,
        );
      }

      setStatus("signing");
      const signed = await signTransaction(transaction);

      setStatus("confirming");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);

      setTxSig(signature);
      setStatus("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      setErrorMsg(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden success-glow">
        <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ background: "rgba(16,185,129,0.06)" }}>
          <span className="text-[14px]" style={{ color: "var(--color-accent-long)" }}>
            ✓
          </span>
          <span className="text-[14px] font-medium" style={{ color: "var(--color-accent-long)" }}>
            Deposited ${amountUsdc} into {poolName}
          </span>
        </div>
        {txSig && (
          <div className="px-4 py-2 border-t border-border-subtle">
            <a
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-text-secondary hover:text-text-primary underline"
            >
              View on Solscan →
            </a>
          </div>
        )}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{errorMsg}</div>
        <button
          onClick={() => {
            setStatus("preview");
            setErrorMsg("");
          }}
          className="text-[12px] text-accent-blue cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  const isLive = status === "executing" || status === "signing" || status === "confirming";

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full" style={{ background: "var(--color-accent-lime)" }} />
          <span className="text-[18px] font-bold text-text-primary">{poolName}</span>
          <span
            className="text-[12px] font-bold tracking-wider px-3 py-1 rounded-full"
            style={{ color: "var(--color-accent-long)", background: "rgba(16,185,129,0.12)" }}
          >
            DEPOSIT
          </span>
        </div>
        {apy > 0 && (
          <span className="text-[13px] num font-medium" style={{ color: "var(--color-accent-long)" }}>
            {apy.toFixed(1)}% APY
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Amount" value={formatUsd(amountUsdc)} />
        <Cell label="Expected FLP" value={`≈ ${safe(expectedShares).toFixed(4)}`} />
        <Cell label="FLP Price" value={`$${safe(flpPrice).toFixed(4)}`} />
        <Cell label="Slippage" value="0.75%" />
      </div>

      {isLive && (
        <div className="px-5 py-3 flex items-center gap-3 text-[13px] text-text-tertiary">
          <span
            className="w-3.5 h-3.5 border-2 border-text-tertiary border-t-transparent rounded-full"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
          {status === "executing"
            ? "Building transaction..."
            : status === "signing"
              ? "Sign in wallet..."
              : "Confirming..."}
        </div>
      )}

      {status === "preview" && (
        <div className="flex border-t border-border-subtle">
          <button
            onClick={handleDeposit}
            disabled={!connected}
            className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
            style={{ color: "#000", background: "var(--color-accent-lime)" }}
          >
            {connected ? `Deposit $${amountUsdc}` : "Connect Wallet"}
          </button>
        </div>
      )}
    </div>
  );
});

export default EarnDepositCard;
