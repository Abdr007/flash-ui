// ============================================
// Flash AI — Place Trigger Order (TP/SL on existing positions)
// ============================================
// Sets or modifies take-profit / stop-loss on an EXISTING open position.
// Uses Flash API's place-trigger-order endpoint.
// This enables "set tp 200 on my SOL long" type commands.

import { z } from "zod";
import { tool } from "ai";
import type { ToolResponse } from "./shared";
import { runTradeGuards, logToolCall, logToolResult, resolveMarket } from "./shared";

export function createPlaceTriggerOrderTool(wallet: string) {
  return tool({
    description:
      "Place or update a take-profit (TP) or stop-loss (SL) trigger order on an EXISTING open position. " +
      "Use when user wants to: set TP/SL on a position, modify existing TP/SL, add TP to a position that doesn't have one. " +
      "Trigger: 'set tp 200 on SOL', 'add sl 130 to my BTC long', 'update tp to 180 on SOL'.",
    inputSchema: z
      .object({
        market: z.string().describe("Market symbol (SOL, BTC, ETH, etc.)"),
        side: z.enum(["LONG", "SHORT"]).describe("Position side"),
        trigger_price: z.number().positive().describe("Price at which to trigger the order"),
        is_stop_loss: z.boolean().describe("true for stop-loss, false for take-profit"),
      })
      .strict(),
    execute: async ({ market, side, trigger_price, is_stop_loss }): Promise<ToolResponse<unknown>> => {
      const requestId = `trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const start = Date.now();
      logToolCall("place_trigger_order", requestId, wallet, { market, side, trigger_price, is_stop_loss });

      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr;

      const resolved = resolveMarket(market);
      if (!resolved) {
        return {
          status: "error",
          data: null,
          error: `Unknown market: ${market}`,
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      // Validate TP/SL direction
      if (!is_stop_loss) {
        // Take profit: LONG TP > current price, SHORT TP < current price
        // We can't fully validate without current price, but basic direction check:
        if (side === "LONG" && trigger_price <= 0) {
          return {
            status: "error",
            data: null,
            error: "Take profit price must be positive",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }
      }

      try {
        // Find existing position to get size
        const { getPositions } = await import("@/lib/api");
        const positions = await getPositions(wallet);
        const position = positions.find((p) => p.market === resolved && p.side === side);

        if (!position) {
          return {
            status: "error",
            data: null,
            error: `No ${side} ${resolved} position found. Open a position first.`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        // Direction validation against entry price
        if (!is_stop_loss && side === "LONG" && trigger_price <= position.entry_price) {
          return {
            status: "error",
            data: null,
            error: `LONG take profit must be above entry price ($${position.entry_price.toFixed(2)})`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }
        if (!is_stop_loss && side === "SHORT" && trigger_price >= position.entry_price) {
          return {
            status: "error",
            data: null,
            error: `SHORT take profit must be below entry price ($${position.entry_price.toFixed(2)})`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }
        if (is_stop_loss && side === "LONG" && trigger_price >= position.entry_price) {
          return {
            status: "error",
            data: null,
            error: `LONG stop loss must be below entry price ($${position.entry_price.toFixed(2)})`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }
        if (is_stop_loss && side === "SHORT" && trigger_price <= position.entry_price) {
          return {
            status: "error",
            data: null,
            error: `SHORT stop loss must be above entry price ($${position.entry_price.toFixed(2)})`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        // Build trigger order via Flash API
        const { buildPlaceTriggerOrder } = await import("@/lib/api");
        const result = await buildPlaceTriggerOrder({
          owner: wallet,
          marketSymbol: resolved,
          side,
          triggerPriceUi: String(trigger_price),
          sizeUsdUi: String(position.size_usd),
          sizeAmountUi: String(position.size_usd / position.entry_price),
          isStopLoss: is_stop_loss,
          collateralTokenSymbol: "USDC",
        });

        if (result.err) {
          return {
            status: "error",
            data: null,
            error: result.err,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        if (!result.transactionBase64) {
          return {
            status: "error",
            data: null,
            error: "No transaction returned from API",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        const orderType = is_stop_loss ? "Stop Loss" : "Take Profit";
        logToolResult("place_trigger_order", requestId, wallet, Date.now() - start, "success");

        return {
          status: "success",
          data: {
            type: "trigger_order_preview",
            order_type: is_stop_loss ? "stop_loss" : "take_profit",
            market: resolved,
            side,
            trigger_price,
            entry_price: position.entry_price,
            size_usd: position.size_usd,
            label: `${orderType} at $${trigger_price.toLocaleString()}`,
            transaction: result.transactionBase64,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build trigger order";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}
