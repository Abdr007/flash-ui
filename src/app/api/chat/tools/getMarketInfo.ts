// ============================================
// Flash AI — Tool: get_market_info
// ============================================

import { tool } from "ai";
import { z } from "zod";
import { makeRequestId } from "@/lib/tool-dedup";
import { logError } from "@/lib/logger";
import { MARKETS, DEFAULT_LEVERAGE, MAX_LEVERAGE } from "@/lib/constants";
import type { ToolResponse } from "./shared";
import { resolveMarket, runReadGuards, logToolCall } from "./shared";

const MAX_LEV_BY_POOL: Record<string, number> = {
  "Crypto.1": 100, "Virtual.1": 50, "Governance.1": 50,
  "Community.1": 20, "Community.2": 20, "Trump.1": 20,
  "Ore.1": 20, "Equity.1": 50,
};

export function createGetMarketInfoTool(wallet: string) {
  return tool({
    description: "Get market metadata: supported pool, default/max leverage, market type",
    inputSchema: z.object({
      market: z.string().describe("Market symbol (e.g., SOL, BTC)"),
    }),
    execute: async ({ market }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runReadGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        const resolved = resolveMarket(market);
        if (!resolved || !(resolved in MARKETS)) {
          return { status: "error", data: null, error: `Unknown market: ${market}`, request_id: requestId, latency_ms: 0 };
        }

        logToolCall("get_market_info", requestId, wallet, { market: resolved });

        const config = MARKETS[resolved];
        return {
          status: "success",
          data: {
            market: resolved,
            pool: config.pool,
            default_leverage: DEFAULT_LEVERAGE[config.pool] ?? 3,
            max_leverage: MAX_LEV_BY_POOL[config.pool] ?? MAX_LEVERAGE,
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
