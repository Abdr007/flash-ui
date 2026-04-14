"use client";

// ============================================
// Flash AI — Trade Preview Card
// Extracted from ToolResultCard.tsx (TradePreviewCard + TradeHints)
// ============================================

import { memo, useState, useEffect } from "react";
import { validateTrade, type TradePreview } from "@/lib/trade-firewall";
import { getTradeConfidence } from "@/lib/predictive-actions";
import { useFlashStore } from "@/store";
import { useNumberSpring, useBounceIn } from "@/hooks/useSpring";
import { formatPrice, formatUsd, formatLeverage, formatPercent, liqDistancePct, safe } from "@/lib/format";
import { HIGH_LEVERAGE_THRESHOLD } from "@/lib/constants";
import {
  getPreferredSlDistance,
  getPreferredTpDistance,
  getRiskProfile,
  getCrossFeatureHint,
  getGuidanceLevel,
  shouldBoostSlSuggestion,
  recordSuggestionShown,
  recordSuggestionAccepted,
} from "@/lib/user-patterns";

import { Cell, ConfidenceBadge, ToolError, TxSuccessCard, validateTpSlAgainstEntry } from "./shared";
import type { ToolOutput } from "./types";

// ---- Trade Hints (internal) ----

interface TradeHint {
  label: string;
  intent: string;
  color: string;
  // For TP/SL suggestions: apply directly to the card inputs instead of
  // filling the chat bar. Leaves other hints (leverage, collateral, cross)
  // on the existing textarea-fill flow.
  applyTp?: number;
  applySl?: number;
}

