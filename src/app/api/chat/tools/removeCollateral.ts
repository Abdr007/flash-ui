// ============================================
// Flash AI — Tool: remove_collateral
// ============================================
// Removes collateral from an existing position, increasing leverage.
// Validates that resulting leverage doesn't exceed max.

import { tool } from "ai";
import { z } from "zod";
import { fetchPositions, fetchPrice } from "../flash-api";
import { makeRequestId } from "@/lib/tool-dedup";
import { withLatency, logError } from "@/lib/logger";
import { MAX_LEVERAGE, MIN_COLLATERAL } from "@/lib/constants";
import { getMaxLeverage } from "@/lib/markets-registry";
import type { ToolResponse } from "./shared";
import { runTradeGuards, resolveMarket, logToolCall, logToolResult } from "./shared";

// Fetch accurate preview from Flash API transaction-builder
async function fetchCollateralPreview(
  positionKey: string, amount: string, market: string, owner: string, action: "add" | "remove"
): Promise<{ newCollateralUsd: string; newLeverage: string; newLiquidationPrice: string } | null> {
  try {
    const url = `${process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade"}/transaction-builder/${action}-collateral`;
    const body = action === "remove"
      ? { positionKey, withdrawAmountUsdUi: amount, withdrawTokenSymbol: market, owner }
      : { positionKey, depositAmountUi: amount, depositTokenSymbol: market, owner };
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.err) return null;
    return data;
  } catch {
    return null;
  }
}

export function createRemoveCollateralTool(wallet: string) {
  return tool({
    description:
      "Remove collateral (USD) from an existing open position to increase leverage. Use when user says 'remove collateral', 'remove $X from my position', 'increase leverage on', etc.",
    inputSchema: z.object({
      market: z.string().describe("Market symbol (e.g., SOL, BTC, ETH)"),
      side: z.enum(["LONG", "SHORT"]).describe("Position side"),
      amount_usd: z.number().min(1).describe("Amount of collateral to remove in USD"),
    }).strict(),
    execute: async ({
      market,
      side,
      amount_usd,
    }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runTradeGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        if (!wallet) {
          return { status: "error", data: null, error: "No wallet connected", request_id: requestId, latency_ms: 0 };
        }

        const resolved = resolveMarket(market);
        if (!resolved) {
          return { status: "error", data: null, error: `Unknown market: ${market}`, request_id: requestId, latency_ms: 0 };
        }

        logToolCall("remove_collateral", requestId, wallet, { market: resolved, side, amount_usd });

        const { result, latency_ms } = await withLatency(async () => {
          const [positions, priceData] = await Promise.all([
            fetchPositions(wallet),
            fetchPrice(resolved),
          ]);
          return { positions, priceData };
        });

        const position = result.positions.find(
          (p) => p.market === resolved && p.side === side,
        );

        if (!position) {
          return {
            status: "error",
            data: null,
            error: `No ${side} ${resolved} position found`,
            request_id: requestId,
            latency_ms,
          };
        }

        const currentCollateral = position.collateral_usd;

        // Validate removal
        if (amount_usd >= currentCollateral) {
          return {
            status: "error",
            data: null,
            error: `Cannot remove $${amount_usd} — position only has $${currentCollateral.toFixed(2)} collateral`,
            request_id: requestId,
            latency_ms,
          };
        }

        // Flash Trade website always withdraws as USDC regardless of position collateral
        // The Flash program handles the internal swap (JitoSOL→USDC etc.)
        const collateralToken = "USDC";

        // Use Flash API for accurate preview (includes fees, funding, PnL)
        const apiPreview = await fetchCollateralPreview(
          position.pubkey, String(amount_usd), collateralToken, wallet, "remove"
        );

        const newCollateral = apiPreview
          ? parseFloat(apiPreview.newCollateralUsd)
          : currentCollateral - amount_usd;
        const newLeverage = apiPreview
          ? parseFloat(apiPreview.newLeverage)
          : position.size_usd / (currentCollateral - amount_usd);
        const newLiqPrice = apiPreview
          ? parseFloat(apiPreview.newLiquidationPrice)
          : (side === "LONG"
            ? position.entry_price * (1 - 1 / newLeverage)
            : position.entry_price * (1 + 1 / newLeverage));

        if (newCollateral < MIN_COLLATERAL) {
          return {
            status: "error",
            data: null,
            error: `Remaining collateral ($${newCollateral.toFixed(2)}) would be below minimum ($${MIN_COLLATERAL})`,
            request_id: requestId,
            latency_ms,
          };
        }

        const marketMaxLev = getMaxLeverage(resolved, "normal") || MAX_LEVERAGE;
        if (newLeverage > marketMaxLev) {
          return {
            status: "error",
            data: null,
            error: `Resulting leverage (${newLeverage.toFixed(1)}x) exceeds ${resolved} max (${marketMaxLev}x)`,
            request_id: requestId,
            latency_ms,
          };
        }

        const markPrice = result.priceData?.price ?? position.mark_price;
        const currentLiqDistance = position.entry_price > 0
          ? (side === "LONG"
            ? ((markPrice - position.liquidation_price) / markPrice) * 100
            : ((position.liquidation_price - markPrice) / markPrice) * 100)
          : 0;
        const newLiqDistance = markPrice > 0
          ? (side === "LONG"
            ? ((markPrice - newLiqPrice) / markPrice) * 100
            : ((newLiqPrice - markPrice) / markPrice) * 100)
          : 0;

        const warnings: string[] = [];
        if (newLeverage >= 20) warnings.push(`High leverage: ${newLeverage.toFixed(1)}x`);
        if (newLiqDistance < 10) warnings.push(`Liquidation only ${newLiqDistance.toFixed(1)}% away`);

        logToolResult("remove_collateral", requestId, wallet, latency_ms, "success");

        return {
          status: "success",
          data: {
            action: "remove_collateral",
            market: resolved,
            side,
            amount_usd,
            current_collateral: currentCollateral,
            new_collateral: Math.round(newCollateral * 100) / 100,
            current_leverage: position.leverage,
            new_leverage: Math.round(newLeverage * 100) / 100,
            current_liq_price: position.liquidation_price,
            new_liq_price: Math.round(newLiqPrice * 100) / 100,
            current_liq_distance_pct: Math.round(currentLiqDistance * 10) / 10,
            new_liq_distance_pct: Math.round(newLiqDistance * 10) / 10,
            mark_price: markPrice,
            size_usd: position.size_usd,
            pubkey: position.pubkey,
            collateral_token: collateralToken,
          },
          request_id: requestId,
          latency_ms,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logError("tool_result", { tool: "remove_collateral", request_id: requestId, error: msg });
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
