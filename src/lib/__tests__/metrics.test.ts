import { recordMetric, getPercentile, getMetricsSummary } from "../metrics";

describe("metrics", () => {
  it("records and retrieves p50", () => {
    for (let i = 1; i <= 100; i++) recordMetric("test_tool", i);
    expect(getPercentile("test_tool", 50)).toBe(51);
  });

  it("returns 0 for unknown metric", () => {
    expect(getPercentile("nonexistent", 50)).toBe(0);
  });

  it("returns summary with all fields", () => {
    recordMetric("summary_test", 10);
    recordMetric("summary_test", 20);
    const summary = getMetricsSummary();
    expect(summary["summary_test"]).toBeDefined();
    expect(summary["summary_test"].count).toBeGreaterThan(0);
    expect(summary["summary_test"].p50).toBeDefined();
    expect(summary["summary_test"].p95).toBeDefined();
    expect(summary["summary_test"].p99).toBeDefined();
  });

  it("caps at window size", () => {
    for (let i = 0; i < 200; i++) recordMetric("overflow_test", i);
    const summary = getMetricsSummary();
    expect(summary["overflow_test"].count).toBeLessThanOrEqual(100);
  });
});
