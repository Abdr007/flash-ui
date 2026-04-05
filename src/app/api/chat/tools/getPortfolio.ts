// ============================================
// Flash AI — Tool: get_portfolio
// ============================================

import { tool } from "ai";
import { z } from "zod";
import { fetchPortfolio } from "../flash-api";
import { cacheFetchThrough, cacheKey, TTL } from "../cache";
import { dedup, makeDedupKey, makeRequestId } from "@/lib/tool-dedup";
import { logError } from "@/lib/logger";
import type { ToolResponse } from "./shared";
import { runReadGuards, logToolCall, logToolResult } from "./shared";

export function createGetPortfolioTool(wallet: string) {
  return tool({
    description: "Get portfolio overview: positions, total collateral, unrealized PnL, exposure",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runReadGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        if (!wallet) {
          return { status: "error", data: null, error: "No wallet connected", request_id: requestId, latency_ms: 0 };
        }

        logToolCall("get_portfolio", requestId, wallet);

        const key = cacheKey("portfolio", wallet);
        const dedupKey = makeDedupKey("get_portfolio", {}, wallet);

        const { data, status, latency_ms } = await dedup(dedupKey, () =>
          cacheFetchThrough(key, TTL.portfolio, wallet, () => fetchPortfolio(wallet)),
        );

        logToolResult("get_portfolio", requestId, wallet, latency_ms, status);
        return { status, data: data ?? null, request_id: requestId, latency_ms };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logError("tool_result", { tool: "get_portfolio", request_id: requestId, error: msg });
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
