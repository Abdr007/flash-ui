// ============================================
// Flash UI — Central State Store (Slice-Composed)
// ============================================
//
// Thin composer — domain logic lives in:
//   data-slice.ts   — prices, positions, wallet, stream
//   trade-slice.ts  — trade lifecycle, execution, confirmation
//   chat-slice.ts   — messages, AI integration, context memory
//
// Safety guarantees (unchanged):
// - Execution lock: prevents double-click / duplicate tx (separate locks for open/close)
// - Input guard: blocks new commands during trade execution
// - Validation gate: collateral/leverage/price checked before execution
// - Cancel safety: cannot cancel during EXECUTING state
// - State transitions: strictly READY → CONFIRMING → EXECUTING → SUCCESS/ERROR
// - Race-safe: snapshots state before async gaps, validates after
// - No non-null assertions on trade fields

import { create } from "zustand";
import type { FlashStore } from "./types";
import { createDataSlice } from "./data-slice";
import { createTradeSlice } from "./trade-slice";
import { createChatSlice } from "./chat-slice";

// Re-export types for consumers
export type { FlashStore, ContextMemory } from "./types";

export const useFlashStore = create<FlashStore>((set, get) => ({
  ...createDataSlice(set, get),
  ...createTradeSlice(set, get),
  ...createChatSlice(set, get),
}));
