// ============================================
// Flash UI — Structured Observability Logger (Hardened)
// ============================================
// JSON-structured logging for Vercel log drain.
// Every entry includes trace_id for session correlation.
//
// Hardening:
// - Hash-chain: each log entry includes hash of previous entry
//   → detects tampering, ordering, or dropped logs
// - Monotonic sequence number → detects gaps

export type LogLevel = "info" | "warn" | "error";

export type LogStage =
  | "ai_request"
  | "tool_call"
  | "tool_result"
  | "firewall"
  | "execution"
  | "signature"
  | "cache_hit"
  | "cache_miss"
  | "parser"
  | "fast_path"
  | "direct_tool"
  | "system";

export interface LogEntry {
  trace_id: string;
  timestamp: string;
  level: LogLevel;
  stage: LogStage;
  seq: number;
  prev_hash: string;
  tool?: string;
  request_id?: string;
  wallet?: string;
  latency_ms?: number;
  error?: string;
  data?: Record<string, unknown>;
}

// ---- Session Trace ID ----

let _traceId: string | null = null;

export function getTraceId(): string {
  if (!_traceId) {
    _traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return _traceId;
}

export function setTraceId(id: string): void {
  _traceId = id;
}

// ---- Hash Chain State ----

let _seq = 0;
let _prevHash = "genesis";

/**
 * Simple djb2 hash for chain integrity.
 * Not cryptographic — detects accidental tampering/reordering.
 */
function hashEntry(entry: string): string {
  let hash = 5381;
  for (let i = 0; i < entry.length; i++) {
    hash = ((hash << 5) + hash + entry.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

// ---- Core Emit ----

function emit(entry: LogEntry): void {
  try {
    const serialized = JSON.stringify(entry);
    console.log(serialized);
    // Update chain
    _prevHash = hashEntry(serialized);
  } catch {
    // Swallow — logging must never throw
  }
}

// ---- Public API ----

export function log(
  level: LogLevel,
  stage: LogStage,
  data?: Partial<Omit<LogEntry, "trace_id" | "timestamp" | "level" | "stage" | "seq" | "prev_hash">>,
): void {
  _seq++;
  emit({
    trace_id: getTraceId(),
    timestamp: new Date().toISOString(),
    level,
    stage,
    seq: _seq,
    prev_hash: _prevHash,
    ...data,
  });
}

export function logInfo(
  stage: LogStage,
  data?: Partial<Omit<LogEntry, "trace_id" | "timestamp" | "level" | "stage" | "seq" | "prev_hash">>,
): void {
  log("info", stage, data);
}

export function logWarn(
  stage: LogStage,
  data?: Partial<Omit<LogEntry, "trace_id" | "timestamp" | "level" | "stage" | "seq" | "prev_hash">>,
): void {
  log("warn", stage, data);
}

export function logError(
  stage: LogStage,
  data?: Partial<Omit<LogEntry, "trace_id" | "timestamp" | "level" | "stage" | "seq" | "prev_hash">>,
): void {
  log("error", stage, data);
}

// ---- Latency Helper ----

export async function withLatency<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; latency_ms: number }> {
  const start = performance.now();
  const result = await fn();
  const latency_ms = Math.round(performance.now() - start);
  return { result, latency_ms };
}

// ---- Scrubbing ----

const SENSITIVE_PATTERNS = /sk-ant-[^\s]+|gsk_[^\s]+|api_key=[^\s&]+/g;

export function scrub(text: string): string {
  return text.replace(SENSITIVE_PATTERNS, "***");
}
