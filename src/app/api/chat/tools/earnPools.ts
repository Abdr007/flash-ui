// ============================================
// Flash AI — Tool: earn_pools (live pool data)
// ============================================
// Fetches REAL pool data from Flash Trade API.
// Shows APY, TVL, FLP price for all pools.

import { tool } from "ai";
import { z } from "zod";
import type { ToolResponse } from "./shared";
import { logToolCall, logToolResult } from "./shared";
import { makeRequestId } from "@/lib/tool-dedup";

interface PoolInfo {
  name: string;
  symbol: string;
  flpSymbol: string;
  apy: number;
  tvl: number;
  flpPrice: number;
  markets: string;
}

export function createEarnPoolsTool(wallet: string) {
  return tool({
    description:
      "Show all available earn pools with live APY, TVL, and FLP prices. " +
      "Call when user says 'show earn pools', 'what pools are available', 'earn pools'.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();
      const start = Date.now();
      logToolCall("earn_pools", requestId, wallet);

      try {
        const res = await fetch("https://api.prod.flash.trade/earn-page/data", {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`Flash API ${res.status}`);
        const data = await res.json();

        const poolMeta: Record<string, { name: string; markets: string }> = {
          "FLP.1": { name: "Crypto Pool", markets: "SOL, BTC, ETH, BNB" },
          "FLP.3": { name: "DeFi Pool", markets: "JUP, PYTH, JTO, RAY" },
          "FLP.2": { name: "Gold Pool", markets: "XAU" },
          "FLP.4": { name: "Meme Pool", markets: "BONK, PENGU" },
          "FLP.5": { name: "WIF Pool", markets: "WIF" },
          "FLP.7": { name: "FART Pool", markets: "FARTCOIN" },
          "FLP.8": { name: "Ore Pool", markets: "ORE" },
        };

        const pools: PoolInfo[] = [];
        for (const p of data.pools ?? []) {
          const sym = String(p.flpTokenSymbol ?? "");
          const meta = poolMeta[sym];
          if (!meta) continue;
          pools.push({
            name: meta.name,
            symbol: sym,
            flpSymbol: sym,
            apy: Math.round((Number(p.flpWeeklyApy) || 0) * 10) / 10,
            tvl: Math.round(Number(p.poolTvl) || 0),
            flpPrice: Math.round((Number(p.flpPrice) || 0) * 10000) / 10000,
            markets: meta.markets,
          });
        }

        // Sort by TVL descending
        pools.sort((a, b) => b.tvl - a.tvl);

        logToolResult("earn_pools", requestId, wallet, Date.now() - start, "success");
        return {
          status: "success",
          data: { type: "earn_pools", pools },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch pool data";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ============================================
// Tool: earn_positions (user's deposits)
// ============================================

export function createEarnPositionsTool(wallet: string) {
  return tool({
    description:
      "Show user's earn positions — deposited amounts, current value, earnings. " +
      "Call when user says 'my earn positions', 'show my deposits'.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();
      const start = Date.now();
      logToolCall("earn_positions", requestId, wallet);

      if (!wallet) {
        return { status: "error", data: null, error: "Connect your wallet to view earn positions.", request_id: requestId, latency_ms: 0 };
      }

      try {
        // Fetch pool data for FLP prices
        const [poolRes, balRes] = await Promise.all([
          fetch("https://api.prod.flash.trade/earn-page/data", { signal: AbortSignal.timeout(8000) }),
          fetch(`https://api.prod.flash.trade/flp-balances/${wallet}`, { signal: AbortSignal.timeout(8000) }),
        ]);

        const poolData = poolRes.ok ? await poolRes.json() : { pools: [] };
        const balData = balRes.ok ? await balRes.json() : {};

        const poolMap: Record<string, { name: string; flpPrice: number; apy: number }> = {};
        for (const p of poolData.pools ?? []) {
          const sym = String(p.flpTokenSymbol ?? "");
          poolMap[sym] = {
            name: sym === "FLP.1" ? "Crypto" : sym === "FLP.3" ? "DeFi" : sym === "FLP.2" ? "Gold"
              : sym === "FLP.4" ? "Meme" : sym === "FLP.5" ? "WIF" : sym === "FLP.7" ? "FART"
              : sym === "FLP.8" ? "Ore" : sym,
            flpPrice: Number(p.flpPrice) || 0,
            apy: Number(p.flpWeeklyApy) || 0,
          };
        }

        const positions: { pool: string; shares: number; valueUsd: number; apy: number }[] = [];
        let totalValue = 0;

        for (const [sym, balance] of Object.entries(balData)) {
          const shares = Number(balance) || 0;
          if (shares <= 0) continue;
          const pool = poolMap[sym];
          if (!pool) continue;
          const valueUsd = shares * pool.flpPrice;
          totalValue += valueUsd;
          positions.push({
            pool: pool.name,
            shares: Math.round(shares * 10000) / 10000,
            valueUsd: Math.round(valueUsd * 100) / 100,
            apy: Math.round(pool.apy * 10) / 10,
          });
        }

        positions.sort((a, b) => b.valueUsd - a.valueUsd);

        logToolResult("earn_positions", requestId, wallet, Date.now() - start, "success");
        return {
          status: "success",
          data: {
            type: "earn_positions",
            positions,
            totalValueUsd: Math.round(totalValue * 100) / 100,
            positionCount: positions.length,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch earn positions";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}
