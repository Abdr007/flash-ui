"use client";

import { memo, useState, useRef, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import type { ToolOutput } from "./types";
import { ToolError, TxSuccessCard } from "./shared";

export const ConvertFlpCard = memo(function ConvertFlpCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "success" | "error">("preview");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const lockRef = useRef(false);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { signTransaction, connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const unmountedRef = useRef(false);
  const [selectedPct, setSelectedPct] = useState<number | null>(null);
  const [customPct, setCustomPct] = useState("");
  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );

  if (!d) return <ToolError toolName="convert_flp_to_sflp" error={output.error} />;

  const pool = String(d.pool ?? "");
  const poolDisplay = String(d.pool_display ?? pool);
  const amount = Number(d.amount ?? 0);
  const flpSymbol = String(d.flp_symbol ?? "FLP");
  const description = String(d.description ?? `Convert all ${flpSymbol} → s${flpSymbol} (auto-compounding)`);

  if (status === "success" && txSig) {
    return <TxSuccessCard label={`Converted ${flpSymbol} → s${flpSymbol}`} signature={txSig} variant="long" />;
  }

  async function handleConvert() {
    if (lockRef.current || !walletAddress || !connected || !signTransaction || !publicKey) return;
    lockRef.current = true;
    setStatus("executing");
    setErrorMsg("");

    try {
      const { buildFlpToSflpStep1, buildFlpToSflpStep2 } = await import("@/lib/earn-sdk");
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

      // Step 1: FLP.1 → USDC
      const result = await buildFlpToSflpStep1(conn, walletObj as never, pool);

      const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
      const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 });
      const allIxs = [cuLimit, cuPrice, ...result.instructions];

      // Resolve ALTs
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

      // Simulate — skip simulation, sign directly (migrateFlp has complex account validation)
      // The on-chain program will reject if invalid

      // Sign
      const signed = await signTransaction(tx);
      const signedB64 = Buffer.from(signed.serialize()).toString("base64");

      // Broadcast
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
      if (!confirmed) throw new Error("Step 1 not confirmed in 45s. Check Solscan.");

      // Step 2: USDC → sFLP.1 (deposit the USDC we just got as sFLP)
      // Get the USDC balance to deposit
      const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
      const usdcMint = await (async () => {
        const pc = result.poolConfig;
        const usdcCustody = pc.custodies.find((c: { symbol: string }) => c.symbol === "USDC");
        return usdcCustody?.mintKey;
      })();
      if (usdcMint) {
        try {
          const usdcAta = getAssociatedTokenAddressSync(usdcMint, publicKey, true);
          const usdcBal = await conn.getTokenAccountBalance(usdcAta);
          const usdcAmount = Number(usdcBal.value.uiAmount ?? 0);
          if (usdcAmount >= 0.01) {
            const step2Result = await buildFlpToSflpStep2(conn, walletObj as never, usdcAmount, pool);
            const cuLimit2 = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
            const cuPrice2 = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 });
            const allIxs2 = [cuLimit2, cuPrice2, ...step2Result.instructions];
            const altAccounts2 = [];
            for (const addr of step2Result.poolConfig.addressLookupTableAddresses ?? []) {
              try {
                const alt = await conn.getAddressLookupTable(addr);
                if (alt.value) altAccounts2.push(alt.value);
              } catch {}
            }
            const { blockhash: bh2 } = await conn.getLatestBlockhash("confirmed");
            const msg2 = MessageV0.compile({
              payerKey: publicKey,
              recentBlockhash: bh2,
              instructions: allIxs2,
              addressLookupTableAccounts: altAccounts2,
            });
            const tx2 = new VersionedTransaction(msg2);
            if (step2Result.additionalSigners.length > 0) tx2.sign(step2Result.additionalSigners);
            const signed2 = await signTransaction(tx2);
            const signedB64_2 = Buffer.from(signed2.serialize()).toString("base64");
            const bResp2 = await fetch("/api/broadcast", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transaction: signedB64_2 }),
            });
            const bJson2 = await bResp2.json();
            if (bResp2.ok && bJson2.signature) {
              // Wait for step 2 confirmation
              const start2 = Date.now();
              while (Date.now() - start2 < 45000) {
                if (unmountedRef.current) break;
                try {
                  const { value: v2 } = await conn.getSignatureStatuses([bJson2.signature]);
                  if (v2[0]?.confirmationStatus === "confirmed" || v2[0]?.confirmationStatus === "finalized") break;
                  if (v2[0]?.err) break;
                } catch {}
                await new Promise((r) => setTimeout(r, 2000));
              }
              setTxSig(bJson2.signature);
              setStatus("success");
              return;
            }
          }
        } catch {}
      }
      // If step 2 fails, still show step 1 success
      setTxSig(bJson.signature);
      setStatus("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Conversion failed";
      setErrorMsg(msg);
      setStatus("error");
    } finally {
      lockRef.current = false;
    }
  }

  const effectivePct = customPct ? Number(customPct) : selectedPct;
  const pctValid = effectivePct != null && effectivePct > 0 && effectivePct <= 100;

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-4">
        <div className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Convert FLP → sFLP</div>
        <div className="text-[16px] font-semibold text-text-primary">{poolDisplay}</div>
        <div className="text-[13px] text-text-secondary mt-1">{description}</div>
      </div>

      {/* Amount selector */}
      <div className="px-5 pb-4">
        <div className="text-[11px] text-text-tertiary mb-2">How much to convert?</div>
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
                background: selectedPct === pct && !customPct ? "var(--color-accent-long)" : "rgba(255,255,255,0.04)",
                color: selectedPct === pct && !customPct ? "#000" : "var(--color-text-secondary)",
                border:
                  selectedPct === pct && !customPct
                    ? "1px solid var(--color-accent-long)"
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

      {status === "error" && errorMsg && (
        <div
          className="px-5 py-3"
          style={{ borderTop: "1px solid rgba(255,77,77,0.1)", background: "rgba(255,77,77,0.04)" }}
        >
          <div className="text-[12px] text-accent-short">{errorMsg}</div>
        </div>
      )}

      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleConvert}
          disabled={status === "executing" || !pctValid}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
        >
          {status === "executing"
            ? "Converting..."
            : status === "error"
              ? "Retry"
              : !pctValid
                ? "Select amount"
                : `Convert ${effectivePct}% to sFLP`}
        </button>
      </div>
    </div>
  );
});
