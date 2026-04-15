// ============================================
// Flash AI — Tool: earn_deposit
// ============================================
// Returns a deposit preview card. Execution happens client-side
// via Flash SDK (same pattern as trade cards).

import { tool } from "ai";
import { z } from "zod";
import type { ToolResponse } from "./shared";
import { logToolCall, logToolResult } from "./shared";
import { makeRequestId } from "@/lib/tool-dedup";
import { resolvePoolAlias } from "./earnPools";

const VALID_POOLS = ["crypto", "defi", "gold", "meme", "community", "wif", "fart", "trump", "ore", "equity"];

const POOL_DISPLAY: Record<string, string> = {
  crypto: "Crypto Pool",
  defi: "DeFi Pool",
  gold: "Gold Pool",
  meme: "Community Pool",
  community: "Community Pool",
  wif: "WIF Pool",
  fart: "FART Pool",
  trump: "TRUMP Pool",
  ore: "Ore Pool",
  equity: "Equity Pool",
};

export function createEarnDepositTool(wallet: string) {
  return tool({
    description:
      "Build a deposit preview for an earn/liquidity pool. " +
      "User deposits USDC and receives FLP tokens. " +
      "Supported pools: crypto, defi, gold, meme, wif, fart, ore, equity. " +
      "Example: 'deposit 100 usdc into crypto pool'",
    inputSchema: z
      .object({
        pool: z.string().describe("Pool name (crypto, defi, gold, meme, wif, fart, ore, equity)"),
        amount_usdc: z.number().positive().describe("Amount in USDC to deposit"),
      })
      .strict(),
    execute: async ({ pool, amount_usdc }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const poolLower = resolvePoolAlias(pool) ?? pool.toLowerCase();
        if (!VALID_POOLS.includes(poolLower)) {
          return {
            status: "error",
            data: null,
            error: `Unknown pool: ${pool}. Valid: ${VALID_POOLS.join(", ")} (or FLP.1, FLP.2, etc.)`,
            request_id: requestId,
            latency_ms: 0,
          };
        }

        if (amount_usdc < 1) {
          return { status: "error", data: null, error: "Minimum deposit is $1", request_id: requestId, latency_ms: 0 };
        }

        logToolCall("earn_deposit", requestId, wallet, { pool: poolLower, amount_usdc });

        // Fetch pool data for preview
        let flpPrice = 0;
        let apy = 0;
        try {
          const res = await fetch("https://api.prod.flash.trade/earn-page/data", {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json();
            const poolMap: Record<string, string> = {
              crypto: "FLP.1",
              gold: "FLP.2",
              defi: "FLP.3",
              meme: "FLP.4",
              community: "FLP.4",
              wif: "FLP.5",
              trump: "FLP.7",
              fart: "FLP.7",
              ore: "FLP.8",
              equity: "FLP.x",
            };
            const sym = poolMap[poolLower];
            const poolData = (data.pools ?? []).find((p: Record<string, unknown>) => p.flpTokenSymbol === sym);
            if (poolData) {
              flpPrice = Number(poolData.flpPrice) || 0;
              apy = Number(poolData.flpWeeklyApy) || 0;
            }
          }
        } catch (err) {
          console.warn("[earnDeposit] Flash API fetch failed:", err instanceof Error ? err.message : "unknown");
        }

        const expectedShares = flpPrice > 0 ? amount_usdc / flpPrice : 0;

        const preview = {
          action: "earn_deposit",
          pool: poolLower,
          pool_name: POOL_DISPLAY[poolLower] ?? pool,
          amount_usdc,
          flp_price: flpPrice,
          expected_shares: Math.round(expectedShares * 10000) / 10000,
          apy: Math.round(apy * 10) / 10,
        };

        logToolResult("earn_deposit", requestId, wallet, 0, "success", { pool: poolLower });

        return { status: "success", data: preview, request_id: requestId, latency_ms: 0 };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Earn deposit failed";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
