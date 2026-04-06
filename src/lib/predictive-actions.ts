// ============================================
// Flash UI — Predictive Action Engine (Enhanced)
// ============================================
// Generates personalized, market-aware suggestions.
//
// Scoring layers:
// 1. Base priority (position state, trade context)
// 2. User preference boost (+20 for preferred markets)
// 3. Action alignment boost (+15 for common sides)
// 4. Market momentum boost (+15 for trend-aligned trades)
// 5. Leverage proximity boost (+10 for familiar leverage)
//
// Output: grouped suggestions (max 2 groups, 3 per group).

import type { Position, Side } from "./types";
import type { TradePreviewData } from "./tool-result-handler";
import { MARKETS, DEFAULT_LEVERAGE } from "./constants";
import {
  marketPreferenceBoost,
  actionAlignmentBoost,
  leverageProximityBoost,
  getTopMarkets,
  getDominantSide,
  getUserPatterns,
  getUnifiedProfile,
  getGuidanceLevel,
} from "./user-patterns";
import {
  getMarketBiasBoost,
  getActiveSignals,
  getPositionWarning,
} from "./market-awareness";

// ---- Types ----

export interface SuggestedAction {
  label: string;
  intent: string;
  priority: number;
  category: "trade" | "close" | "manage" | "info";
  icon: "open" | "close" | "collateral" | "info" | "flip" | "modify" | "warning";
}

export interface ActionGroup {
  group: string;
  actions: SuggestedAction[];
}

interface PredictionState {
  positions: Position[];
  lastTradeDraft: TradePreviewData | null;
  recentMarkets: string[];
  prices: Record<string, { price: number }>;
  walletConnected: boolean;
  hasActiveTrade: boolean;
  isExecuting: boolean;
}

// ---- Core Engine (Grouped Output) ----

