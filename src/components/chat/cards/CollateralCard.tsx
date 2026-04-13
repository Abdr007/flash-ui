"use client";

// ============================================
// Flash AI — Collateral Card (Add / Remove)
// ============================================

import { memo, useState } from "react";
import { useFlashStore } from "@/store";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatPrice, formatUsd, safe } from "@/lib/format";
import { useExecuteTx } from "@/hooks/useExecuteTx";
import { Cell, ToolError } from "./shared";
import type { ToolOutput } from "./types";

export const CollateralCard = memo(function CollateralCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [postExecData, setPostExecData] = useState<Record<string, unknown> | null>(null);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  useWallet(); // ensure wallet context is available

  const isAdd = d?.action === "add_collateral";
  const side = String(d?.side ?? "");
  const market = String(d?.market ?? "");
  const isLong = side === "LONG";
  const accent = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const newLevHigher = Number(d?.new_leverage ?? 0) > Number(d?.current_leverage ?? 0);
  const positionKey = String(d?.pubkey ?? "");
  const amountUsd = Number(d?.amount_usd ?? 0);

  const {
    status,
    txSig,
    error: errorMsg,
    execute: handleExecute,
    reset,
  } = useExecuteTx({
    buildTx: async () => {
      if (!walletAddress || !positionKey) throw new Error("Missing wallet or position key");

      const { buildAddCollateral, buildRemoveCollateral } = await import("@/lib/api");
      const apiResult = isAdd
        ? await buildAddCollateral({
            positionKey,
            depositAmountUi: String(amountUsd),
            depositTokenSymbol: "USDC",
            owner: walletAddress,
          })
        : await buildRemoveCollateral({
            positionKey,
            withdrawAmountUsdUi: String(amountUsd),
            withdrawTokenSymbol: "USDC",
            owner: walletAddress,
          });

      if (apiResult.err) throw new Error(apiResult.err);
      if (!apiResult.transactionBase64) throw new Error("No transaction from API");

      // Clean server-side (strip Lighthouse, fix CU to match Flash Trade)
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
    onSuccess: async () => {
      refreshPositions();

      // Fetch real post-execution position data
      try {
        await new Promise((r) => setTimeout(r, 2000)); // wait for chain to update
        // Fallback: use flash API directly
        const posResp = await fetch(
          `https://flashapi.trade/positions/owner/${walletAddress}?includePnlInLeverageDisplay=true`,
        );
        if (posResp.ok) {
          const positions = await posResp.json().catch(() => null);
          const pos = Array.isArray(positions)
            ? positions.find(
                (p: Record<string, unknown>) => p.marketSymbol === market && String(p.sideUi).toUpperCase() === side,
              )
            : null;
          if (pos) {
            setPostExecData({
              collateral: safe(pos.collateralUsdUi),
              leverage: safe(pos.leverageUi),
              liqPrice: safe(pos.liquidationPriceUi),
            });
          }
        }
      } catch {}
    },
  });

  if (!d) return <ToolError toolName="collateral" error="No collateral data returned" />;

  if (status === "success") {
    const realCollateral = postExecData ? Number(postExecData.collateral) : Number(d.new_collateral ?? 0);
    const realLeverage = postExecData ? Number(postExecData.leverage) : Number(d.new_leverage ?? 0);
    const realLiqPrice = postExecData ? Number(postExecData.liqPrice) : Number(d.new_liq_price ?? 0);
    const realMarkPrice = Number(d.mark_price ?? 0);
    const realLiqDist =
      realMarkPrice > 0
        ? side === "LONG"
          ? ((realMarkPrice - realLiqPrice) / realMarkPrice) * 100
          : ((realLiqPrice - realMarkPrice) / realMarkPrice) * 100
        : Number(d.new_liq_distance_pct ?? 0);

    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden success-glow">
        <div
          className="px-5 py-3.5 flex items-center gap-2.5 border-b border-border-subtle"
          style={{ background: "rgba(16,185,129,0.06)" }}
        >
          <span className="text-[14px]" style={{ color: "var(--color-accent-long)" }}>
            ✓
          </span>
          <span className="text-[14px] font-medium" style={{ color: "var(--color-accent-long)" }}>
            Collateral {isAdd ? "added" : "removed"} — {isAdd ? "+" : "-"}${safe(amountUsd).toFixed(2)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Collateral" value={formatUsd(realCollateral)} />
          <Cell
            label="Leverage"
            value={`${safe(realLeverage).toFixed(2)}x`}
            color={realLeverage >= 10 ? "var(--color-accent-warn)" : undefined}
          />
          <Cell label="Liq Price" value={formatPrice(realLiqPrice)} />
          <Cell
            label="Liq Distance"
            value={`${safe(realLiqDist).toFixed(1)}%`}
            color={realLiqDist < 10 ? "var(--color-accent-short)" : undefined}
          />
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
        <button onClick={() => reset()} className="text-[12px] text-accent-blue cursor-pointer">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-text-primary">{isAdd ? "Add" : "Remove"} Collateral</span>
          <span
            className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
            style={{ color: accent, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}
          >
            {side} {market}
          </span>
        </div>
        <span className="text-[14px] font-semibold num text-text-primary">
          {isAdd ? "+" : "-"}${safe(amountUsd).toFixed(2)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell
          label="Collateral"
          value={`${formatUsd(Number(d.current_collateral ?? 0))} → ${formatUsd(Number(d.new_collateral ?? 0))}`}
        />
        <Cell
          label="Leverage"
          value={`${safe(d.current_leverage).toFixed(1)}x → ${safe(d.new_leverage).toFixed(1)}x`}
          color={newLevHigher ? "var(--color-accent-warn)" : "var(--color-accent-long)"}
        />
        <Cell
          label="Liq Price"
          value={`${formatPrice(Number(d.current_liq_price ?? 0))} → ${formatPrice(Number(d.new_liq_price ?? 0))}`}
        />
        <Cell
          label="Liq Distance"
          value={`${safe(d.current_liq_distance_pct).toFixed(1)}% → ${safe(d.new_liq_distance_pct).toFixed(1)}%`}
          color={Number(d.new_liq_distance_pct ?? 0) < 10 ? "var(--color-accent-short)" : undefined}
        />
      </div>

      {output.warnings && output.warnings.length > 0 && (
        <div className="px-5 py-2.5 text-[12px] text-accent-warn border-t border-border-subtle">
          {output.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      {/* Execute button */}
      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleExecute}
          disabled={status !== "preview"}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ color: "#000", background: accent }}
        >
          {status === "executing"
            ? "Building tx..."
            : status === "signing"
              ? "Sign in wallet..."
              : status === "confirming"
                ? "Confirming..."
                : `Confirm ${isAdd ? "Add" : "Remove"}`}
        </button>
      </div>
    </div>
  );
});

export default CollateralCard;
