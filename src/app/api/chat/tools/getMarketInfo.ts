// ============================================
// Flash AI — Tool: get_market_info
// ============================================

import { tool } from "ai";
import { z } from "zod";
import { makeRequestId } from "@/lib/tool-dedup";
import { logError } from "@/lib/logger";
import { DEFAULT_LEVERAGE } from "@/lib/constants";
import { getMarket } from "@/lib/markets-registry";
import { getMarketStatus } from "@/lib/market-hours";
import type { ToolResponse } from "./shared";
import { resolveMarket, runReadGuards, logToolCall } from "./shared";

export function createGetMarketInfoTool(wallet: string) {
  return tool({
    description:
      "Get market metadata: pool, category, leverage caps (normal + degen), live price, fee rate, utilization, and trading-hours status",
    inputSchema: z
      .object({
        market: z.string().describe("Market symbol (e.g., SOL, BTC, MET, EUR)"),
      })
      .strict(),
    execute: async ({ market }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runReadGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        const resolved = resolveMarket(market);
        const meta = resolved ? getMarket(resolved) : null;
        if (!resolved || !meta) {
          return {
            status: "error",
            data: null,
            error: `Unknown market: ${market}`,
            request_id: requestId,
            latency_ms: 0,
          };
        }

        logToolCall("get_market_info", requestId, wallet, { market: resolved });

        const status = getMarketStatus(meta.category);

        return {
          status: "success",
          data: {
            market: resolved,
            pool: meta.pool,
            category: meta.category,
            is_virtual: meta.isVirtual,
            default_leverage: DEFAULT_LEVERAGE[meta.pool] ?? 3,
            max_leverage: meta.maxLeverage,
            max_degen_leverage: meta.maxDegenLeverage,
            price_ui: meta.priceUi,
            open_fee_bps: meta.openPositionFeeBps,
            utilization: meta.utilization,
            is_open: status.open,
            status_reason: status.reason ?? null,
            next_open_utc: status.nextOpenUtc ?? null,
          },
          request_id: requestId,
          latency_ms: 0,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logError("tool_result", { tool: "get_market_info", request_id: requestId, error: msg });
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
