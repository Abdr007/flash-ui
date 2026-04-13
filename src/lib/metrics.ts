// ============================================
// Flash UI — Performance Metrics
// ============================================
// Tracks p50/p95/p99 latencies for tools and API calls.
// Logged to stdout as structured JSON for Vercel log drain.

interface MetricEntry {
  name: string;
  latency_ms: number;
  timestamp: number;
}

const WINDOW_SIZE = 100; // Keep last 100 entries per metric
const metrics = new Map<string, MetricEntry[]>();

export function recordMetric(name: string, latency_ms: number): void {
  if (!metrics.has(name)) metrics.set(name, []);
  const entries = metrics.get(name)!;
  entries.push({ name, latency_ms, timestamp: Date.now() });
  if (entries.length > WINDOW_SIZE) entries.shift();
}

export function getPercentile(name: string, percentile: number): number {
  const entries = metrics.get(name);
  if (!entries || entries.length === 0) return 0;
  const sorted = entries.map((e) => e.latency_ms).sort((a, b) => a - b);
  const idx = Math.min(Math.floor((sorted.length * percentile) / 100), sorted.length - 1);
  return sorted[idx];
}

export function getMetricsSummary(): Record<string, { count: number; p50: number; p95: number; p99: number }> {
  const summary: Record<string, { count: number; p50: number; p95: number; p99: number }> = {};
  for (const [name, entries] of metrics) {
    summary[name] = {
      count: entries.length,
      p50: getPercentile(name, 50),
      p95: getPercentile(name, 95),
      p99: getPercentile(name, 99),
    };
  }
  return summary;
}
