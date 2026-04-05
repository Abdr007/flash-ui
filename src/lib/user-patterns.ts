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
}

export interface UserPatterns {
  preferredMarkets: Record<string, number>; // market → weight (frequency)
  avgLeverage: number;
  actionCounts: { LONG: number; SHORT: number; CLOSE: number };
  lastActions: UserAction[];
  totalTrades: number;
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
  };
}

// ---- Persistence ----

let _cached: UserPatterns | null = null;

export function getUserPatterns(): UserPatterns {
  if (_cached) return _cached;

  try {
    const raw = typeof window !== "undefined"
      ? sessionStorage.getItem(STORAGE_KEY)
      : null;
    if (raw) {
      const parsed = JSON.parse(raw) as UserPatterns;
      // Validate structure
      if (parsed.preferredMarkets && parsed.actionCounts && Array.isArray(parsed.lastActions)) {
        _cached = parsed;
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
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(patterns));
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
