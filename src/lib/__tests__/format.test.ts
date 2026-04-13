// Format Utilities — Comprehensive Unit Tests

import {
  safe,
  formatUsd,
  formatPrice,
  formatPnl,
  formatPnlPct,
  formatLeverage,
  formatPercent,
  formatChange,
  truncateTx,
  liqDistancePct,
  formatAgo,
} from "../format";

describe("safe()", () => {
  it("passes through a normal number", () => {
    expect(safe(42)).toBe(42);
    expect(safe(-3.14)).toBe(-3.14);
    expect(safe(0)).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(safe(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(safe(undefined)).toBe(0);
  });

  it("returns 0 for NaN", () => {
    expect(safe(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(safe(Infinity)).toBe(0);
    expect(safe(-Infinity)).toBe(0);
  });

  it("coerces string to number", () => {
    expect(safe("123")).toBe(123);
    expect(safe("3.14")).toBe(3.14);
  });

  it("returns fallback for non-numeric string", () => {
    expect(safe("abc")).toBe(0);
  });

  it("uses custom fallback", () => {
    expect(safe(null, -1)).toBe(-1);
    expect(safe(undefined, 99)).toBe(99);
    expect(safe(NaN, 42)).toBe(42);
  });

  it("logs warning for invalid values (non-blocking)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    safe(NaN);
    expect(warnSpy).toHaveBeenCalledWith("[safe] invalid value:", "number", expect.any(String));
    warnSpy.mockRestore();
  });
});

describe("formatUsd()", () => {
  it("formats normal values", () => {
    expect(formatUsd(100)).toBe("$100.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(9.99)).toBe("$9.99");
  });

  it("returns dash for null", () => {
    expect(formatUsd(null)).toBe("\u2014");
  });

  it("returns dash for undefined", () => {
    expect(formatUsd(undefined)).toBe("\u2014");
  });

  it("returns dash for NaN", () => {
    expect(formatUsd(NaN)).toBe("\u2014");
  });

  it("returns dash for Infinity", () => {
    expect(formatUsd(Infinity)).toBe("\u2014");
  });

  it("formats large numbers", () => {
    const result = formatUsd(50000);
    // The code sets maximumFractionDigits: 0 for values >= 1000
    // Intl behavior varies by environment; verify it starts with $ and contains 50000
    expect(result).toMatch(/^\$50,?000(\.00)?$/);
  });

  it("formats small numbers with 2 decimals", () => {
    expect(formatUsd(5.5)).toBe("$5.50");
    expect(formatUsd(999.99)).toBe("$999.99");
  });

  it("formats negative values", () => {
    const result = formatUsd(-100);
    expect(result).toContain("100");
  });
});

describe("formatPrice()", () => {
  it("formats normal prices >= $1", () => {
    expect(formatPrice(150.42)).toBe("$150.42");
    expect(formatPrice(1)).toBe("$1.00");
  });

  it("formats sub-$1 prices with 6 decimals", () => {
    expect(formatPrice(0.000123)).toBe("$0.000123");
    expect(formatPrice(0.5)).toBe("$0.500000");
  });

  it("returns dash for null", () => {
    expect(formatPrice(null)).toBe("\u2014");
  });

  it("returns dash for undefined", () => {
    expect(formatPrice(undefined)).toBe("\u2014");
  });

  it("returns dash for NaN", () => {
    expect(formatPrice(NaN)).toBe("\u2014");
  });

  it("returns dash for Infinity", () => {
    expect(formatPrice(Infinity)).toBe("\u2014");
  });
});

describe("formatPnl()", () => {
  it("formats positive PnL with + prefix", () => {
    const result = formatPnl(250);
    expect(result).toMatch(/^\+\$/);
    expect(result).toContain("250");
  });

  it("formats negative PnL", () => {
    const result = formatPnl(-50);
    expect(result).toContain("50");
    // negative sign comes from formatUsd
    expect(result).not.toMatch(/^\+/);
  });

  it("formats zero as positive", () => {
    const result = formatPnl(0);
    expect(result).toMatch(/^\+/);
    expect(result).toContain("0.00");
  });

  it("returns dash for null", () => {
    expect(formatPnl(null)).toBe("\u2014");
  });

  it("returns dash for NaN", () => {
    expect(formatPnl(NaN)).toBe("\u2014");
  });
});

describe("formatPnlPct()", () => {
  it("formats positive percentage with + prefix", () => {
    expect(formatPnlPct(12.345)).toBe("+12.3%");
  });

  it("formats negative percentage", () => {
    expect(formatPnlPct(-5.67)).toBe("-5.7%");
  });

  it("formats zero as positive", () => {
    expect(formatPnlPct(0)).toBe("+0.0%");
  });

  it("returns dash for null", () => {
    expect(formatPnlPct(null)).toBe("\u2014");
  });

  it("returns dash for undefined", () => {
    expect(formatPnlPct(undefined)).toBe("\u2014");
  });

  it("returns dash for NaN", () => {
    expect(formatPnlPct(NaN)).toBe("\u2014");
  });
});

describe("formatLeverage()", () => {
  it("formats normal leverage", () => {
    expect(formatLeverage(5)).toBe("5x");
    expect(formatLeverage(100)).toBe("100x");
    expect(formatLeverage(1.5)).toBe("1.5x");
  });

  it("returns dash for null", () => {
    expect(formatLeverage(null)).toBe("\u2014");
  });

  it("returns dash for undefined", () => {
    expect(formatLeverage(undefined)).toBe("\u2014");
  });

  it("returns dash for NaN", () => {
    expect(formatLeverage(NaN)).toBe("\u2014");
  });
});

describe("formatPercent()", () => {
  it("formats 0.08 as 8.00%", () => {
    expect(formatPercent(0.08)).toBe("8.00%");
  });

  it("formats 1 as 100.00%", () => {
    expect(formatPercent(1)).toBe("100.00%");
  });

  it("formats 0 as 0.00%", () => {
    expect(formatPercent(0)).toBe("0.00%");
  });

  it("returns dash for null", () => {
    expect(formatPercent(null)).toBe("\u2014");
  });

  it("returns dash for NaN", () => {
    expect(formatPercent(NaN)).toBe("\u2014");
  });
});

describe("formatChange()", () => {
  it("formats positive change with up arrow", () => {
    expect(formatChange(5.3)).toBe("\u25B2 5.3%");
  });

  it("formats negative change with down arrow", () => {
    expect(formatChange(-2.7)).toBe("\u25BC 2.7%");
  });

  it("formats zero as up arrow", () => {
    expect(formatChange(0)).toBe("\u25B2 0.0%");
  });

  it("returns dash for null", () => {
    expect(formatChange(null)).toBe("\u2014");
  });

  it("returns dash for undefined", () => {
    expect(formatChange(undefined)).toBe("\u2014");
  });

  it("returns dash for NaN", () => {
    expect(formatChange(NaN)).toBe("\u2014");
  });
});

describe("truncateTx()", () => {
  it("truncates a normal signature", () => {
    const sig = "5KtP9a2bF7cX3dE9fG1hJ2kL3mN4pQ5rS6tU7vW8xY9zA0bC1dE2fG3hJ4kL5mN6pQ7rS8tU9";
    expect(truncateTx(sig)).toBe("5KtP...8tU9");
  });

  it("returns short sig as-is", () => {
    expect(truncateTx("abcdef")).toBe("abcdef");
    expect(truncateTx("12345678901")).toBe("12345678901"); // 11 chars < 12
  });

  it("truncates exactly 12-char sig", () => {
    expect(truncateTx("123456789012")).toBe("1234...9012");
  });

  it("returns empty string for null", () => {
    expect(truncateTx(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(truncateTx(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(truncateTx("")).toBe("");
  });
});

describe("liqDistancePct()", () => {
  it("calculates LONG: entry > liq gives positive %", () => {
    // (100 - 80) / 100 * 100 = 20%
    expect(liqDistancePct(100, 80, "LONG")).toBeCloseTo(20, 5);
  });

  it("calculates SHORT: liq > entry gives positive %", () => {
    // (120 - 100) / 100 * 100 = 20%
    expect(liqDistancePct(100, 120, "SHORT")).toBeCloseTo(20, 5);
  });

  it("returns 0 for zero entry", () => {
    expect(liqDistancePct(0, 80, "LONG")).toBe(0);
  });

  it("returns 0 for null entry", () => {
    expect(liqDistancePct(null, 80, "LONG")).toBe(0);
  });

  it("returns 0 for null liq", () => {
    expect(liqDistancePct(100, null, "LONG")).toBe(0);
  });

  it("returns 0 for undefined inputs", () => {
    expect(liqDistancePct(undefined, undefined, "LONG")).toBe(0);
  });

  it("handles LONG where liq > entry (negative distance)", () => {
    // (100 - 120) / 100 * 100 = -20%
    expect(liqDistancePct(100, 120, "LONG")).toBeCloseTo(-20, 5);
  });

  it("handles SHORT where entry > liq (negative distance)", () => {
    // (80 - 100) / 100 * 100 = -20%
    expect(liqDistancePct(100, 80, "SHORT")).toBeCloseTo(-20, 5);
  });
});

describe("formatAgo()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for < 5s ago", () => {
    expect(formatAgo(Date.now() - 2000)).toBe("just now");
    expect(formatAgo(Date.now())).toBe("just now");
  });

  it("returns seconds for 5s-59s range", () => {
    expect(formatAgo(Date.now() - 10_000)).toBe("10s ago");
    expect(formatAgo(Date.now() - 59_000)).toBe("59s ago");
  });

  it("returns minutes for 1m-59m range", () => {
    expect(formatAgo(Date.now() - 60_000)).toBe("1m ago");
    expect(formatAgo(Date.now() - 300_000)).toBe("5m ago");
    expect(formatAgo(Date.now() - 3_599_000)).toBe("59m ago");
  });

  it("returns hours for >= 1h", () => {
    expect(formatAgo(Date.now() - 3_600_000)).toBe("1h ago");
    expect(formatAgo(Date.now() - 7_200_000)).toBe("2h ago");
  });

  it("returns empty string for null", () => {
    expect(formatAgo(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatAgo(undefined)).toBe("");
  });

  it("returns empty string for NaN", () => {
    expect(formatAgo(NaN)).toBe("");
  });

  it("clamps negative delta to 0 (future timestamp)", () => {
    // ts in the future → delta < 0 → Math.max(0, ...) → "just now"
    expect(formatAgo(Date.now() + 60_000)).toBe("just now");
  });
});
