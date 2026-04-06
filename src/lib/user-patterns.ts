// ============================================
// Flash UI — User Behavior Learning
// ============================================
// Tracks trading patterns to personalize suggestions.
// Persists to sessionStorage (survives page refresh, not tabs).
// Never persists to server — client-only learning.
//
// Tracked:
// - preferredMarkets (weighted by frequency)
// - avgLeverage (rolling average)
// - commonActions (LONG vs SHORT vs CLOSE frequency)
// - lastActions (recent 20 for recency bias)
//
// Updated after every confirmed trade or close.

import type { Side } from "./types";

// ---- Types ----

export interface UserAction {
  market: string;
  side: Side | "CLOSE";
  leverage: number;
  collateral: number;
  timestamp: number;
  hasTp?: boolean;
  hasSl?: boolean;
  tpDistancePct?: number;  // TP distance from entry as %
  slDistancePct?: number;  // SL distance from entry as %
}

export interface UserPatterns {
  preferredMarkets: Record<string, number>; // market → weight (frequency)
  avgLeverage: number;
  actionCounts: { LONG: number; SHORT: number; CLOSE: number };
  lastActions: UserAction[];
  totalTrades: number;
  // ---- TP/SL behavior ----
  tpUsageRate: number;      // 0-1: how often user sets TP
  slUsageRate: number;      // 0-1: how often user sets SL
  avgTpDistancePct: number; // average TP distance from entry (%)
  avgSlDistancePct: number; // average SL distance from entry (%)
  tpSlSampleCount: number;  // number of trades used for TP/SL averaging
  // ---- Streaks & progression ----
  slStreak: number;         // consecutive trades WITH SL set
  bestSlStreak: number;     // all-time best SL streak
  sessionTrades: number;    // trades in current session (since last page load)
}

// ---- Storage Key ----

const STORAGE_KEY = "flash_user_patterns";

// ---- Default State ----

function defaultPatterns(): UserPatterns {
  return {
    preferredMarkets: {},
    avgLeverage: 3,
    actionCounts: { LONG: 0, SHORT: 0, CLOSE: 0 },
    lastActions: [],
    totalTrades: 0,
    tpUsageRate: 0,
    slUsageRate: 0,
    avgTpDistancePct: 10,  // default 10% TP
    avgSlDistancePct: 5,   // default 5% SL
    tpSlSampleCount: 0,
    slStreak: 0,
    bestSlStreak: 0,
    sessionTrades: 0,
  };
}

// ---- Persistence ----

let _cached: UserPatterns | null = null;

export function getUserPatterns(): UserPatterns {
  if (_cached) return _cached;

  try {
    const raw = typeof window !== "undefined"
      ? (localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY))
      : null;
    if (raw) {
      const parsed = JSON.parse(raw) as UserPatterns;
      // Validate structure + migrate: add missing fields from default
      if (parsed.preferredMarkets && parsed.actionCounts && Array.isArray(parsed.lastActions)) {
        const defaults = defaultPatterns();
        _cached = { ...defaults, ...parsed };
        return _cached;
      }
    }
  } catch {
    // Corrupt data — reset
  }

  _cached = defaultPatterns();
  return _cached;
}

function persist(patterns: UserPatterns): void {
  _cached = patterns;
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns));
    }
  } catch {
    // Storage full or unavailable — silent
  }
}

// ---- Recording Actions ----

const MAX_HISTORY = 20;

