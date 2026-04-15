"use client";

import { memo, useState, useRef, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import type { ToolOutput } from "./types";
import { ToolError, TxDisclaimer, TxSuccessCard } from "./shared";
import { SlippageSelector } from "./SlippageSelector";

export const MintSflpCard = memo(function MintSflpCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "success" | "error">("preview");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const [slippageBps, setSlippageBps] = useState(75);
  const lockRef = useRef(false);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { signTransaction, connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const unmountedRef = useRef(false);
  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );

  if (!d) return <ToolError toolName="mint_sflp" error={output.error} />;

  const pool = String(d.pool ?? "");
  const poolName = String(d.pool_name ?? pool);
  const sflpSymbol = String(d.sflp_symbol ?? "sFLP");
  const amountUsdc = Number(d.amount_usdc ?? 0);

  if (status === "success" && txSig) {
    return <TxSuccessCard label={`Minted ${sflpSymbol} from $${amountUsdc}`} signature={txSig} variant="long" />;
  }

  async function handleMint() {
    if (lockRef.current || !walletAddress || !connected || !signTransaction || !publicKey) return;
    lockRef.current = true;
    setStatus("executing");
    setErrorMsg("");

    try {
      const { buildEarnDeposit } = await import("@/lib/earn-sdk");
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

      // asSflp = true → uses addLiquidity instead of addCompoundingLiquidity
      const result = await buildEarnDeposit(conn, walletObj as never, amountUsdc, pool, 0, slippageBps / 100, true);

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
      if (!confirmed) throw new Error("Not confirmed in 45s.");

      setTxSig(bJson.signature);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Mint failed");
      setStatus("error");
    } finally {
      lockRef.current = false;
    }
  }

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-4">
        <div className="text-[11px] text-text-tertiary uppercase tracking-wider mb-1">Mint sFLP</div>
        <div className="text-[16px] font-semibold text-text-primary">{poolName} Pool</div>
        <div className="text-[13px] text-text-secondary mt-1">
          Deposit ${amountUsdc.toFixed(2)} USDC → receive {sflpSymbol} tokens in your wallet
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
          onClick={handleMint}
          disabled={status === "executing"}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
        >
          {status === "executing"
            ? "Minting..."
            : status === "error"
              ? "Retry"
              : `Mint ${sflpSymbol} for $${amountUsdc.toFixed(2)}`}
        </button>
      </div>
    </div>
  );
});
