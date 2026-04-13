"use client";

import { memo, useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import { ToolError, TxSuccessCard } from "./shared";
import type { ToolOutput } from "./types";
import { formatPrice } from "@/lib/format";

export const OrderActionCard = memo(function OrderActionCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { signTransaction } = useWallet();
  const { connection } = useConnection();

  const action = String(d?.action ?? d?.type ?? "cancel");
  const market = String(d?.market ?? "");
  const side = String(d?.side ?? "");
  const cancelTx = String(d?.transaction ?? d?.cancel_transaction ?? "");
  const newOrderTx = d?.new_order_transaction ? String(d.new_order_transaction) : null;
  const isEdit = action.includes("edit") || !!newOrderTx;
  const isCancel = !isEdit;
  const oldPrice = Number(d?.old_price ?? d?.price ?? 0);
  const newPrice = Number(d?.new_limit_price ?? 0);

  const [step, setStep] = useState<"preview" | "cancelling" | "placing" | "success" | "error">("preview");
  const [txSig, setTxSig] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handleExecute = useCallback(async () => {
    if (step !== "preview" || !walletAddress || !signTransaction) return;

    try {
      const { VersionedTransaction } = await import("@solana/web3.js");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");

      // Step 1: Sign and broadcast the cancel transaction
      setStep("cancelling");
      const cancelBytes = Uint8Array.from(atob(cancelTx), (c) => c.charCodeAt(0));
      const cancelTransaction = VersionedTransaction.deserialize(cancelBytes);
      const signedCancel = await signTransaction(cancelTransaction);
      const cancelB64 = Buffer.from(signedCancel.serialize()).toString("base64");
      await executeSignedTransaction(cancelB64, connection);

      // Step 2: If this is an edit, sign and broadcast the new order
      if (isEdit && newOrderTx) {
        setStep("placing");
        const newBytes = Uint8Array.from(atob(newOrderTx), (c) => c.charCodeAt(0));
        const newTransaction = VersionedTransaction.deserialize(newBytes);
        const signedNew = await signTransaction(newTransaction);
        const newB64 = Buffer.from(signedNew.serialize()).toString("base64");
        const sig = await executeSignedTransaction(newB64, connection);
        setTxSig(sig);
      }

      setStep("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      setErrorMsg(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStep("error");
    }
  }, [step, walletAddress, signTransaction, cancelTx, newOrderTx, isEdit, connection]);

  if (!d) return <ToolError toolName="order_action" error={output.error} />;

  if (step === "success") {
    const label = isEdit
      ? `Order updated — ${market} ${side} @ ${formatPrice(newPrice)}`
      : `Order cancelled — ${market} ${side}`;
    return <TxSuccessCard label={label} signature={txSig || null} variant={isEdit ? "long" : "short"} />;
  }

  if (step === "error") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{errorMsg}</div>
        <button
          onClick={() => {
            setStep("preview");
            setErrorMsg("");
          }}
          className="text-[12px] text-accent-blue cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-text-primary">
            {isEdit ? "Edit Limit Order" : "Cancel Order"}
          </span>
          {market && (
            <span
              className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
              style={{
                color: side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                background: side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
              }}
            >
              {side} {market}
            </span>
          )}
        </div>
      </div>

      {isEdit && oldPrice > 0 && newPrice > 0 ? (
        <div className="px-5 py-3 text-[13px]">
          <span className="text-text-tertiary">Limit price: </span>
          <span className="text-text-secondary num">{formatPrice(oldPrice)}</span>
          <span className="text-text-tertiary"> → </span>
          <span className="text-text-primary num font-semibold">{formatPrice(newPrice)}</span>
        </div>
      ) : oldPrice > 0 ? (
        <div className="px-5 py-3 text-[13px] text-text-secondary">
          Cancelling limit order @ {formatPrice(oldPrice)}
        </div>
      ) : null}

      {isEdit && (
        <div className="px-5 py-2 text-[10px] text-text-tertiary border-t border-border-subtle">
          Two signatures required: cancel old order + place new order
        </div>
      )}

      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleExecute}
          disabled={step !== "preview" || !walletAddress}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{
            color: isCancel ? "#fff" : "#000",
            background: isCancel ? "var(--color-accent-short)" : "var(--color-accent-lime)",
          }}
        >
          {step === "cancelling"
            ? "Cancelling old order..."
            : step === "placing"
              ? "Placing new order..."
              : isEdit
                ? "Confirm Edit (2 signatures)"
                : "Confirm Cancel"}
        </button>
      </div>
    </div>
  );
});

export default OrderActionCard;