export function recordTradeAction(action: UserAction): void {
  const p = getUserPatterns();

  // Update market frequency
  p.preferredMarkets[action.market] = (p.preferredMarkets[action.market] ?? 0) + 1;

  // Update action counts
  if (action.side === "LONG" || action.side === "SHORT" || action.side === "CLOSE") {
    p.actionCounts[action.side]++;
  }

  // Rolling average leverage (exclude CLOSE actions)
  if (action.side !== "CLOSE" && action.leverage > 0) {
    const prevTotal = p.avgLeverage * p.totalTrades;
    p.totalTrades++;
    p.avgLeverage = (prevTotal + action.leverage) / p.totalTrades;
  }

  // TP/SL behavior tracking (for adaptive suggestions)
  if (action.side !== "CLOSE") {
    p.tpSlSampleCount++;
    const n = p.tpSlSampleCount;

    // Exponential moving average for usage rates
    const alpha = Math.min(0.3, 2 / (n + 1)); // adapts faster early, stabilizes later
    p.tpUsageRate = p.tpUsageRate * (1 - alpha) + (action.hasTp ? 1 : 0) * alpha;
    p.slUsageRate = p.slUsageRate * (1 - alpha) + (action.hasSl ? 1 : 0) * alpha;

    // Rolling average TP/SL distances (only when set)
    if (action.hasTp && action.tpDistancePct && Number.isFinite(action.tpDistancePct) && action.tpDistancePct > 0) {
      p.avgTpDistancePct = p.avgTpDistancePct * (1 - alpha) + action.tpDistancePct * alpha;
    }
    if (action.hasSl && action.slDistancePct && Number.isFinite(action.slDistancePct) && action.slDistancePct > 0) {
      p.avgSlDistancePct = p.avgSlDistancePct * (1 - alpha) + action.slDistancePct * alpha;
    }
  }

  // Streak tracking
  if (action.side !== "CLOSE") {
    p.sessionTrades++;
    if (action.hasSl) {
      p.slStreak++;
      if (p.slStreak > p.bestSlStreak) p.bestSlStreak = p.slStreak;
    } else {
      p.slStreak = 0;
    }
  }

  // History (FIFO, max 20)
  p.lastActions.unshift(action);
  if (p.lastActions.length > MAX_HISTORY) {
    p.lastActions.pop();
  }

  persist(p);
}

// ---- Scoring Helpers (for predictive-actions.ts) ----

/**
 * Score boost for a market based on user preference.
 * Returns 0–20.
 */
export function marketPreferenceBoost(market: string): number {
  const p = getUserPatterns();
  const freq = p.preferredMarkets[market] ?? 0;
  if (freq === 0) return 0;

  // Normalize: most-traded market gets +20, others proportional
  const maxFreq = Math.max(...Object.values(p.preferredMarkets), 1);
  return Math.round((freq / maxFreq) * 20);
}

/**
 * Score boost for action alignment (LONG/SHORT/CLOSE).
 * Returns 0–15.
 */
export function actionAlignmentBoost(side: Side | "CLOSE"): number {
  const p = getUserPatterns();
  const total = p.actionCounts.LONG + p.actionCounts.SHORT + p.actionCounts.CLOSE;
  if (total === 0) return 0;

  const ratio = p.actionCounts[side] / total;
  return Math.round(ratio * 15);
}

/**
 * Score boost for leverage proximity to user's average.
 * Returns 0–10.
 */
export function leverageProximityBoost(leverage: number): number {
  const p = getUserPatterns();
  if (p.totalTrades === 0) return 5; // Neutral for new users

  const distance = Math.abs(leverage - p.avgLeverage);
  if (distance <= 1) return 10;
  if (distance <= 3) return 7;
  if (distance <= 5) return 4;
  return 0;
}

/**
 * Get the user's most-traded markets (top 3).
 */
export function getTopMarkets(fallback: string[] = ["SOL", "BTC"]): string[] {
  const p = getUserPatterns();
  const entries = Object.entries(p.preferredMarkets);
  if (entries.length === 0) return fallback;

  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, 3).map(([market]) => market);
}

/**
 * Get the user's dominant side (LONG or SHORT).
 */
export function getDominantSide(): Side {
  const p = getUserPatterns();
  return p.actionCounts.LONG >= p.actionCounts.SHORT ? "LONG" : "SHORT";
}

// ---- Adaptive Hint Helpers ----

/**
 * Get the user's preferred SL distance (% from entry).
 * Returns learned average or default 5%.
 */
export function getPreferredSlDistance(): number {
  const p = getUserPatterns();
  return p.tpSlSampleCount >= 3 ? p.avgSlDistancePct : 5;
}

/**
 * Get the user's preferred TP distance (% from entry).
 * Returns learned average or default 10%.
 */
export function getPreferredTpDistance(): number {
  const p = getUserPatterns();
  return p.tpSlSampleCount >= 3 ? p.avgTpDistancePct : 10;
}

