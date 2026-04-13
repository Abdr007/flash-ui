// ============================================
// Flash AI — Tool Registry
// ============================================
// Assembles all tools for the chat route.
// Route.ts orchestrates — tools contain the logic.

import { createGetPriceTool } from "./getPrice";
import { createGetAllPricesTool } from "./getAllPrices";
import { createGetPositionsTool } from "./getPositions";
import { createGetPortfolioTool } from "./getPortfolio";
import { createGetMarketInfoTool } from "./getMarketInfo";
import { createBuildTradeTool } from "./buildTrade";
import { createClosePositionPreviewTool } from "./closePositionPreview";
import { createAddCollateralTool } from "./addCollateral";
import { createRemoveCollateralTool } from "./removeCollateral";
import { createReversePositionTool } from "./reversePosition";
import { createEarnDepositTool } from "./earnDeposit";
import { createEarnPoolsTool, createEarnPositionsTool, createEarnWithdrawTool } from "./earnPools";
import { createTransferPreviewTool } from "./transferPreview";
import { createTransferHistoryTool } from "./transferHistory";
import { createPlaceTriggerOrderTool } from "./placeTriggerOrder";
import { createGetOrdersTool, createCancelLimitOrderTool, createEditLimitOrderTool } from "./limitOrderTools";
import {
  createFafDashboardTool,
  createFafStakeTool,
  createFafUnstakeTool,
  createFafClaimTool,
  createFafRequestsTool,
  createFafCancelUnstakeTool,
  createFafTierTool,
} from "./fafTools";

export function buildTools(wallet: string) {
  return {
    get_price: createGetPriceTool(wallet),
    get_all_prices: createGetAllPricesTool(wallet),
    get_positions: createGetPositionsTool(wallet),
    get_portfolio: createGetPortfolioTool(wallet),
    get_market_info: createGetMarketInfoTool(wallet),
    build_trade: createBuildTradeTool(wallet),
    close_position_preview: createClosePositionPreviewTool(wallet),
    add_collateral: createAddCollateralTool(wallet),
    remove_collateral: createRemoveCollateralTool(wallet),
    reverse_position_preview: createReversePositionTool(wallet),
    earn_deposit: createEarnDepositTool(wallet),
    earn_pools: createEarnPoolsTool(wallet),
    earn_positions: createEarnPositionsTool(wallet),
    earn_withdraw: createEarnWithdrawTool(wallet),
    transfer_preview: createTransferPreviewTool(wallet),
    transfer_history: createTransferHistoryTool(wallet),
    faf_dashboard: createFafDashboardTool(wallet),
    faf_stake: createFafStakeTool(wallet),
    faf_unstake: createFafUnstakeTool(wallet),
    faf_claim: createFafClaimTool(wallet),
    faf_requests: createFafRequestsTool(wallet),
    faf_cancel_unstake: createFafCancelUnstakeTool(wallet),
    faf_tier: createFafTierTool(wallet),
    place_trigger_order: createPlaceTriggerOrderTool(wallet),
    get_orders: createGetOrdersTool(wallet),
    cancel_limit_order: createCancelLimitOrderTool(wallet),
    edit_limit_order: createEditLimitOrderTool(wallet),
  };
}
