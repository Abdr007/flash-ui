// ============================================
// Flash UI — Formatting Utilities (Hardened)
// ============================================
// ALL functions guard against NaN/Infinity/undefined/null.
// NEVER crashes. Returns safe fallback on bad input.

/** Safe number: returns 0 for NaN/Infinity/null/undefined */
export function safe(n: unknown, fallback = 0): number {
  if (n == null) return fallback;
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function formatUsd(value: number | null | undefined): string {
  const v = safe(value);
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: v >= 1000 ? 0 : 2,
    }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

export function formatPrice(value: number | null | undefined): string {
  const v = safe(value);
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    if (v >= 1) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
    }
    // Small prices (BONK, etc)
    return `$${v.toFixed(6)}`;
  } catch {
    return `$${v.toFixed(2)}`;
  }
}

export function formatPnl(value: number | null | undefined): string {
  const v = safe(value);
  const prefix = v >= 0 ? "+" : "";
  return `${prefix}${formatUsd(v)}`;
}

export function formatPnlPct(value: number | null | undefined): string {
  const v = safe(value);
  const prefix = v >= 0 ? "+" : "";
  return `${prefix}${v.toFixed(1)}%`;
}

export function formatLeverage(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value}x`;
}

export function formatPercent(value: number | null | undefined): string {
  const v = safe(value);
  return `${(v * 100).toFixed(2)}%`;
}

export function formatTime(ts: number | null | undefined): string {
  try {
    const d = new Date(safe(ts));
    const h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "p" : "a";
    const h12 = h % 12 || 12;
    return `${h12}:${m}${ampm}`;
  } catch {
    return "—";
  }
}

export function formatChange(pct: number | null | undefined): string {
  const v = safe(pct);
  const arrow = v >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(v).toFixed(1)}%`;
}

export function truncateTx(sig: string | null | undefined): string {
  if (!sig || sig.length < 12) return sig ?? "";
  return `${sig.slice(0, 4)}...${sig.slice(-4)}`;
}

export function liqDistancePct(
  entry: number | null | undefined,
  liq: number | null | undefined,
  side: "LONG" | "SHORT"
): number {
  const e = safe(entry);
  const l = safe(liq);
  if (!e || !l) return 0;
  const result = side === "LONG"
    ? ((e - l) / e) * 100
    : ((l - e) / e) * 100;
  return Number.isFinite(result) ? result : 0;
}
