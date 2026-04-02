// ============================================
// Flash UI — Core Type System
// ============================================

export type Side = "LONG" | "SHORT";

export type TradeStatus =
  | "INCOMPLETE"
  | "READY"
  | "CONFIRMING"
  | "EXECUTING"
  | "SIGNING"
  | "SUCCESS"
  | "ERROR";

export interface TradeObject {
  id: string;
  action: Side;
  market: string;
  collateral_usd: number | null;
  leverage: number | null;
  position_size: number | null;
  entry_price: number | null;
  mark_price: number | null;
  liquidation_price: number | null;
  fees: number | null;
  fee_rate: number | null;
  slippage_bps: number | null;
  status: TradeStatus;
  error?: string;
  tx_signature?: string;
  /** Base64-encoded unsigned transaction from Flash API — needs wallet signature */
  unsigned_tx?: string;
  missing_fields: (keyof TradeObject)[];
}

export interface Position {
  pubkey: string;
  market: string;
  side: Side;
  entry_price: number;
  mark_price: number;
  size_usd: number;
  collateral_usd: number;
  leverage: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  liquidation_price: number;
  fees: number;
  timestamp: number;
}

export interface MarketData {
  symbol: string;
  price: number;
  price_change_24h: number;
  open_interest_long: number;
  open_interest_short: number;
  max_leverage: number;
  funding_rate: number;
}

export interface MarketPrice {
  symbol: string;
  price: number;
  confidence: number;
  timestamp: number;
}

export type MessageRole = "user" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  trade_card?: TradeObject;
  collapsed_trade?: {
    market: string;
    side: Side;
    collateral: number;
    leverage: number;
    entry_price: number;
    tx_signature?: string;
  };
}

export interface Portfolio {
  wallet_address: string;
  balance_usdc: number;
  total_collateral: number;
  total_unrealized_pnl: number;
  positions: Position[];
}

// API response types matching flashapi.trade
export interface ApiPriceResponse {
  symbol: string;
  price: number;
  confidence: number;
}

export interface ApiQuoteResponse {
  entryPrice: number;
  liquidationPrice: number;
  fee: number;
  feeRate: number;
  size: number;
  collateral: number;
  leverage: number;
  slippage: number;
}

export interface ApiPositionResponse {
  pubkey: string;
  market: string;
  side: string;
  entryPrice: number;
  markPrice: number;
  sizeUsd: number;
  collateralUsd: number;
  leverage: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  liquidationPrice: number;
  fees: number;
  timestamp: number;
}

// Flash API build-transaction response
export interface ApiBuildTxResponse {
  transaction: string; // base64 encoded
  message: string;
}

// ---- Intent System ----

export type IntentType =
  | "OPEN_POSITION"
  | "CLOSE_POSITION"
  | "REDUCE_POSITION"
  | "MODIFY_TRADE"
  | "SET_SL"
  | "SET_TP"
  | "CANCEL"
  | "QUERY";

export interface ParsedIntent {
  type: IntentType;
  market?: string;
  side?: Side;
  collateral_usd?: number;
  leverage?: number;
  reduce_percent?: number;
  stop_loss_pct?: number;
  take_profit_pct?: number;
  stop_loss_price?: number;
  take_profit_price?: number;
  flip?: boolean;
  raw: string;
}
