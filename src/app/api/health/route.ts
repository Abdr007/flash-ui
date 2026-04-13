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

  // RPC liveness check (getSlot)
  let rpcStatus = "unknown";
  let rpcLatencyMs = 0;
  let rpcSlot = 0;
  try {
    const rpcUrl = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";
    const rpcStart = performance.now();
    const rpcRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [{ commitment: "confirmed" }] }),
      signal: AbortSignal.timeout(5000),
    });
    rpcLatencyMs = Math.round(performance.now() - rpcStart);
    const rpcData = await rpcRes.json();
    if (rpcData.result && typeof rpcData.result === "number") {
      rpcStatus = "ok";
      rpcSlot = rpcData.result;
    } else {
      rpcStatus = "degraded";
    }
  } catch {
    rpcStatus = "down";
  }

  // Pyth oracle freshness check (SOL/USD feed)
  let pythStatus = "unknown";
  let pythLatencyMs = 0;
  let pythAgeSec = 0;
  try {
    const pythStart = performance.now();
    const pythRes = await fetch(
      "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d&parsed=true",
      { signal: AbortSignal.timeout(5000) },
    );
    pythLatencyMs = Math.round(performance.now() - pythStart);
    const pythData = await pythRes.json();
    const parsed = pythData?.parsed?.[0];
    if (parsed?.price?.publish_time) {
      pythAgeSec = Math.floor(Date.now() / 1000) - parsed.price.publish_time;
      pythStatus = pythAgeSec < 30 ? "ok" : pythAgeSec < 120 ? "stale" : "down";
    } else {
      pythStatus = "degraded";
    }
  } catch {
    pythStatus = "down";
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
  if (rpcStatus === "down" && finalExecEnabled) {
    finalStatus = "degraded";
    finalReason = "RPC node unreachable";
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
    rpc: {
      status: rpcStatus,
      latency_ms: rpcLatencyMs,
      slot: rpcSlot,
    },
    pyth: {
      status: pythStatus,
      latency_ms: pythLatencyMs,
      age_seconds: pythAgeSec,
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
