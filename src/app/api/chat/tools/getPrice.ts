// ============================================
// Flash AI — Tool: get_price
// ============================================

import { tool } from "ai";
import { z } from "zod";
import { fetchPrice } from "../flash-api";
import { cacheFetchThrough, cacheKey, TTL } from "../cache";
import { dedup, makeDedupKey, makeRequestId } from "@/lib/tool-dedup";
import { logError } from "@/lib/logger";
import type { ToolResponse } from "./shared";
import {
  resolveMarket,
  runReadGuards,
  logToolCall,
  logToolResult,
} from "./shared";

export function createGetPriceTool(wallet: string) {
  return tool({
    description:
      "Get the current price of a specific market (e.g., SOL, BTC, ETH)",
    inputSchema: z.object({
      market: z.string().describe("Market symbol (e.g., SOL, BTC, ETH)"),
    }),
    execute: async ({ market }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runReadGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        const resolved = resolveMarket(market);
        if (!resolved) {
          return { status: "error", data: null, error: `Unknown market: ${market}`, request_id: requestId, latency_ms: 0 };
        }

        logToolCall("get_price", requestId, wallet, { market: resolved });

        const key = cacheKey("price", wallet, resolved);
        const dedupKey = makeDedupKey("get_price", { market: resolved }, wallet);

        const { data, status, latency_ms } = await dedup(dedupKey, () =>
          cacheFetchThrough(key, TTL.prices, wallet, () => fetchPrice(resolved)),
        );

        logToolResult("get_price", requestId, wallet, latency_ms, status);
        return { status, data: data ?? null, request_id: requestId, latency_ms };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logError("tool_result", { tool: "get_price", request_id: requestId, error: msg });
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