export function getSuggestedActionGroups(state: PredictionState): ActionGroup[] {
  if (!state.walletConnected) {
    return [{
      group: "Get Started",
      actions: [
        { label: "Price SOL", intent: "price of SOL", priority: 50, category: "info", icon: "info" },
        { label: "Price BTC", intent: "price of BTC", priority: 40, category: "info", icon: "info" },
        { label: "Explore markets", intent: "show all prices", priority: 30, category: "info", icon: "info" },
      ],
    }];
  }

  if (state.isExecuting) return [];

  const manageActions: SuggestedAction[] = [];
  const tradeActions: SuggestedAction[] = [];

  // ---- Position Management ----
  for (const pos of state.positions) {
    const pnlPct = pos.unrealized_pnl_pct;
    const liqDist = pos.side === "LONG"
      ? ((pos.mark_price - pos.liquidation_price) / pos.mark_price) * 100
      : ((pos.liquidation_price - pos.mark_price) / pos.mark_price) * 100;

    // Market warning from awareness engine
    const warning = getPositionWarning(pos.market, pos.side);

    // Close to liquidation → urgent
    if (liqDist < 15 && liqDist > 0) {
      manageActions.push({
        label: `Add collateral ${pos.market}`,
        intent: `add collateral to ${pos.market} ${pos.side}`,
        priority: 90 + marketPreferenceBoost(pos.market),
        category: "manage",
        icon: "collateral",
      });
    }

    // Market-aware warning → suggest close
    if (warning) {
      manageActions.push({
        label: `Close ${pos.market} (${warning.includes("down") ? "downtrend" : "risk"})`,
        intent: `close ${pos.market} ${pos.side}`,
        priority: 80 + marketPreferenceBoost(pos.market),
        category: "close",
        icon: "warning",
      });
    }
    // Profitable → suggest take profit
    else if (pnlPct > 5) {
      manageActions.push({
        label: `Close ${pos.market} +${pnlPct.toFixed(1)}%`,
        intent: `close ${pos.market} ${pos.side}`,
        priority: 70 + Math.min(pnlPct, 30) + actionAlignmentBoost("CLOSE"),
        category: "close",
        icon: "close",
      });
    }
    // Losing → suggest cut
    else if (pnlPct < -10) {
      manageActions.push({
        label: `Cut ${pos.market} ${pnlPct.toFixed(1)}%`,
        intent: `close ${pos.market} ${pos.side}`,
        priority: 75 + actionAlignmentBoost("CLOSE"),
        category: "close",
        icon: "close",
      });
    }
  }

  // ---- New Trade Suggestions ----

  // Re-entry from last draft
  if (state.lastTradeDraft && !state.hasActiveTrade) {
    const d = state.lastTradeDraft;
    const bias = getMarketBiasBoost(d.market, d.side);
    tradeActions.push({
      label: `${d.side} ${d.market} ${d.leverage}x`,
      intent: `${d.side.toLowerCase()} ${d.market} ${d.leverage}x $${d.collateral_usd}`,
      priority: 60 + marketPreferenceBoost(d.market) + bias + actionAlignmentBoost(d.side),
      category: "trade",
      icon: "open",
    });

    // Flip suggestion
    const flipSide: Side = d.side === "LONG" ? "SHORT" : "LONG";
    const flipBias = getMarketBiasBoost(d.market, flipSide);
    if (flipBias > 0) { // Only suggest flip if market supports it
      tradeActions.push({
        label: `Flip to ${flipSide}`,
        intent: `${flipSide.toLowerCase()} ${d.market} ${d.leverage}x $${d.collateral_usd}`,
        priority: 40 + flipBias + actionAlignmentBoost(flipSide),
        category: "trade",
        icon: "flip",
      });
    }
  }

  // Active trade modifications
  if (state.hasActiveTrade && state.lastTradeDraft) {
    tradeActions.push({
      label: "Change to 3x",
      intent: "change leverage to 3x",
      priority: 45 + leverageProximityBoost(3),
      category: "trade",
      icon: "modify",
    });
  }

  // Market-opportunity trades (no positions, no active trade)
  if (state.positions.length === 0 && !state.hasActiveTrade) {
    const topMarkets = getTopMarkets(state.recentMarkets.length > 0 ? state.recentMarkets : undefined);
    const preferredSide = getDominantSide();

    // Add momentum-aligned suggestions
    const signals = getActiveSignals();
    for (const signal of signals.slice(0, 2)) {
      if (signal.tradeBias === "long" || signal.tradeBias === "short") {
        const side: Side = signal.tradeBias === "long" ? "LONG" : "SHORT";
        const pool = MARKETS[signal.market]?.pool;
        const lev = pool ? (DEFAULT_LEVERAGE[pool] ?? 3) : 3;

        tradeActions.push({
          label: `${side} ${signal.market} (${signal.description})`,
          intent: `${side.toLowerCase()} ${signal.market} ${lev}x $50`,
          priority: 50 + signal.priorityBoost + marketPreferenceBoost(signal.market),
          category: "trade",
          icon: "open",
        });
      }
    }

    // Personalized defaults from user history
    for (const market of topMarkets.slice(0, 2)) {
      const pool = MARKETS[market]?.pool;
      const defLev = pool ? (DEFAULT_LEVERAGE[pool] ?? 3) : 3;
      const bias = getMarketBiasBoost(market, preferredSide);

      tradeActions.push({
        label: `${preferredSide} ${market} ${defLev}x`,
        intent: `${preferredSide.toLowerCase()} ${market} ${defLev}x $50`,
        priority: 35 + marketPreferenceBoost(market) + actionAlignmentBoost(preferredSide) + bias + leverageProximityBoost(defLev),
        category: "trade",
        icon: "open",
      });
    }
  }

  // Portfolio overview
  if (state.positions.length > 0) {
    manageActions.push({
      label: "Portfolio",
      intent: "show my portfolio",
      priority: 20,
      category: "info",
      icon: "info",
    });
  }

  // ---- Inject predicted next action (highest priority) ----
  const predicted = predictNextAction(state);
  if (predicted) {
    if (predicted.category === "manage" || predicted.category === "close") {
      manageActions.push(predicted);
    } else {
      tradeActions.push(predicted);
    }
  }

  // ---- Combined risk warning (inject as manage action) ----
  const risk = getCombinedRisk(state.positions);
  if (risk.message && getGuidanceLevel() !== "none") {
    manageActions.push({
      label: risk.riskLevel === "high" ? "⚠ High exposure" : "Diversify exposure",
      intent: "show my portfolio",
      priority: risk.riskLevel === "high" ? 95 : 55,
      category: "manage",
      icon: "warning",
    });
  }

  // ---- Build Groups ----
  const groups: ActionGroup[] = [];

  // Sort each group by priority, take top 3
  manageActions.sort((a, b) => b.priority - a.priority);
  tradeActions.sort((a, b) => b.priority - a.priority);

  if (manageActions.length > 0) {
    const marketLabel = state.positions.length === 1
      ? `Manage ${state.positions[0].market}`
      : "Manage Positions";
    groups.push({
      group: marketLabel,
      actions: manageActions.slice(0, 3),
    });
  }

  if (tradeActions.length > 0) {
    groups.push({
      group: state.hasActiveTrade ? "Modify Trade" : "New Trades",
      actions: tradeActions.slice(0, 3),
    });
  }

  // Max 2 groups
  return groups.slice(0, 2);
}

