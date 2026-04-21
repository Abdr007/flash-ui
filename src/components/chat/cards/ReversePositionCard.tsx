"use client";

// ============================================
// Flash AI — Reverse Position Card
// ============================================

import { memo, useState } from "react";
import { useFlashStore } from "@/store";
import { useWallet } from "@/lib/wallet";
import { formatUsd, formatPnl, formatLeverage } from "@/lib/format";
import { useExecuteTx } from "@/hooks/useExecuteTx";
import { Cell, ToolError, TxDisclaimer, TxSuccessCard } from "./shared";
import { SlippageSelector } from "./SlippageSelector";
import type { ToolOutput } from "./types";

export const ReversePositionCard = memo(function ReversePositionCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [cancelled, setCancelled] = useState(false);
  const [slippageBps, setSlippageBps] = useState(80);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  useWallet(); // ensure wallet context is available

  // Derive values safely before hooks (hooks must be called unconditionally)
  const market = String(d?.market ?? "");
  const currentSide = String(d?.current_side ?? "");
  const newSide = String(d?.new_side ?? "");
  const closePnl = Number(d?.close_pnl ?? 0);
  const totalFees = Number(d?.total_fees ?? 0);
  const newCollateral = Number(d?.new_collateral ?? 0);
  const newSize = Number(d?.new_size ?? 0);
  const newLeverage = Number(d?.new_leverage ?? 0);
  const positionKey = String(d?.pubkey ?? "");

  const {
    status,
    txSig,
    error: errorMsg,
    execute: handleReverse,
  } = useExecuteTx({
    buildTx: async () => {
      if (!walletAddress || !positionKey) throw new Error("Missing wallet or position key");

      const { buildReversePosition } = await import("@/lib/api");
      const apiResult = await buildReversePosition({
        positionKey,
        owner: walletAddress,
        slippagePercentage: (slippageBps / 100).toString(),
      });

      if (apiResult.err) throw new Error(apiResult.err);
      if (!apiResult.transactionBase64) throw new Error("No transaction from API");

      const cleanResp = await fetch("/api/clean-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txBase64: apiResult.transactionBase64, payerKey: walletAddress }),
      });
      if (!cleanResp.ok) throw new Error(`Clean-tx failed: ${cleanResp.status}`);
      const cleanData = await cleanResp.json().catch(() => {
        throw new Error("Invalid clean-tx response");
      });
      if (cleanData.error) throw new Error(cleanData.error);
      if (!cleanData.txBase64) throw new Error("No cleaned transaction returned");

      return cleanData.txBase64;
    },
    onSuccess: () => {
      refreshPositions();
    },
  });

  // Early return AFTER hooks (React rules-of-hooks compliance)
  if (cancelled) return <div className="text-[13px] text-text-tertiary py-2">Position reversal cancelled.</div>;
  if (!d) return <ToolError toolName="reverse_position" error="No position data returned" />;

  if (status === "success") {
    return (
      <TxSuccessCard
        label={`Reversed ${market} — ${currentSide} to ${newSide}`}
        signature={txSig}
        variant={newSide === "LONG" ? "long" : "short"}
      />
    );
  }

  if (status === "error") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{errorMsg}</div>
      </div>
    );
  }

  const isLive = status === "executing" || status === "signing" || status === "confirming";

  return (
    <div className="w-full max-w-[420px] glass-card overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-text-tertiary tracking-wider uppercase">Reverse Position</span>
          {isLive && (
            <span className="text-[11px] text-text-secondary animate-pulse">
              {status === "executing" ? "Building..." : status === "signing" ? "Sign in wallet..." : "Confirming..."}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[13px] font-bold px-2 py-0.5 rounded"
            style={{
              color: currentSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
              background: currentSide === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
            }}
          >
            {currentSide}
          </span>
          <span className="text-text-tertiary">→</span>
          <span
            className="text-[13px] font-bold px-2 py-0.5 rounded"
            style={{
              color: newSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
              background: newSide === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
            }}
          >
            {newSide}
          </span>
          <span className="text-[15px] font-semibold text-text-primary ml-1">{market}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell
          label="Close PnL"
          value={formatPnl(closePnl)}
          color={closePnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)"}
        />
        <Cell label="Total Fees" value={formatUsd(totalFees)} />
        <Cell label="New Collateral" value={formatUsd(newCollateral)} />
        <Cell label="New Size" value={formatUsd(newSize)} />
        <Cell label="Leverage" value={formatLeverage(newLeverage)} />
        <Cell
          label="New Side"
          value={newSide}
          color={newSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)"}
        />
      </div>

      <div className="px-5 pb-2">
        <SlippageSelector valueBps={slippageBps} onChange={setSlippageBps} />
      </div>

      <TxDisclaimer />
      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleReverse}
          disabled={status !== "preview"}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{
            background: newSide === "LONG" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
            color: newSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
          }}
        >
          {isLive ? "Processing..." : `Reverse to ${newSide}`}
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

export default ReversePositionCard;
