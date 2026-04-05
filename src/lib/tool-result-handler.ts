// ============================================
// Flash UI — Tool Result Handler
// ============================================
// Normalizes AI tool responses and routes them to the correct store updates.
// NO direct UI mutation. All updates go through the store.
//
// Flow:
// 1. AI tool returns ToolResponse<T>
// 2. handleToolResult() normalizes the response
// 3. Routes to the correct store action
// 4. Trade tools are firewalled before state update
//
// This is the ONLY path from AI tool output to store state.

import { validateTrade, type TradePreview, type FirewallResult } from "./trade-firewall";
import { logInfo, logError } from "./logger";
import type { Position, Side } from "./types";

// ---- Normalized Tool Response (matches server ToolResponse<T>) ----

export interface NormalizedToolResult<T = unknown> {
  status: "success" | "error" | "degraded";
  data: T | null;
  error?: string;
  request_id: string;
  latency_ms: number;
  warnings?: string[];
}

// ---- Tool Output Types (typed per tool) ----

export interface PriceData {
  symbol: string;
  price: number;
  confidence: number;
  timestamp: number;
}

export interface PositionData {
  pubkey: string;
  market: string;
  side: Side;
  entry_price: number;
  mark_price: number;
  size_usd: number;
  collateral_usd: number;
  leverage: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  liquidation_price: number;
  fees: number;
  timestamp: number;
}

export interface PortfolioData {
  wallet_address: string;
  positions: PositionData[];
  total_collateral: number;
  total_unrealized_pnl: number;
  total_exposure: number;
  position_count: number;
}

export interface TradePreviewData {
  market: string;
  side: Side;
  collateral_usd: number;
  leverage: number;
  entry_price: number;
  liquidation_price: number;
  position_size: number;
  fees: number;
  fee_rate: number;
  slippage_bps: number;
}

export interface ClosePreviewData {
  market: string;
  side: Side;
  close_percent: number;
  exit_price: number;
  closing_size: number;
  estimated_pnl: number;
  estimated_fees: number;
  net_pnl: number;
  entry_price: number;
}

export interface MarketInfoData {
  market: string;
  pool: string;
  default_leverage: number;
  max_leverage: number;
}

// ---- Tool Name Registry ----

export type ToolName =
  | "get_price"
  | "get_all_prices"
  | "get_positions"
  | "get_portfolio"
  | "build_trade"
  | "get_market_info"
  | "close_position_preview";

// ---- Store Action Interface ----
// These are the actions the handler will call on the store.
// The store must implement all of these.

export interface StoreActions {
  setTradeFromAI: (raw: unknown, wallet: string, positions: Position[]) => boolean;
  setClosePreview: (data: ClosePreviewData) => void;
  updatePositions: (positions: PositionData[]) => void;
  updatePortfolio: (portfolio: PortfolioData) => void;
  setError: (tool: string, error: string) => void;
}

// ---- Core Handler ----

export interface HandleResult {
  handled: boolean;
  tool: string;
  status: "success" | "error" | "degraded";
  firewallResult?: FirewallResult;
}

/**
 * Route a tool result to the correct store action.
 * Returns whether the result was handled and its status.
 */
export function handleToolResult(
  toolName: string,
  result: NormalizedToolResult,
  store: StoreActions,
  wallet: string,
  positions: Position[],
): HandleResult {
  const base = { tool: toolName, status: result.status, handled: true };

  // Error responses — log and notify store
  if (result.status === "error" && !result.data) {
    logError("tool_result", {
      tool: toolName,
      request_id: result.request_id,
      error: result.error,
    });
    store.setError(toolName, result.error ?? "Unknown error");
    return { ...base, handled: true };
  }

  switch (toolName) {
    case "build_trade": {
      // FIREWALL: validate BEFORE store mutation
      const accepted = store.setTradeFromAI(result.data, wallet, positions);
      if (!accepted) {
        logError("firewall", {
          tool: toolName,
          request_id: result.request_id,
          error: "Trade rejected by client firewall",
        });
        return { ...base, status: "error" };
      }
      logInfo("tool_result", {
        tool: toolName,
        request_id: result.request_id,
        data: { status: "accepted", warnings: result.warnings },
      });
      return base;
    }

    case "close_position_preview": {
      if (result.data) {
        store.setClosePreview(result.data as ClosePreviewData);
      }
      return base;
    }

    case "get_positions": {
      if (result.data && Array.isArray(result.data)) {
        store.updatePositions(result.data as PositionData[]);
      }
      return base;
    }

    case "get_portfolio": {
      if (result.data) {
        store.updatePortfolio(result.data as PortfolioData);
      }
      return base;
    }

    // Price tools update is handled by the UI directly (cards)
    // since prices are already managed by PriceStream SSE
    case "get_price":
    case "get_all_prices":
    case "get_market_info":
      return base;

    default:
      return { ...base, handled: false };
  }
}

// ---- Multi-Turn Trade Modification ----

/**
 * Resolve a modification to an existing trade preview.
 * Preserves previous fields unless overridden.
 * Validates AFTER modification.
 *
 * Returns null if modification produces invalid state.
 */
export function resolveTradeModification(
  previousTrade: TradePreviewData,
  modification: Partial<TradePreviewData>,
  wallet: string,
  positions: Position[],
): { trade: TradePreviewData; firewall: FirewallResult } | null {
  // Merge: new fields override, old fields preserved
  const merged: TradePreviewData = {
    ...previousTrade,
    ...stripUndefined(modification),
  };

  // Recompute derived fields if base changed
  if (modification.collateral_usd || modification.leverage) {
    merged.position_size = merged.collateral_usd * merged.leverage;
    merged.fees = merged.position_size * (merged.fee_rate || 0.0008);
  }

  if (modification.collateral_usd || modification.leverage || modification.entry_price) {
    merged.liquidation_price =
      merged.side === "LONG"
        ? merged.entry_price - merged.entry_price / merged.leverage
        : merged.entry_price + merged.entry_price / merged.leverage;
  }

  // Validate AFTER modification
  const firewall = validateTrade(merged, wallet, positions);

  if (!firewall.valid) {
    logError("firewall", {
      data: {
        action: "modification_rejected",
        errors: firewall.errors,
        original: previousTrade.market,
        modified: modification,
      },
    });
    return null;
  }

  return { trade: merged, firewall };
}

// ---- Helpers ----

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}
