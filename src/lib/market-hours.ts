// ============================================
// Flash UI — Market Hours
// ============================================
// Source: https://docs.flash.trade/.../perpetuals-specifications/market-hours
//
// Official Flash hours (all times in US Eastern Time):
//   - Crypto:      24/7, no close
//   - US Equities: Mon–Fri 9:30AM–4:00PM ET
//   - FX:          Sun 5:00PM ET → Fri 5:00PM ET, 60-min daily break at 5PM ET
//   - Metals:      Sun 5:00PM ET → Fri 5:00PM ET, 60-min daily break at 5PM ET
//   - Commodities: Sun 6:00PM ET → Fri 5:00PM ET, 60-min daily break at 5PM ET
//
// Implementation uses Intl.DateTimeFormat with timeZone "America/New_York"
// so US DST (EDT vs EST) is handled automatically. Without this, a fixed
// UTC offset would misclassify ~8 months of the year (during DST, real ET
// is UTC-4, not UTC-5 — equity 09:30 ET would be reported as "pre-market"
// for the first hour of the real session). Holiday calendars are NOT
// modeled (forex trades through most US holidays; equities close); the
// on-chain oracle remains the authoritative backstop.

import type { MarketCategory } from "./markets-registry";

export interface MarketStatus {
  open: boolean;
  reason?: string;
  nextOpenUtc?: string;
}

// ---- Time helpers ----

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function getEtParts(now: Date) {
  const parts = ET_FORMATTER.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  // en-US with hour12:false emits "24" at local midnight — normalize to 0.
  const hour = parseInt(hourStr, 10) % 24;
  const minute = parseInt(minuteStr, 10);
  return {
    day: DAY_INDEX[weekday] ?? 1,
    hour,
    minute,
    totalMinutes: hour * 60 + minute,
  };
}

function formatEt(day: number, hour: number, minute: number): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${dayNames[day]} ${hh}:${mm} ET`;
}

// ---- Per-category session logic ----

/**
 * US equities regular trading hours: Mon–Fri 9:30AM–4:00PM ET.
 */
function equityStatus(now: Date): MarketStatus {
  const { day, totalMinutes } = getEtParts(now);
  const openMin = 9 * 60 + 30; // 09:30 ET
  const closeMin = 16 * 60;    // 16:00 ET

  if (day === 0 || day === 6) {
    return {
      open: false,
      reason: "US equities closed on weekends",
      nextOpenUtc: formatEt(1, 9, 30),
    };
  }
  if (totalMinutes < openMin) {
    return {
      open: false,
      reason: "Pre-market",
      nextOpenUtc: formatEt(day, 9, 30),
    };
  }
  if (totalMinutes >= closeMin) {
    const nextDay = day === 5 ? 1 : day + 1;
    return {
      open: false,
      reason: "After-hours",
      nextOpenUtc: formatEt(nextDay, 9, 30),
    };
  }
  return { open: true };
}

/**
 * FX + Metals session: Sun 5:00PM ET → Fri 5:00PM ET, with a 60-minute
 * daily break at 5:00PM ET. Same window applies to both categories.
 */
function fxOrMetalsStatus(now: Date, label: string): MarketStatus {
  const { day, totalMinutes } = getEtParts(now);
  const openMin = 17 * 60;   // 17:00 ET
  const closeMin = 18 * 60;  // 18:00 ET (end of daily break)

  // Saturday — fully closed
  if (day === 6) {
    return {
      open: false,
      reason: `${label} closed for the weekend`,
      nextOpenUtc: formatEt(0, 17, 0),
    };
  }
  // Sunday before 17:00 ET — weekend not over
  if (day === 0 && totalMinutes < openMin) {
    return {
      open: false,
      reason: `${label} session not yet open`,
      nextOpenUtc: formatEt(0, 17, 0),
    };
  }
  // Friday at/after 17:00 ET — weekend close
  if (day === 5 && totalMinutes >= openMin) {
    return {
      open: false,
      reason: `${label} closed for the weekend`,
      nextOpenUtc: formatEt(0, 17, 0),
    };
  }
  // Daily 60-minute break Mon–Thu at 17:00 ET
  if (day >= 1 && day <= 4 && totalMinutes >= openMin && totalMinutes < closeMin) {
    return {
      open: false,
      reason: "Daily maintenance break",
      nextOpenUtc: formatEt(day, 18, 0),
    };
  }
  return { open: true };
}

/**
 * Commodities session: Sun 6:00PM ET → Fri 5:00PM ET with 60-min daily
 * break at 5:00PM ET.
 */
function commodityStatus(now: Date): MarketStatus {
  const { day, totalMinutes } = getEtParts(now);
  const sundayOpen = 18 * 60;     // 18:00 ET Sun
  const dailyBreakStart = 17 * 60; // 17:00 ET
  const dailyBreakEnd = 18 * 60;   // 18:00 ET

  if (day === 6) {
    return {
      open: false,
      reason: "Commodity market closed for the weekend",
      nextOpenUtc: formatEt(0, 18, 0),
    };
  }
  if (day === 0 && totalMinutes < sundayOpen) {
    return {
      open: false,
      reason: "Commodity session not yet open",
      nextOpenUtc: formatEt(0, 18, 0),
    };
  }
  if (day === 5 && totalMinutes >= dailyBreakStart) {
    return {
      open: false,
      reason: "Commodity closed for the weekend",
      nextOpenUtc: formatEt(0, 18, 0),
    };
  }
  // Daily 60-minute break Mon–Thu at 17:00 ET
  if (day >= 1 && day <= 4 && totalMinutes >= dailyBreakStart && totalMinutes < dailyBreakEnd) {
    return {
      open: false,
      reason: "Daily maintenance break",
      nextOpenUtc: formatEt(day, 18, 0),
    };
  }
  return { open: true };
}

// ---- Public API ----

export function getMarketStatus(
  category: MarketCategory,
  now: Date = new Date(),
): MarketStatus {
  switch (category) {
    case "crypto":
      return { open: true };
    case "equity":
      return equityStatus(now);
    case "forex":
      return fxOrMetalsStatus(now, "Forex");
    case "metals":
      return fxOrMetalsStatus(now, "Metals");
    case "commodity":
      return commodityStatus(now);
  }
}

export function isMarketOpen(
  category: MarketCategory,
  now: Date = new Date(),
): boolean {
  return getMarketStatus(category, now).open;
}
