"use client";

// ============================================
// Flash AI — Tool Result Card (Galileo-Style)
// ============================================

import { memo, useState, useEffect, useMemo, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { validateTrade, type TradePreview } from "@/lib/trade-firewall";
import { getTradeConfidence, type TradeConfidence } from "@/lib/predictive-actions";
import { useFlashStore } from "@/store";
import { useNumberSpring, useBounceIn } from "@/hooks/useSpring";
import {
  formatPrice, formatUsd, formatLeverage, formatPnl, formatPnlPct, formatPercent, liqDistancePct, safe,
} from "@/lib/format";
import { HIGH_LEVERAGE_THRESHOLD, MARKETS } from "@/lib/constants";
import { getPreferredSlDistance, getPreferredTpDistance, getRiskProfile, getPostTradeInsight, getUserPatterns, getCrossFeatureHint, getGuidanceLevel, type TradeInsight } from "@/lib/user-patterns";

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
  if (!output) return <StreamingSteps toolName={part.toolName} step={2} input={part.input} />;
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
    case "reverse_position_preview": return <ReversePositionCard output={output} />;
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
  reverse_position_preview: ["Loading position", "Calculating reversal", "Estimating fees"],
  get_positions: ["Querying positions"],
  get_portfolio: ["Loading portfolio"],
  get_price: ["Fetching price"],
  get_all_prices: ["Loading markets"],
  get_market_info: ["Loading market info"],
};

const StreamingSteps = memo(function StreamingSteps({ toolName, step, input }: { toolName: string; step: 1 | 2; input?: Record<string, unknown> }) {
  const steps = TOOL_STEPS[toolName] ?? ["Processing"];
  const market = input?.market ? ` ${input.market}` : "";

  // Build an intent summary from input params (shows what was understood)
  const intentParts: string[] = [];
  if (input) {
    if (input.side) intentParts.push(String(input.side));
    if (input.market) intentParts.push(String(input.market));
    if (input.leverage) intentParts.push(`${input.leverage}x`);
    if (input.collateral_usd) intentParts.push(`$${input.collateral_usd}`);
    if (input.take_profit_price) intentParts.push(`TP $${input.take_profit_price}`);
    if (input.stop_loss_price) intentParts.push(`SL $${input.stop_loss_price}`);
  }
  const intentSummary = intentParts.length > 0 ? intentParts.join(" · ") : "";

  return (
    <div className="w-full max-w-[420px] glass-card anticipate-in overflow-hidden">
      {/* Intent detection banner */}
      {intentSummary && step >= 2 && (
        <div className="px-4 py-2 text-[11px] text-text-tertiary border-b border-border-subtle flex items-center gap-2">
          <span style={{ color: "var(--color-accent-lime)" }}>✓</span>
          <span>Detected: {intentSummary}</span>
        </div>
      )}
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

  // Compute insight unconditionally (hooks can't be conditional)
  const postTradeInsight = useMemo<TradeInsight | null>(() => {
    if (!tradeCompleted) return null;
    try {
      const t = output.data as Record<string, unknown> | null;
      if (!t) return null;
      return getPostTradeInsight({
        market: String(t.market ?? ""),
        side: String(t.side ?? "LONG") as "LONG" | "SHORT",
        leverage: Number(t.leverage ?? 0),
        collateral: Number(t.collateral_usd ?? 0),
        timestamp: Date.now(),
        hasTp: !!t.take_profit_price,
        hasSl: !!t.stop_loss_price,
      });
    } catch { return null; }
  }, [tradeCompleted, output.data]);

  // Trade was submitted and completed successfully
  if (tradeCompleted && (tradeStatus === "SUCCESS" || !activeTrade)) {
    return (
      <div className="w-full max-w-[460px]">
        <div className="glass-card overflow-hidden success-glow">
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
        {postTradeInsight && (
          <div className="mt-2 flex items-center gap-2 px-1 msg-anim">
            <span className="text-[11px] font-medium" style={{ color: postTradeInsight.color }}>{postTradeInsight.message}</span>
          </div>
        )}
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
      {/* Header — bold, prominent */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full" style={{ background: accent }} />
          <span className="text-[18px] font-bold text-text-primary tracking-tight">{t.market}-PERP</span>
          <span className="text-[12px] font-bold tracking-wider px-3 py-1 rounded-full"
            style={{ color: accent, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
            {t.side}
          </span>
        </div>
        <ConfidenceBadge confidence={confidence} />
      </div>

      {/* Speed badge */}
      {output.latency_ms != null && (
        <div className="px-5 py-1.5 flex items-center gap-2 border-b border-border-subtle" style={{ background: "rgba(200,245,71,0.03)" }}>
          {output.latency_ms === 0 ? (
            <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--color-accent-lime)" }}>⚡ INSTANT</span>
          ) : (
            <span className="text-[10px] font-medium num text-text-tertiary">{output.latency_ms}ms</span>
          )}
          {output.status === "degraded" && (
            <span className="text-[10px] text-text-tertiary">· cached price</span>
          )}
        </div>
      )}

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

      {/* TP/SL badges */}
      {(t.take_profit_price || t.stop_loss_price) && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-t border-border-subtle">
          {t.take_profit_price && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.08)" }}>
              <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--color-accent-long)" }}>TP</span>
              <span className="text-[12px] num font-medium" style={{ color: "var(--color-accent-long)" }}>{formatPrice(t.take_profit_price)}</span>
            </div>
          )}
          {t.stop_loss_price && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(239,68,68,0.08)" }}>
              <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--color-accent-short)" }}>SL</span>
              <span className="text-[12px] num font-medium" style={{ color: "var(--color-accent-short)" }}>{formatPrice(t.stop_loss_price)}</span>
            </div>
          )}
        </div>
      )}

      {/* Risk bar */}
      {liqDist > 0 && (
        <div className="px-5 py-3 border-t border-border-subtle">
          <div className="flex justify-between text-[12px] mb-2">
            <span className="text-text-tertiary">Liquidation distance</span>
            <span className="num font-medium" style={{ color: liqDist < 10 ? "var(--color-accent-short)" : liqDist < 20 ? "var(--color-accent-warn)" : "var(--color-accent-long)" }}>
              {safe(liqDist).toFixed(1)}%
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

      {/* Smart suggestions — context-aware, non-intrusive */}
      {!submitting && <TradeHints trade={t} />}
    </div>
  );
});

