"use client";

// ============================================
// Flash AI — Tool Result Card (Galileo-Style)
// ============================================

import { memo, useState, useEffect, useMemo, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { validateTrade } from "@/lib/trade-firewall";
import { getTradeConfidence, type TradeConfidence } from "@/lib/predictive-actions";
import { useFlashStore } from "@/store";
import { useNumberSpring, useBounceIn } from "@/hooks/useSpring";
import {
  formatPrice, formatUsd, formatLeverage, formatPnl, formatPnlPct, formatPercent, liqDistancePct,
} from "@/lib/format";
import { HIGH_LEVERAGE_THRESHOLD, MARKETS } from "@/lib/constants";

// ---- Types ----

interface ToolPart {
  type: string;
  toolName: string;
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available";
  input?: Record<string, unknown>;
  output?: ToolOutput;
}

interface ToolOutput {
  status: "success" | "error" | "degraded";
  data: unknown;
  error?: string;
  request_id?: string;
  latency_ms?: number;
  warnings?: string[];
}

// ---- Main ----

const ToolResultCard = memo(function ToolResultCard({ part }: { part: ToolPart }) {
  const output = part.output;

  if (part.state === "input-streaming") return <StreamingSteps toolName={part.toolName} step={1} input={part.input} />;
  if (part.state === "input-available") return <StreamingSteps toolName={part.toolName} step={2} input={part.input} />;
  if (!output) return null;
  if (output.status === "error" && !output.data) return <ToolError toolName={part.toolName} error={output.error} />;

  switch (part.toolName) {
    case "build_trade": return <TradePreviewCard output={output} />;
    case "close_position_preview": return <ClosePreviewCard output={output} />;
    case "get_positions": return <PositionsCard output={output} />;
    case "get_portfolio": return <PortfolioCard output={output} />;
    case "get_price":
    case "get_all_prices": return <PriceCard toolName={part.toolName} output={output} />;
    case "get_market_info": return <MarketInfoCard output={output} />;
    case "add_collateral":
    case "remove_collateral": return <CollateralCard output={output} />;
    default: return <GenericCard toolName={part.toolName} output={output} />;
  }
});

export default ToolResultCard;

// ---- Streaming Steps ----

const TOOL_STEPS: Record<string, string[]> = {
  build_trade: ["Fetching price", "Calculating position", "Validating trade"],
  close_position_preview: ["Loading position", "Fetching exit price", "Calculating PnL"],
  add_collateral: ["Loading position", "Calculating new leverage"],
  remove_collateral: ["Loading position", "Validating removal", "Calculating new leverage"],
  get_positions: ["Querying positions"],
  get_portfolio: ["Loading portfolio"],
  get_price: ["Fetching price"],
  get_all_prices: ["Loading markets"],
  get_market_info: ["Loading market info"],
};

const StreamingSteps = memo(function StreamingSteps({ toolName, step, input }: { toolName: string; step: 1 | 2; input?: Record<string, unknown> }) {
  const steps = TOOL_STEPS[toolName] ?? ["Processing"];
  const market = input?.market ? ` ${input.market}` : "";

  return (
    <div className="w-full max-w-[420px] glass-card anticipate-in overflow-hidden">
      <div className="px-4 py-3 flex flex-col gap-2">
        {steps.map((label, i) => {
          const isDone = i < step;
          const isCurrent = i === step - 1;
          return (
            <div key={i} className="flex items-center gap-2.5 text-[13px]">
              {isDone ? (
                <span className="text-accent-long w-4 text-center font-medium">✓</span>
              ) : isCurrent ? (
                <span className="w-2 h-2 rounded-full bg-accent-blue ml-1" style={{ animation: "pulseDot 1s infinite" }} />
              ) : (
                <span className="w-4 text-center text-text-tertiary">·</span>
              )}
              <span className={isDone ? "text-text-secondary" : isCurrent ? "text-text-primary" : "text-text-tertiary"}>
                {label}{i === 0 ? market : ""}
              </span>
            </div>
          );
        })}
      </div>
      {toolName === "build_trade" && (
        <div className="border-t border-border-subtle px-4 py-3">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="skel h-5 w-24" />
            <div className="skel h-5 w-28" />
            <div className="skel h-5 w-20" />
            <div className="skel h-5 w-16" />
          </div>
        </div>
      )}
    </div>
  );
});

// ---- Trade Preview Card ----

const TradePreviewCard = memo(function TradePreviewCard({ output }: { output: ToolOutput }) {
  const [submitting, setSubmitting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const positions = useFlashStore((s) => s.positions);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const setTradeFromAI = useFlashStore((s) => s.setTradeFromAI);
  const confirmTrade = useFlashStore((s) => s.confirmTrade);
  const cancelTrade = useFlashStore((s) => s.cancelTrade);
  const isExecuting = useFlashStore((s) => s.isExecuting);
  const activeTrade = useFlashStore((s) => s.activeTrade);

  // Reset submitting when trade completes or is cancelled
  const tradeStatus = activeTrade?.status;
  const tradeCompleted = submitting && !isExecuting && tradeStatus !== "CONFIRMING" && tradeStatus !== "EXECUTING" && tradeStatus !== "SIGNING";

  if (cancelled) return <div className="text-[13px] text-text-tertiary py-2">Trade cancelled.</div>;

  // Trade was submitted and completed successfully
  if (tradeCompleted && (tradeStatus === "SUCCESS" || !activeTrade)) {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden success-glow">
        <div className="px-5 py-3.5 flex items-center gap-2.5"
          style={{ background: "rgba(16,185,129,0.06)" }}>
          <span className="text-[14px]" style={{ color: "var(--color-accent-long)" }}>✓</span>
          <span className="text-[14px] font-medium" style={{ color: "var(--color-accent-long)" }}>Trade executed</span>
          {activeTrade?.tx_signature && (
            <span className="text-[12px] text-text-tertiary ml-auto num">
              {activeTrade.tx_signature.slice(0, 8)}..
            </span>
          )}
        </div>
      </div>
    );
  }

  // Trade errored
  if (tradeCompleted && tradeStatus === "ERROR") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{activeTrade?.error ?? "Trade failed"}</div>
        <button onClick={() => setSubmitting(false)} className="text-[12px] text-accent-blue cursor-pointer">Try again</button>
      </div>
    );
  }

  const firewall = validateTrade(output.data, walletAddress ?? "", positions);
  if (!firewall.valid) return <ToolError toolName="build_trade" error={`Trade blocked: ${firewall.errors.join("; ")}`} />;

  const t = firewall.trade;
  const isLong = t.side === "LONG";
  const accent = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const liqDist = liqDistancePct(t.entry_price, t.liquidation_price, t.side);
  const highLev = t.leverage >= HIGH_LEVERAGE_THRESHOLD;

  const springLiqDist = useNumberSpring(liqDist);
  const bounceStyle = useBounceIn();

  const confidence = useMemo(() => getTradeConfidence({
    leverage: t.leverage, collateral_usd: t.collateral_usd, position_size: t.position_size,
    fees: t.fees, entry_price: t.entry_price, liquidation_price: t.liquidation_price, side: t.side,
  }), [t.leverage, t.collateral_usd, t.position_size, t.fees, t.entry_price, t.liquidation_price, t.side]);

  function handleConfirm() {
    if (submitting || isExecuting) return;
    setSubmitting(true);
    const ok = setTradeFromAI(output.data, walletAddress ?? "", positions);
    if (!ok) { setSubmitting(false); return; }
    confirmTrade();
  }

  return (
    <div
      className={`w-full max-w-[460px] glass-card overflow-hidden ${submitting ? "success-glow" : ""}`}
      style={{ ...bounceStyle }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full" style={{ background: accent }} />
          <span className="text-[15px] font-semibold text-text-primary tracking-tight">{t.market}-PERP</span>
          <span className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
            style={{ color: accent, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
            {t.side}
          </span>
        </div>
        <ConfidenceBadge confidence={confidence} />
      </div>

      {/* Primary prices */}
      <div className="grid grid-cols-2 border-b border-border-subtle">
        <div className="px-5 py-4">
          <div className="text-[11px] text-text-tertiary mb-1">Entry</div>
          <div className="text-[20px] font-semibold num text-text-primary leading-none">{formatPrice(t.entry_price)}</div>
        </div>
        <div className="px-5 py-4 border-l border-border-subtle">
          <div className="text-[11px] text-text-tertiary mb-1">Liquidation</div>
          <div className="text-[20px] font-semibold num leading-none" style={{ color: "var(--color-accent-warn)" }}>{formatPrice(t.liquidation_price)}</div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Size" value={formatUsd(t.position_size)} />
        <Cell label="Leverage" value={formatLeverage(t.leverage)} color={highLev ? "var(--color-accent-warn)" : undefined} />
        <Cell label="Collateral" value={formatUsd(t.collateral_usd)} />
        <Cell label="Fees" value={t.fee_rate != null ? `${formatUsd(t.fees)} (${formatPercent(t.fee_rate)})` : formatUsd(t.fees)} />
      </div>

      {/* Risk bar */}
      {liqDist > 0 && (
        <div className="px-5 py-3 border-t border-border-subtle">
          <div className="flex justify-between text-[12px] mb-2">
            <span className="text-text-tertiary">Liquidation distance</span>
            <span className="num font-medium" style={{ color: liqDist < 10 ? "var(--color-accent-short)" : liqDist < 20 ? "var(--color-accent-warn)" : "var(--color-accent-long)" }}>
              {liqDist.toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-border-subtle rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{
              width: `${Math.min(springLiqDist, 100)}%`,
              background: liqDist < 10 ? "var(--color-accent-short)" : liqDist < 20 ? "var(--color-accent-warn)" : "var(--color-accent-long)",
              transition: "background-color 300ms ease-out",
            }} />
          </div>
        </div>
      )}

      {/* Warnings */}
      {output.warnings && output.warnings.length > 0 && (
        <div className="px-5 py-2.5 text-[12px] text-accent-warn border-t border-border-subtle">
          {output.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* Degraded */}
      {output.status === "degraded" && (
        <div className="px-5 py-2 text-[12px] text-accent-warn border-t border-border-subtle">Price data may be slightly stale</div>
      )}

      {/* Confidence factors */}
      {confidence.level !== "high" && confidence.factors.length > 0 && (
        <div className="px-5 py-2.5 border-t border-border-subtle">
          {confidence.factors.map((f, i) => <div key={i} className="text-[12px] text-text-tertiary leading-relaxed">· {f}</div>)}
        </div>
      )}

      {/* Actions */}
      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleConfirm}
          disabled={submitting || isExecuting}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ color: "#000", background: accent }}
        >
          {submitting ? "Submitting..." : "Confirm Trade"}
        </button>
        <button
          onClick={() => { cancelTrade(); setCancelled(true); }}
          className="btn-secondary px-6 py-3 text-[13px] text-text-tertiary border-l border-border-subtle cursor-pointer hover:text-text-secondary rounded-none rounded-br-xl"
        >
          Cancel
        </button>
      </div>
    </div>
  );
});

// ---- Other Cards ----

const CollateralCard = memo(function CollateralCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "signing" | "confirming" | "success" | "error">("preview");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const [postExecData, setPostExecData] = useState<Record<string, unknown> | null>(null);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  const { connection } = useConnection();
  const { signTransaction, connected } = useWallet();

  if (!d) return null;

  const isAdd = d.action === "add_collateral";
  const side = String(d.side ?? "");
  const market = String(d.market ?? "");
  const isLong = side === "LONG";
  const accent = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const newLevHigher = Number(d.new_leverage ?? 0) > Number(d.current_leverage ?? 0);
  const positionKey = String(d.pubkey ?? "");
  const amountUsd = Number(d.amount_usd ?? 0);
  const tokenAmount = Number(d.token_amount ?? 0);
  const collateralToken = "USDC";

  async function handleExecute() {
    if (status !== "preview" || !walletAddress || !positionKey || !connected || !signTransaction) return;
    setStatus("executing");

    try {
      // Single API call with USDC (matching Flash Trade website exactly)
      const { buildAddCollateral, buildRemoveCollateral } = await import("@/lib/api");
      const apiResult = isAdd
        ? await buildAddCollateral({ positionKey, depositAmountUi: String(amountUsd), depositTokenSymbol: "USDC", owner: walletAddress })
        : await buildRemoveCollateral({ positionKey, withdrawAmountUsdUi: String(amountUsd), withdrawTokenSymbol: "USDC", owner: walletAddress });

      if (apiResult.err) throw new Error(apiResult.err);
      if (!apiResult.transactionBase64) throw new Error("No transaction from API");

      // Clean server-side (strip Lighthouse, fix CU to match Flash Trade)
      const cleanResp = await fetch("/api/clean-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txBase64: apiResult.transactionBase64, payerKey: walletAddress }),
      });
      const cleanData = await cleanResp.json();
      if (cleanData.error) throw new Error(cleanData.error);

      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(cleanData.txBase64), (c) => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(txBytes);

      // Sign with signTransaction (NOT signAndSendTransaction) — dApp submits
      // This prevents wallet from injecting Lighthouse assertions
      setStatus("signing");
      const signed = await signTransaction(transaction);

      // dApp submits directly via RPC — wallet never touches submission
      setStatus("confirming");
      const rawTxBytes = signed.serialize();
      const signature = await connection.sendRawTransaction(rawTxBytes, {
        skipPreflight: true,
        maxRetries: 5,
      });

      // Resend for better landing rate
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try { await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true }); } catch {}
      }

      // Poll for confirmation
      let confirmed = false;
      const start = Date.now();
      while (Date.now() - start < 60_000) {
        const { value } = await connection.getSignatureStatuses([signature]);
        const s = value[0];
        if (s?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(s.err)}`);
        if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
          confirmed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }

      if (!confirmed) {
        throw new Error("Transaction sent but not confirmed within 60s. Check your wallet for the result.");
      }

      setTxSig(signature);
      refreshPositions();

      // Fetch real post-execution position data
      try {
        await new Promise((r) => setTimeout(r, 2000)); // wait for chain to update
        const resp = await fetch(`${window.location.origin}/api/rpc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "getPositions", wallet: walletAddress }),
        });
        // Fallback: use flash API directly
        const posResp = await fetch(
          `https://flashapi.trade/positions/owner/${walletAddress}?includePnlInLeverageDisplay=true`
        );
        if (posResp.ok) {
          const positions = await posResp.json();
          const pos = Array.isArray(positions)
            ? positions.find((p: Record<string, unknown>) => p.marketSymbol === market && String(p.sideUi).toUpperCase() === side)
            : null;
          if (pos) {
            setPostExecData({
              collateral: parseFloat(String(pos.collateralUsdUi ?? 0)),
              leverage: parseFloat(String(pos.leverageUi ?? 0)),
              liqPrice: parseFloat(String(pos.liquidationPriceUi ?? 0)),
            });
          }
        }
      } catch {}

      setStatus("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      setErrorMsg(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStatus("error");
    }
  }

  if (status === "success") {
    const realCollateral = postExecData ? Number(postExecData.collateral) : Number(d.new_collateral ?? 0);
    const realLeverage = postExecData ? Number(postExecData.leverage) : Number(d.new_leverage ?? 0);
    const realLiqPrice = postExecData ? Number(postExecData.liqPrice) : Number(d.new_liq_price ?? 0);
    const realMarkPrice = Number(d.mark_price ?? 0);
    const realLiqDist = realMarkPrice > 0
      ? (side === "LONG"
        ? ((realMarkPrice - realLiqPrice) / realMarkPrice) * 100
        : ((realLiqPrice - realMarkPrice) / realMarkPrice) * 100)
      : Number(d.new_liq_distance_pct ?? 0);

    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden success-glow">
        <div className="px-5 py-3.5 flex items-center gap-2.5 border-b border-border-subtle" style={{ background: "rgba(16,185,129,0.06)" }}>
          <span className="text-[14px]" style={{ color: "var(--color-accent-long)" }}>✓</span>
          <span className="text-[14px] font-medium" style={{ color: "var(--color-accent-long)" }}>
            Collateral {isAdd ? "added" : "removed"} — {isAdd ? "+" : "-"}${amountUsd.toFixed(2)}
          </span>
          {txSig && <span className="text-[12px] text-text-tertiary ml-auto num">{txSig.slice(0, 8)}..</span>}
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Collateral" value={formatUsd(realCollateral)} />
          <Cell label="Leverage" value={`${realLeverage.toFixed(2)}x`}
            color={realLeverage >= 10 ? "var(--color-accent-warn)" : undefined} />
          <Cell label="Liq Price" value={formatPrice(realLiqPrice)} />
          <Cell label="Liq Distance" value={`${realLiqDist.toFixed(1)}%`}
            color={realLiqDist < 10 ? "var(--color-accent-short)" : undefined} />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{errorMsg}</div>
        <button onClick={() => { setStatus("preview"); setErrorMsg(""); }} className="text-[12px] text-accent-blue cursor-pointer">Try again</button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-text-primary">
            {isAdd ? "Add" : "Remove"} Collateral
          </span>
          <span className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
            style={{ color: accent, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
            {side} {market}
          </span>
        </div>
        <span className="text-[14px] font-semibold num text-text-primary">
          {isAdd ? "+" : "-"}${amountUsd.toFixed(2)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Collateral" value={`${formatUsd(Number(d.current_collateral ?? 0))} → ${formatUsd(Number(d.new_collateral ?? 0))}`} />
        <Cell
          label="Leverage"
          value={`${Number(d.current_leverage ?? 0).toFixed(1)}x → ${Number(d.new_leverage ?? 0).toFixed(1)}x`}
          color={newLevHigher ? "var(--color-accent-warn)" : "var(--color-accent-long)"}
        />
        <Cell label="Liq Price" value={`${formatPrice(Number(d.current_liq_price ?? 0))} → ${formatPrice(Number(d.new_liq_price ?? 0))}`} />
        <Cell
          label="Liq Distance"
          value={`${Number(d.current_liq_distance_pct ?? 0).toFixed(1)}% → ${Number(d.new_liq_distance_pct ?? 0).toFixed(1)}%`}
          color={Number(d.new_liq_distance_pct ?? 0) < 10 ? "var(--color-accent-short)" : undefined}
        />
      </div>

      {output.warnings && output.warnings.length > 0 && (
        <div className="px-5 py-2.5 text-[12px] text-accent-warn border-t border-border-subtle">
          {output.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
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
          {status === "executing" ? "Building tx..." : status === "signing" ? "Sign in wallet..." : status === "confirming" ? "Confirming..." : `Confirm ${isAdd ? "Add" : "Remove"}`}
        </button>
      </div>
    </div>
  );
});

const ClosePreviewCard = memo(function ClosePreviewCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "signing" | "confirming" | "success" | "error">("preview");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const [receivedUsd, setReceivedUsd] = useState("");
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  const { connection } = useConnection();
  const { signTransaction, connected } = useWallet();

  if (!d) return null;
  const netPnl = Number(d.net_pnl ?? 0);
  const isProfit = netPnl >= 0;
  const market = String(d.market ?? "");
  const side = String(d.side ?? "");
  const closePercent = Number(d.close_percent ?? 100);
  const positionKey = String(d.pubkey ?? "");
  const sizeUsd = Number(d.size_usd ?? 0);
  const closingSize = sizeUsd * (closePercent / 100);

  async function handleClose() {
    if (status !== "preview" || !walletAddress || !connected || !signTransaction || !positionKey) return;
    setStatus("executing");

    try {
      const { buildClosePositionTx } = await import("@/lib/api");
      const apiResult = await buildClosePositionTx({
        positionKey,
        marketSymbol: market,
        side: side === "LONG" ? "Long" : "Short",
        owner: walletAddress,
        closePercent,
        inputUsdUi: String(closingSize),
        withdrawTokenSymbol: "USDC",
      });

      if (apiResult.err) throw new Error(apiResult.err);
      if (!apiResult.transactionBase64) throw new Error("No transaction from API");

      // Clean server-side (strip Lighthouse, fix CU to match Flash Trade)
      const cleanResp = await fetch("/api/clean-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txBase64: apiResult.transactionBase64, payerKey: walletAddress }),
      });
      const cleanData = await cleanResp.json();
      if (cleanData.error) throw new Error(cleanData.error);

      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(cleanData.txBase64), (c) => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(txBytes);

      setStatus("signing");
      const signed = await signTransaction(transaction);

      setStatus("confirming");
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 5 });

      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try { await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true }); } catch {}
      }

      let confirmed = false;
      const start = Date.now();
      while (Date.now() - start < 60_000) {
        const { value } = await connection.getSignatureStatuses([signature]);
        const s = value[0];
        if (s?.err) throw new Error(`Transaction failed: ${JSON.stringify(s.err)}`);
        if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") { confirmed = true; break; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!confirmed) throw new Error("Transaction not confirmed in 60s");

      setTxSig(signature);
      setReceivedUsd(apiResult.receiveTokenAmountUsdUi ?? "");
      setStatus("success");
      refreshPositions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      setErrorMsg(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden success-glow">
        <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ background: isProfit ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)" }}>
          <span className="text-[14px]" style={{ color: isProfit ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>✓</span>
          <span className="text-[14px] font-medium" style={{ color: isProfit ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
            Position closed — {receivedUsd ? `received $${receivedUsd}` : formatPnl(netPnl)}
          </span>
          {txSig && <span className="text-[12px] text-text-tertiary ml-auto num">{txSig.slice(0, 8)}..</span>}
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{errorMsg}</div>
        <button onClick={() => { setStatus("preview"); setErrorMsg(""); }} className="text-[12px] text-accent-blue cursor-pointer">Try again</button>
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
          <span className="text-[11px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
            style={{ color: side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
              background: side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
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

      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleClose}
          disabled={status !== "preview"}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ color: "#fff", background: "var(--color-accent-short)" }}
        >
          {status === "executing" ? "Building tx..." : status === "signing" ? "Sign in wallet..." : status === "confirming" ? "Confirming..." : `Close ${closePercent < 100 ? closePercent + "%" : "Position"}`}
        </button>
        {status === "preview" && (
          <button className="btn-secondary px-6 py-3 text-[13px] text-text-tertiary border-l border-border-subtle cursor-pointer hover:text-text-secondary rounded-none rounded-br-xl">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
});

const PositionsCard = memo(function PositionsCard({ output }: { output: ToolOutput }) {
  const data = output.data;
  if (!data || !Array.isArray(data)) return <ToolError toolName="get_positions" error="No position data" />;
  if (data.length === 0) return <div className="text-[13px] text-text-secondary py-2">No open positions.</div>;

  let totalPnl = 0;
  let totalSize = 0;
  for (const pos of data) { totalPnl += Number(pos.unrealized_pnl ?? 0); totalSize += Number(pos.size_usd ?? 0); }

  return (
    <div className="w-full max-w-[500px] glass-card overflow-hidden">
      {/* Header with totals */}
      <div className="px-5 py-4">
        <div className="text-[11px] text-text-tertiary tracking-wider uppercase mb-1">Open Positions</div>
        <div className="flex items-baseline gap-3">
          <span className="text-[24px] font-semibold text-text-primary num">{formatUsd(totalSize)}</span>
          <span className="text-[14px] font-medium num" style={{ color: totalPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
            {formatPnl(totalPnl)}
          </span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        {data.map((pos: Record<string, unknown>, i: number) => {
          const pnl = Number(pos.unrealized_pnl ?? 0);
          const pnlPct = Number(pos.unrealized_pnl_pct ?? 0);
          const side = String(pos.side ?? "");
          const market = String(pos.market ?? "");
          const leverage = Number(pos.leverage ?? 0);
          const size = Number(pos.size_usd ?? 0);
          const entry = Number(pos.entry_price ?? 0);
          const mark = Number(pos.mark_price ?? 0);
          const dotColor = (MARKETS as Record<string, { dotColor: string }>)[market]?.dotColor ?? "#555";
          return (
            <div key={i} className="px-5 py-3.5 flex items-center gap-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                style={{ background: dotColor }}>{market.slice(0, 1)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[14px] font-semibold text-text-primary">{market}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ color: side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                      background: side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>{side}</span>
                  <span className="text-[11px] text-text-tertiary num">{leverage.toFixed(1)}x</span>
                </div>
                <div className="flex items-center gap-3 text-[12px] text-text-tertiary num">
                  <span>{formatUsd(size)}</span>
                  <span>·</span>
                  <span>Entry {formatPrice(entry)}</span>
                  {mark > 0 && <><span>·</span><span>Mark {formatPrice(mark)}</span></>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[14px] font-semibold num" style={{ color: pnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                  {formatPnl(pnl)}
                </div>
                <div className="text-[11px] num" style={{ color: pnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                  {formatPnlPct(pnlPct)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

const PortfolioCard = memo(function PortfolioCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const storePrices = useFlashStore((s) => s.prices);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const [walletUsd, setWalletUsd] = useState(0);
  const [solBal, setSolBal] = useState(0);
  const [usdcBal, setUsdcBal] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const [allTokens, setAllTokens] = useState<{ symbol: string; amount: number; usdValue: number; color: string }[]>([]);

  const TOKEN_COLORS: Record<string, string> = {
    SOL: "#9945FF", USDC: "#2775CA", JitoSOL: "#8B5CF6", JUP: "#00D18C",
    BONK: "#F59E0B", WIF: "#A855F7", PYTH: "#7142CF", JTO: "#4E7CFF",
    WBTC: "#F7931A", BTC: "#F7931A", ETH: "#627EEA", ORE: "#F97316",
    HYPE: "#3B82F6", RAY: "#4F46E5", PENGU: "#7DD3FC", FAF: "#FF6B6B",
    SPYx: "#3B82F6", WSOL: "#9945FF",
  };

  // Fetch ALL wallet tokens via Helius DAS API (single call, auto-priced)
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch("/api/token-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: walletAddress }),
        });
        if (!resp.ok) return;
        const data = await resp.json();

        const tokens: { symbol: string; amount: number; usdValue: number; color: string }[] = [];

        // SOL
        tokens.push({
          symbol: "SOL",
          amount: data.solBalance ?? 0,
          usdValue: data.solUsd ?? 0,
          color: "#9945FF",
        });
        if (!cancelled) setSolBal(data.solBalance ?? 0);

        // All SPL tokens
        for (const t of data.tokens ?? []) {
          tokens.push({
            symbol: t.symbol,
            amount: t.amount,
            usdValue: t.usdValue,
            color: TOKEN_COLORS[t.symbol] ?? `hsl(${Math.abs(t.symbol.charCodeAt(0) * 37) % 360}, 60%, 55%)`,
          });
          if (t.symbol === "USDC" && !cancelled) setUsdcBal(t.amount);
        }

        // Filter dust, sort by value
        const meaningful = tokens.filter((t) => t.usdValue >= 0.01);
        meaningful.sort((a, b) => b.usdValue - a.usdValue);

        if (!cancelled) {
          setAllTokens(meaningful);
          setWalletUsd(data.totalUsd ?? 0);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [walletAddress, storePrices]);

  if (!d) return null;

  const pnl = Number(d.total_unrealized_pnl ?? 0);
  const exposure = Number(d.total_exposure ?? 0);
  const collateral = Number(d.total_collateral ?? 0);
  const positions = (d.positions as Record<string, unknown>[]) ?? [];
  const netWorth = walletUsd + collateral;

  return (
    <div className="w-full max-w-[520px] overflow-hidden" style={{
      background: "linear-gradient(135deg, rgba(17,24,32,0.95), rgba(20,30,40,0.85))",
      borderRadius: "20px",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      {/* NET WORTH */}
      <div className="px-6 pt-6 pb-4">
        <div className="text-[12px] font-medium tracking-wider mb-2" style={{ color: "var(--color-accent-long)" }}>
          NET WORTH
        </div>
        <div className="text-[40px] font-semibold text-text-primary tracking-tight leading-none num">
          {formatUsd(netWorth)}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-6" style={{ height: "1px", background: "linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))" }} />

      {/* Wallet token balances — all tokens */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-4 flex-wrap">
          {allTokens.filter((t) => t.usdValue >= 0.01).map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                style={{ background: t.color }}>{t.symbol.slice(0, 1)}</div>
              <span className="text-[14px] font-medium text-text-primary num">{formatUsd(t.usdValue)}</span>
            </div>
          ))}
          {collateral > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: "#3B82F6" }}>P</div>
              <span className="text-[14px] font-medium text-text-primary num">{formatUsd(collateral)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="mx-6" style={{ height: "1px", background: "linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))" }} />

      {/* Positions section */}
      <div className="px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-[12px] text-text-tertiary tracking-wider">POSITIONS</span>
          <span className="text-[14px] font-semibold text-text-primary num">{formatUsd(exposure)}</span>
          <span className="text-[13px] num font-medium" style={{ color: pnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
            {formatPnl(pnl)}
          </span>
        </div>

        {positions.map((pos, i) => {
          const side = String(pos.side ?? "");
          const market = String(pos.market ?? "");
          const posPnl = Number(pos.unrealized_pnl ?? 0);
          const pnlPct = Number(pos.unrealized_pnl_pct ?? 0);
          const leverage = Number(pos.leverage ?? 0);
          const entry = Number(pos.entry_price ?? 0);
          const dotColor = (MARKETS as Record<string, { dotColor: string }>)[market]?.dotColor ?? "#555";
          return (
            <div key={i} className="flex items-center gap-3 py-2">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: dotColor }}>{market.slice(0, 1)}</div>
              <div className="flex-1">
                <span className="text-[14px] font-medium text-text-primary">{market}</span>
                <span className="text-[11px] text-text-tertiary ml-2 num">{leverage.toFixed(1)}x · {formatPrice(entry)}</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full mr-2"
                style={{ color: side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                  background: side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>{side}</span>
              <div className="text-right">
                <div className="text-[13px] num font-medium" style={{ color: posPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                  {formatPnl(posPnl)}
                </div>
                <div className="text-[10px] num" style={{ color: posPnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
                  {formatPnlPct(pnlPct)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* View More */}
      <div className="px-6 pb-5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-5 py-2 text-[13px] font-semibold rounded-lg cursor-pointer transition-all hover:brightness-110"
          style={{ background: "var(--color-accent-lime)", color: "#0A0E13" }}>
          {expanded ? "Show Less" : "View More"}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2">
            {allTokens.filter((t) => t.amount > 0).map((t, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                  style={{ background: t.color }}>{t.symbol.slice(0, 1)}</div>
                <span className="text-[13px] text-text-primary flex-1">{t.symbol}</span>
                <span className="text-[12px] text-text-secondary num">{t.amount < 1 ? t.amount.toFixed(6) : t.amount.toFixed(2)}</span>
                <span className="text-[12px] text-text-primary num w-16 text-right">{formatUsd(t.usdValue)}</span>
              </div>
            ))}
            <div className="pt-2 text-[12px] text-text-tertiary" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <div>In Positions: {formatUsd(collateral)}</div>
              <div>Exposure: {formatUsd(exposure)} · PnL: {formatPnl(pnl)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

const PriceCard = memo(function PriceCard({ toolName, output }: { toolName: string; output: ToolOutput }) {
  const data = output.data;
  if (toolName === "get_all_prices" && data && typeof data === "object") {
    const allPrices = Object.values(data as Record<string, Record<string, unknown>>)
      .filter((p) => Number(p.price ?? 0) > 0)
      .sort((a, b) => Number(b.price ?? 0) - Number(a.price ?? 0));

    // Group into categories
    const crypto = allPrices.filter((p) => ["SOL", "BTC", "ETH", "BNB", "ZEC", "BONK", "WIF", "JUP", "PYTH", "JTO", "RAY", "PENGU", "FARTCOIN", "ORE", "HYPE", "KMNO", "PUMP"].includes(String(p.symbol ?? "")));
    const other = allPrices.filter((p) => !crypto.includes(p));

    return (
      <div className="w-full max-w-[500px] glass-card overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[11px] text-text-tertiary tracking-wider uppercase mb-1">Markets</div>
          <div className="text-[20px] font-semibold text-text-primary">{allPrices.length} active</div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {crypto.slice(0, 8).map((p, i) => {
            const sym = String(p.symbol ?? "");
            const price = Number(p.price ?? 0);
            const dotColor = (MARKETS as Record<string, { dotColor: string }>)[sym]?.dotColor ?? "#555";
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                  style={{ background: dotColor }}>{sym.slice(0, 1)}</div>
                <span className="text-[14px] font-medium text-text-primary flex-1">{sym}</span>
                <span className="text-[14px] num text-text-secondary">{formatPrice(price)}</span>
              </div>
            );
          })}
        </div>
        {other.length > 0 && (
          <>
            <div className="px-5 py-2 text-[10px] text-text-tertiary tracking-wider uppercase" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              Commodities & Equities
            </div>
            {other.slice(0, 6).map((p, i) => {
              const sym = String(p.symbol ?? "");
              const price = Number(p.price ?? 0);
              return (
                <div key={i} className="flex items-center gap-3 px-5 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span className="w-6 h-6 rounded-full bg-bg-elevated flex items-center justify-center text-[9px] font-bold text-text-tertiary">{sym.slice(0, 1)}</span>
                  <span className="text-[13px] font-medium text-text-primary flex-1">{sym}</span>
                  <span className="text-[13px] num text-text-secondary">{formatPrice(price)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  }
  if (data && typeof data === "object") {
    const p = data as Record<string, unknown>;
    const sym = String(p.symbol ?? "");
    const price = Number(p.price ?? 0);
    const dotColor = (MARKETS as Record<string, { dotColor: string }>)[sym]?.dotColor ?? "#555";
    return (
      <div className="inline-flex items-center gap-3 py-2">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
          style={{ background: dotColor }}>{sym.slice(0, 1)}</div>
        <span className="text-[15px] font-semibold text-text-primary">{sym}</span>
        <span className="text-[15px] num text-text-secondary">{formatPrice(price)}</span>
      </div>
    );
  }
  return null;
});

const MarketInfoCard = memo(function MarketInfoCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  if (!d) return null;
  return (
    <div className="w-full max-w-[380px] glass-card overflow-hidden">
      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Market" value={String(d.market ?? "")} />
        <Cell label="Pool" value={String(d.pool ?? "")} />
        <Cell label="Default Lev" value={`${d.default_leverage ?? "—"}x`} />
        <Cell label="Max Lev" value={`${d.max_leverage ?? "—"}x`} />
      </div>
    </div>
  );
});

// ---- Shared ----

const Cell = memo(function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-card px-5 py-3">
      <div className="text-[11px] text-text-tertiary mb-0.5">{label}</div>
      <div className="num text-[15px] font-medium" style={{ color: color ?? "var(--color-text-primary)" }}>{value}</div>
    </div>
  );
});

const ConfidenceBadge = memo(function ConfidenceBadge({ confidence }: { confidence: TradeConfidence }) {
  const cfg = { high: { c: "var(--color-accent-long)", l: "High" }, medium: { c: "var(--color-accent-warn)", l: "Med" }, low: { c: "var(--color-accent-short)", l: "Low" } }[confidence.level];
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{ background: `${cfg.c}12` }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.c }} />
      <span className="text-[11px] font-semibold" style={{ color: cfg.c }}>{cfg.l}</span>
    </div>
  );
});

const ToolError = memo(function ToolError({ toolName, error }: { toolName: string; error?: string }) {
  return (
    <div className="w-full max-w-[420px] glass-card px-4 py-3 overflow-hidden"
      style={{ borderColor: "rgba(239,68,68,0.2)" }}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-[13px] text-accent-short">✕</span>
        <span className="text-[13px] text-text-secondary">{error ?? `${toolName} failed`}</span>
      </div>
      <button className="btn-secondary text-[12px] text-accent-blue cursor-pointer">Retry</button>
    </div>
  );
});

const GenericCard = memo(function GenericCard({ toolName, output }: { toolName: string; output: ToolOutput }) {
  return <div className="text-[13px] text-text-secondary py-1.5">{toolName}: {output.status === "success" ? "Done" : output.error ?? "Error"}</div>;
});
