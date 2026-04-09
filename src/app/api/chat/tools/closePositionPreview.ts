// ============================================
// Flash AI — Tool: close_position_preview
// ============================================
// Execution order (STRICT):
// 1. Replay protection
// 2. Wallet rate limit
// 3. Kill switch
// 4. Wallet + market validation
// 5. Fetch data (positions + price)
// 6. Build close preview
// 7. Firewall validation
// 8. Log firewall result (pass AND block)
// 9. Return response
//
// NEVER deduplicated. No uncaught exceptions.

import { tool } from "ai";
import { z } from "zod";
import { fetchPositions, fetchPrice } from "../flash-api";
import { makeRequestId } from "@/lib/tool-dedup";
import { withLatency, logError } from "@/lib/logger";
import { enforceFirewall } from "@/lib/trade-firewall";
import type { ToolResponse } from "./shared";
import {
  resolveMarket,
  runTradeGuards,
  logToolCall,
  logToolResult,
  logFirewallResult,
} from "./shared";

export function createClosePositionPreviewTool(wallet: string) {
  return tool({
    description:
      "Preview closing a position: estimated PnL, fees, exit price. " +
      "Does NOT execute — returns preview only.",
    inputSchema: z.object({
      market: z.string().describe("Market symbol"),
      side: z.enum(["LONG", "SHORT"]).optional().describe("Position side to close — auto-detected if omitted"),
      close_percent: z
        .number()
        .min(1)
        .max(100)
        .default(100)
        .describe("Percentage to close (1-100)"),
    }),
    execute: async ({
      market,
      side,
      close_percent,
    }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        // ---- STEP 1-3: Guard chain (replay → rate limit → kill switch) ----
        const guardBlock = runTradeGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        // ---- STEP 4: Wallet + market validation ----
        if (!wallet) {
          return {
            status: "error",
            data: null,
            error: "No wallet connected",
            request_id: requestId,
            latency_ms: 0,
          };
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

        logToolCall("close_position_preview", requestId, wallet, {
          market: resolved,
          side,
          close_percent,
        });

        // ---- STEP 5: Fetch data (positions + current price) ----
        const { result, latency_ms } = await withLatency(async () => {
          const [positions, priceData] = await Promise.all([
            fetchPositions(wallet),
            fetchPrice(resolved),
          ]);
          return { positions, priceData };
        });

        // Auto-detect side if not specified — find any position on this market
        const position = side
          ? result.positions.find((p) => p.market === resolved && p.side === side)
          : result.positions.find((p) => p.market === resolved);

        if (!position) {
          return {
            status: "error",
            data: null,
            error: `No ${side ?? ""} ${resolved} position found`.replace("  ", " ").trim(),
            request_id: requestId,
            latency_ms,
          };
        }

        // ---- STEP 6: Build close preview ----
        const exitPrice = result.priceData?.price ?? position.mark_price;
        const closeRatio = close_percent / 100;
        const closingSize = position.size_usd * closeRatio;
        const closeFee = closingSize * 0.0008;

        let pnl: number;
        if (side === "LONG") {
          pnl =
            ((exitPrice - position.entry_price) / position.entry_price) *
            closingSize;
        } else {
          pnl =
            ((position.entry_price - exitPrice) / position.entry_price) *
            closingSize;
        }

        const preview = {
          market: resolved,
          side,
          close_percent,
          exit_price: exitPrice,
          closing_size: closingSize,
          estimated_pnl: pnl,
          estimated_fees: closeFee,
          net_pnl: pnl - closeFee,
          entry_price: position.entry_price,
          pubkey: position.pubkey,
          size_usd: position.size_usd,
        };

        // ---- STEP 7: Firewall validation ----
        const firewall = enforceFirewall(
          "close_position_preview",
          preview,
          wallet,
          result.positions,
        );

        // ---- STEP 8: Log firewall result (ALWAYS — pass or block) ----
        logFirewallResult(
          "close_position_preview",
          requestId,
          wallet,
          firewall.blocked,
          firewall.errors,
          firewall.warnings,
        );

        if (firewall.blocked) {
          return {
            status: "error",
            data: null,
            error: `Close preview failed validation: ${firewall.errors?.join("; ")}`,
            request_id: requestId,
            latency_ms,
          };
        }

        // ---- STEP 9: Return validated response ----
        logToolResult(
          "close_position_preview",
          requestId,
          wallet,
          latency_ms,
          "success",
        );

        return {
          status: "success",
          data: preview,
          request_id: requestId,
          latency_ms,
          warnings: firewall.warnings,
        };
      } catch (err: unknown) {
        // No silent failures — structured error response
        const errorMsg = err instanceof Error ? err.message : "Unknown error in close_position_preview";
        logError("tool_result", {
          tool: "close_position_preview",
          request_id: requestId,
          wallet,
          error: errorMsg,
        });
        return {
          status: "error",
          data: null,
          error: errorMsg,
          request_id: requestId,
          latency_ms: 0,
        };
      }
    },
  });
}
