// ============================================
// System Certification — Execution Gate
// ============================================
// Evaluates all subsystems and produces a single certification status.
// If not CERTIFIED, execution is blocked.
//
// Inputs: circuit breaker, trace verifier, stream status, API latency
// Output: certification status + reason
//
// Pure evaluation. No side effects. Called before every execution.

import { getCircuitStats, type CircuitState } from "./circuit-breaker";
import { getRecentTraces } from "./execution-log";
import { verifyTraces, anomalySummary } from "./trace-verifier";

export type CertificationStatus = "certified" | "degraded" | "blocked";

export interface CertificationResult {
  status: CertificationStatus;
  execution_enabled: boolean;
  reason: string;
  anomaly_count: number;
  critical_count: number;
  circuit_state: CircuitState;
}

const LATENCY_WARN_MS = 2000;

/**
 * Evaluate system certification status.
 * Called before execution and by health endpoint.
 */
export function evaluateCertification(
  streamStatus: "connected" | "reconnecting" | "disconnected",
  apiLatencyMs?: number,
): CertificationResult {
  const circuit = getCircuitStats();
  const traces = getRecentTraces();
  const anomalies = verifyTraces(traces);
  const summary = anomalySummary(anomalies);

  // ---- BLOCKED conditions (any one triggers) ----

  // Critical trace anomalies
  if (summary.critical > 0) {
    return {
      status: "blocked",
      execution_enabled: false,
      reason: `${summary.critical} critical trace anomaly detected — execution blocked`,
      anomaly_count: summary.total,
      critical_count: summary.critical,
      circuit_state: circuit.state,
    };
  }

  // Circuit breaker open
  if (circuit.state === "open") {
    return {
      status: "blocked",
      execution_enabled: false,
      reason: `Circuit breaker open — ${circuit.consecutiveFailures} consecutive failures (${circuit.lastFailureType})`,
      anomaly_count: summary.total,
      critical_count: 0,
      circuit_state: circuit.state,
    };
  }

  // ---- DEGRADED conditions ----

  const degradedReasons: string[] = [];

  // High anomalies
  if (summary.high > 0) {
    degradedReasons.push(`${summary.high} high-severity anomalies`);
  }

  // Circuit half-open (recovering)
  if (circuit.state === "half-open") {
    degradedReasons.push("circuit breaker recovering");
  }

  // Stream disconnected
  if (streamStatus === "disconnected") {
    degradedReasons.push("price stream disconnected");
  }

  // Stream reconnecting
  if (streamStatus === "reconnecting") {
    degradedReasons.push("price stream reconnecting");
  }

  // High API latency
  if (apiLatencyMs != null && apiLatencyMs > LATENCY_WARN_MS) {
    degradedReasons.push(`API latency ${apiLatencyMs}ms`);
  }

  if (degradedReasons.length > 0) {
    return {
      status: "degraded",
      execution_enabled: true, // Degraded still allows execution with warnings
      reason: degradedReasons.join("; "),
      anomaly_count: summary.total,
      critical_count: 0,
      circuit_state: circuit.state,
    };
  }

  // ---- CERTIFIED ----
  return {
    status: "certified",
    execution_enabled: true,
    reason: "all systems operational",
    anomaly_count: 0,
    critical_count: 0,
    circuit_state: circuit.state,
  };
}