/**
 * Flat list for backward compatibility (used in empty states).
 */
export function getSuggestedActions(state: PredictionState): SuggestedAction[] {
  const groups = getSuggestedActionGroups(state);
  const all: SuggestedAction[] = [];
  for (const g of groups) {
    all.push(...g.actions);
  }
  all.sort((a, b) => b.priority - a.priority);
  return all.slice(0, 4);
}

// ---- Trade Confidence (unchanged from Phase 3) ----

export type ConfidenceLevel = "high" | "medium" | "low";

export interface TradeConfidence {
  level: ConfidenceLevel;
  score: number;
  factors: string[];
}

export function getTradeConfidence(trade: {
  leverage: number;
  collateral_usd: number;
  position_size: number;
  fees: number;
  entry_price: number;
  liquidation_price: number;
  side: Side;
}): TradeConfidence {
  const factors: string[] = [];
  let score = 80;

  if (trade.leverage > 50) {
    score -= 40;
    factors.push("Extreme leverage (>50x)");
  } else if (trade.leverage > 20) {
    score -= 20;
    factors.push("High leverage (>20x)");
  } else if (trade.leverage > 10) {
    score -= 10;
    factors.push("Moderate leverage");
  }

  const liqDist = trade.side === "LONG"
    ? ((trade.entry_price - trade.liquidation_price) / trade.entry_price) * 100
    : ((trade.liquidation_price - trade.entry_price) / trade.entry_price) * 100;

  if (liqDist < 5) {
    score -= 30;
    factors.push(`Liquidation only ${liqDist.toFixed(1)}% away`);
  } else if (liqDist < 10) {
    score -= 15;
    factors.push(`Liquidation ${liqDist.toFixed(1)}% away`);
  }

  const feeImpact = (trade.fees / trade.collateral_usd) * 100;
  if (feeImpact > 2) {
    score -= 15;
    factors.push(`High fee impact (${feeImpact.toFixed(1)}% of collateral)`);
  }

  if (trade.collateral_usd < 20) {
    score -= 10;
    factors.push("Low collateral — small margin for error");
  }

  // Market momentum check
  const bias = getMarketBiasBoost(trade.side === "LONG" ? "SOL" : "SOL", trade.side);
  if (bias < -5) {
    score -= 10;
    factors.push("Against current market momentum");
  }

  score = Math.max(0, Math.min(100, score));
  const level: ConfidenceLevel = score >= 60 ? "high" : score >= 35 ? "medium" : "low";

  return { level, score, factors };
}

// ---- Input Autocomplete (unchanged from Phase 3) ----

const COMMAND_PREFIXES = [
  { prefix: "long", completions: Object.keys(MARKETS).map((m) => `long ${m}`) },
  { prefix: "short", completions: Object.keys(MARKETS).map((m) => `short ${m}`) },
  { prefix: "close", completions: Object.keys(MARKETS).map((m) => `close ${m}`) },
  { prefix: "price", completions: Object.keys(MARKETS).map((m) => `price ${m}`) },
];

export function getAutocompleteSuggestions(
  input: string,
  maxResults = 4,
): string[] {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 2) return [];

  const results: string[] = [];

  for (const { prefix, completions } of COMMAND_PREFIXES) {
    if (prefix.startsWith(trimmed) || trimmed.startsWith(prefix)) {
      for (const c of completions) {
        if (c.toLowerCase().startsWith(trimmed) || trimmed.startsWith(prefix)) {
          results.push(c);
          if (results.length >= maxResults) return results;
        }
      }
    }
  }

  for (const market of Object.keys(MARKETS)) {
    if (market.toLowerCase().startsWith(trimmed)) {
      results.push(`price ${market}`);
      if (results.length >= maxResults) return results;
    }
  }

  return results;
}

// ============================================
// Intent Prediction + Combined Risk
// ============================================

