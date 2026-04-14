"use client";

import { memo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import type { ToolOutput } from "./types";
import { ToolError } from "./shared";

// ═══ EARN WITHDRAW PREVIEW ═══
export const EarnWithdrawCard = memo(function EarnWithdrawCard({ output }: { output: ToolOutput }) {
  const data = output.data as Record<string, unknown> | null;

  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { signTransaction, connected, publicKey } = useWallet();
  const [status, setStatus] = useState<"idle" | "executing" | "signing" | "confirming" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  if (!data) return <ToolError toolName="earn_withdraw" error={output.error} />;

  const poolName = String(data.pool_name ?? "");
  const percent = Number(data.percent ?? 100);
  const flpPrice = Number(data.flp_price ?? 0);
  const apy = Number(data.apy ?? 0);

  if (cancelled) return <div className="text-[13px] text-text-tertiary py-2">Withdrawal cancelled.</div>;

  if (status === "success" && txSig) {
    return (
      <div
        className="glass-card-solid overflow-hidden success-glow max-w-[460px]"
        style={{ borderColor: "rgba(0,210,106,0.15)" }}
      >
        <div className="px-5 py-4 flex items-center gap-3">
          <span className="text-[14px]" style={{ color: "var(--color-accent-long)" }}>
            &#10003;
          </span>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">Withdrawn from {poolName}</div>
            <a
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-mono text-accent-blue hover:underline"
            >
              View on Solscan &rarr;
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="glass-card-solid overflow-hidden max-w-[460px]" style={{ borderColor: "rgba(255,77,77,0.15)" }}>
        <div className="px-5 py-4">
          <div className="text-[14px] font-semibold text-accent-short mb-1">Withdrawal Failed</div>
          <div className="text-[12px] text-text-tertiary">{error}</div>
        </div>
        <div className="flex border-t border-border-subtle">
          <button
            onClick={() => {
              setStatus("idle");
              setError(null);
            }}
            className="btn-secondary flex-1 py-2.5 text-[12px] font-semibold text-text-secondary cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status !== "idle") {
    return (
      <div className="glass-card-solid overflow-hidden px-5 py-4 flex items-center gap-3 max-w-[460px]">
        <span
          className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full"
          style={{ animation: "spin 0.8s linear infinite" }}
        />
        <span className="text-[13px] text-text-secondary">
          {status === "executing" ? "Building..." : status === "signing" ? "Sign in wallet..." : "Confirming..."}
        </span>
      </div>
    );
  }

  return (
    <div className="glass-card-solid overflow-hidden w-full max-w-[460px]">
      <div
        className="px-5 py-4 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--color-accent-warn)" }} />
          <span className="text-[16px] font-bold text-text-primary">{poolName}</span>
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: "rgba(245,166,35,0.12)", color: "var(--color-accent-warn)" }}
          >
            WITHDRAW
          </span>
        </div>
        <span
          className="text-[14px] num font-bold"
          style={{ color: apy > 0 ? "var(--color-accent-long)" : "var(--color-text-tertiary)" }}
        >
          {apy}% APY
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <div className="px-5 py-3 bg-bg-card-solid">
          <div className="text-[11px] text-text-tertiary mb-1">Withdraw</div>
          <div className="text-[16px] num font-semibold text-text-primary">{percent}%</div>
        </div>
        <div className="px-5 py-3 bg-bg-card-solid">
          <div className="text-[11px] text-text-tertiary mb-1">FLP Price</div>
          <div className="text-[16px] num font-semibold text-text-primary">${flpPrice.toFixed(4)}</div>
        </div>
        <div className="px-5 py-3 bg-bg-card-solid">
          <div className="text-[11px] text-text-tertiary mb-1">Slippage</div>
          <div className="text-[16px] num font-semibold text-text-primary">0.75%</div>
        </div>
        <div className="px-5 py-3 bg-bg-card-solid">
          <div className="text-[11px] text-text-tertiary mb-1">Receive</div>
          <div className="text-[16px] num font-semibold text-text-primary">USDC</div>
        </div>
      </div>
      <button
        onClick={async () => {
          if (!walletAddress || !connected || !signTransaction || !publicKey) return;
          setStatus("executing");
          try {
            const { buildEarnWithdraw } = await import("@/lib/earn-sdk");
            const { Connection, VersionedTransaction, ComputeBudgetProgram, MessageV0 } =
              await import("@solana/web3.js");
            const conn = new Connection(`${window.location.origin}/api/rpc`, "confirmed");
            const walletObj = {
              publicKey,
              signTransaction,
              signAllTransactions: async (txs: unknown[]) => {
                const signed = [];
                for (const tx of txs) signed.push(await signTransaction(tx as Parameters<typeof signTransaction>[0]));
                return signed;
              },
            };
            const result = await buildEarnWithdraw(
              conn,
              walletObj as never,
              percent,
              String(data.pool),
              flpPrice,
              0.75,
            );

            const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
            const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 });
            const allIxs = [cuLimit, cuPrice, ...result.instructions];

            // Use Address Lookup Tables from pool config (prevents "encoding overruns" error)
            const altAccounts = [];
            for (const addr of result.poolConfig.addressLookupTableAddresses ?? []) {
              try {
                const alt = await conn.getAddressLookupTable(addr);
                if (alt.value) altAccounts.push(alt.value);
              } catch {}
            }

            const { blockhash } = await conn.getLatestBlockhash("confirmed");
            const message = MessageV0.compile({
              payerKey: publicKey,
              recentBlockhash: blockhash,
              instructions: allIxs,
              addressLookupTableAccounts: altAccounts,
            });
            const tx = new VersionedTransaction(message);
            if (result.additionalSigners.length > 0) tx.sign(result.additionalSigners);

            // Simulate before signing
            const simResult = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
            if (simResult.value.err) {
              const logs = simResult.value.logs?.slice(-3)?.join(" ") ?? "";
              throw new Error(
                logs.includes("insufficient")
                  ? "Insufficient FLP balance"
                  : logs.includes("AccountNotFound")
                    ? "No FLP tokens found — deposit first"
                    : `Simulation failed: ${JSON.stringify(simResult.value.err).slice(0, 80)}`,
              );
            }

            setStatus("signing");
            const signed = await signTransaction(tx);
            const signedB64 = Buffer.from(signed.serialize()).toString("base64");
            const bResp = await fetch("/api/broadcast", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transaction: signedB64 }),
            });
            const bJson = await bResp.json().catch(() => null);
            if (!bResp.ok || !bJson?.signature) throw new Error("Broadcast failed");
            setTxSig(bJson.signature);
            setStatus("confirming");
            let confirmed = false;
            const startT = Date.now();
            while (Date.now() - startT < 45000) {
              try {
                const { value } = await conn.getSignatureStatuses([bJson.signature]);
                const s = value[0];
                if (s?.err) throw new Error("Failed on-chain");
                if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
                  confirmed = true;
                  break;
                }
              } catch (e) {
                if (e instanceof Error && e.message.includes("on-chain")) throw e;
              }
              await new Promise((r) => setTimeout(r, 2000));
            }
            if (!confirmed) throw new Error("Not confirmed in 45s");
            setStatus("success");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Withdraw failed");
            setStatus("error");
          }
        }}
        disabled={!walletAddress || !connected}
        className="w-full py-3.5 text-[14px] font-bold cursor-pointer transition-all disabled:opacity-30"
        style={{ background: "var(--color-accent-warn)", color: "#0a0a0a" }}
      >
        Withdraw {percent}%
      </button>
      <button
        onClick={() => setCancelled(true)}
        className="w-full py-2.5 text-[12px] font-semibold text-text-tertiary cursor-pointer hover:text-text-secondary transition-colors"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        Cancel
      </button>
    </div>
  );
});

export default EarnWithdrawCard;