/**
 * Does this user typically set SL? (>50% usage rate with enough samples)
 */
export function userTypicallySetsSlStop(): boolean {
  const p = getUserPatterns();
  return p.tpSlSampleCount >= 3 && p.slUsageRate > 0.5;
}

/**
 * Risk profile derived from behavior.
 * "aggressive": high avg leverage (>10x), low SL usage
 * "moderate": medium leverage (3-10x), some SL
 * "conservative": low leverage (<3x), frequent SL
 */
export function getRiskProfile(): "aggressive" | "moderate" | "conservative" {
  const p = getUserPatterns();
  if (p.totalTrades < 3) return "moderate"; // Not enough data
  if (p.avgLeverage >= 10 && p.slUsageRate < 0.3) return "aggressive";
  if (p.avgLeverage <= 3 && p.slUsageRate > 0.5) return "conservative";
  return "moderate";
}

/**
 * Get the user's typical leverage for a specific market.
 * Falls back to global avgLeverage.
 */
export function getTypicalLeverage(): number {
  const p = getUserPatterns();
  return p.totalTrades >= 2 ? Math.round(p.avgLeverage) : 0; // 0 = no preference
}

// ---- Post-Trade Insight Generator ----

export interface TradeInsight {
  message: string;
  type: "streak" | "milestone" | "tip" | "progress";
  color: string; // CSS color var
}

/**
 * Generate a post-trade insight based on current patterns.
 * Returns null if nothing noteworthy. Called after recordTradeAction.
 */
export function getPostTradeInsight(action: UserAction): TradeInsight | null {
  const p = getUserPatterns();

  // ---- Streaks ----
  if (action.hasSl && p.slStreak >= 3) {
    if (p.slStreak === p.bestSlStreak && p.slStreak >= 5) {
      return { message: `New record! ${p.slStreak} trades in a row with SL`, type: "streak", color: "var(--color-accent-lime)" };
    }
    if (p.slStreak === 3 || p.slStreak === 5 || p.slStreak === 10) {
      return { message: `${p.slStreak}-trade SL streak — disciplined trading`, type: "streak", color: "var(--color-accent-long)" };
    }
  }

  // ---- Milestones ----
  if (p.totalTrades === 1) {
    return { message: "First trade executed!", type: "milestone", color: "var(--color-accent-lime)" };
  }
  if (p.totalTrades === 5) {
    return { message: "5 trades complete — you're getting the hang of it", type: "milestone", color: "var(--color-accent-blue)" };
  }
  if (p.totalTrades === 10) {
    return { message: "10 trades — learning system adapting to your style", type: "milestone", color: "var(--color-accent-purple)" };
  }
  if (p.totalTrades === 25) {
    return { message: "25 trades — experienced trader detected", type: "milestone", color: "var(--color-accent-lime)" };
  }
  if (p.totalTrades === 50 || p.totalTrades === 100) {
    return { message: `${p.totalTrades} trades — power user`, type: "milestone", color: "var(--color-accent-lime)" };
  }

  // ---- Risk tips (non-intrusive, only every ~5 trades) ----
  if (p.sessionTrades % 5 === 0 && p.sessionTrades > 0) {
    if (!action.hasSl && p.slUsageRate < 0.3 && p.totalTrades >= 5) {
      return { message: "Tip: setting SL on every trade protects capital", type: "tip", color: "var(--color-accent-warn)" };
    }
    if (p.avgLeverage > 15 && p.totalTrades >= 5) {
      return { message: `Avg leverage ${p.avgLeverage.toFixed(0)}x — consider lowering for consistency`, type: "tip", color: "var(--color-accent-warn)" };
    }
  }

  // ---- Progress signals (every ~10 trades) ----
  if (p.totalTrades >= 10 && p.totalTrades % 10 === 0) {
    const profile = getRiskProfile();
    const profileLabel = { aggressive: "Aggressive", moderate: "Balanced", conservative: "Conservative" }[profile];
    return { message: `Trading profile: ${profileLabel} · Avg ${p.avgLeverage.toFixed(1)}x · SL rate ${Math.round(p.slUsageRate * 100)}%`, type: "progress", color: "var(--color-text-secondary)" };
  }

  return null;
}
