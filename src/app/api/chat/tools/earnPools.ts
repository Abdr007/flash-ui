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
            tvl: Math.round(Number(p.aum) || 0),
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
        const poolRes = await fetch("https://api.prod.flash.trade/earn-page/data", { signal: AbortSignal.timeout(8000) });
        const poolData = poolRes.ok ? await poolRes.json() : { pools: [] };

        // Try to fetch user's compounding positions from Flash API
        let balData: Record<string, unknown> = {};
        try {
          const balRes = await fetch(`https://api.prod.flash.trade/compounding-positions/${wallet}`, { signal: AbortSignal.timeout(5000) });
          if (balRes.ok) balData = await balRes.json();
        } catch {}
        // Fallback: try token balances endpoint
        if (Object.keys(balData).length === 0) {
          try {
            const balRes2 = await fetch(`https://api.prod.flash.trade/user-flp-balances/${wallet}`, { signal: AbortSignal.timeout(5000) });
            if (balRes2.ok) balData = await balRes2.json();
          } catch {}
        }

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

// ============================================
// Tool: earn_withdraw (withdraw preview)
// ============================================

const POOL_FLP_MAP: Record<string, string> = {
  crypto: "FLP.1", defi: "FLP.3", gold: "FLP.2", meme: "FLP.4",
  wif: "FLP.5", fart: "FLP.7", ore: "FLP.8",
};

const POOL_NAMES_W: Record<string, string> = {
  crypto: "Crypto Pool", defi: "DeFi Pool", gold: "Gold Pool",
  meme: "Meme Pool", wif: "WIF Pool", fart: "FART Pool", ore: "Ore Pool",
};

export function createEarnWithdrawTool(wallet: string) {
  return tool({
    description:
      "Preview withdrawing from an earn pool. Shows current balance, withdrawal amount, and value. " +
      "Call when user says 'withdraw from crypto pool', 'withdraw 50% from defi pool'.",
    inputSchema: z.object({
      pool: z.string().describe("Pool name"),
      percent: z.number().min(1).max(100).default(100).describe("Percentage to withdraw"),
    }),
    execute: async ({ pool, percent }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();
      const start = Date.now();
      logToolCall("earn_withdraw", requestId, wallet, { pool, percent });

      if (!wallet) {
        return { status: "error", data: null, error: "Connect your wallet to withdraw.", request_id: requestId, latency_ms: 0 };
      }

      const poolLower = (pool ?? "").toLowerCase();
      const flpSymbol = POOL_FLP_MAP[poolLower];
      if (!flpSymbol) {
        return { status: "error", data: null, error: `Unknown pool: ${pool}. Valid: ${Object.keys(POOL_FLP_MAP).join(", ")}`, request_id: requestId, latency_ms: 0 };
      }

      try {
        // Fetch pool data only — FLP balance is checked client-side via on-chain read
        const poolRes = await fetch("https://api.prod.flash.trade/earn-page/data", { signal: AbortSignal.timeout(8000) });
        const poolData = poolRes.ok ? await poolRes.json() : { pools: [] };

        const poolInfo = (poolData.pools ?? []).find((p: Record<string, unknown>) => p.flpTokenSymbol === flpSymbol);
        const flpPrice = Number(poolInfo?.flpPrice) || 0;
        const apy = Number(poolInfo?.flpWeeklyApy) || 0;

        logToolResult("earn_withdraw", requestId, wallet, Date.now() - start, "success");
        return {
          status: "success",
          data: {
            type: "earn_withdraw_preview",
            action: "earn_withdraw",
            pool: poolLower,
            pool_name: POOL_NAMES_W[poolLower] ?? pool,
            percent,
            flp_price: Math.round(flpPrice * 10000) / 10000,
            apy: Math.round(apy * 10) / 10,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Withdraw preview failed";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}