/**
 * Predict the user's next likely action based on recent behavior.
 * Returns null if no prediction is confident enough.
 */
export function predictNextAction(state: PredictionState): SuggestedAction | null {
  const p = getUserPatterns();
  const profile = getUnifiedProfile();

  // Experts don't need predictions unless position-critical
  if (profile.confidence === "expert" && state.positions.length === 0) return null;

  const recent = p.lastActions.slice(0, 3);
  if (recent.length === 0) return null;

  const last = recent[0];

  // Pattern: user just opened a trade → likely wants to check it
  if (last.side !== "CLOSE" && state.positions.length > 0) {
    const pos = state.positions.find((pos) => pos.market === last.market);
    if (pos && Math.abs(pos.unrealized_pnl_pct) > 3) {
      return {
        label: pos.unrealized_pnl_pct > 0
          ? `Take profit ${pos.market} +${pos.unrealized_pnl_pct.toFixed(1)}%`
          : `Check ${pos.market} ${pos.unrealized_pnl_pct.toFixed(1)}%`,
        intent: pos.unrealized_pnl_pct > 5
          ? `close ${pos.market} ${pos.side}`
          : `price ${pos.market}`,
        priority: 85,
        category: "manage",
        icon: pos.unrealized_pnl_pct > 0 ? "close" : "info",
      };
    }
  }

  // Pattern: user closed a trade → likely wants to re-enter or check portfolio
  if (last.side === "CLOSE" && state.positions.length === 0) {
    const prevTrade = recent.find((a) => a.side !== "CLOSE");
    if (prevTrade) {
      return {
        label: `Re-enter ${prevTrade.side} ${prevTrade.market}`,
        intent: `${prevTrade.side.toLowerCase()} ${prevTrade.market} ${prevTrade.leverage}x $${prevTrade.collateral}`,
        priority: 65,
        category: "trade",
        icon: "open",
      };
    }
  }

  // Pattern: user deposited into earn → suggest checking positions or trading
  if (profile.isEarner && !profile.isTrader && state.positions.length === 0) {
    return {
      label: "Try trading — Long SOL 5x $50",
      intent: "long SOL 5x $50",
      priority: 40,
      category: "trade",
      icon: "open",
    };
  }

  return null;
}

/**
 * Combined risk assessment across ALL user exposure.
 * Reads positions (leveraged trading) + earn deposits (yield exposure).
 */
export interface CombinedRisk {
  totalExposure: number;     // sum of all position sizes + earn deposits
  tradingExposure: number;   // leveraged position sizes
  earnExposure: number;      // estimated earn deposit value
  riskLevel: "low" | "moderate" | "elevated" | "high";
  message: string | null;    // contextual warning (null = no warning)
}

export function getCombinedRisk(positions: Position[]): CombinedRisk {
  const p = getUserPatterns();
  const profile = getUnifiedProfile();

  let tradingExposure = 0;
  for (const pos of positions) {
    tradingExposure += pos.size_usd;
  }

  // Earn exposure estimated from deposit count × average
  const earnExposure = p.earnDeposits * p.earnAvgDeposit;
  const totalExposure = tradingExposure + earnExposure;

  // Risk level based on concentration and leverage
  let riskLevel: CombinedRisk["riskLevel"] = "low";
  if (tradingExposure > 0 && earnExposure > 0) {
    const tradeRatio = tradingExposure / totalExposure;
    // >80% in leveraged trades = elevated
    if (tradeRatio > 0.8 && p.avgLeverage > 5) riskLevel = "elevated";
    // High leverage + big earn = high
    if (p.avgLeverage > 10 && earnExposure > 500) riskLevel = "high";
    // Balanced = moderate
    if (tradeRatio > 0.3 && tradeRatio < 0.7) riskLevel = "moderate";
  } else if (tradingExposure > 0 && p.avgLeverage > 10) {
    riskLevel = "elevated";
  }

  // Generate message only for non-experts at elevated+ risk
  let message: string | null = null;
  if (profile.confidence !== "expert" && riskLevel === "high") {
    message = "High combined exposure — consider reducing leverage or earn position.";
  } else if (profile.confidence !== "expert" && riskLevel === "elevated") {
    message = "Most capital in leveraged trades. Earn can diversify your exposure.";
  }

  return { totalExposure, tradingExposure, earnExposure, riskLevel, message };
}
