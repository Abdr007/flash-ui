// ============================================
// Execution Trace Logger
// ============================================
// Full audit trail for every trade lifecycle.
// Each trade gets a unique execution_id that links all stages.
// Logs are structured JSON, append-only, captured by Vercel log drain.
//
// Never logs: private keys, wallet secret material, RPC API keys.
// Logs do not affect execution path — fire-and-forget.

// ---- Execution ID Generator ----
let execCounter = 0;

/** Generate a unique execution ID: exec_{timestamp}_{counter} */
export function genExecutionId(): string {
  return `exec_${Date.now()}_${++execCounter}`;
}

// ---- Event Types ----

export type TraceStage =
  | "intent_parsed"
  | "trade_enriched"
  | "trade_confirm"
  | "trade_execute"
  | "trade_success"
  | "trade_error"
  | "close_position"
  | "reduce_position"
  | "circuit_open"
  | "circuit_recover"
  | "rate_limited"
  | "stream_fallback";

export interface ExecutionTrace {
  execution_id: string;
  timestamp: string;
  stage: TraceStage;
  wallet: string;
  market: string;
  side: string;
  collateral?: number;
  leverage?: number;
  position_size?: number;
  entry_price?: number;
  liquidation_price?: number;
  slippage_bps?: number;
  fees?: number;
  tx_signature?: string;
  error?: string;
  error_type?: string;
  latency_ms?: number;
  circuit_state?: string;
  system_status?: string;
}

// ---- In-Memory Trace Buffer (for verification) ----
// Rolling buffer of last 100 traces. Append-only.
const MAX_BUFFER = 100;
const traceBuffer: ExecutionTrace[] = [];

/** Emit a structured trace event. Append-only. Never throws. */
export function logTrace(trace: ExecutionTrace): void {
  try {
    // Append to buffer
    traceBuffer.push(trace);
    if (traceBuffer.length > MAX_BUFFER) {
      traceBuffer.shift();
    }
    // Emit to log drain
    console.log(JSON.stringify({ ...trace, _type: "trace" }));
  } catch {
    // Fire-and-forget — logging must never affect execution
  }
}

/** Get recent traces grouped by execution_id (for verification) */
export function getRecentTraces(): Map<string, ExecutionTrace[]> {
  const grouped = new Map<string, ExecutionTrace[]>();
  for (const trace of traceBuffer) {
    const group = grouped.get(trace.execution_id) ?? [];
    group.push(trace);
    grouped.set(trace.execution_id, group);
  }
  return grouped;
}

/** Emit a system decision event (circuit breaker, rate limit, fallback) */
export function logSystemEvent(
  stage: TraceStage,
  detail: Record<string, unknown>
): void {
  try {
    console.log(
      JSON.stringify({
        _type: "system",
        timestamp: new Date().toISOString(),
        stage,
        ...detail,
      })
    );
  } catch {
    // Fire-and-forget
  }
}

// ---- Legacy compatibility ----

export interface ExecutionEvent {
  timestamp: string;
  event: string;
  wallet: string;
  market: string;
  side: string;
  collateral?: number;
  leverage?: number;
  entry_price?: number;
  tx_signature?: string;
  error?: string;
  latency_ms?: number;
}

/** @deprecated Use logTrace instead */
export function logExecution(event: ExecutionEvent): void {
  try {
    console.log(JSON.stringify({ ...event, _type: "execution" }));
  } catch {
    // Fire-and-forget
  }
}

/** Measure async operation latency and return result + duration */
export async function withLatency<T>(
  fn: () => Promise<T>
): Promise<{ result: T; latencyMs: number }> {
  const start = performance.now();
  const result = await fn();
  const latencyMs = Math.round(performance.now() - start);
  return { result, latencyMs };
}
