// ============================================
// Flash UI — Formatting Utilities
// ============================================

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 10_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
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
}

export function formatPnl(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${formatUsd(value)}`;
}

export function formatPnlPct(value: number): string {
  const prefix = value >= 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

export function formatLeverage(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value}x`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "p" : "a";
  const h12 = h % 12 || 12;
  return `${h12}:${m}${ampm}`;
}

export function formatChange(pct: number): string {
  const arrow = pct >= 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

export function truncateTx(sig: string): string {
  if (!sig || sig.length < 12) return sig;
  return `${sig.slice(0, 4)}...${sig.slice(-4)}`;
}

export function liqDistancePct(
  entry: number,
  liq: number,
  side: "LONG" | "SHORT"
): number {
  if (!entry || !liq) return 0;
  if (side === "LONG") {
    return ((entry - liq) / entry) * 100;
  }
  return ((liq - entry) / entry) * 100;
}
