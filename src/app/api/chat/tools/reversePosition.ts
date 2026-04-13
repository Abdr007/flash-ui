// ============================================
// Flash AI — Tool: reverse_position_preview
// ============================================
// Preview flipping a position direction (LONG→SHORT or SHORT→LONG).
// Does NOT execute — returns preview for user confirmation.

import { tool } from "ai";
import { z } from "zod";
import { fetchPositions, fetchPrice } from "../flash-api";
import { makeRequestId } from "@/lib/tool-dedup";
import { withLatency, logError } from "@/lib/logger";
import type { ToolResponse } from "./shared";
import { resolveMarket, runTradeGuards, logToolCall, logToolResult } from "./shared";

export function createReversePositionTool(wallet: string) {
  return tool({
    description:
      "Preview reversing/flipping a position direction (LONG to SHORT or SHORT to LONG). " +
      "Closes the existing position and opens the opposite side. Does NOT execute — returns preview only.",
    inputSchema: z
      .object({
        market: z.string().describe("Market symbol (e.g. SOL, BTC, ETH)"),
        side: z.enum(["LONG", "SHORT"]).describe("Current position side to reverse"),
      })
      .strict(),
    execute: async ({ market, side }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runTradeGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        if (!wallet) {
          return { status: "error", data: null, error: "No wallet connected", request_id: requestId, latency_ms: 0 };
        }

        const resolved = resolveMarket(market);
        if (!resolved) {
          return {
            status: "error",
            data: null,
            error: `Unknown market: ${market}`,
            request_id: requestId,
            latency_ms: 0,
          };
        }

        logToolCall("reverse_position_preview", requestId, wallet, { market: resolved, side });

        const { result, latency_ms } = await withLatency(async () => {
          const [positions, priceData] = await Promise.all([fetchPositions(wallet), fetchPrice(resolved)]);
          return { positions, priceData };
        });

        const position = result.positions.find((p) => p.market === resolved && p.side === side);

        if (!position) {
          return {
            status: "error",
            data: null,
            error: `No ${side} ${resolved} position found to reverse`,
            request_id: requestId,
            latency_ms,
          };
        }

        const currentPrice = result.priceData?.price ?? position.mark_price;
        const newSide = side === "LONG" ? "SHORT" : "LONG";

        // Estimate close PnL
        const closingSize = position.size_usd;
        const closeFee = closingSize * 0.0008;
        let closePnl: number;
        if (side === "LONG") {
          closePnl = ((currentPrice - position.entry_price) / position.entry_price) * closingSize;
        } else {
          closePnl = ((position.entry_price - currentPrice) / position.entry_price) * closingSize;
        }

        // New position will use same collateral minus fees
        const netCollateral = position.collateral_usd + closePnl - closeFee;
        const openFee = netCollateral * position.leverage * 0.0008;

        const preview = {
          market: resolved,
          current_side: side,
          new_side: newSide,
          current_entry: position.entry_price,
          exit_price: currentPrice,
          close_pnl: closePnl,
          close_fee: closeFee,
          new_collateral: Math.max(0, netCollateral - openFee),
          new_leverage: position.leverage,
          new_size: Math.max(0, (netCollateral - openFee) * position.leverage),
          open_fee: openFee,
          total_fees: closeFee + openFee,
          pubkey: position.pubkey,
        };

        logToolResult("reverse_position_preview", requestId, wallet, latency_ms, "success");

        return {
          status: "success",
          data: preview,
          request_id: requestId,
          latency_ms,
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error in reverse_position_preview";
        logError("tool_result", { tool: "reverse_position_preview", request_id: requestId, wallet, error: errorMsg });
        return { status: "error", data: null, error: errorMsg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
