// ============================================
// Flash UI — Badge & Achievement System
// ============================================
// Pure functions. Computed from UserPatterns data.
// No network. No server. Client-only.
//
// Badges are deterministic: same patterns → same badges.
// Share cards are generated as text strings (copy-to-clipboard).

import { getUserPatterns, getRiskProfile, type UserPatterns } from "./user-patterns";

// ---- Badge Definitions ----

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string; // emoji
  tier: "bronze" | "silver" | "gold";
  category: "discipline" | "risk" | "volume" | "skill";
  earned: boolean;
}

// ---- Badge Computation (pure, deterministic) ----

export function computeBadges(p?: UserPatterns): Badge[] {
  const patterns = p ?? getUserPatterns();
  const profile = getRiskProfile();

  return [
    // ---- Discipline Badges ----
    {
      id: "first_sl",
      name: "Safety First",
      description: "Set a stop loss on your first trade",
      icon: "🛡️",
      tier: "bronze",
      category: "discipline",
      earned: patterns.lastActions.some((a) => a.hasSl),
    },
    {
      id: "sl_streak_3",
      name: "Disciplined",
      description: "3 consecutive trades with stop loss",
      icon: "🎯",
      tier: "bronze",
      category: "discipline",
      earned: patterns.bestSlStreak >= 3,
    },
    {
      id: "sl_streak_5",
      name: "Iron Discipline",
      description: "5 consecutive trades with stop loss",
      icon: "⚔️",
      tier: "silver",
      category: "discipline",
      earned: patterns.bestSlStreak >= 5,
    },
    {
      id: "sl_streak_10",
      name: "Untouchable",
      description: "10 consecutive trades with stop loss",
      icon: "👑",
      tier: "gold",
      category: "discipline",
      earned: patterns.bestSlStreak >= 10,
    },
    {
      id: "always_protected",
      name: "Always Protected",
      description: "SL usage rate above 80%",
      icon: "🔒",
      tier: "silver",
      category: "discipline",
      earned: patterns.tpSlSampleCount >= 5 && patterns.slUsageRate > 0.8,
    },

    // ---- Risk Management Badges ----
    {
      id: "conservative",
      name: "Conservative",
      description: "Average leverage under 3x",
      icon: "🧊",
      tier: "bronze",
      category: "risk",
      earned: patterns.totalTrades >= 5 && patterns.avgLeverage <= 3,
    },
    {
      id: "balanced",
      name: "Balanced Trader",
      description: "Maintain a moderate risk profile",
      icon: "⚖️",
      tier: "silver",
      category: "risk",
      earned: patterns.totalTrades >= 10 && profile === "moderate",
    },
    {
      id: "risk_aware",
      name: "Risk Aware",
      description: "Use both TP and SL on 5+ trades",
      icon: "📊",
      tier: "silver",
      category: "risk",
      earned: patterns.tpSlSampleCount >= 5 && patterns.tpUsageRate > 0.5 && patterns.slUsageRate > 0.5,
    },

    // ---- Volume Badges ----
    {
      id: "first_trade",
      name: "Genesis",
      description: "Execute your first trade",
      icon: "⚡",
      tier: "bronze",
      category: "volume",
      earned: patterns.totalTrades >= 1,
    },
    {
      id: "ten_trades",
      name: "Getting Started",
      description: "Execute 10 trades",
      icon: "🔥",
      tier: "bronze",
      category: "volume",
      earned: patterns.totalTrades >= 10,
    },
    {
      id: "twentyfive_trades",
      name: "Regular",
      description: "Execute 25 trades",
      icon: "💎",
      tier: "silver",
      category: "volume",
      earned: patterns.totalTrades >= 25,
    },
    {
      id: "fifty_trades",
      name: "Power Trader",
      description: "Execute 50 trades",
      icon: "🏆",
      tier: "gold",
      category: "volume",
      earned: patterns.totalTrades >= 50,
    },

    // ---- Skill Badges ----
    {
      id: "multi_market",
      name: "Diversified",
      description: "Trade 3+ different markets",
      icon: "🌐",
      tier: "bronze",
      category: "skill",
      earned: Object.keys(patterns.preferredMarkets).length >= 3,
    },
    {
      id: "five_markets",
      name: "Market Explorer",
      description: "Trade 5+ different markets",
      icon: "🗺️",
      tier: "silver",
      category: "skill",
      earned: Object.keys(patterns.preferredMarkets).length >= 5,
    },
    {
      id: "both_sides",
      name: "Dual Wielder",
      description: "Trade both LONG and SHORT",
      icon: "⚔️",
      tier: "bronze",
      category: "skill",
      earned: patterns.actionCounts.LONG >= 2 && patterns.actionCounts.SHORT >= 2,
    },
  ];
}

/** Get only earned badges */
export function getEarnedBadges(): Badge[] {
  return computeBadges().filter((b) => b.earned);
}

/** Get next unearned badge closest to being achieved */
export function getNextBadge(): Badge | null {
  const all = computeBadges();
  const unearned = all.filter((b) => !b.earned);
  if (unearned.length === 0) return null;

  // Prioritize: volume first (closest to earning), then discipline
  const p = getUserPatterns();
  for (const b of unearned) {
    if (b.id === "first_trade" && p.totalTrades === 0) return b;
    if (b.id === "first_sl") return b;
    if (b.id === "sl_streak_3" && p.bestSlStreak >= 1) return b;
    if (b.id === "ten_trades" && p.totalTrades >= 5) return b;
  }
  return unearned[0];
}

// ---- Share Card Generator ----

export interface ShareCard {
  title: string;
  body: string;
  hashtag: string;
}

/**
 * Generate a shareable text card for a milestone or achievement.
 * Returns null if nothing worth sharing.
 */
export function generateShareCard(): ShareCard | null {
  const p = getUserPatterns();
  const earned = getEarnedBadges();
  const profile = getRiskProfile();

  if (earned.length === 0) return null;

  const topBadge = earned.sort((a, b) => {
    const tierOrder = { gold: 3, silver: 2, bronze: 1 };
    return tierOrder[b.tier] - tierOrder[a.tier];
  })[0];

  const topMarkets = Object.entries(p.preferredMarkets)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m)
    .join(", ");

  const profileLabel = { aggressive: "Aggressive", moderate: "Balanced", conservative: "Conservative" }[profile];

  const title = `${topBadge.icon} ${topBadge.name}`;
  const body = [
    `${p.totalTrades} trades on Flash Trade`,
    `Profile: ${profileLabel} · Avg ${p.avgLeverage.toFixed(1)}x`,
    `SL discipline: ${Math.round(p.slUsageRate * 100)}%`,
    topMarkets ? `Markets: ${topMarkets}` : "",
    `Badges: ${earned.length}/${computeBadges().length}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title,
    body,
    hashtag: "#FlashTrade #Solana",
  };
}

/** Format share card as copyable text */
export function formatShareText(): string | null {
  const card = generateShareCard();
  if (!card) return null;
  return `${card.title}\n\n${card.body}\n\n${card.hashtag}\n\nhttps://flashedge.vercel.app`;
}
