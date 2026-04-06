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
  };
}
