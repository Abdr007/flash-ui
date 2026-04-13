// ============================================
// Flash UI — Centralized Error Types
// ============================================
// Structured errors with codes, severity, and context.
// Used across API routes and tool handlers for consistent
// error reporting and log correlation.

import { NextResponse } from "next/server";

export type ErrorSeverity = "low" | "medium" | "high" | "critical";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "MARKET_INVALID"
  | "LEVERAGE_EXCEEDED"
  | "INSUFFICIENT_BALANCE"
  | "API_TIMEOUT"
  | "RPC_ERROR"
  | "TX_FAILED"
  | "TX_REJECTED"
  | "CIRCUIT_OPEN"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly severity: ErrorSeverity;
  public readonly context?: Record<string, unknown>;
  public readonly statusCode: number;

  constructor(
    message: string,
    code: ErrorCode,
    opts?: {
      severity?: ErrorSeverity;
      statusCode?: number;
      context?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.severity = opts?.severity ?? severityForCode(code);
    this.statusCode = opts?.statusCode ?? statusCodeForError(code);
    this.context = opts?.context;
  }
}

function severityForCode(code: ErrorCode): ErrorSeverity {
  switch (code) {
    case "VALIDATION_ERROR":
    case "MARKET_INVALID":
    case "LEVERAGE_EXCEEDED":
      return "low";
    case "RATE_LIMITED":
    case "INSUFFICIENT_BALANCE":
    case "TX_REJECTED":
      return "medium";
    case "AUTH_ERROR":
    case "API_TIMEOUT":
    case "RPC_ERROR":
    case "TX_FAILED":
    case "CIRCUIT_OPEN":
      return "high";
    case "INTERNAL_ERROR":
      return "critical";
  }
}

function statusCodeForError(code: ErrorCode): number {
  switch (code) {
    case "VALIDATION_ERROR":
    case "MARKET_INVALID":
    case "LEVERAGE_EXCEEDED":
    case "INSUFFICIENT_BALANCE":
      return 400;
    case "AUTH_ERROR":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "TX_REJECTED":
      return 403;
    case "API_TIMEOUT":
    case "RPC_ERROR":
    case "TX_FAILED":
    case "CIRCUIT_OPEN":
      return 502;
    case "INTERNAL_ERROR":
      return 500;
  }
}

/** Create a standardized JSON error response from any error */
export function errorResponse(err: unknown, opts?: { trace_id?: string; fallbackCode?: ErrorCode }): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        ...(opts?.trace_id && { trace_id: opts.trace_id }),
      },
      { status: err.statusCode },
    );
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  const code = opts?.fallbackCode ?? "INTERNAL_ERROR";

  return NextResponse.json(
    {
      error: message,
      code,
      ...(opts?.trace_id && { trace_id: opts.trace_id }),
    },
    { status: statusCodeForError(code) },
  );
}

/** Type guard: check if an error is an AppError with a specific code */
export function isAppError(err: unknown, code?: ErrorCode): err is AppError {
  return err instanceof AppError && (code === undefined || err.code === code);
}