// ---- Post-Intent Suggestions ----

const TradeHints = memo(function TradeHints({ trade }: { trade: TradePreview }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const hints: { label: string; intent: string; color: string }[] = [];

  // Learned preferences (adapts to user behavior over time)
  const slDistPct = getPreferredSlDistance();  // learned or default 5%
  const tpDistPct = getPreferredTpDistance();  // learned or default 10%
  const riskProfile = getRiskProfile();

  // No SL → suggest adding one (using user's preferred distance)
  if (!trade.stop_loss_price) {
    const slMul = trade.side === "LONG" ? (1 - slDistPct / 100) : (1 + slDistPct / 100);
    const suggestedSl = Math.round(trade.entry_price * slMul * 100) / 100;
    hints.push({
      label: `Add SL ~$${suggestedSl.toLocaleString()}`,
      intent: `${trade.side.toLowerCase()} ${trade.market} $${trade.collateral_usd} ${trade.leverage}x sl ${suggestedSl}`,
      color: "var(--color-accent-short)",
    });
  }

  // No TP → suggest adding one (using user's preferred distance)
  if (!trade.take_profit_price) {
    const tpMul = trade.side === "LONG" ? (1 + tpDistPct / 100) : (1 - tpDistPct / 100);
    const suggestedTp = Math.round(trade.entry_price * tpMul * 100) / 100;
    hints.push({
      label: `Add TP ~$${suggestedTp.toLocaleString()}`,
      intent: `${trade.side.toLowerCase()} ${trade.market} $${trade.collateral_usd} ${trade.leverage}x tp ${suggestedTp}`,
      color: "var(--color-accent-long)",
    });
  }

  // High leverage → warn (stricter for conservative users)
  const levThreshold = riskProfile === "conservative" ? 10 : riskProfile === "aggressive" ? 30 : 20;
  if (trade.leverage >= levThreshold) {
    const safeLev = Math.max(5, Math.floor(trade.leverage / 2));
    hints.push({
      label: `Reduce to ${safeLev}x?`,
      intent: `${trade.side.toLowerCase()} ${trade.market} $${trade.collateral_usd} ${safeLev}x`,
      color: "var(--color-accent-warn)",
    });
  }

  // Low liquidation distance → suggest more collateral
  const liqDist = liqDistancePct(trade.entry_price, trade.liquidation_price, trade.side);
  if (liqDist < 10 && liqDist > 0 && trade.leverage < 20) {
    hints.push({
      label: "Add more collateral?",
      intent: `${trade.side.toLowerCase()} ${trade.market} $${Math.round(trade.collateral_usd * 1.5)} ${trade.leverage}x`,
      color: "var(--color-accent-warn)",
    });
  }

  // Cross-feature hint (e.g. "try earn" for aggressive traders)
  const guidanceLevel = getGuidanceLevel();
  if (guidanceLevel !== "none") {
    const crossHint = getCrossFeatureHint("trade");
    if (crossHint && hints.length < 3) {
      hints.push({ label: crossHint, intent: "", color: "var(--color-accent-blue)" });
    }
  }

  if (hints.length === 0) return null;

  return (
    <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-t border-border-subtle" style={{ animation: "fadeIn 200ms ease-out" }}>
      {hints.slice(0, 3).map((h, i) => (
        <button
          key={i}
          onClick={() => {
            setDismissed(true);
            // Copy intent to clipboard and focus input — user can paste or we auto-fill
            try {
              const input = document.querySelector<HTMLTextAreaElement>("textarea");
              if (input) {
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
                nativeSet?.call(input, h.intent);
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.focus();
              }
            } catch {}
          }}
          className="chip text-[11px] px-3 py-1.5 cursor-pointer"
          style={{ color: h.color, background: `${h.color}08`, border: `1px solid ${h.color}20` }}
        >
          {h.label}
        </button>
      ))}
      <button
        onClick={() => setDismissed(true)}
        className="text-[10px] text-text-tertiary px-2 py-1.5 cursor-pointer hover:text-text-secondary"
      >
        ✕
      </button>
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

  if (!d) return <ToolError toolName="collateral" error="No collateral data returned" />;

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
      if (!cleanResp.ok) throw new Error(`Clean-tx failed: ${cleanResp.status}`);
      const cleanData = await cleanResp.json().catch(() => { throw new Error("Invalid clean-tx response"); });
      if (cleanData.error) throw new Error(cleanData.error);
      if (!cleanData.txBase64) throw new Error("No cleaned transaction returned");

      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(cleanData.txBase64), (c) => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(txBytes);

      setStatus("signing");
      const signed = await signTransaction(transaction);

      // Execute via shared FlashEdge engine (multi-broadcast + WS/HTTP + rebroadcast)
      setStatus("confirming");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);

      setTxSig(signature);
      refreshPositions();

      // Fetch real post-execution position data
      try {
        await new Promise((r) => setTimeout(r, 2000)); // wait for chain to update
        // Fallback: use flash API directly
        const posResp = await fetch(
          `https://flashapi.trade/positions/owner/${walletAddress}?includePnlInLeverageDisplay=true`
        );
        if (posResp.ok) {
          const positions = await posResp.json().catch(() => null);
          const pos = Array.isArray(positions)
            ? positions.find((p: Record<string, unknown>) => p.marketSymbol === market && String(p.sideUi).toUpperCase() === side)
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
            Collateral {isAdd ? "added" : "removed"} — {isAdd ? "+" : "-"}${safe(amountUsd).toFixed(2)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Collateral" value={formatUsd(realCollateral)} />
          <Cell label="Leverage" value={`${safe(realLeverage).toFixed(2)}x`}
            color={realLeverage >= 10 ? "var(--color-accent-warn)" : undefined} />
          <Cell label="Liq Price" value={formatPrice(realLiqPrice)} />
          <Cell label="Liq Distance" value={`${safe(realLiqDist).toFixed(1)}%`}
            color={realLiqDist < 10 ? "var(--color-accent-short)" : undefined} />
        </div>
        {txSig && (
          <div className="px-4 py-2 border-t border-border-subtle">
            <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer" className="text-[12px] text-text-secondary hover:text-text-primary underline">
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
          {isAdd ? "+" : "-"}${safe(amountUsd).toFixed(2)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Collateral" value={`${formatUsd(Number(d.current_collateral ?? 0))} → ${formatUsd(Number(d.new_collateral ?? 0))}`} />
        <Cell
          label="Leverage"
          value={`${safe(d.current_leverage).toFixed(1)}x → ${safe(d.new_leverage).toFixed(1)}x`}
          color={newLevHigher ? "var(--color-accent-warn)" : "var(--color-accent-long)"}
        />
        <Cell label="Liq Price" value={`${formatPrice(Number(d.current_liq_price ?? 0))} → ${formatPrice(Number(d.new_liq_price ?? 0))}`} />
        <Cell
          label="Liq Distance"
          value={`${safe(d.current_liq_distance_pct).toFixed(1)}% → ${safe(d.new_liq_distance_pct).toFixed(1)}%`}
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

  if (!d) return <ToolError toolName="close_position" error="No position data returned" />;
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
      if (!cleanResp.ok) throw new Error(`Clean-tx failed: ${cleanResp.status}`);
      const cleanData = await cleanResp.json().catch(() => { throw new Error("Invalid clean-tx response"); });
      if (cleanData.error) throw new Error(cleanData.error);
      if (!cleanData.txBase64) throw new Error("No cleaned transaction returned");

      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(cleanData.txBase64), (c) => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(txBytes);

      setStatus("signing");
      const signed = await signTransaction(transaction);

      setStatus("confirming");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);

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
        </div>
        {txSig && (
          <div className="px-4 py-2 border-t border-border-subtle">
            <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer" className="text-[12px] text-text-secondary hover:text-text-primary underline">
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

const ReversePositionCard = memo(function ReversePositionCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "signing" | "confirming" | "success" | "error">("preview");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const refreshPositions = useFlashStore((s) => s.refreshPositions);
  const { connection } = useConnection();
  const { signTransaction, connected } = useWallet();

  if (!d) return <ToolError toolName="reverse_position" error="No position data returned" />;
  const market = String(d.market ?? "");
  const currentSide = String(d.current_side ?? "");
  const newSide = String(d.new_side ?? "");
  const closePnl = Number(d.close_pnl ?? 0);
  const totalFees = Number(d.total_fees ?? 0);
  const newCollateral = Number(d.new_collateral ?? 0);
  const newSize = Number(d.new_size ?? 0);
  const newLeverage = Number(d.new_leverage ?? 0);
  const positionKey = String(d.pubkey ?? "");

  async function handleReverse() {
    if (status !== "preview" || !walletAddress || !connected || !signTransaction || !positionKey) return;
    setStatus("executing");

    try {
      const { buildReversePosition } = await import("@/lib/api");
      const apiResult = await buildReversePosition({
        positionKey,
        owner: walletAddress,
      });

      if (apiResult.err) throw new Error(apiResult.err);
      if (!apiResult.transactionBase64) throw new Error("No transaction from API");

      const cleanResp = await fetch("/api/clean-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txBase64: apiResult.transactionBase64, payerKey: walletAddress }),
      });
      if (!cleanResp.ok) throw new Error(`Clean-tx failed: ${cleanResp.status}`);
      const cleanData = await cleanResp.json().catch(() => { throw new Error("Invalid clean-tx response"); });
      if (cleanData.error) throw new Error(cleanData.error);
      if (!cleanData.txBase64) throw new Error("No cleaned transaction returned");

      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(cleanData.txBase64), (c) => c.charCodeAt(0));
      const transaction = VersionedTransaction.deserialize(txBytes);

      setStatus("signing");
      const signed = await signTransaction(transaction);

      setStatus("confirming");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);

      setTxSig(signature);
      setStatus("success");
      refreshPositions();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Reverse failed";
      setErrorMsg(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStatus("error");
    }
  }

  const isLive = status === "executing" || status === "signing" || status === "confirming";

  return (
    <div className="w-full max-w-[420px] glass-card overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-text-tertiary tracking-wider uppercase">Reverse Position</span>
          {status === "success" && <span className="text-[11px] text-accent-long font-medium">Confirmed</span>}
          {status === "error" && <span className="text-[11px] text-accent-short font-medium">Failed</span>}
          {isLive && <span className="text-[11px] text-text-secondary animate-pulse">
            {status === "executing" ? "Building..." : status === "signing" ? "Sign in wallet..." : "Confirming..."}
          </span>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-bold px-2 py-0.5 rounded"
            style={{ color: currentSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
              background: currentSide === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
            {currentSide}
          </span>
          <span className="text-text-tertiary">→</span>
          <span className="text-[13px] font-bold px-2 py-0.5 rounded"
            style={{ color: newSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
              background: newSide === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
            {newSide}
          </span>
          <span className="text-[15px] font-semibold text-text-primary ml-1">{market}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Close PnL" value={formatPnl(closePnl)} color={closePnl >= 0 ? "var(--color-accent-long)" : "var(--color-accent-short)"} />
        <Cell label="Total Fees" value={formatUsd(totalFees)} />
        <Cell label="New Collateral" value={formatUsd(newCollateral)} />
        <Cell label="New Size" value={formatUsd(newSize)} />
        <Cell label="Leverage" value={formatLeverage(newLeverage)} />
        <Cell label="New Side" value={newSide} color={newSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)"} />
      </div>

      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleReverse}
          disabled={status !== "preview"}
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ background: newSide === "LONG" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
            color: newSide === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)" }}>
          {isLive ? "Processing..." : status === "success" ? "Reversed" : status === "error" ? "Failed" : `Reverse to ${newSide}`}
        </button>
      </div>

      {status === "error" && errorMsg && (
        <div className="px-4 py-2 text-[12px] text-accent-short bg-accent-short/5">{errorMsg}</div>
      )}
      {status === "success" && txSig && (
        <div className="px-4 py-2 text-[12px] text-text-secondary">
          <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-text-primary">
            View on Solscan →
          </a>
        </div>
      )}
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
                  <span className="text-[11px] text-text-tertiary num">{safe(leverage).toFixed(1)}x</span>
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
        const data = await resp.json().catch(() => null);
        if (!data) return;

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

  if (!d) return <ToolError toolName="get_portfolio" error="No portfolio data returned" />;

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
                <span className="text-[11px] text-text-tertiary ml-2 num">{safe(leverage).toFixed(1)}x · {formatPrice(entry)}</span>
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
                <span className="text-[12px] text-text-secondary num">{safe(t.amount) < 1 ? safe(t.amount).toFixed(6) : safe(t.amount).toFixed(2)}</span>
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
  if (!d) return <ToolError toolName="get_market_info" error="No market data returned" />;
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
  const cfg = {
    high: { c: "var(--color-accent-long)", l: "Verified", icon: "✓" },
    medium: { c: "var(--color-accent-warn)", l: "Med", icon: "●" },
    low: { c: "var(--color-accent-short)", l: "Low", icon: "●" },
  }[confidence.level];
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      style={{ background: `${cfg.c}12` }}>
      <span className="text-[10px] font-bold" style={{ color: cfg.c }}>{cfg.icon}</span>
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