const TradeHints = memo(function TradeHints({
  trade,
  onApplyTp,
  onApplySl,
  onAction,
}: {
  trade: TradePreview;
  onApplyTp?: (value: number) => void;
  onApplySl?: (value: number) => void;
  onAction?: (cmd: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  // Per-chip applied state: applying TP must NOT remove the SL chip and
  // vice versa. Previously a single `dismissed` flag killed every chip on
  // the first click.
  const [tpApplied, setTpApplied] = useState(false);
  const [slApplied, setSlApplied] = useState(false);

  if (dismissed) return null;

  const hints: TradeHint[] = [];

  // Learned preferences (adapts to user behavior over time)
  const slDistPct = getPreferredSlDistance(); // learned or default 5%
  const tpDistPct = getPreferredTpDistance(); // learned or default 10%
  const riskProfile = getRiskProfile();

  // No SL → suggest adding one (boosted if outcome data shows SL helps)
  if (!trade.stop_loss_price && !slApplied) {
    const slMul = trade.side === "LONG" ? 1 - slDistPct / 100 : 1 + slDistPct / 100;
    const suggestedSl = Math.round(trade.entry_price * slMul * 100) / 100;
    const boost = shouldBoostSlSuggestion();
    hints.push({
      label: boost
        ? `Add SL ~$${suggestedSl.toLocaleString()} (improves your win rate)`
        : `Add SL ~$${suggestedSl.toLocaleString()}`,
      intent: `${trade.side.toLowerCase()} ${trade.market} $${trade.collateral_usd} ${trade.leverage}x sl ${suggestedSl}`,
      color: "var(--color-accent-short)",
      applySl: suggestedSl,
    });
  }

  // No TP → suggest adding one (using user's preferred distance)
  if (!trade.take_profit_price && !tpApplied) {
    const tpMul = trade.side === "LONG" ? 1 + tpDistPct / 100 : 1 - tpDistPct / 100;
    const suggestedTp = Math.round(trade.entry_price * tpMul * 100) / 100;
    hints.push({
      label: `Add TP ~$${suggestedTp.toLocaleString()}`,
      intent: `${trade.side.toLowerCase()} ${trade.market} $${trade.collateral_usd} ${trade.leverage}x tp ${suggestedTp}`,
      color: "var(--color-accent-long)",
      applyTp: suggestedTp,
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
  try {
    recordSuggestionShown(`${trade.market}:${trade.side}:${hints.length}`);
  } catch {}

  return (
    <div
      className="px-4 py-2.5 flex flex-wrap gap-1.5 border-t border-border-subtle"
      style={{ animation: "fadeIn 200ms ease-out" }}
    >
      {hints.slice(0, 3).map((h, i) => (
        <button
          key={i}
          onClick={() => {
            try {
              recordSuggestionAccepted();
            } catch {}

            // TP/SL hints apply to the inline card inputs and hide ONLY
            // their own chip. Other hints (leverage, collateral, cross-
            // feature) still fill the chat textarea and dismiss the row.
            if (h.applyTp != null && onApplyTp) {
              onApplyTp(h.applyTp);
              setTpApplied(true);
              return;
            }
            if (h.applySl != null && onApplySl) {
              onApplySl(h.applySl);
              setSlApplied(true);
              return;
            }

            setDismissed(true);
            if (h.intent && onAction) {
              onAction(h.intent);
            }
          }}
          aria-label={h.label}
          className="chip text-[11px] px-3 py-1.5 cursor-pointer"
          style={{ color: h.color, background: `${h.color}08`, border: `1px solid ${h.color}20` }}
        >
          {h.label}
        </button>
      ))}
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss suggestions"
        className="text-[10px] text-text-tertiary px-2 py-1.5 cursor-pointer hover:text-text-secondary"
      >
        ✕
      </button>
    </div>
  );
});

// ---- Trade Preview Card ----

const TradePreviewCard = memo(function TradePreviewCard({
  output,
  onAction,
}: {
  output: ToolOutput;
  onAction?: (cmd: string) => void;
}) {
  // ─── ALL HOOKS MUST BE CALLED UNCONDITIONALLY ───
  // Early returns below must not be moved above this block or React will
  // see a mismatched hook count between renders and crash with
  // "Rendered fewer hooks than expected".
  const [submitting, setSubmitting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  // Pre-fill TP/SL drafts if the trade preview already has them (e.g., limit orders with TP/SL)
  const previewData = output.data as Record<string, unknown> | null;
  const initialTp = previewData?.take_profit_price ? String(previewData.take_profit_price) : "";
  const initialSl = previewData?.stop_loss_price ? String(previewData.stop_loss_price) : "";
  const [tpDraft, setTpDraft] = useState<string>(initialTp);
  const [slDraft, setSlDraft] = useState<string>(initialSl);
  const positions = useFlashStore((s) => s.positions);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const setTradeFromAI = useFlashStore((s) => s.setTradeFromAI);
  const confirmTrade = useFlashStore((s) => s.confirmTrade);
  const executeTrade = useFlashStore((s) => s.executeTrade);
  const cancelTrade = useFlashStore((s) => s.cancelTrade);
  const isExecuting = useFlashStore((s) => s.isExecuting);
  const activeTrade = useFlashStore((s) => s.activeTrade);

  // Non-hook derivations (safe before hooks that depend on them)
  const tradeStatus = activeTrade?.status;

  // Outcome tracking — distinguishes SUCCESS from CANCEL (both end with
  // activeTrade=null). Without this, cancelling at the overlay would show
  // "Trade executed" — a VERY bad UX lie.
  const [outcome, setOutcome] = useState<"pending" | "success" | "error">("pending");
  // Capture tx_signature the moment we first see it. The store clears
  // activeTrade 8s after completion to avoid blocking the next trade;
  // without this state, the success card loses its Solscan link mid-view.
  const [capturedSig, setCapturedSig] = useState<string | null>(null);

  // Sync outcome from activeTrade state
  useEffect(() => {
    if (activeTrade?.tx_signature) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOutcome("success");

      setCapturedSig(activeTrade.tx_signature);
    } else if (activeTrade?.status === "ERROR") {
      setOutcome("error");
    }
  }, [activeTrade]);

  // If the trade was cancelled (activeTrade cleared without resolution),
  // reset submitting so the user can try again.
  useEffect(() => {
    if (submitting && !activeTrade && outcome === "pending") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubmitting(false);
    }
  }, [submitting, activeTrade, outcome]);

  const tradeCompleted = submitting && !isExecuting && (outcome === "success" || outcome === "error");

  // Firewall runs during render — synchronous, not a hook
  const firewall = validateTrade(output.data, walletAddress ?? "", positions);
  const firewallValid = firewall.valid;
  const t = firewallValid ? firewall.trade : null;

  // Safe values for hook deps when firewall rejects
  const hookEntry = t?.entry_price ?? 0;
  const hookLiqPrice = t?.liquidation_price ?? 0;
  const hookSide = t?.side ?? "LONG";
  const hookLeverage = t?.leverage ?? 0;
  const hookCollateral = t?.collateral_usd ?? 0;
  const hookPositionSize = t?.position_size ?? 0;
  const hookFees = t?.fees ?? 0;
  const liqDist = t ? liqDistancePct(hookEntry, hookLiqPrice, hookSide) : 0;

  const springLiqDist = useNumberSpring(liqDist);
  const bounceStyle = useBounceIn();

  const confidence = getTradeConfidence({
    market: t?.market ?? "",
    leverage: hookLeverage,
    collateral_usd: hookCollateral,
    position_size: hookPositionSize,
    fees: hookFees,
    entry_price: hookEntry,
    liquidation_price: hookLiqPrice,
    side: hookSide,
  });

  // ─── END HOOKS — early returns and conditional rendering below this line ───

  if (cancelled) return <div className="text-[13px] text-text-tertiary py-2">Trade cancelled.</div>;

  // Trade was submitted and completed successfully — unified success card.
  if (tradeCompleted && (tradeStatus === "SUCCESS" || !activeTrade)) {
    const sig = activeTrade?.tx_signature ?? capturedSig;
    return <TxSuccessCard label="Trade executed" signature={sig} variant="long" />;
  }

  // Trade errored
  if (tradeCompleted && tradeStatus === "ERROR") {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-3.5">
        <div className="text-[13px] text-accent-short mb-2">{activeTrade?.error ?? "Trade failed"}</div>
        <button onClick={() => setSubmitting(false)} className="text-[12px] text-accent-blue cursor-pointer">
          Try again
        </button>
      </div>
    );
  }

  if (!firewall.valid)
    return <ToolError toolName="build_trade" error={`Trade blocked: ${firewall.errors.join("; ")}`} />;
  if (!t) return null;

  const isLong = t.side === "LONG";
  const accent = isLong ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const highLev = t.leverage >= HIGH_LEVERAGE_THRESHOLD;

  // ─── TP/SL draft parse + live validation (derived during render) ───
  const tpParsed = tpDraft.trim() === "" ? null : Number(tpDraft);
  const slParsed = slDraft.trim() === "" ? null : Number(slDraft);
  const tpHint = isLong ? t.entry_price * 1.1 : t.entry_price * 0.9;
  const slHint = isLong ? t.entry_price * 0.95 : t.entry_price * 1.05;
  const triggerError = validateTpSlAgainstEntry(tpParsed, slParsed, t.entry_price, t.side);

  function handleConfirm() {
    if (submitting || isExecuting) return;
    if (triggerError) return;
    setSubmitting(true);

    // Inject drafts into a shallow clone of output.data so setTradeFromAI
    // carries them into the TradeObject, which executeTrade then forwards
    // to buildOpenPosition. The Flash builder bundles TP+SL into the same
    // versioned tx — single signature, single broadcast.
    //
    // IMPORTANT: the firewall schema uses z.number().optional() — .optional()
    // allows a MISSING field, not a null. Passing null silently fails
    // validation and makes the Confirm button appear to do nothing. Only
    // spread the keys when the user actually provided a value.
    const enriched: Record<string, unknown> = { ...(output.data as Record<string, unknown>) };
    if (tpParsed != null) enriched.take_profit_price = tpParsed;
    else delete enriched.take_profit_price;
    if (slParsed != null) enriched.stop_loss_price = slParsed;
    else delete enriched.stop_loss_price;

    const ok = setTradeFromAI(enriched, walletAddress ?? "", positions);
    if (!ok) {
      setSubmitting(false);
      return;
    }

    // Fire-and-forget: confirmTrade sets status=CONFIRMING synchronously,
    // then executeTrade's sync prefix immediately transitions to EXECUTING.
    // React batches these within the same event handler, so the CONFIRMING
    // state is never rendered — no modal interstitial, wallet opens directly.
    confirmTrade();
    void executeTrade();
  }

  return (
    <div
      className={`w-full max-w-[460px] glass-card overflow-hidden ${submitting ? "success-glow" : ""} ${isLong ? "trade-card-long" : "trade-card-short"}`}
      style={{ ...bounceStyle }}
    >
      {/* Header — bold, prominent */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div
            className="w-4 h-4 rounded-full"
            role="img"
            aria-label={`${t.side} position`}
            style={{ background: accent }}
          />
          <span className="text-[18px] font-bold text-text-primary tracking-tight">{t.market}-PERP</span>
          <span
            className="text-[12px] font-bold tracking-wider px-3 py-1 rounded-full"
            style={{ color: accent, background: isLong ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}
          >
            {t.side}
          </span>
          {t.order_type === "LIMIT" && (
            <span
              className="text-[10px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
              style={{ color: "var(--color-accent-blue)", background: "rgba(59,130,246,0.12)" }}
            >
              LIMIT
            </span>
          )}
        </div>
        <ConfidenceBadge confidence={confidence} />
      </div>

      {/* Speed badge */}
      {output.latency_ms != null && (
        <div
          className="px-5 py-1.5 flex items-center gap-2 border-b border-border-subtle"
          style={{ background: "rgba(51,201,161,0.03)" }}
        >
          {output.latency_ms === 0 ? (
            <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--color-accent-lime)" }}>
              ⚡ INSTANT
            </span>
          ) : (
            <span className="text-[10px] font-medium num text-text-tertiary">{output.latency_ms}ms</span>
          )}
          {output.status === "degraded" && <span className="text-[10px] text-text-tertiary">· cached price</span>}
        </div>
      )}

      {/* Primary prices */}
      <div className="grid grid-cols-2 border-b border-border-subtle">
        <div className="px-5 py-4">
          <div className="text-[11px] text-text-tertiary mb-1">
            {t.order_type === "LIMIT" ? "Limit Price" : "Entry"}
          </div>
          <div className="text-[20px] font-semibold num text-text-primary leading-none">
            {formatPrice(t.entry_price)}
          </div>
        </div>
        <div className="px-5 py-4 border-l border-border-subtle">
          <div className="text-[11px] text-text-tertiary mb-1">Liquidation</div>
          <div className="text-[20px] font-semibold num leading-none" style={{ color: "var(--color-accent-warn)" }}>
            {formatPrice(t.liquidation_price)}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <Cell label="Size" value={formatUsd(t.position_size)} />
        <Cell
          label="Leverage"
          value={formatLeverage(t.leverage)}
          color={highLev ? "var(--color-accent-warn)" : undefined}
        />
        <Cell label="Collateral" value={formatUsd(t.collateral_usd)} />
        <Cell
          label="Fees"
          value={t.fee_rate != null ? `${formatUsd(t.fees)} (${formatPercent(t.fee_rate)})` : formatUsd(t.fees)}
        />
      </div>

      {/* Inline TP/SL inputs — bundled atomically into the open-position tx. */}
      {!submitting && (
        <>
          <div
            className="grid grid-cols-2 gap-px border-t border-border-subtle"
            style={{ background: "var(--color-border-subtle)" }}
          >
            <div className="bg-bg-card px-5 py-3">
              <label className="text-[11px] text-text-tertiary mb-0.5 block" htmlFor="tpsl-tp">
                Take Profit
              </label>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[13px] text-text-tertiary">$</span>
                <input
                  id="tpsl-tp"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Take profit price"
                  value={tpDraft}
                  placeholder={tpHint.toFixed(2)}
                  onChange={(e) => setTpDraft(e.target.value)}
                  className="num text-[15px] font-medium bg-transparent outline-none w-full text-text-primary placeholder:text-text-tertiary"
                />
              </div>
            </div>
            <div className="bg-bg-card px-5 py-3">
              <label className="text-[11px] text-text-tertiary mb-0.5 block" htmlFor="tpsl-sl">
                Stop Loss
              </label>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[13px] text-text-tertiary">$</span>
                <input
                  id="tpsl-sl"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Stop loss price"
                  value={slDraft}
                  placeholder={slHint.toFixed(2)}
                  onChange={(e) => setSlDraft(e.target.value)}
                  className="num text-[15px] font-medium bg-transparent outline-none w-full text-text-primary placeholder:text-text-tertiary"
                />
              </div>
            </div>
          </div>
          {triggerError && (
            <div
              className="px-5 py-2 text-[12px] border-t border-border-subtle"
              style={{ color: "var(--color-accent-short)", background: "rgba(239,68,68,0.04)" }}
            >
              {triggerError}
            </div>
          )}
        </>
      )}

      {/* TP/SL badges — only show when submitting (inputs hidden) and values exist */}
      {(t.take_profit_price || t.stop_loss_price) && submitting && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-t border-border-subtle">
          {t.take_profit_price && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(16,185,129,0.08)" }}
            >
              <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--color-accent-long)" }}>
                TP
              </span>
              <span className="text-[12px] num font-medium" style={{ color: "var(--color-accent-long)" }}>
                {formatPrice(t.take_profit_price)}
              </span>
            </div>
          )}
          {t.stop_loss_price && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(239,68,68,0.08)" }}
            >
              <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--color-accent-short)" }}>
                SL
              </span>
              <span className="text-[12px] num font-medium" style={{ color: "var(--color-accent-short)" }}>
                {formatPrice(t.stop_loss_price)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Risk bar */}
      {liqDist > 0 && (
        <div className="px-5 py-3 border-t border-border-subtle">
          <div className="flex justify-between text-[12px] mb-2">
            <span className="text-text-tertiary">Liquidation distance</span>
            <span
              className="num font-medium"
              style={{
                color:
                  liqDist < 10
                    ? "var(--color-accent-short)"
                    : liqDist < 20
                      ? "var(--color-accent-warn)"
                      : "var(--color-accent-long)",
              }}
            >
              {safe(liqDist).toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-border-subtle rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              role="progressbar"
              aria-valuenow={Math.round(springLiqDist)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Distance to liquidation"
              style={{
                width: `${Math.min(springLiqDist, 100)}%`,
                background:
                  liqDist < 10
                    ? "var(--color-accent-short)"
                    : liqDist < 20
                      ? "var(--color-accent-warn)"
                      : "var(--color-accent-long)",
                transition: "background-color 300ms ease-out",
              }}
            />
          </div>
        </div>
      )}

      {/* Existing position — show combined values after averaging */}
      {(() => {
        const existing = positions.find((p) => p.market === t.market && p.side === t.side);
        if (!existing) return null;
        const existingSize = safe(existing.size_usd);
        const existingCollateral = safe(existing.collateral_usd);
        const existingEntry = safe(existing.entry_price);
        const newSize = existingSize + t.position_size;
        const newCollateral = existingCollateral + t.collateral_usd;
        const newAvgEntry =
          existingSize > 0 && t.position_size > 0
            ? (existingEntry * existingSize + t.entry_price * t.position_size) / newSize
            : t.entry_price;
        const newLeverage = newCollateral > 0 ? newSize / newCollateral : t.leverage;
        return (
          <div className="px-5 py-3 border-t border-border-subtle" style={{ background: "rgba(245,166,35,0.04)" }}>
            <div className="text-[11px] font-semibold text-accent-warn mb-2.5">
              After averaging into existing position:
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-text-tertiary">Avg Entry</span>
                <span className="num font-medium text-text-primary">{formatPrice(newAvgEntry)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-tertiary">Total Size</span>
                <span className="num font-medium text-text-primary">{formatUsd(newSize)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-tertiary">Total Collateral</span>
                <span className="num font-medium text-text-primary">{formatUsd(newCollateral)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-tertiary">Eff. Leverage</span>
                <span className="num font-medium text-text-primary">{newLeverage.toFixed(1)}x</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Warnings */}
      {output.warnings && output.warnings.length > 0 && (
        <div className="px-5 py-2.5 text-[12px] text-accent-warn border-t border-border-subtle">
          {output.warnings
            .filter((w) => !w.includes("average into"))
            .map((w, i) => (
              <div key={i}>⚠ {w}</div>
            ))}
        </div>
      )}

      {/* Degraded */}
      {output.status === "degraded" && (
        <div className="px-5 py-2 text-[12px] text-accent-warn border-t border-border-subtle">
          Price data may be slightly stale
        </div>
      )}

      {/* Confidence factors */}
      {confidence.level !== "high" && confidence.factors.length > 0 && (
        <div className="px-5 py-2.5 border-t border-border-subtle">
          {confidence.factors.map((f, i) => (
            <div key={i} className="text-[12px] text-text-tertiary leading-relaxed">
              · {f}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex border-t border-border-subtle">
        <button
          onClick={handleConfirm}
          disabled={submitting || isExecuting || !!triggerError}
          aria-label="Confirm trade execution"
          className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide
            cursor-pointer disabled:opacity-25 disabled:cursor-default rounded-none rounded-bl-xl"
          style={{ color: "#000", background: accent }}
        >
          {submitting ? "Submitting..." : "Confirm Trade"}
        </button>
        <button
          onClick={() => {
            cancelTrade();
            setCancelled(true);
          }}
          aria-label="Cancel trade"
          className="btn-secondary px-6 py-3 text-[13px] text-text-tertiary border-l border-border-subtle cursor-pointer hover:text-text-secondary rounded-none rounded-br-xl"
        >
          Cancel
        </button>
      </div>

      {/* Smart suggestions — context-aware, non-intrusive */}
      {!submitting && (
        <TradeHints
          trade={t}
          onApplyTp={(v) => setTpDraft(String(v))}
          onApplySl={(v) => setSlDraft(String(v))}
          onAction={onAction}
        />
      )}
    </div>
  );
});

export { TradePreviewCard };
export default TradePreviewCard;
