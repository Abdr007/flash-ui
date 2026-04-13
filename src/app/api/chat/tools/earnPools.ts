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
        // Fetch both official earn data (APY) AND pool-data (custodies, stables) in parallel
        const [earnRes, poolRes] = await Promise.all([
          fetch("https://api.prod.flash.trade/earn-page/data", { signal: AbortSignal.timeout(8000) }),
          fetch("https://flashapi.trade/pool-data", { signal: AbortSignal.timeout(8000) }).catch(() => null),
        ]);

        if (!earnRes.ok) throw new Error(`Flash API ${earnRes.status}`);
        const earnData = await earnRes.json();
        const poolData = poolRes && poolRes.ok ? await poolRes.json() : null;

        const poolMeta: Record<string, { name: string; poolName: string }> = {
          "FLP.1": { name: "Crypto Pool", poolName: "Crypto.1" },
          "FLP.2": { name: "Gold Pool", poolName: "Virtual.1" },
          "FLP.3": { name: "DeFi Pool", poolName: "Governance.1" },
          "FLP.4": { name: "Community Pool", poolName: "Community.1" },
          "FLP.5": { name: "WIF Pool", poolName: "Community.2" },
          "FLP.6": { name: "Stable Pool", poolName: "Stable.1" },
          "FLP.7": { name: "FART/TRUMP Pool", poolName: "Trump.1" },
          "FLP.8": { name: "Ore Pool", poolName: "Ore.1" },
          "FLP.x": { name: "Equity Pool", poolName: "Equity.1" },
        };

        // Build custody map from pool-data endpoint
        const custodyMap: Record<string, string[]> = {};
        if (poolData?.pools) {
          for (const pool of poolData.pools as Record<string, unknown>[]) {
            const name = String(pool.poolName ?? "");
            const custodies = (pool.custodyStats ?? []) as Record<string, unknown>[];
            custodyMap[name] = custodies
              .map((c) => String(c.tokenSymbol ?? c.symbol ?? "").toUpperCase())
              .filter(Boolean);
          }
        }

        const pools: PoolInfo[] = [];
        for (const p of earnData.pools ?? []) {
          const sym = String(p.flpTokenSymbol ?? "");
          const meta = poolMeta[sym];
          if (!meta) continue;
          const custodies = custodyMap[meta.poolName] ?? [];
          const markets = custodies.length > 0 ? custodies.join(", ") : "—";
          pools.push({
            name: meta.name,
            symbol: sym,
            flpSymbol: sym,
            apy: Math.round((Number(p.flpWeeklyApy) || 0) * 100) / 100,
            tvl: Math.round(Number(p.aum) || 0),
            flpPrice: Math.round((Number(p.flpPrice) || 0) * 10000) / 10000,
            markets,
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
        return {
          status: "error",
          data: null,
          error: "Connect your wallet to view earn positions.",
          request_id: requestId,
          latency_ms: 0,
        };
      }

      // Mainnet FLP compounding mints (from flash-sdk PoolConfig.json)
      const FLP_MINTS: Record<string, string> = {
        "FLP.1": "NUZ3FDWTtN5SP72BsefbsqpnbAY5oe21LE8bCSkqsEK",
        "FLP.2": "AbVzeRUss8QJYzv2WDizDJ2RtsD1jkVyRjNdAzX94JhG",
        "FLP.3": "4PZTRNrHnxWBqLRvX5nuE6m1cNR8RqB4kWvVYjDkMd2H",
        "FLP.4": "EngqvevoQ8yaNdtxY7sSh5J7NF74k3cDKi9v9pHi5H3B",
        "FLP.5": "Ab6K8anKSwAz8VXJPVvAVjPQMJNoVhwzfF7FtAB5PNW9",
        "FLP.7": "2aAQefifU14gxfc2FQHruFrp2UViLF4TYwzvbfyKFiFa",
        "FLP.8": "EViAVW2WXmbQhGwH4rjAvxAVAtXn1W8g2izbHUQ9s2AW",
        "FLP.x": "HokRUTnsr3FgLj9sq2iw3F6XkPoHn62wytcdNuPZowa7",
      };
      const POOL_NAME_BY_FLP: Record<string, string> = {
        "FLP.1": "Crypto",
        "FLP.2": "Gold",
        "FLP.3": "DeFi",
        "FLP.4": "Community",
        "FLP.5": "WIF",
        "FLP.6": "Stable",
        "FLP.7": "FART/TRUMP",
        "FLP.8": "Ore",
        "FLP.x": "Equity",
      };

      try {
        // Fetch pool data for FLP prices
        const poolRes = await fetch("https://api.prod.flash.trade/earn-page/data", {
          signal: AbortSignal.timeout(8000),
        });
        const poolData = poolRes.ok ? await poolRes.json() : { pools: [] };

        // Read FLP balances on-chain via Helius RPC
        const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";
        const balData: Record<string, number> = {};
        try {
          const rpcResp = await fetch(RPC_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getTokenAccountsByOwner",
              params: [
                wallet,
                { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
                { encoding: "jsonParsed" },
              ],
            }),
            signal: AbortSignal.timeout(8000),
          });
          if (rpcResp.ok) {
            const rpcData = await rpcResp.json();
            const accounts = rpcData?.result?.value ?? [];
            for (const acc of accounts) {
              const mint = acc?.account?.data?.parsed?.info?.mint;
              const uiAmount = Number(acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
              if (!mint || uiAmount <= 0) continue;
              for (const [sym, mintAddr] of Object.entries(FLP_MINTS)) {
                if (mintAddr === mint) {
                  balData[sym] = uiAmount;
                  break;
                }
              }
            }
          }
        } catch {}

        const poolMap: Record<string, { name: string; flpPrice: number; apy: number }> = {};
        for (const p of poolData.pools ?? []) {
          const sym = String(p.flpTokenSymbol ?? "");
          poolMap[sym] = {
            name: POOL_NAME_BY_FLP[sym] ?? sym,
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

const POOL_NAMES_W: Record<string, string> = {
  crypto: "Crypto Pool",
  gold: "Gold Pool",
  defi: "DeFi Pool",
  meme: "Community Pool",
  community: "Community Pool",
  wif: "WIF Pool",
  trump: "TRUMP Pool",
  fart: "FART Pool",
  ore: "Ore Pool",
  equity: "Equity Pool",
};

export function createEarnWithdrawTool(wallet: string) {
  return tool({
    description:
      "Preview withdrawing from an earn pool. Shows current balance, withdrawal amount, and value. " +
      "Call when user says 'withdraw from crypto pool', 'withdraw 50% from defi pool'.",
    inputSchema: z
      .object({
        pool: z.string().describe("Pool name"),
        percent: z.number().min(1).max(100).default(100).describe("Percentage to withdraw"),
      })
      .strict(),
    execute: async ({ pool, percent }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();
      const start = Date.now();
      logToolCall("earn_withdraw", requestId, wallet, { pool, percent });

      if (!wallet) {
        return {
          status: "error",
          data: null,
          error: "Connect your wallet to withdraw.",
          request_id: requestId,
          latency_ms: 0,
        };
      }

      const poolLower = (pool ?? "").toLowerCase();
      const flpSymbol = POOL_FLP_MAP[poolLower];
      if (!flpSymbol) {
        return {
          status: "error",
          data: null,
          error: `Unknown pool: ${pool}. Valid: ${Object.keys(POOL_FLP_MAP).join(", ")}`,
          request_id: requestId,
          latency_ms: 0,
        };
      }

      try {
        // Fetch pool data only — FLP balance is checked client-side via on-chain read
        const poolRes = await fetch("https://api.prod.flash.trade/earn-page/data", {
          signal: AbortSignal.timeout(8000),
        });
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
