// ============================================
// Flash UI — Formatting Utilities (Hardened + Honest)
// ============================================
// ALL functions guard against NaN/Infinity/undefined/null.
// NEVER crashes. Returns HONEST fallback on bad input.
// Shows "—" for missing data, never fake "$0.00".

/** Safe number: returns fallback for NaN/Infinity/null/undefined. Logs invalid hits (non-blocking). */
export function safe(n: unknown, fallback = 0): number {
  if (n == null) return fallback;
  const v = typeof n === "number" ? n : Number(n);
  if (Number.isFinite(v)) return v;
  // Non-blocking log: invalid value reached rendering
  try {
    console.warn("[safe] invalid value:", typeof n, String(n).slice(0, 50));
  } catch {}
  return fallback;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return `$${safe(value).toFixed(2)}`;
  }
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  try {
    if (value >= 1) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    }
    // Small prices (BONK, etc)
    return `$${value.toFixed(6)}`;
  } catch {
    return `$${safe(value).toFixed(2)}`;
  }
}

export function formatPnl(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatUsd(value)}`;
}

export function formatPnlPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

export function formatLeverage(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value}x`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

export function formatTime(ts: number | null | undefined): string {
  try {
    if (ts == null || !Number.isFinite(ts)) return "—";
    const d = new Date(ts);
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
  if (pct == null || !Number.isFinite(pct)) return "—";
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

export function truncateTx(sig: string | null | undefined): string {
  if (!sig || sig.length < 12) return sig ?? "";
  return `${sig.slice(0, 4)}...${sig.slice(-4)}`;
}

export function liqDistancePct(
  entry: number | null | undefined,
  liq: number | null | undefined,
  side: "LONG" | "SHORT",
): number {
  const e = safe(entry);
  const l = safe(liq);
  if (!e || !l) return 0;
  const result = side === "LONG" ? ((e - l) / e) * 100 : ((l - e) / e) * 100;
  return Number.isFinite(result) ? result : 0;
}

/** Format a relative time since a timestamp. "2s ago", "1m ago", "5m ago" */
export function formatAgo(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "";
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}
