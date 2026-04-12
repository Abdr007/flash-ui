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
    }).strict(),
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
        // Always source `side` from the actual position — the AI input is
        // optional and can be null/undefined/wrong. The position object is
        // guaranteed LONG or SHORT via fetchPositions normalization.
        const effectiveSide: "LONG" | "SHORT" = position.side;

        // Defensive close_percent normalization — Zod's .default() may not
        // apply if the AI passes null instead of omitting the field.
        const pctRaw = Number(close_percent);
        const effectivePercent = Number.isFinite(pctRaw) && pctRaw >= 1 && pctRaw <= 100
          ? pctRaw
          : 100;

        const exitPrice = Number.isFinite(result.priceData?.price)
          ? (result.priceData!.price as number)
          : position.mark_price;

        if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
          return {
            status: "error",
            data: null,
            error: "Could not determine exit price. Try again.",
            request_id: requestId,
            latency_ms,
          };
        }
        if (!Number.isFinite(position.entry_price) || position.entry_price <= 0) {
          return {
            status: "error",
            data: null,
            error: "Position has no valid entry price on-chain.",
            request_id: requestId,
            latency_ms,
          };
        }

        const closeRatio = effectivePercent / 100;
        const closingSize = position.size_usd * closeRatio;
        const closeFee = closingSize * 0.0008;

        const pnl = effectiveSide === "LONG"
          ? ((exitPrice - position.entry_price) / position.entry_price) * closingSize
          : ((position.entry_price - exitPrice) / position.entry_price) * closingSize;

        const preview = {
          market: resolved,
          side: effectiveSide,
          close_percent: effectivePercent,
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
