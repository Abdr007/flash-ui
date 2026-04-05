// ============================================
// Flash AI — Tool: get_positions
// ============================================

import { tool } from "ai";
import { z } from "zod";
import { fetchPositions } from "../flash-api";
import { cacheFetchThrough, cacheKey, TTL } from "../cache";
import { dedup, makeDedupKey, makeRequestId } from "@/lib/tool-dedup";
import { logError } from "@/lib/logger";
import type { ToolResponse } from "./shared";
import { runReadGuards, logToolCall, logToolResult } from "./shared";

export function createGetPositionsTool(wallet: string) {
  return tool({
    description: "Get all open trading positions for the connected wallet",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runReadGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        if (!wallet) {
          return { status: "error", data: null, error: "No wallet connected", request_id: requestId, latency_ms: 0 };
        }

        logToolCall("get_positions", requestId, wallet);

        const key = cacheKey("positions", wallet);
        const dedupKey = makeDedupKey("get_positions", {}, wallet);

        const { data, status, latency_ms } = await dedup(dedupKey, () =>
          cacheFetchThrough(key, TTL.positions, wallet, () => fetchPositions(wallet)),
        );

        logToolResult("get_positions", requestId, wallet, latency_ms, status);
        return { status, data: data ?? null, request_id: requestId, latency_ms };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logError("tool_result", { tool: "get_positions", request_id: requestId, error: msg });
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
