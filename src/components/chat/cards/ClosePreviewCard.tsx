"use client";

// ============================================
// Flash AI — Close Position Preview Card
// ============================================

import { memo, useState } from "react";
import { useFlashStore } from "@/store";
import { useWallet } from "@solana/wallet-adapter-react";
import { formatPrice, formatUsd, formatPnl } from "@/lib/format";
import { useExecuteTx } from "@/hooks/useExecuteTx";
import { Cell, ToolError, TxDisclaimer, TxSuccessCard } from "./shared";
import { SlippageSelector } from "./SlippageSelector";
import type { ToolOutput } from "./types";

export const ClosePreviewCard = memo(function ClosePreviewCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [receivedUsd, setReceivedUsd] = useState("");
  const [slippageBps, setSlippageBps] = useState(80);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  useWallet(); // ensure wallet context is available

  // Derive values safely before hooks (hooks must be called unconditionally)
  const netPnl = Number(d?.net_pnl ?? 0);
  const isProfit = netPnl >= 0;
  const market = String(d?.market ?? "");
  const side = String(d?.side ?? "");
  const closePercent = Number(d?.close_percent ?? 100);
  const positionKey = String(d?.pubkey ?? "");
  const sizeUsd = Number(d?.size_usd ?? 0);
  const closingSize = sizeUsd * (closePercent / 100);

  const {
    status,
    txSig,
    error: errorMsg,
    execute: handleClose,
    reset,
  } = useExecuteTx({
    buildTx: async () => {
      if (!walletAddress || !positionKey) throw new Error("Missing wallet or position key");

      const { buildClosePositionTx } = await import("@/lib/api");
      const apiResult = await buildClosePositionTx({
        positionKey,
        marketSymbol: market,
        side: side === "LONG" ? "Long" : "Short",
        owner: walletAddress,
        closePercent,
        inputUsdUi: String(closingSize),
        withdrawTokenSymbol: "USDC",
        slippageBps,
      });

      if (apiResult.err) throw new Error(apiResult.err);
      if (!apiResult.transactionBase64) throw new Error("No transaction from API");

      // Stash receivedUsd from API response for success display
      if (apiResult.receiveTokenAmountUsdUi) {
        setReceivedUsd(apiResult.receiveTokenAmountUsdUi);
      }

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
    onSuccess: () => {
      refreshPositions();

      // Record outcome for learning (fire-and-forget)
      try {
        import("@/lib/user-patterns")
          .then(({ recordTradeOutcome }) => {
            const pnlPct = sizeUsd > 0 ? (netPnl / sizeUsd) * 100 : 0;
            // Check if original position had SL by looking at the trade data
            const hadSl = !!(d as Record<string, unknown> | null)?.stop_loss_price;
            recordTradeOutcome(pnlPct, hadSl);
          })
          .catch(() => {});
      } catch {}
    },
  });

  // Early return AFTER hooks (React rules-of-hooks compliance)
  if (!d) return <ToolError toolName="close_position" error="No position data returned" />;

  if (status === "success") {
    return (
      <TxSuccessCard
        label={`Position closed — ${receivedUsd ? `received $${receivedUsd}` : formatPnl(netPnl)}`}
        signature={txSig}
        variant={isProfit ? "long" : "short"}
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

  const accent = isProfit ? "var(--color-accent-long)" : "var(--color-accent-short)";

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-text-primary">
            Close {closePercent < 100 ? `${closePercent}%` : ""} Position
          </span>
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
        <Cell label="Exit Price" value={formatPrice(Number(d.exit_price ?? 0))} />
        <Cell label="PnL" value={formatPnl(Number(d.estimated_pnl ?? 0))} color={accent} />
        <Cell label="Fees" value={formatUsd(Number(d.estimated_fees ?? 0))} />
        <Cell label="Net PnL" value={formatPnl(netPnl)} color={accent} />
      </div>

      {status === "preview" && (
        <div className="px-5 py-2.5 border-t border-border-subtle">
          <SlippageSelector valueBps={slippageBps} onChange={setSlippageBps} />
        </div>
      )}

      <TxDisclaimer />
      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleClose}
          disabled={status !== "preview"}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ color: "#fff", background: "var(--color-accent-short)" }}
        >
          {status === "executing"
            ? "Building tx..."
            : status === "signing"
              ? "Sign in wallet..."
              : status === "confirming"
                ? "Confirming..."
                : `Close ${closePercent < 100 ? closePercent + "%" : "Position"}`}
        </button>
        {status === "preview" && (
          <button
            onClick={() => reset()}
            className="btn-secondary px-6 py-3 text-[13px] text-text-tertiary border-l border-border-subtle cursor-pointer hover:text-text-secondary rounded-none rounded-br-xl"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
});

export default ClosePreviewCard;
