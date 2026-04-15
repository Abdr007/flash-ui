"use client";

import { memo, useState, useRef, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import type { ToolOutput } from "./types";
import { ToolError, TxDisclaimer, TxSuccessCard } from "./shared";
import { SlippageSelector } from "./SlippageSelector";

export const BurnSflpCard = memo(function BurnSflpCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "success" | "error">("preview");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const lockRef = useRef(false);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { signTransaction, connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const unmountedRef = useRef(false);
  const [slippageBps, setSlippageBps] = useState(75);
  const [selectedPct, setSelectedPct] = useState<number | null>(null);
  const [customPct, setCustomPct] = useState("");
  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );
  const effectivePct = customPct ? Number(customPct) : selectedPct;
  const pctValid = effectivePct != null && effectivePct > 0 && effectivePct <= 100;

  if (!d) return <ToolError toolName="burn_sflp" error={output.error} />;

  const pool = String(d.pool ?? "");
  const poolName = String(d.pool_name ?? pool);
  const sflpSymbol = String(d.sflp_symbol ?? "sFLP");
  const percent = Number(d.percent ?? 100);

  if (status === "success" && txSig) {
    return <TxSuccessCard label={`Burned ${sflpSymbol} → USDC`} signature={txSig} variant="long" />;
  }

  async function handleBurn() {
    if (lockRef.current || !walletAddress || !connected || !signTransaction || !publicKey) return;
    lockRef.current = true;
    setStatus("executing");
    setErrorMsg("");

    try {
      const { buildBurnSflp } = await import("@/lib/earn-sdk");
      const { VersionedTransaction, ComputeBudgetProgram, MessageV0 } = await import("@solana/web3.js");
      const conn = connection;
      const walletObj = {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs: unknown[]) => {
          const signed = [];
          for (const tx of txs) signed.push(await signTransaction(tx as Parameters<typeof signTransaction>[0]));
          return signed;
        },
      };

      const result = await buildBurnSflp(conn, walletObj as never, slippageBps / 100, effectivePct ?? 100, pool);

      const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
      const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 });
      const allIxs = [cuLimit, cuPrice, ...result.instructions];

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

      const signed = await signTransaction(tx);
      const signedB64 = Buffer.from(signed.serialize()).toString("base64");

      const bResp = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: signedB64 }),
      });
      const bJson = await bResp.json();
      if (!bResp.ok || bJson.error) throw new Error(bJson.error ?? "Broadcast failed");

      // Confirm
      let confirmed = false;
      const start = Date.now();
      while (Date.now() - start < 45000) {
        if (unmountedRef.current) break;
        try {
          const { value } = await conn.getSignatureStatuses([bJson.signature]);
          const s = value[0];
          if (s?.err) throw new Error("Transaction failed on-chain");
          if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
            confirmed = true;
            break;
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("failed on-chain")) throw e;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!confirmed) throw new Error("Not confirmed in 45s. Check Solscan.");

      setTxSig(bJson.signature);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Burn failed");
      setStatus("error");
    } finally {
      lockRef.current = false;
    }
  }

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-4">
        <div className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Burn sFLP → USDC</div>
        <div className="text-[16px] font-semibold text-text-primary">{poolName} Pool</div>
        <div className="text-[13px] text-text-secondary mt-1">Burn your {sflpSymbol} tokens to receive USDC</div>
      </div>

      {/* Amount selector */}
      <div className="px-5 pb-4">
        <div className="text-[11px] text-text-tertiary mb-2">How much to burn?</div>
        <div className="flex gap-2">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => {
                setSelectedPct(pct);
                setCustomPct("");
              }}
              className="flex-1 py-2 rounded-lg text-[13px] font-semibold cursor-pointer transition-all duration-150"
              style={{
                background: selectedPct === pct && !customPct ? "var(--color-accent-warn)" : "rgba(255,255,255,0.04)",
                color: selectedPct === pct && !customPct ? "#000" : "var(--color-text-secondary)",
                border:
                  selectedPct === pct && !customPct
                    ? "1px solid var(--color-accent-warn)"
                    : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {pct}%
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min="1"
            max="100"
            placeholder="Custom %"
            value={customPct}
            onChange={(e) => {
              setCustomPct(e.target.value);
              setSelectedPct(null);
            }}
            className="flex-1 py-2 px-3 rounded-lg text-[13px] num bg-transparent text-text-primary outline-none"
            style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
          />
          <span className="text-[12px] text-text-tertiary">%</span>
        </div>
      </div>

      <div className="px-5 pb-2">
        <SlippageSelector valueBps={slippageBps} onChange={setSlippageBps} />
      </div>

      {status === "error" && errorMsg && (
        <div
          className="px-5 py-3"
          style={{ borderTop: "1px solid rgba(255,77,77,0.1)", background: "rgba(255,77,77,0.04)" }}
        >
          <div className="text-[12px] text-accent-short">{errorMsg}</div>
        </div>
      )}

      <TxDisclaimer />
      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleBurn}
          disabled={status === "executing" || !pctValid}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ background: "var(--color-accent-warn)", color: "#000" }}
        >
          {status === "executing"
            ? "Burning..."
            : status === "error"
              ? "Retry"
              : !pctValid
                ? "Select amount"
                : `Burn ${effectivePct}% ${sflpSymbol} for USDC`}
        </button>
      </div>
    </div>
  );
});
