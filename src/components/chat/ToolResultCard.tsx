"use client";

// ============================================
// Flash AI — Tool Result Card (Galileo-Style)
// ============================================

import { memo, useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { validateTrade, type TradePreview } from "@/lib/trade-firewall";
import { getTradeConfidence, type TradeConfidence } from "@/lib/predictive-actions";
import { useFlashStore } from "@/store";
import { useNumberSpring, useBounceIn } from "@/hooks/useSpring";
import {
  formatPrice, formatUsd, formatLeverage, formatPnl, formatPnlPct, formatPercent, liqDistancePct, safe,
} from "@/lib/format";
import { HIGH_LEVERAGE_THRESHOLD, MARKETS } from "@/lib/constants";
import { getPreferredSlDistance, getPreferredTpDistance, getRiskProfile, getPostTradeInsight, getUserPatterns, getCrossFeatureHint, getGuidanceLevel, shouldBoostSlSuggestion, getOutcomeInsight, recordSuggestionShown, recordSuggestionAccepted, type TradeInsight } from "@/lib/user-patterns";

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

// ---- Tool Status Dot (Neur pattern) ----
function ToolStatusDot({ state, status }: { state: string; status?: string }) {
  if (state === "output-available" && status === "error")
    return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-accent-short)", boxShadow: "0 0 0 3px rgba(239,68,68,0.2)" }} />;
  if (state === "output-available")
    return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-accent-long)", boxShadow: "0 0 0 3px rgba(16,185,129,0.2)" }} />;
  return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-accent-warn)", boxShadow: "0 0 0 3px rgba(245,158,11,0.2)", animation: "pulseDot 1s infinite" }} />;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  build_trade: "Trade Preview",
  transfer_preview: "Transfer Preview",
  transfer_history: "Transfer History",
  faf_dashboard: "FAF Dashboard",
  faf_stake: "Stake FAF",
  faf_unstake: "Unstake FAF",
  faf_claim: "Claim Rewards",
  faf_requests: "Unstake Requests",
  faf_cancel_unstake: "Cancel Unstake",
  faf_tier: "VIP Tiers",
  close_position_preview: "Close Preview",
  get_positions: "Positions",
  get_portfolio: "Portfolio",
  get_price: "Price",
  get_all_prices: "Markets",
  get_market_info: "Market Info",
  add_collateral: "Add Collateral",
  remove_collateral: "Remove Collateral",
  reverse_position_preview: "Reverse Position",
  earn_deposit: "Earn Deposit",
};

const ToolResultCard = memo(function ToolResultCard({ part, onAction }: { part: ToolPart; onAction?: (cmd: string) => void }) {
  const output = part.output;

  if (part.state === "input-streaming") return <StreamingSteps toolName={part.toolName} step={1} input={part.input} />;
  if (part.state === "input-available") return <StreamingSteps toolName={part.toolName} step={2} input={part.input} />;
  if (!output) return <StreamingSteps toolName={part.toolName} step={2} input={part.input} />;
  if (output.status === "error" && !output.data) return <ToolError toolName={part.toolName} error={output.error} />;

  // Tool status header (Neur pattern: dot + name + ID)
  const displayName = TOOL_DISPLAY_NAMES[part.toolName] ?? part.toolName;
  const statusHeader = (
    <div className="flex items-center gap-2 mb-2">
      <ToolStatusDot state={part.state} status={output.status} />
      <span className="text-[12px] font-medium text-text-secondary truncate">{displayName}</span>
      <span className="text-[10px] font-mono text-text-tertiary">{part.toolCallId.slice(0, 9)}</span>
    </div>
  );

  let card: React.ReactNode;
  switch (part.toolName) {
    case "build_trade": card = <TradePreviewCard output={output} />; break;
    case "close_position_preview": card = <ClosePreviewCard output={output} />; break;
    case "get_positions": card = <PositionsCard output={output} />; break;
    case "get_portfolio": card = <PortfolioCard output={output} />; break;
    case "get_price":
    case "get_all_prices": card = <PriceCard toolName={part.toolName} output={output} />; break;
    case "get_market_info": card = <MarketInfoCard output={output} />; break;
    case "add_collateral":
    case "remove_collateral": card = <CollateralCard output={output} />; break;
    case "reverse_position_preview": card = <ReversePositionCard output={output} />; break;
    case "earn_deposit": card = <EarnDepositCard output={output} />; break;
    case "transfer_preview": card = <TransferPreviewCard output={output} />; break;
    case "transfer_history": card = <TransferHistoryCard output={output} />; break;
    case "faf_dashboard":
    case "faf_stake":
    case "faf_unstake":
    case "faf_claim":
    case "faf_requests":
    case "faf_cancel_unstake":
    case "faf_tier": card = <FafCard toolName={part.toolName} output={output} onAction={onAction} />; break;
    default: card = <GenericCard toolName={part.toolName} output={output} />; break;
  }

  return <div>{statusHeader}{card}</div>;
});

export default ToolResultCard;

// ---- Streaming Steps ----

