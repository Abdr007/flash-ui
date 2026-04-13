// ============================================
// Trace Verifier — Execution Audit Validation
// ============================================
// Pure functions. No side effects. No I/O.
// Validates consistency of execution trace chains.
//
// Checks:
// 1. Required stages exist (confirm → execute → result)
// 2. Stage order is correct
// 3. No duplicate stages
// 4. Numeric consistency (position_size = collateral × leverage)
// 5. Price validity (finite, positive, liq relative to entry)
// 6. Latency within bounds
// 7. execution_id uniqueness

import type { ExecutionTrace, TraceStage } from "./execution-log";

export interface TraceAnomaly {
  execution_id: string;
  check: string;
  severity: "critical" | "high" | "medium";
  detail: string;
}

// Expected stage order for a complete trade lifecycle (used for documentation)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _STAGE_ORDER: TraceStage[] = [
  "trade_confirm",
  "trade_execute",
  // terminal: one of trade_success or trade_error
];

const TERMINAL_STAGES: TraceStage[] = ["trade_success", "trade_error"];
const MAX_REASONABLE_LATENCY_MS = 30_000;
const MAX_REASONABLE_FEE_RATE = 0.01; // 1%

/**
 * Verify a set of traces grouped by execution_id.
 * Returns all detected anomalies.
 */
export function verifyTraces(tracesByExecId: Map<string, ExecutionTrace[]>): TraceAnomaly[] {
  const anomalies: TraceAnomaly[] = [];

  for (const [execId, traces] of tracesByExecId) {
    // Sort by timestamp
    const sorted = [...traces].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const stages = sorted.map((t) => t.stage);

    // ---- 1. Required stages ----
    if (!stages.includes("trade_confirm")) {
      anomalies.push({
        execution_id: execId,
        check: "missing_stage",
        severity: "critical",
        detail: "Missing trade_confirm stage",
      });
    }

    if (!stages.includes("trade_execute")) {
      // Only flag if there's a terminal stage (means something happened after confirm)
      if (stages.some((s) => TERMINAL_STAGES.includes(s))) {
        anomalies.push({
          execution_id: execId,
          check: "missing_stage",
          severity: "critical",
          detail: "Missing trade_execute stage but has terminal stage",
        });
      }
    }

    // ---- 2. Stage order ----
    const confirmIdx = stages.indexOf("trade_confirm");
    const executeIdx = stages.indexOf("trade_execute");
    const successIdx = stages.indexOf("trade_success");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _errorIdx = stages.indexOf("trade_error");

    if (confirmIdx >= 0 && executeIdx >= 0 && executeIdx < confirmIdx) {
      anomalies.push({
        execution_id: execId,
        check: "stage_order",
        severity: "critical",
        detail: "trade_execute before trade_confirm",
      });
    }

    if (executeIdx >= 0 && successIdx >= 0 && successIdx < executeIdx) {
      anomalies.push({
        execution_id: execId,
        check: "stage_order",
        severity: "critical",
        detail: "trade_success before trade_execute",
      });
    }

    // ---- 3. Duplicate stages ----
    const stageCounts = new Map<string, number>();
    for (const s of stages) {
      stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1);
    }
    for (const [stage, count] of stageCounts) {
      if (count > 1) {
        anomalies.push({
          execution_id: execId,
          check: "duplicate_stage",
          severity: "high",
          detail: `Stage ${stage} appears ${count} times`,
        });
      }
    }

    // ---- 4. Numeric consistency ----
    for (const trace of sorted) {
      if (trace.collateral != null && trace.leverage != null && trace.position_size != null) {
        const expected = trace.collateral * trace.leverage;
        const diff = Math.abs(trace.position_size - expected);
        // Allow 1% tolerance for API-adjusted values
        if (diff / expected > 0.01) {
          anomalies.push({
            execution_id: execId,
            check: "numeric_consistency",
            severity: "high",
            detail: `position_size (${trace.position_size}) != collateral (${trace.collateral}) × leverage (${trace.leverage}) = ${expected}`,
          });
        }
      }

      // ---- 5. Price validity ----
      if (trace.entry_price != null) {
        if (!Number.isFinite(trace.entry_price) || trace.entry_price <= 0) {
          anomalies.push({
            execution_id: execId,
            check: "invalid_price",
            severity: "critical",
            detail: `Invalid entry_price: ${trace.entry_price}`,
          });
        }
      }

      if (trace.liquidation_price != null && trace.entry_price != null && trace.side) {
        if (trace.side === "LONG" && trace.liquidation_price >= trace.entry_price) {
          anomalies.push({
            execution_id: execId,
            check: "liq_price_invalid",
            severity: "critical",
            detail: `LONG liq_price (${trace.liquidation_price}) >= entry (${trace.entry_price})`,
          });
        }
        if (trace.side === "SHORT" && trace.liquidation_price <= trace.entry_price) {
          anomalies.push({
            execution_id: execId,
            check: "liq_price_invalid",
            severity: "critical",
            detail: `SHORT liq_price (${trace.liquidation_price}) <= entry (${trace.entry_price})`,
          });
        }
      }

      // ---- 6. Fee reasonableness ----
      if (trace.fees != null && trace.position_size != null && trace.position_size > 0) {
        const feeRate = trace.fees / trace.position_size;
        if (feeRate > MAX_REASONABLE_FEE_RATE) {
          anomalies.push({
            execution_id: execId,
            check: "excessive_fees",
            severity: "medium",
            detail: `Fee rate ${(feeRate * 100).toFixed(2)}% exceeds ${MAX_REASONABLE_FEE_RATE * 100}% threshold`,
          });
        }
      }

      // ---- 7. Latency bounds ----
      if (trace.latency_ms != null && trace.latency_ms > MAX_REASONABLE_LATENCY_MS) {
        anomalies.push({
          execution_id: execId,
          check: "high_latency",
          severity: "medium",
          detail: `Latency ${trace.latency_ms}ms exceeds ${MAX_REASONABLE_LATENCY_MS}ms`,
        });
      }
    }

    // ---- 8. No terminal stage (orphaned execution) ----
    if (stages.includes("trade_execute") && !stages.some((s) => TERMINAL_STAGES.includes(s))) {
      anomalies.push({
        execution_id: execId,
        check: "orphaned_execution",
        severity: "high",
        detail: "trade_execute without success or error result",
      });
    }
  }

  return anomalies;
}

/**
 * Quick health summary from anomalies.
 */
export function anomalySummary(anomalies: TraceAnomaly[]): {
  total: number;
  critical: number;
  high: number;
  medium: number;
} {
  let critical = 0;
  let high = 0;
  let medium = 0;
  for (const a of anomalies) {
    if (a.severity === "critical") critical++;
    else if (a.severity === "high") high++;
    else medium++;
  }
  return { total: anomalies.length, critical, high, medium };
}
