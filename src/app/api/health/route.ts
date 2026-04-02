import { NextResponse } from "next/server";
import { evaluateCertification } from "@/lib/certification";
import { getCircuitStats } from "@/lib/circuit-breaker";
import { getRecentTraces } from "@/lib/execution-log";
import { verifyTraces, anomalySummary } from "@/lib/trace-verifier";

const FLASH_API_URL = process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade";

export async function GET() {
  const start = performance.now();

  // Flash API latency check
  let apiStatus = "unknown";
  let apiLatencyMs = 0;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const apiStart = performance.now();
    const res = await fetch(`${FLASH_API_URL}/health`, { signal: controller.signal });
    apiLatencyMs = Math.round(performance.now() - apiStart);
    clearTimeout(timer);
    const data = await res.json();
    apiStatus = data.status === "ok" ? "ok" : "degraded";
  } catch {
    apiStatus = "down";
  }

  // Certification evaluation (uses circuit breaker + trace verifier internally)
  // Stream status not available server-side — pass "connected" as default
  const cert = evaluateCertification("connected", apiLatencyMs);

  // Override certification if API is down (server-side knows this, client-side might not)
  let finalStatus = cert.status;
  let finalReason = cert.reason;
  let finalExecEnabled = cert.execution_enabled;
  if (apiStatus === "down") {
    finalStatus = "blocked";
    finalReason = "Flash API unreachable";
    finalExecEnabled = false;
  }

  // Trace audit details
  const traces = getRecentTraces();
  const anomalies = verifyTraces(traces);
  const auditSummary = anomalySummary(anomalies);

  const circuit = getCircuitStats();

  return NextResponse.json({
    certification: finalStatus,
    execution_enabled: finalExecEnabled,
    reason: finalReason,
    uptime_check_ms: Math.round(performance.now() - start),
    flash_api: {
      status: apiStatus,
      latency_ms: apiLatencyMs,
    },
    circuit_breaker: {
      state: circuit.state,
      consecutive_failures: circuit.consecutiveFailures,
      cooldown_ms: circuit.cooldownMs,
      open_count: circuit.openCount,
    },
    audit: {
      recent_traces: traces.size,
      anomalies: auditSummary,
      ...(anomalies.length > 0 && {
        latest_anomalies: anomalies.slice(-5),
      }),
    },
    timestamp: new Date().toISOString(),
  });
}