const TOOL_STEPS: Record<string, string[]> = {
  build_trade: ["Fetching price", "Calculating position", "Validating trade"],
  earn_deposit: ["Checking pool", "Building deposit preview"],
  transfer_preview: ["Validating address", "Checking balance", "Building preview"],
  transfer_history: ["Loading history", "Analyzing patterns"],
  faf_dashboard: ["Loading stake data"],
  faf_stake: ["Checking balance", "Building preview"],
  faf_unstake: ["Checking stake", "Building preview"],
  faf_claim: ["Loading rewards"],
  faf_requests: ["Loading requests"],
  faf_cancel_unstake: ["Validating request"],
  faf_tier: ["Loading tiers"],
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
  const displayName = TOOL_DISPLAY_NAMES[toolName] ?? toolName;

  // Simple single-line loader for most tools
  if (steps.length <= 2 && toolName !== "build_trade") {
    return (
      <div className="flex items-center gap-2 py-1 text-[12px] text-text-tertiary">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-warn)", animation: "pulseDot 1s infinite" }} />
        <span>{steps[0]}{input?.market ? ` ${input.market}` : ""}...</span>
      </div>
    );
  }

  // Multi-step loader for trade building
  return (
    <div className="w-full max-w-[420px] glass-card overflow-hidden" style={{ animation: "fadeIn 150ms ease-out" }}>
      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        {steps.map((label, i) => {
          const isDone = i < step;
          const isCurrent = i === step - 1;
          return (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              {isDone ? (
                <span className="text-accent-long w-3 text-center text-[10px]">✓</span>
              ) : isCurrent ? (
                <span className="w-1.5 h-1.5 rounded-full ml-[3px]" style={{ background: "var(--color-accent-warn)", animation: "pulseDot 1s infinite" }} />
              ) : (
                <span className="w-3 text-center text-text-tertiary text-[10px]">·</span>
              )}
              <span className={isDone ? "text-text-secondary" : isCurrent ? "text-text-primary" : "text-text-tertiary"}>
                {label}{i === 0 && input?.market ? ` ${input.market}` : ""}
              </span>
            </div>
          );
        })}
      </div>
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
        {(() => {
          try { const oi = getOutcomeInsight(); if (oi && (!postTradeInsight || oi.message !== postTradeInsight.message)) return (
            <div className="mt-1 flex items-center gap-2 px-1 msg-anim">
              <span className="text-[10px]" style={{ color: oi.color }}>{oi.message}</span>
            </div>
          ); } catch {} return null;
        })()}
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

  // No SL → suggest adding one (boosted if outcome data shows SL helps)
  if (!trade.stop_loss_price) {
    const slMul = trade.side === "LONG" ? (1 - slDistPct / 100) : (1 + slDistPct / 100);
    const suggestedSl = Math.round(trade.entry_price * slMul * 100) / 100;
    const boost = shouldBoostSlSuggestion();
    hints.push({
      label: boost ? `Add SL ~$${suggestedSl.toLocaleString()} (improves your win rate)` : `Add SL ~$${suggestedSl.toLocaleString()}`,
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

  // Record that suggestions were shown (deduped by trade market+side)
  try { recordSuggestionShown(`${trade.market}:${trade.side}:${hints.length}`); } catch {}

  return (
    <div className="px-4 py-2.5 flex flex-wrap gap-1.5 border-t border-border-subtle" style={{ animation: "fadeIn 200ms ease-out" }}>
      {hints.slice(0, 3).map((h, i) => (
        <button
          key={i}
          onClick={() => {
            setDismissed(true);
            // Record suggestion acceptance for learning
            try { recordSuggestionAccepted(); } catch {}
            // Fill input with suggested command
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

      // Record outcome for learning (fire-and-forget)
      try {
        import("@/lib/user-patterns").then(({ recordTradeOutcome }) => {
          const pnlPct = sizeUsd > 0 ? (netPnl / sizeUsd) * 100 : 0;
          // Check if original position had SL by looking at the trade data
          const hadSl = !!(d as Record<string, unknown> | null)?.stop_loss_price;
          recordTradeOutcome(pnlPct, hadSl);
        }).catch(() => {});
      } catch {}
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

// ---- Earn Deposit Card ----

const EarnDepositCard = memo(function EarnDepositCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  const [status, setStatus] = useState<"preview" | "executing" | "signing" | "confirming" | "success" | "error">("preview");
  const [errorMsg, setErrorMsg] = useState("");
  const [txSig, setTxSig] = useState("");
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { connection } = useConnection();
  const { signTransaction, connected } = useWallet();

  if (!d) return <ToolError toolName="earn_deposit" error="No deposit data returned" />;

  const poolName = String(d.pool_name ?? d.pool ?? "");
  const poolAlias = String(d.pool ?? "");
  const amountUsdc = Number(d.amount_usdc ?? 0);
  const flpPrice = Number(d.flp_price ?? 0);
  const expectedShares = Number(d.expected_shares ?? 0);
  const apy = Number(d.apy ?? 0);

  async function handleDeposit() {
    if (status !== "preview" || !walletAddress || !connected || !signTransaction) return;
    setStatus("executing");

    try {
      const { buildEarnDeposit } = await import("@/lib/earn-sdk");
      const { VersionedTransaction, ComputeBudgetProgram, MessageV0, PublicKey } = await import("@solana/web3.js");

      const pubkey = new PublicKey(walletAddress);
      const walletObj = {
        publicKey: pubkey,
        signTransaction,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signAllTransactions: async (txs: any[]) => {
          const signed = [];
          for (const t of txs) signed.push(await signTransaction(t));
          return signed;
        },
      };

      const result = await buildEarnDeposit(connection, walletObj as never, amountUsdc, poolAlias, flpPrice, 0.75);

      const cuLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
      const cuPrice = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
      const allIxs = [cuLimit, cuPrice, ...result.instructions];

      const altAccounts = [];
      for (const addr of result.poolConfig.addressLookupTableAddresses ?? []) {
        try { const alt = await connection.getAddressLookupTable(addr); if (alt.value) altAccounts.push(alt.value); } catch {}
      }

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const message = MessageV0.compile({ payerKey: pubkey, recentBlockhash: blockhash, instructions: allIxs, addressLookupTableAccounts: altAccounts });
      const transaction = new VersionedTransaction(message);
      if (result.additionalSigners.length > 0) transaction.sign(result.additionalSigners);

      // Simulate before signing
      const simResult = await connection.simulateTransaction(transaction, { sigVerify: false, replaceRecentBlockhash: true });
      if (simResult.value.err) {
        const logs = simResult.value.logs?.slice(-3)?.join(" ") ?? "";
        throw new Error(
          logs.includes("insufficient") ? "Insufficient USDC balance"
          : logs.includes("AccountNotFound") ? "Token account not initialized — try the Earn page instead"
          : `Simulation failed: ${JSON.stringify(simResult.value.err).slice(0, 80)}`
        );
      }

      setStatus("signing");
      const signed = await signTransaction(transaction);

      setStatus("confirming");
      const { executeSignedTransaction } = await import("@/lib/tx-executor");
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      const signature = await executeSignedTransaction(signedBase64, connection);

      setTxSig(signature);
      setStatus("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      setErrorMsg(msg.includes("rejected") ? "Transaction rejected by wallet." : msg);
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden success-glow">
        <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ background: "rgba(16,185,129,0.06)" }}>
          <span className="text-[14px]" style={{ color: "var(--color-accent-long)" }}>✓</span>
          <span className="text-[14px] font-medium" style={{ color: "var(--color-accent-long)" }}>
            Deposited ${amountUsdc} into {poolName}
          </span>
        </div>
        {txSig && (
          <div className="px-4 py-2 border-t border-border-subtle">
            <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer" className="text-[12px] text-text-secondary hover:text-text-primary underline">View on Solscan →</a>
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

  const isLive = status === "executing" || status === "signing" || status === "confirming";

  return (
    <div className="w-full max-w-[460px] glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full" style={{ background: "var(--color-accent-lime)" }} />
          <span className="text-[18px] font-bold text-text-primary">{poolName}</span>
          <span className="text-[12px] font-bold tracking-wider px-3 py-1 rounded-full"
            style={{ color: "var(--color-accent-long)", background: "rgba(16,185,129,0.12)" }}>
            DEPOSIT
          </span>
        </div>
        {apy > 0 && <span className="text-[13px] num font-medium" style={{ color: "var(--color-accent-long)" }}>{apy.toFixed(1)}% APY</span>}
      </div>

      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Amount" value={formatUsd(amountUsdc)} />
        <Cell label="Expected FLP" value={`≈ ${safe(expectedShares).toFixed(4)}`} />
        <Cell label="FLP Price" value={`$${safe(flpPrice).toFixed(4)}`} />
        <Cell label="Slippage" value="0.75%" />
      </div>

      {isLive && (
        <div className="px-5 py-3 flex items-center gap-3 text-[13px] text-text-tertiary">
          <span className="w-3.5 h-3.5 border-2 border-text-tertiary border-t-transparent rounded-full" style={{ animation: "spin 0.8s linear infinite" }} />
          {status === "executing" ? "Building transaction..." : status === "signing" ? "Sign in wallet..." : "Confirming..."}
        </div>
      )}

      {status === "preview" && (
        <div className="flex border-t border-border-subtle">
          <button
            onClick={handleDeposit}
            disabled={!connected}
            className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
            style={{ color: "#000", background: "var(--color-accent-lime)" }}
          >
            {connected ? `Deposit $${amountUsdc}` : "Connect Wallet"}
          </button>
        </div>
      )}
    </div>
  );
});

// ============================================
// Transfer Preview Card (Premium Trust UX)
// ============================================
// State diff view, address intelligence, risk warnings,
// step confirmation, explorer feedback.
// Execution engine UNCHANGED.

// ---- Address Intelligence ----
const KNOWN_ADDRESSES: Record<string, { label: string; type: "cex" | "protocol" | "bridge" }> = {
  // Major CEX hot wallets (Solana)
  "5tzFkiKscjHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": { label: "Binance", type: "cex" },
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": { label: "Coinbase", type: "cex" },
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ": { label: "FTX (Inactive)", type: "cex" },
  "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH": { label: "Kraken", type: "cex" },
  "4wBqpZM9xaSheekzYoGKNteMCRPqBKKCbuMgmuKn3R2V": { label: "OKX", type: "cex" },
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE": { label: "Bybit", type: "cex" },
};

function getAddressLabel(addr: string): { label: string; type: string } | null {
  const known = KNOWN_ADDRESSES[addr];
  if (known) return known;
  // Check localStorage contacts
  try {
    const contacts = JSON.parse(localStorage.getItem("flash_contacts") ?? "{}");
    if (contacts[addr]) return { label: contacts[addr], type: "contact" };
  } catch {}
  return null;
}

function getRecentRecipients(): { address: string; label: string; lastUsed: number }[] {
  try {
    return JSON.parse(localStorage.getItem("flash_recent_recipients") ?? "[]");
  } catch { return []; }
}

function saveRecentRecipient(address: string, label: string) {
  try {
    const recents = getRecentRecipients().filter((r) => r.address !== address);
    recents.unshift({ address, label, lastUsed: Date.now() });
    localStorage.setItem("flash_recent_recipients", JSON.stringify(recents.slice(0, 10)));
  } catch {}
}

// ---- Transfer History (localStorage) ----
interface TransferRecord {
  token: string;
  amount: number;
  recipient: string;
  recipientLabel: string | null;
  txSignature: string;
  timestamp: number;
  status: "success" | "failed";
}

function saveTransferHistory(record: TransferRecord) {
  try {
    const key = "flash_transfer_history";
    const history: TransferRecord[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    history.unshift(record);
    // Keep last 100 transfers
    localStorage.setItem(key, JSON.stringify(history.slice(0, 100)));
  } catch {}
}

function getTransferHistory(): TransferRecord[] {
  try {
    return JSON.parse(localStorage.getItem("flash_transfer_history") ?? "[]");
  } catch { return []; }
}

function ConfirmStep({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-4 h-4 rounded-full flex items-center justify-center" style={{
        background: done ? "rgba(0,210,106,0.15)" : "rgba(59,130,246,0.12)",
      }}>
        {done ? (
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-long)" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-accent-blue)", animation: "pulseDot 1s infinite" }} />
        )}
      </span>
      <span className="text-[12px]" style={{ color: done ? "var(--color-text-secondary)" : "var(--color-accent-blue)" }}>{label}</span>
    </div>
  );
}

function humanizeError(raw: string): { message: string; suggestion: string } {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient sol"))
    return { message: "You don't have enough SOL to complete this transfer.", suggestion: "Deposit more SOL or reduce the amount." };
  if (lower.includes("insufficient"))
    return { message: "You don't have enough tokens to complete this transfer.", suggestion: "Check your balance and try a smaller amount." };
  if (lower.includes("simulation failed"))
    return { message: "This transaction would fail on-chain.", suggestion: "The token may have transfer restrictions. Try a smaller amount or check the token." };
  if (lower.includes("rejected"))
    return { message: "You cancelled the transaction in your wallet.", suggestion: "Click Confirm Transfer to try again." };
  if (lower.includes("wallet not available"))
    return { message: "Your wallet isn't connected.", suggestion: "Connect your wallet and try again." };
  if (lower.includes("frozen"))
    return { message: "This token account is frozen by the token issuer.", suggestion: "Contact the token issuer or check their announcements." };
  return { message: raw, suggestion: "Try again or contact support if this persists." };
}

const TransferPreviewCard = memo(function TransferPreviewCard({ output }: { output: ToolOutput }) {
  const [status, setStatus] = useState<"preview" | "executing" | "signing" | "confirming" | "success" | "error">("preview");
  const [txSig, setTxSig] = useState<string | null>(null);
  const [txConfirmed, setTxConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"addr" | "tx" | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const walletAddress = useFlashStore((s) => s.walletAddress);

  const data = output.data as {
    token: string;
    token_name: string;
    amount: number;
    amount_display: string;
    recipient: string;
    recipient_short: string;
    sender: string;
    sender_short: string;
    estimated_fee_sol: number;
    needs_ata: boolean;
    ata_fee_sol: number;
    total_fee_sol: number;
    mint: string | null;
    mint_short: string | null;
    decimals: number;
    is_native_sol: boolean;
    is_verified: boolean;
    sender_balance?: number;
    warnings: string[];
  } | null;

  if (!data) return <ToolError toolName="transfer_preview" error={output.error} />;

  // Address intelligence
  const recipientLabel = getAddressLabel(data.recipient);
  const recipientDisplay = recipientLabel?.label ?? data.recipient_short;
  const recentMatch = getRecentRecipients().find((r) => r.address === data.recipient);
  const isFirstTime = !recentMatch && !recipientLabel;

  // Balance impact
  const balanceImpactPct = data.sender_balance && data.sender_balance > 0
    ? Math.round((data.amount / data.sender_balance) * 100)
    : null;
  const isLargeTransfer = (balanceImpactPct !== null && balanceImpactPct >= 50) ||
    (data.is_native_sol && data.amount >= 10) ||
    (!data.is_native_sol && data.amount >= 1000);
  const requiresTypeConfirm = balanceImpactPct !== null && balanceImpactPct >= 80;

  // Risk signals
  const risks: { level: "warn" | "caution"; message: string }[] = [];
  if (!data.is_verified && !data.is_native_sol) {
    risks.push({ level: "warn", message: "This token is not verified. Double-check the mint address." });
  }
  if (isFirstTime) {
    risks.push({ level: "caution", message: "First time sending to this address." });
  }
  if (balanceImpactPct !== null && balanceImpactPct >= 80) {
    risks.push({ level: "warn", message: `You're sending ${balanceImpactPct}% of your ${data.token} balance.` });
  } else if (balanceImpactPct !== null && balanceImpactPct >= 50) {
    risks.push({ level: "caution", message: `This is ${balanceImpactPct}% of your ${data.token} balance.` });
  }
  for (const w of data.warnings) {
    if (w.toLowerCase().includes("large") || w.includes("verified")) continue; // already handled above
    if (!w.includes("ATA") || data.needs_ata) {
      risks.push({ level: "caution", message: w });
    }
  }

  function copyToClipboard(text: string, type: "addr" | "tx") {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  // Execution lock — prevents double-click across renders
  const executionLockRef = useRef(false);
  // Attempt counter — ensures each retry gets a fresh blockhash (not stale cache)
  const attemptRef = useRef(0);

  async function handleConfirm() {
    // Triple guard: state + wallet + lock
    if (status !== "preview" || !walletAddress || executionLockRef.current) return;

    // Verify wallet hasn't changed since preview
    if (walletAddress !== data!.sender) {
      setError("Wallet changed since preview. Please request a new transfer preview.");
      setStatus("error");
      return;
    }

    executionLockRef.current = true;
    attemptRef.current++;
    setStatus("executing");
    setError(null);

    // Idempotency key: stable within same click (prevents double-click),
    // but changes on retry (ensures fresh blockhash after error)
    const requestId = `txf_${data!.sender.slice(0,6)}_${data!.recipient.slice(0,6)}_${data!.amount}_${attemptRef.current}`;

    try {
      // Step 1: Build unsigned transaction (idempotent)
      const buildController = new AbortController();
      const buildTimer = setTimeout(() => buildController.abort(), 15000);

      const buildResp = await fetch("/api/transfer/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: data!.sender,
          recipient: data!.recipient,
          token: data!.token,
          amount: data!.amount,
          mint: data!.mint,
          decimals: data!.decimals,
          is_native_sol: data!.is_native_sol,
          is_token2022: (data as Record<string, unknown>).is_token2022 ?? false,
          request_id: requestId,
        }),
        signal: buildController.signal,
      }).finally(() => clearTimeout(buildTimer));

      const buildJson = await buildResp.json().catch(() => null);
      if (!buildResp.ok || !buildJson) {
        throw new Error(buildJson?.error ?? "Failed to build transaction");
      }

      const txBase64 = buildJson.transaction;
      if (!txBase64 || typeof txBase64 !== "string") {
        throw new Error("Server returned invalid transaction data");
      }

      // Step 2: Sign with wallet (60s timeout)
      setStatus("signing");

      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      // HIGH FIX: Use wallet adapter from window.solana with proper validation
      // Note: window.solana works for Phantom, Solflare, Backpack — the major Solana wallets
      // The wallet-adapter-react signTransaction requires component-level hook access which
      // we can't use inside a memo callback. This is the standard pattern for signing in
      // event handlers outside of hooks.
      const walletAdapter = (window as unknown as { solana?: { signTransaction: (tx: unknown) => Promise<unknown> } }).solana;
      if (!walletAdapter?.signTransaction) {
        throw new Error("Wallet not available. Please connect your wallet.");
      }

      // Wallet signing with 60s timeout (user may need time to approve)
      const signTimeout = new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error("Wallet signing timed out. Please try again.")), 60_000);
        // Don't block Node.js exit
        if (typeof t === "object" && "unref" in t) (t as NodeJS.Timeout).unref();
      });
      const signed = await Promise.race([
        walletAdapter.signTransaction(tx),
        signTimeout,
      ]) as { serialize?: () => Uint8Array } | null;

      if (!signed || typeof signed.serialize !== "function") {
        throw new Error("Wallet returned invalid signed transaction");
      }

      // CRITICAL FIX: Chunked base64 encoding (no spread operator overflow)
      const signedBytes = signed.serialize();
      let signedBase64 = "";
      const CHUNK = 8192;
      for (let i = 0; i < signedBytes.length; i += CHUNK) {
        const slice = signedBytes.subarray(i, Math.min(i + CHUNK, signedBytes.length));
        signedBase64 += String.fromCharCode(...slice);
      }
      signedBase64 = btoa(signedBase64);

      // Step 3: Broadcast
      const broadcastController = new AbortController();
      const broadcastTimer = setTimeout(() => broadcastController.abort(), 20000);

      const broadcastResp = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: signedBase64 }),
        signal: broadcastController.signal,
      }).finally(() => clearTimeout(broadcastTimer));

      const broadcastJson = await broadcastResp.json().catch(() => null);
      if (!broadcastResp.ok || !broadcastJson) {
        throw new Error("Failed to broadcast transaction");
      }

      // Validate signature format
      const sig = broadcastJson.signature;
      if (!sig || typeof sig !== "string" || sig.length < 80) {
        throw new Error("Broadcast returned invalid signature");
      }

      // Step 4: Wait for on-chain confirmation (poll getSignatureStatuses)
      // Never show "Confirmed on-chain" until actually confirmed
      setTxSig(sig);
      setStatus("confirming");

      const { Connection } = await import("@solana/web3.js");
      const conn = new Connection("/api/rpc", "confirmed");

      let confirmed = false;
      const confirmStart = Date.now();
      const CONFIRM_TIMEOUT = 30_000;
      const POLL_MS = 2_000;

      while (Date.now() - confirmStart < CONFIRM_TIMEOUT) {
        try {
          const { value } = await conn.getSignatureStatuses([sig]);
          const s = value[0];
          if (s?.err) {
            throw new Error("Transaction failed on-chain. Check Solscan for details.");
          }
          if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
            confirmed = true;
            break;
          }
        } catch (pollErr) {
          if (pollErr instanceof Error && pollErr.message.includes("failed on-chain")) throw pollErr;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      setTxConfirmed(confirmed);

      if (confirmed) {
        setStatus("success");
        // Only save as success when ACTUALLY confirmed on-chain
        saveRecentRecipient(data!.recipient, recipientLabel?.label ?? data!.recipient_short);
        saveTransferHistory({
          token: data!.token, amount: data!.amount, recipient: data!.recipient,
          recipientLabel: recipientLabel?.label ?? null,
          txSignature: sig, timestamp: Date.now(), status: "success",
        });
      } else {
        // Tx broadcast but NOT confirmed — show honest error, not false success
        throw new Error(
          "Transaction was broadcast but not confirmed within 30 seconds. " +
          "It may still land — check Solscan before retrying. Signature: " + sig.slice(0, 12) + "..."
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transfer failed";
      setError(msg);
      setStatus("error");
    } finally {
      executionLockRef.current = false;
    }
  }

  // ======== SUCCESS STATE ========
  if (status === "success" && txSig) {
    return (
      <div className="glass-card-solid overflow-hidden success-glow" style={{ borderColor: "rgba(0,210,106,0.15)" }}>
        {/* Success header */}
        <div className="px-5 py-5 flex items-center gap-4">
          <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(0,210,106,0.1)", border: "1px solid rgba(0,210,106,0.2)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-long)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div>
            <div className="text-[15px] font-semibold text-text-primary">Transfer Complete</div>
            <div className="text-[13px] text-text-tertiary mt-0.5">
              {data.amount_display} sent to {recipientDisplay}
            </div>
          </div>
        </div>

        {/* Confirmation steps — honest status */}
        <div className="px-5 pb-2">
          <ConfirmStep done label="Transaction signed" />
          <ConfirmStep done label="Broadcast to Solana" />
          <ConfirmStep done={txConfirmed} label={txConfirmed ? "Confirmed on-chain" : "Awaiting confirmation..."} />
        </div>

        {/* Explorer + copy + trust signal */}
        <div className="px-5 pb-4">
          <div className="flex items-center gap-3 mb-3">
            <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer"
              className="text-[12px] font-medium text-accent-blue hover:underline flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
              </svg>
              View on Solscan
            </a>
            <button onClick={() => copyToClipboard(txSig!, "tx")}
              className="text-[11px] font-mono text-text-tertiary hover:text-text-secondary cursor-pointer flex items-center gap-1 transition-colors">
              {copied === "tx" ? (
                <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-long)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg> Copied</>
              ) : (
                <><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg> Copy hash</>
              )}
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Secured and verified on the Solana network
          </div>
        </div>
      </div>
    );
  }

  // ======== ERROR STATE ========
  if (status === "error" && error) {
    const { message, suggestion } = humanizeError(error);
    return (
      <div className="glass-card-solid overflow-hidden" style={{ borderColor: "rgba(255,77,77,0.15)" }}>
        <div className="px-5 py-5 flex items-start gap-3">
          <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: "rgba(255,77,77,0.1)", border: "1px solid rgba(255,77,77,0.2)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-short)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </span>
          <div>
            <div className="text-[14px] font-semibold text-text-primary mb-1">Transfer Failed</div>
            <div className="text-[13px] text-text-secondary leading-relaxed">{message}</div>
            <div className="text-[12px] text-text-tertiary mt-2">{suggestion}</div>
          </div>
        </div>
        <div className="flex border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
          <button onClick={() => { setStatus("preview"); setError(null); }}
            className="btn-secondary flex-1 py-3 text-[13px] font-semibold text-text-secondary cursor-pointer hover:text-text-primary transition-colors">
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ======== PREVIEW STATE ========
  return (
    <div className="glass-card-solid overflow-hidden">
      {/* ---- Header: "You are sending..." ---- */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-blue)" strokeWidth="1.8" strokeLinecap="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </span>
          <div>
            <div className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: "var(--color-text-tertiary)" }}>
              You are sending
            </div>
            <div className="text-[22px] font-bold tracking-tight num text-text-primary leading-tight mt-0.5">
              {data.amount_display}
            </div>
          </div>
        </div>

        {/* ---- Transfer flow visualization ---- */}
        <div className="flex items-center gap-3 px-1">
          {/* From */}
          <div className="flex-1 rounded-xl px-3.5 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-tertiary)" }}>From</div>
            <div className="text-[13px] font-mono font-medium text-text-primary">{data.sender_short}</div>
          </div>

          {/* Arrow */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" className="shrink-0">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>

          {/* To */}
          <div className="flex-1 rounded-xl px-3.5 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-tertiary)" }}>To</div>
            <div className="text-[13px] font-mono font-medium text-text-primary">
              {recipientLabel ? (
                <span className="flex items-center gap-1.5">
                  {recipientLabel.label}
                  {recipientLabel.type === "cex" && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-sans"
                      style={{ background: "rgba(59,130,246,0.12)", color: "var(--color-accent-blue)" }}>
                      Exchange
                    </span>
                  )}
                </span>
              ) : data.recipient_short}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Details ---- */}
      <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[12px] text-text-tertiary">Token</span>
          <span className="text-[12px] font-medium text-text-primary flex items-center gap-1.5">
            {data.token_name}
            {data.is_verified ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-accent-blue)">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,166,35,0.12)", color: "var(--color-accent-warn)" }}>
                Unverified
              </span>
            )}
          </span>
        </div>
        {data.mint_short && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[12px] text-text-tertiary">Mint</span>
            <span className="text-[11px] font-mono text-text-secondary">{data.mint_short}</span>
          </div>
        )}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[12px] text-text-tertiary">Network Fee</span>
          <span className="text-[12px] num text-text-secondary">{data.total_fee_sol.toFixed(6)} SOL</span>
        </div>
        {data.needs_ata && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[12px] text-text-tertiary">Account Creation</span>
            <span className="text-[12px] num text-text-secondary">~{data.ata_fee_sol.toFixed(4)} SOL</span>
          </div>
        )}
      </div>

      {/* ---- Risk signals ---- */}
      {risks.length > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {risks.map((r, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5 last:mb-0">
              <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: r.level === "warn" ? "rgba(245,166,35,0.12)" : "rgba(59,130,246,0.12)" }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none"
                  stroke={r.level === "warn" ? "var(--color-accent-warn)" : "var(--color-accent-blue)"} strokeWidth="3" strokeLinecap="round">
                  <line x1="12" y1="9" x2="12" y2="13" /><circle cx="12" cy="17" r="1" fill={r.level === "warn" ? "var(--color-accent-warn)" : "var(--color-accent-blue)"} />
                </svg>
              </span>
              <span className="text-[12px] leading-relaxed"
                style={{ color: r.level === "warn" ? "var(--color-accent-warn)" : "var(--color-text-secondary)" }}>
                {r.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Balance impact ---- */}
      {balanceImpactPct !== null && data.sender_balance != null && data.sender_balance > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-text-tertiary">Balance Impact</span>
            <span className="text-[11px] num" style={{
              color: balanceImpactPct >= 80 ? "var(--color-accent-short)" : balanceImpactPct >= 50 ? "var(--color-accent-warn)" : "var(--color-text-secondary)"
            }}>
              {balanceImpactPct}% of your {data.token}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full transition-all duration-300" style={{
              width: `${Math.min(balanceImpactPct, 100)}%`,
              background: balanceImpactPct >= 80 ? "var(--color-accent-short)" : balanceImpactPct >= 50 ? "var(--color-accent-warn)" : "var(--color-accent-blue)",
            }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px] num text-text-tertiary">
            <span>Before: {data.sender_balance < 1 ? data.sender_balance.toFixed(4) : data.sender_balance.toFixed(2)} {data.token}</span>
            <span>After: {(data.sender_balance - data.amount) < 0.0001 ? "0" : (data.sender_balance - data.amount).toFixed(data.sender_balance < 1 ? 4 : 2)} {data.token}</span>
          </div>
        </div>
      )}

      {/* ---- Recipient full address (copyable) ---- */}
      <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] text-text-tertiary">Recipient Address</span>
            {recentMatch && (
              <span className="text-[9px] text-text-tertiary">
                (sent before)
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-text-secondary break-all leading-relaxed">{data.recipient}</div>
        </div>
        <button onClick={() => copyToClipboard(data!.recipient, "addr")}
          className="shrink-0 ml-3 w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:bg-white/[0.05]"
          title="Copy address">
          {copied === "addr" ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-long)" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* ---- In-flight status ---- */}
      {(status === "executing" || status === "signing" || status === "confirming") && (
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <span className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full shrink-0" style={{ animation: "spin 0.8s linear infinite" }} />
          <span className="text-[13px] text-text-secondary">
            {status === "executing" ? "Building transaction..." : status === "signing" ? "Approve in your wallet..." : "Confirming on-chain..."}
          </span>
        </div>
      )}

      {/* ---- Confirm section ---- */}
      {status === "preview" && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {/* Type CONFIRM gate for large transfers */}
          {requiresTypeConfirm && walletAddress && (
            <div className="px-5 pt-3 pb-2">
              <div className="text-[11px] text-text-tertiary mb-2">
                Type <span className="font-bold text-text-secondary">CONFIRM</span> to proceed with this large transfer
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type CONFIRM"
                className="w-full px-3 py-2 rounded-lg text-[13px] font-mono bg-transparent outline-none
                  text-text-primary placeholder:text-text-tertiary"
                style={{ border: "1px solid var(--color-border-subtle)" }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          <div className="flex">
            <button onClick={handleConfirm}
              disabled={!walletAddress || (requiresTypeConfirm && confirmInput.trim().toUpperCase() !== "CONFIRM") || status !== "preview"}
              className="btn-primary flex-1 py-4 text-[14px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default"
              style={{ color: "#070A0F", background: "var(--color-accent-lime)", borderRadius: "0 0 16px 16px" }}>
              {!walletAddress
                ? "Connect Wallet"
                : `Send ${data.amount_display} to ${recipientDisplay}`}
            </button>
          </div>

          {/* Trust signal */}
          <div className="flex items-center justify-center gap-1.5 py-2 text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Executed on-chain via Solana
          </div>
        </div>
      )}
    </div>
  );
});

// ---- FAF Error Humanization ----
function humanizeFafError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("instructionerror") && lower.includes("custom"))
    return "Transaction failed on-chain. You may not have enough FAF tokens, or the staking program rejected the request.";
  if (lower.includes("not been authorized"))
    return "Your wallet couldn't connect to the staking program. Try disconnecting and reconnecting your wallet.";
  if (lower.includes("simulation failed"))
    return "This transaction would fail. Check your FAF balance and try a different amount.";
  if (lower.includes("insufficient"))
    return "Not enough tokens to complete this action. Check your balance.";
  if (lower.includes("not confirmed"))
    return "Transaction was sent but not confirmed. Check Solscan before retrying.";
  if (lower.includes("wallet not available") || lower.includes("connect"))
    return "Wallet not connected. Please connect your wallet and try again.";
  if (lower.includes("rejected"))
    return "Transaction cancelled in your wallet.";
  return raw;
}

