"use client";

import { memo, useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
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
  const unmountedRef = useRef(false);
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
  const description = String(d.description ?? `Convert ${amount} ${flpSymbol} to s${flpSymbol}`);

  if (status === "success" && txSig) {
    return <TxSuccessCard label={`Converted ${flpSymbol} → s${flpSymbol}`} signature={txSig} variant="long" />;
  }

  async function handleConvert() {
    if (lockRef.current || !walletAddress || !connected || !signTransaction || !publicKey) return;
    lockRef.current = true;
    setStatus("executing");
    setErrorMsg("");

    try {
      const { buildFlpToSflp } = await import("@/lib/earn-sdk");
      const { Connection, VersionedTransaction, ComputeBudgetProgram, MessageV0 } = await import("@solana/web3.js");
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

      const result = await buildFlpToSflp(conn, walletObj as never, amount, pool);

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

      // Simulate
      const simResult = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
      if (simResult.value.err) {
        const logs = simResult.value.logs?.slice(-3)?.join(" ") ?? "";
        throw new Error(
          logs.includes("insufficient")
            ? "Insufficient FLP balance"
            : logs.includes("AccountNotFound")
              ? "No FLP token account found"
              : `Simulation failed: ${JSON.stringify(simResult.value.err)}`,
        );
      }

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
      if (!confirmed) throw new Error("Transaction not confirmed in 45s. Check Solscan.");

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

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-4">
        <div className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Convert FLP → sFLP</div>
        <div className="text-[16px] font-semibold text-text-primary">{poolDisplay}</div>
        <div className="text-[13px] text-text-secondary mt-1">{description}</div>
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
          disabled={status === "executing"}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
        >
          {status === "executing" ? "Converting..." : status === "error" ? "Retry" : "Convert to sFLP"}
        </button>
      </div>
    </div>
  );
});
