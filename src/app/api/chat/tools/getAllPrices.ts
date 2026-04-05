// ============================================
// Flash AI — Tool: get_all_prices
// ============================================

import { tool } from "ai";
import { z } from "zod";
import { fetchAllPrices } from "../flash-api";
import { cacheFetchThrough, cacheKey, TTL } from "../cache";
import { dedup, makeDedupKey, makeRequestId } from "@/lib/tool-dedup";
import { logError } from "@/lib/logger";
import type { ToolResponse } from "./shared";
import { runReadGuards, logToolCall, logToolResult } from "./shared";

export function createGetAllPricesTool(wallet: string) {
  return tool({
    description: "Get current prices for all supported markets",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runReadGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        logToolCall("get_all_prices", requestId, wallet);

        const key = cacheKey("prices", wallet);
        const dedupKey = makeDedupKey("get_all_prices", {}, wallet);

        const { data, status, latency_ms } = await dedup(dedupKey, () =>
          cacheFetchThrough(key, TTL.prices, wallet, fetchAllPrices),
        );

        logToolResult("get_all_prices", requestId, wallet, latency_ms, status);
        return { status, data: data ?? null, request_id: requestId, latency_ms };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logError("tool_result", { tool: "get_all_prices", request_id: requestId, error: msg });
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