// ============================================
// FAF Staking Cards (Dashboard, Stake, Unstake, Claim, Requests, Tier)
// ============================================

const FafCard = memo(function FafCard({ toolName, output, onAction }: { toolName: string; output: ToolOutput; onAction?: (cmd: string) => void }) {
  const data = output.data as Record<string, unknown> | null;
  if (!data) return <ToolError toolName={toolName} error={output.error} />;

  const type = String(data.type ?? "");
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const [status, setStatus] = useState<"idle" | "executing" | "signing" | "confirming" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);

  async function executeFafAction(action: string, params: Record<string, unknown> = {}) {
    if (lockRef.current || !walletAddress) return;
    lockRef.current = true;
    setStatus("executing");
    setError(null);
    try {
      const buildResp = await fetch("/api/faf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, wallet: walletAddress, ...params }),
      });
      const buildJson = await buildResp.json().catch(() => null);
      if (!buildResp.ok || !buildJson?.transaction) throw new Error(buildJson?.error ?? "Failed to build transaction");

      setStatus("signing");
      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(buildJson.transaction), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      const wa = (window as unknown as { solana?: { signTransaction: (t: unknown) => Promise<unknown> } }).solana;
      if (!wa?.signTransaction) throw new Error("Wallet not available");
      const signed = await wa.signTransaction(tx) as { serialize: () => Uint8Array };

      const signedBytes = signed.serialize();
      let signedB64 = "";
      const CHUNK = 8192;
      for (let i = 0; i < signedBytes.length; i += CHUNK) {
        signedB64 += String.fromCharCode(...signedBytes.subarray(i, Math.min(i + CHUNK, signedBytes.length)));
      }
      signedB64 = btoa(signedB64);

      const bResp = await fetch("/api/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: signedB64 }) });
      const bJson = await bResp.json().catch(() => null);
      if (!bResp.ok || !bJson?.signature) throw new Error("Broadcast failed");

      setTxSig(bJson.signature);
      setStatus("confirming");

      // Poll for confirmation
      const { Connection } = await import("@solana/web3.js");
      const conn = new Connection("/api/rpc", "confirmed");
      let confirmed = false;
      const start = Date.now();
      while (Date.now() - start < 30000) {
        try {
          const { value } = await conn.getSignatureStatuses([bJson.signature]);
          const s = value[0];
          if (s?.err) throw new Error("Transaction failed on-chain");
          if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") { confirmed = true; break; }
        } catch (e) { if (e instanceof Error && e.message.includes("failed on-chain")) throw e; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!confirmed) throw new Error("Transaction not confirmed in 30s. Check Solscan.");
      setStatus("success");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed";
      setError(humanizeFafError(raw));
      setStatus("error");
    } finally {
      lockRef.current = false;
    }
  }

  // Success state
  if (status === "success" && txSig) {
    return (
      <div className="glass-card-solid overflow-hidden success-glow" style={{ borderColor: "rgba(0,210,106,0.15)" }}>
        <div className="px-5 py-4 flex items-center gap-3">
          <span className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "rgba(0,210,106,0.1)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-long)" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
          </span>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">Transaction Confirmed</div>
            <a href={`https://solscan.io/tx/${txSig}`} target="_blank" rel="noopener noreferrer" className="text-[12px] font-mono text-accent-blue hover:underline">{txSig.slice(0, 16)}...</a>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="glass-card-solid overflow-hidden" style={{ borderColor: "rgba(255,77,77,0.15)" }}>
        <div className="px-5 py-4">
          <div className="text-[14px] font-semibold text-accent-short mb-1">Failed</div>
          <div className="text-[12px] text-text-tertiary">{error}</div>
        </div>
        <div className="flex border-t border-border-subtle">
          <button onClick={() => { setStatus("idle"); setError(null); }} className="btn-secondary flex-1 py-2.5 text-[12px] font-semibold text-text-secondary cursor-pointer">Retry</button>
        </div>
      </div>
    );
  }

  // In-flight
  if (status !== "idle") {
    return (
      <div className="glass-card-solid overflow-hidden px-5 py-4 flex items-center gap-3">
        <span className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full" style={{ animation: "spin 0.8s linear infinite" }} />
        <span className="text-[13px] text-text-secondary">{status === "executing" ? "Building..." : status === "signing" ? "Sign in wallet..." : "Confirming..."}</span>
      </div>
    );
  }

  // ── OPTIONS (Galileo-style action picker) ──
  if (type === "faf_options") {
    const options = [
      { label: "Dashboard", desc: "Staked FAF, rewards, tier progress", intent: "faf status" },
      { label: "Stake FAF", desc: "Earn rewards + fee discounts", intent: "I want to stake FAF tokens" },
      { label: "Claim Rewards", desc: "FAF rewards + USDC revenue", intent: "claim my faf rewards" },
      { label: "VIP Tiers", desc: "See all tiers and benefits", intent: "show me the vip tiers" },
      { label: "Unstake Requests", desc: "Pending unlocks + progress", intent: "show my unstake requests" },
    ];

    return (
      <div style={{ animation: "slideUp 200ms ease-out" }}>
        <div className="text-[15px] font-semibold text-text-primary mb-3">What would you like to do?</div>
        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onAction?.(opt.intent)}
              className="quick-option group flex items-center justify-between w-full text-left
                px-4 py-3.5 rounded-xl cursor-pointer transition-all"
              style={{
                background: "transparent",
                border: "1px solid var(--color-border-subtle)",
                animationDelay: `${i * 60}ms`,
              }}
            >
              <div className="flex flex-col">
                <span className="text-[14px] font-medium text-text-primary group-hover:text-accent-lime transition-colors">
                  {opt.label}
                </span>
                <span className="text-[12px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                  {opt.desc}
                </span>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round"
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── DASHBOARD (Progression-Driven) ──
  if (type === "faf_dashboard") {
    if (!data.hasAccount) return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-5">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(200,245,71,0.08)", border: "1px solid rgba(200,245,71,0.12)" }}>
              <span className="text-[16px] font-bold" style={{ color: "var(--color-accent-lime)" }}>F</span>
            </span>
            <div>
              <div className="text-[15px] font-semibold text-text-primary">Start Earning with FAF</div>
              <div className="text-[12px] text-text-tertiary">Stake FAF to earn rewards + fee discounts</div>
            </div>
          </div>
          <div className="text-[13px] text-text-secondary leading-relaxed">
            Stake 20,000 FAF to unlock VIP Level 1 with 2.5% trading fee discount and USDC revenue share from protocol fees.
          </div>
        </div>
      </div>
    );

    const staked = safe(data.stakedAmount as number);
    const fafR = safe(data.pendingRewardsFaf as number);
    const usdcR = safe(data.pendingRevenueUsdc as number);
    const rebate = safe(data.pendingRebateUsdc as number);
    const tier = String(data.tierName ?? "None");
    const discount = safe(data.feeDiscount as number);
    const level = safe(data.level as number);
    const nextTier = data.nextTier as Record<string, unknown> | null;
    const toNext = safe(data.amountToNextTier as number);
    const hasRewards = fafR > 0.001 || usdcR > 0.001 || rebate > 0.001;

    // Tier progress calculation
    const nextReq = nextTier ? safe(nextTier.fafRequired as number) : 0;
    const currentReq = level > 0
      ? [0, 20000, 40000, 100000, 200000, 1000000, 2000000][level] ?? 0
      : 0;
    const tierRange = nextReq - currentReq;
    const tierProgress = tierRange > 0
      ? Math.min(100, Math.max(0, ((staked - currentReq) / tierRange) * 100))
      : 100;

    return (
      <div className="glass-card-solid overflow-hidden">
        {/* Header with tier badge */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(200,245,71,0.08)", border: "1px solid rgba(200,245,71,0.12)" }}>
              <span className="text-[16px] font-bold" style={{ color: "var(--color-accent-lime)" }}>F</span>
            </span>
            <div>
              <div className="text-[15px] font-semibold text-text-primary">{staked.toLocaleString()} FAF</div>
              <div className="text-[12px] text-text-tertiary">staked</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] font-semibold px-2.5 py-1 rounded-full"
              style={{ background: level > 0 ? "rgba(200,245,71,0.1)" : "rgba(255,255,255,0.04)", color: level > 0 ? "var(--color-accent-lime)" : "var(--color-text-tertiary)" }}>
              VIP {tier}
            </div>
            <div className="text-[10px] num text-text-tertiary mt-1">{discount}% fee discount</div>
          </div>
        </div>

        {/* Tier progress bar */}
        {nextTier && toNext > 0 && (
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Progress to {String(nextTier.name)}</span>
              <span className="text-[11px] num font-medium" style={{ color: "var(--color-accent-lime)" }}>{Math.round(tierProgress)}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${tierProgress}%`, background: "linear-gradient(90deg, var(--color-accent-lime), rgba(200,245,71,0.6))" }} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-text-tertiary">
              <span>Stake {toNext.toLocaleString()} more</span>
              <span>+{safe((nextTier as Record<string, unknown>).feeDiscount as number) - discount}% fee discount</span>
            </div>
          </div>
        )}

        {/* Rewards section */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="px-5 py-3">
            <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Earnings</div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="text-[18px] font-bold num" style={{ color: fafR > 0 ? "var(--color-accent-long)" : "var(--color-text-secondary)" }}>
                  {fafR.toFixed(2)} <span className="text-[11px] font-normal text-text-tertiary">FAF</span>
                </div>
                <div className="text-[10px] text-text-tertiary mt-0.5">staking rewards</div>
              </div>
              <div className="w-px h-8" style={{ background: "rgba(255,255,255,0.06)" }} />
              <div className="flex-1">
                <div className="text-[18px] font-bold num" style={{ color: usdcR > 0 ? "var(--color-accent-long)" : "var(--color-text-secondary)" }}>
                  ${usdcR.toFixed(2)} <span className="text-[11px] font-normal text-text-tertiary">USDC</span>
                </div>
                <div className="text-[10px] text-text-tertiary mt-0.5">revenue share</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action triggers */}
        {hasRewards && (
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(0,210,106,0.03)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-long)", animation: "pulseDot 2s infinite" }} />
            <span className="text-[12px] text-accent-long">You have rewards waiting to be claimed</span>
          </div>
        )}

        {nextTier && toNext > 0 && toNext < staked * 0.2 && !hasRewards && (
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", background: "rgba(200,245,71,0.02)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-lime)" }} />
            <span className="text-[12px]" style={{ color: "var(--color-accent-lime)" }}>You're close to {String(nextTier.name)}!</span>
          </div>
        )}

        {/* Action options (Galileo-style) */}
        {onAction && (
          <div className="flex flex-wrap gap-2 px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            {[
              { label: "Stake FAF", intent: "I want to stake FAF tokens" },
              { label: "Claim Rewards", intent: "claim my faf rewards" },
              { label: "VIP Tiers", intent: "show me the vip tiers" },
              { label: "Unstake", intent: "I want to unstake FAF" },
              { label: "Requests", intent: "show my unstake requests" },
            ].map((opt) => (
              <button key={opt.label} onClick={() => onAction(opt.intent)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer
                  transition-all duration-100 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "var(--color-text-secondary)",
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── STAKE PREVIEW ──
  if (type === "faf_stake_preview") {
    const amount = safe(data.amount as number);
    const newTier = String(data.newTier ?? "None");
    const newDiscount = safe(data.newFeeDiscount as number);
    const tierChanged = data.tierChanged as boolean;

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1">You are staking</div>
          <div className="text-[22px] font-bold num text-text-primary">{amount.toLocaleString()} FAF</div>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Current Stake" value={`${safe(data.currentStake as number).toLocaleString()} FAF`} />
          <Cell label="New Stake" value={`${safe(data.newStake as number).toLocaleString()} FAF`} />
          <Cell label="New Tier" value={newTier} color={tierChanged ? "var(--color-accent-lime)" : undefined} />
          <Cell label="Fee Discount" value={`${newDiscount}%`} />
        </div>
        {tierChanged && <div className="px-5 py-3 text-[12px] text-accent-lime" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>Tier upgrade! You'll reach {newTier} with this stake.</div>}
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={() => executeFafAction("stake", { amount })} disabled={!walletAddress}
            className="btn-primary flex-1 py-3.5 text-[14px] font-bold cursor-pointer disabled:opacity-25"
            style={{ color: "#070A0F", background: "var(--color-accent-lime)", borderRadius: "0 0 16px 16px" }}>
            Confirm Stake
          </button>
        </div>
      </div>
    );
  }

  // ── UNSTAKE PREVIEW ──
  if (type === "faf_unstake_preview") {
    const amount = safe(data.amount as number);

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1">You are unstaking</div>
          <div className="text-[22px] font-bold num text-text-primary">{amount.toLocaleString()} FAF</div>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Remaining Stake" value={`${safe(data.remainingStake as number).toLocaleString()} FAF`} />
          <Cell label="New Tier" value={String(data.newTier ?? "None")} />
          <Cell label="Lock Period" value="90 days" color="var(--color-accent-warn)" />
          <Cell label="Unlock Date" value={String(data.unlockDate ?? "")} />
        </div>
        <div className="px-5 py-3 flex items-start gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-warn)" strokeWidth="2" className="mt-0.5 shrink-0"><path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
          <span className="text-[12px] text-accent-warn leading-relaxed">{String(data.warning)}</span>
        </div>
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={() => executeFafAction("unstake", { amount })} disabled={!walletAddress}
            className="btn-primary flex-1 py-3.5 text-[14px] font-bold cursor-pointer disabled:opacity-25"
            style={{ color: "#070A0F", background: "var(--color-accent-warn)", borderRadius: "0 0 16px 16px" }}>
            Confirm Unstake (90-day lock)
          </button>
        </div>
      </div>
    );
  }

  // ── CLAIM PREVIEW ──
  if (type === "faf_claim_preview") {
    const fafR = safe(data.fafRewards as number);
    const usdcR = safe(data.usdcRevenue as number);
    const claimType = String(data.claim_type ?? "all");

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">Claim Rewards</div>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          {fafR > 0 && <Cell label="FAF Rewards" value={`${fafR.toFixed(4)} FAF`} color="var(--color-accent-long)" />}
          {usdcR > 0 && <Cell label="USDC Revenue" value={`$${usdcR.toFixed(2)}`} color="var(--color-accent-long)" />}
        </div>
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {(claimType === "all" || claimType === "rewards") && fafR > 0 && (
            <button onClick={() => executeFafAction("claim_rewards")} disabled={!walletAddress}
              className="btn-primary flex-1 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-25"
              style={{ color: "#070A0F", background: "var(--color-accent-lime)", borderRadius: usdcR > 0 ? "0" : "0 0 16px 16px" }}>
              Claim FAF
            </button>
          )}
          {(claimType === "all" || claimType === "revenue") && usdcR > 0 && (
            <button onClick={() => executeFafAction("claim_revenue")} disabled={!walletAddress}
              className="btn-primary flex-1 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-25"
              style={{ color: "#070A0F", background: "var(--color-accent-blue)", borderRadius: fafR > 0 ? "0 0 16px 0" : "0 0 16px 16px" }}>
              Claim USDC
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── REQUESTS LIST ──
  if (type === "faf_requests") {
    const requests = (data.requests as Record<string, unknown>[]) ?? [];
    if (requests.length === 0) return (
      <div className="glass-card-solid overflow-hidden px-5 py-5">
        <div className="text-[14px] text-text-secondary">No pending unstake requests.</div>
      </div>
    );

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">Unstake Requests</div>
          <div className="text-[12px] text-text-tertiary">{requests.length} pending</div>
        </div>
        {requests.map((req, i) => {
          const locked = safe(req.lockedAmount as number);
          const withdrawable = safe(req.withdrawableAmount as number);
          const progress = safe(req.progressPercent as number);
          const timeLeft = safe(req.timeRemainingSeconds as number);
          const daysLeft = Math.ceil(timeLeft / 86400);

          return (
            <div key={i} className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-text-primary">#{i} · {(locked + withdrawable).toFixed(2)} FAF</span>
                <span className="text-[11px] num text-text-tertiary">{daysLeft > 0 ? `${daysLeft}d left` : "Unlocked"}</span>
              </div>
              <div className="w-full h-1.5 rounded-full overflow-hidden mb-2" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div className="h-full rounded-full" style={{ width: `${progress}%`, background: progress >= 100 ? "var(--color-accent-long)" : "var(--color-accent-blue)", transition: "width 300ms" }} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-text-tertiary">
                <span>{progress}% unlocked</span>
                {progress < 100 && (
                  <button onClick={() => executeFafAction("cancel_unstake", { index: i })} disabled={!walletAddress}
                    className="text-accent-short hover:underline cursor-pointer">Cancel</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── CANCEL PREVIEW ──
  if (type === "faf_cancel_preview") {
    const amount = safe(data.amount as number);
    const idx = safe(data.index as number);

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">Cancel Unstake Request #{idx}</div>
          <div className="text-[13px] text-text-tertiary mt-1">{amount.toFixed(2)} FAF will be returned to your active stake.</div>
        </div>
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button onClick={() => executeFafAction("cancel_unstake", { index: idx })} disabled={!walletAddress}
            className="btn-primary flex-1 py-3.5 text-[14px] font-bold cursor-pointer disabled:opacity-25"
            style={{ color: "#070A0F", background: "var(--color-accent-lime)", borderRadius: "0 0 16px 16px" }}>
            Confirm Cancel → Re-stake
          </button>
        </div>
      </div>
    );
  }

  // ── TIERS ──
  if (type === "faf_tiers") {
    const tiers = (data.tiers as Record<string, unknown>[]) ?? [];
    const currentLevel = safe(data.currentLevel as number);
    const staked = safe(data.stakedAmount as number);

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">VIP Tiers</div>
          <div className="text-[12px] text-text-tertiary">You have {staked.toLocaleString()} FAF staked</div>
        </div>
        {tiers.map((t, i) => {
          const level = safe(t.level as number);
          const name = String(t.name ?? `Level ${level}`);
          const req = safe(t.fafRequired as number);
          const discount = safe(t.feeDiscount as number);
          const isActive = level === currentLevel;

          return (
            <div key={i} className="flex items-center justify-between px-5 py-2.5"
              style={{
                borderTop: "1px solid rgba(255,255,255,0.04)",
                background: isActive ? "rgba(200,245,71,0.04)" : "transparent",
              }}>
              <div className="flex items-center gap-2">
                {isActive && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-lime)" }} />}
                <span className={`text-[13px] ${isActive ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{name}</span>
              </div>
              <div className="flex items-center gap-4 text-[11px] num text-text-tertiary">
                <span>{req > 0 ? `${(req / 1000).toFixed(0)}K FAF` : "Free"}</span>
                <span className="w-12 text-right">{discount}% off</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Fallback
  return <GenericCard toolName={toolName} output={output} />;
});

// ============================================
// Transfer History + Insights Card
// ============================================

const TransferHistoryCard = memo(function TransferHistoryCard({ output }: { output: ToolOutput }) {
  const data = output.data as {
    total_transfers: number;
    total_successful: number;
    recent_transfers: TransferRecord[];
    top_tokens: { token: string; count: number; total_amount: number }[];
    top_recipients: { address: string; label: string | null; count: number }[];
    volume_summary: {
      last_24h: { count: number; tokens: string[] };
      last_7d: { count: number; tokens: string[] };
      last_30d: { count: number; tokens: string[] };
    };
  } | null;

  if (!data) return <ToolError toolName="transfer_history" error={output.error} />;

  if (data.total_transfers === 0) {
    return (
      <div className="glass-card-solid overflow-hidden px-5 py-5">
        <div className="text-[14px] text-text-secondary">No transfer history yet. Send your first transfer to start tracking.</div>
      </div>
    );
  }

  function timeAgo(ts: number): string {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  return (
    <div className="glass-card-solid overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3">
        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.15)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-purple)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l3 3" /><circle cx="12" cy="12" r="10" />
          </svg>
        </span>
        <div>
          <div className="text-[15px] font-semibold text-text-primary">Transfer History</div>
          <div className="text-[12px] text-text-tertiary">{data.total_successful} successful transfer{data.total_successful !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* Insights row */}
      {data.top_tokens.length > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Most used tokens</div>
          <div className="flex flex-wrap gap-2">
            {data.top_tokens.map((t) => (
              <span key={t.token} className="text-[12px] px-2.5 py-1 rounded-full font-medium"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--color-text-secondary)" }}>
                {t.token} <span className="num text-text-tertiary">({t.count}x)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top recipients */}
      {data.top_recipients.length > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Frequent recipients</div>
          {data.top_recipients.slice(0, 3).map((r) => (
            <div key={r.address} className="flex items-center justify-between py-1">
              <span className="text-[12px] font-mono text-text-secondary">
                {r.label ?? `${r.address.slice(0, 4)}...${r.address.slice(-4)}`}
              </span>
              <span className="text-[11px] num text-text-tertiary">{r.count} transfer{r.count !== 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recent transfers */}
      <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Recent</div>
        {data.recent_transfers.slice(0, 5).map((t, i) => (
          <div key={i} className="flex items-center justify-between py-1.5"
            style={{ borderBottom: i < Math.min(data.recent_transfers.length, 5) - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-long)" }} />
              <span className="text-[12px] font-medium text-text-primary">{t.amount} {t.token}</span>
              <span className="text-[11px] text-text-tertiary">→ {t.recipientLabel ?? `${t.recipient.slice(0, 4)}...${t.recipient.slice(-4)}`}</span>
            </div>
            <span className="text-[10px] text-text-tertiary">{timeAgo(t.timestamp)}</span>
          </div>
        ))}
      </div>

      {/* Volume summary */}
      <div className="grid grid-cols-3 gap-px" style={{ background: "var(--color-border-subtle)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="px-3 py-3 text-center" style={{ background: "var(--color-bg-card-solid)" }}>
          <div className="text-[16px] num font-bold text-text-primary">{data.volume_summary.last_24h.count}</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Last 24h</div>
        </div>
        <div className="px-3 py-3 text-center" style={{ background: "var(--color-bg-card-solid)" }}>
          <div className="text-[16px] num font-bold text-text-primary">{data.volume_summary.last_7d.count}</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Last 7d</div>
        </div>
        <div className="px-3 py-3 text-center" style={{ background: "var(--color-bg-card-solid)" }}>
          <div className="text-[16px] num font-bold text-text-primary">{data.volume_summary.last_30d.count}</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Last 30d</div>
        </div>
      </div>
    </div>
  );
});

const GenericCard = memo(function GenericCard({ toolName, output }: { toolName: string; output: ToolOutput }) {
  return <div className="text-[13px] text-text-secondary py-1.5">{toolName}: {output.status === "success" ? "Done" : output.error ?? "Error"}</div>;
});
