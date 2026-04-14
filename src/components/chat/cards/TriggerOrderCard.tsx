"use client";

import { memo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import { useExecuteTx } from "@/hooks/useExecuteTx";
import { Cell, ToolError, TxSuccessCard } from "./shared";
import type { ToolOutput } from "./types";
import { formatPrice, formatUsd } from "@/lib/format";

export const TriggerOrderCard = memo(function TriggerOrderCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [cancelled, setCancelled] = useState(false);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  useWallet();

  const orderType = String(d?.order_type ?? "take_profit");
  const market = String(d?.market ?? "");
  const side = String(d?.side ?? "");
  const triggerPrice = Number(d?.trigger_price ?? 0);
  const entryPrice = Number(d?.entry_price ?? 0);
  const sizeUsd = Number(d?.size_usd ?? 0);
  const txBase64 = String(d?.transaction ?? "");

  const isTP = orderType === "take_profit";
  const accent = isTP ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const rawDist = entryPrice > 0 ? (Math.abs(triggerPrice - entryPrice) / entryPrice) * 100 : 0;
  const distance = Number.isFinite(rawDist) ? rawDist : 0;

  const {
    status,
    txSig,
    error: errorMsg,
    execute,
    reset,
  } = useExecuteTx({
    buildTx: async () => {
      if (!txBase64) throw new Error("No transaction data");
      // Clean via server-side
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
    onSuccess: () => {
      refreshPositions();
    },
  });

  if (cancelled) return <div className="text-[13px] text-text-tertiary py-2">Order cancelled.</div>;
  if (!d) return <ToolError toolName="place_trigger_order" error={output.error} />;

  if (status === "success") {
    return (
      <TxSuccessCard
        label={`${isTP ? "Take Profit" : "Stop Loss"} set — ${market}`}
        signature={txSig}
        variant={isTP ? "long" : "short"}
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
          <span className="text-[15px] font-semibold text-text-primary">{isTP ? "Take Profit" : "Stop Loss"}</span>
          <span
            className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
            style={{
              color: side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
              background: side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
            }}
          >
            {side} {market}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Trigger Price" value={formatPrice(triggerPrice)} color={accent} />
        <Cell label="Entry Price" value={formatPrice(entryPrice)} />
        <Cell
          label="Distance"
          value={`${distance.toFixed(1)}%`}
          color={distance < 5 ? "var(--color-accent-warn)" : undefined}
        />
        <Cell label="Position Size" value={formatUsd(sizeUsd)} />
      </div>

      <div className="flex border-t border-border-subtle">
        <button
          onClick={execute}
          disabled={status !== "preview" || !walletAddress}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ color: isTP ? "#000" : "#fff", background: accent }}
        >
          {isLive
            ? status === "executing"
              ? "Building tx..."
              : status === "signing"
                ? "Sign in wallet..."
                : "Confirming..."
            : `Set ${isTP ? "Take Profit" : "Stop Loss"}`}
        </button>
        {status === "preview" && (
          <button
            onClick={() => setCancelled(true)}
            className="btn-secondary px-6 py-3 text-[13px] text-text-tertiary border-l border-border-subtle cursor-pointer hover:text-text-secondary rounded-none rounded-br-xl"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
});

export default TriggerOrderCard;
