"use client";

import { memo } from "react";
import { useFlashStore } from "@/store";
import { useExecuteTx } from "@/hooks/useExecuteTx";
import { ToolError, TxSuccessCard } from "./shared";
import type { ToolOutput } from "./types";
import { formatPrice } from "@/lib/format";

export const OrderActionCard = memo(function OrderActionCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const walletAddress = useFlashStore((s) => s.walletAddress);

  const action = String(d?.action ?? d?.type ?? "cancel");
  const market = String(d?.market ?? "");
  const side = String(d?.side ?? "");
  const txBase64 = String(d?.transaction ?? "");
  const label = String(d?.label ?? `${action} order`);
  const isCancel = action.includes("cancel");

  const {
    status,
    txSig,
    error: errorMsg,
    execute,
    reset,
  } = useExecuteTx({
    buildTx: async () => {
      if (!txBase64) throw new Error("No transaction data");
      const cleanResp = await fetch("/api/clean-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txBase64, payerKey: walletAddress }),
      });
      if (!cleanResp.ok) throw new Error(`Clean-tx failed: ${cleanResp.status}`);
      const cleanData = await cleanResp.json().catch(() => {
        throw new Error("Invalid clean-tx response");
      });
      if (cleanData.error) throw new Error(cleanData.error);
      return cleanData.txBase64 || txBase64;
    },
    onSuccess: () => {},
  });

  if (!d) return <ToolError toolName="order_action" error={output.error} />;

  if (status === "success") {
    return (
      <TxSuccessCard
        label={isCancel ? `Order cancelled — ${market} ${side}` : label}
        signature={txSig}
        variant={isCancel ? "short" : "long"}
      />
    );
  }

  if (status === "error") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{errorMsg}</div>
        <button onClick={() => reset()} className="text-[12px] text-accent-blue cursor-pointer">
          Try again
        </button>
      </div>
    );
  }

  const isLive = status === "executing" || status === "signing" || status === "confirming";

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-text-primary">
            {isCancel ? "Cancel Order" : "Update Order"}
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

      {Number(d.price) > 0 && (
        <div className="px-5 py-3 text-[13px] text-text-secondary">
          {isCancel ? "Cancelling" : "Updating"} limit order @ {formatPrice(Number(d.price))}
        </div>
      )}

      <div className="flex border-t border-border-subtle">
        <button
          onClick={execute}
          disabled={status !== "preview" || !walletAddress}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{
            color: isCancel ? "#fff" : "#000",
            background: isCancel ? "var(--color-accent-short)" : "var(--color-accent-lime)",
          }}
        >
          {isLive
            ? status === "executing"
              ? "Building tx..."
              : status === "signing"
                ? "Sign in wallet..."
                : "Confirming..."
            : isCancel
              ? "Confirm Cancel"
              : "Confirm Update"}
        </button>
      </div>
    </div>
  );
});

export default OrderActionCard;
