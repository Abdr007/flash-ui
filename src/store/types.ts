// ============================================
// Flash UI — Store Type Definitions
// ============================================
//
// Extracted from store/index.ts to break circular imports
// between the main store and domain slices.

import type { ChatMessage, MarketPrice, Position, Side, TradeObject } from "@/lib/types";
import type { ParsedIntent } from "@/lib/types";
import type { TradePreviewData, PositionData, PortfolioData, ClosePreviewData } from "@/lib/tool-result-handler";

// ---- Trade Expiry ----
export const TRADE_EXPIRY_MS = 30_000;

// ---- TOCTOU: Max acceptable price drift at execution time ----
export const MAX_EXECUTION_DRIFT_PCT = 3.0;

export function msgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Execution locks (module-level, separate for open vs close) ----
export let tradeLock = false;
export let closeLock = false;

export function setTradeLock(v: boolean) {
  tradeLock = v;
}
export function setCloseLock(v: boolean) {
  closeLock = v;
}

// ---- Monotonic version counter for async race detection ----
let _stateVersion = 0;
export function getStateVersion() {
  return _stateVersion;
}
export function bumpStateVersion() {
  return ++_stateVersion;
}

// ---- Context Memory (multi-turn conversation support) ----
export interface ContextMemory {
  lastIntent: ParsedIntent | null;
  lastTradeDraft: TradePreviewData | null;
  portfolioSnapshot: {
    positions: Position[];
    balance: number;
    totalExposure: number;
    timestamp: number;
  } | null;
  recentMarkets: string[];
}

export interface FlashStore {
  // ---- Existing State (UNTOUCHED) ----
  messages: ChatMessage[];
  isProcessing: boolean;
  activeTrade: TradeObject | null;
  prices: Record<string, MarketPrice>;
  selectedMarket: string;
  positions: Position[];
  walletAddress: string | null;
  walletConnected: boolean;
  streamStatus: "connected" | "reconnecting" | "disconnected";

  // ---- AI Chat State (NEW) ----
  isStreaming: boolean;
  isExecuting: boolean;
  traceId: string;
  currentTrade: TradePreviewData | null;
  lastTradeDraft: TradePreviewData | null;
  tradeCreatedAt: number | null;
  closePreview: ClosePreviewData | null;
  contextMemory: ContextMemory;
  loadingStates: Record<string, boolean>;
  lastError: { tool: string; message: string } | null;

  // ---- Data Freshness (Transparency) ----
  dataStatus: {
    pricesLastOk: number;
    pricesError: string | null;
    positionsLastOk: number;
    positionsError: string | null;
  };
  setDataError: (source: "prices" | "positions", error: string | null) => void;

  // ---- Existing Actions (UNTOUCHED) ----
  sendMessage: (input: string) => Promise<void>;
  setTriggers: (tradeId: string, triggers: { tp?: number | null; sl?: number | null }) => Promise<void>;
  confirmTrade: () => void;
  executeTrade: () => Promise<void>;
  completeExecution: (txSignature: string) => void;
  failExecution: (error: string) => void;
  cancelTrade: () => void;
  closePosition: (market: string, side: Side) => Promise<void>;
  refreshPrices: () => Promise<void>;
  refreshPositions: () => Promise<void>;
  handleStreamPrices: (updates: MarketPrice[]) => void;
  setStreamStatus: (status: "connected" | "reconnecting" | "disconnected") => void;
  setWallet: (address: string | null) => void;
  selectMarket: (symbol: string) => void;
  clearChat: () => void;

  // ---- AI Actions (NEW) ----
  setTradeFromAI: (raw: unknown, wallet: string, positions: Position[]) => boolean;
  modifyTrade: (modification: Partial<TradePreviewData>) => boolean;
  setClosePreview: (data: ClosePreviewData) => void;
  updatePositionsFromAI: (positions: PositionData[]) => void;
  updatePortfolioFromAI: (portfolio: PortfolioData) => void;
  setAIError: (tool: string, error: string) => void;
  setStreaming: (streaming: boolean) => void;
  setTraceId: (id: string) => void;
  updateContextMemory: (update: Partial<ContextMemory>) => void;
  setToolLoading: (tool: string, loading: boolean) => void;
  clearAITrade: () => void;
  getContextForAPI: () => {
    lastIntent: ParsedIntent | null;
    lastTradeDraft: TradePreviewData | null;
    portfolioSnapshot: ContextMemory["portfolioSnapshot"];
    recentMarkets: string[];
    positions: Position[];
  };
}

// ---- Zustand setter/getter types for slices ----
export type StoreSet = (partial: Partial<FlashStore> | ((state: FlashStore) => Partial<FlashStore>)) => void;
export type StoreGet = () => FlashStore;
