// ============================================
// Flash UI — Data Slice
// ============================================
//
// Owns: prices, positions, wallet, market selection, stream status,
// data freshness tracking, and the high-frequency SSE price handler.

import type { MarketPrice } from "@/lib/types";
import { getAllPrices, getPositions } from "@/lib/api";
import { computePositionPnl } from "@/lib/pnl";
import type { FlashStore, StoreSet, StoreGet } from "./types";

// ---- The subset of FlashStore that this slice provides ----
export type DataSlice = Pick<
  FlashStore,
  | "prices"
  | "selectedMarket"
  | "positions"
  | "walletAddress"
  | "walletConnected"
  | "walletError"
  | "streamStatus"
  | "dataStatus"
  | "setDataError"
  | "setWalletError"
  | "refreshPrices"
  | "refreshPositions"
  | "handleStreamPrices"
  | "setStreamStatus"
  | "setWallet"
  | "selectMarket"
>;

export function createDataSlice(set: StoreSet, get: StoreGet): DataSlice {
  return {
    // ---- State ----
    prices: {},
    selectedMarket: "SOL",
    positions: [],
    walletAddress: null,
    walletConnected: false,
    walletError: null,
    streamStatus: "disconnected" as const,

    dataStatus: {
      pricesLastOk: 0,
      pricesError: null,
      positionsLastOk: 0,
      positionsError: null,
    },

    setWalletError: (message: string | null) => {
      set({ walletError: message });
    },

    // ---- Actions ----

    setDataError: (source: "prices" | "positions", error: string | null) => {
      const ds = { ...get().dataStatus };
      if (source === "prices") {
        ds.pricesError = error;
        if (!error) ds.pricesLastOk = Date.now();
      } else {
        ds.positionsError = error;
        if (!error) ds.positionsLastOk = Date.now();
      }
      set({ dataStatus: ds });
    },

    // ---- Refresh Prices (diff detection) ----
    refreshPrices: async () => {
      try {
        const freshPrices = await getAllPrices();
        const current = get().prices;
        let changed = false;
        const next: Record<string, MarketPrice> = { ...current };

        for (const p of freshPrices) {
          // Validate price before accepting
          if (!Number.isFinite(p.price) || p.price <= 0) continue;

          const existing = current[p.symbol];
          if (!existing || existing.price !== p.price || existing.timestamp !== p.timestamp) {
            next[p.symbol] = p;
            changed = true;
          }
        }

        if (changed) {
          set({ prices: next });
        }
        get().setDataError("prices", null); // clear error on success
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Price fetch failed";
        try {
          console.warn("[refreshPrices] failed:", msg);
        } catch {}
        get().setDataError("prices", msg);
        // Keep stale data — don't wipe
      }
    },

    // ---- Refresh Positions ----
    refreshPositions: async () => {
      const wallet = get().walletAddress;
      if (!wallet) return;
      try {
        const positions = await getPositions(wallet);
        // Enrich mark prices from live price feed
        const prices = get().prices;
        const enriched = positions.map((pos) => {
          const livePrice = prices[pos.market];
          if (livePrice && Number.isFinite(livePrice.price) && livePrice.price > 0) {
            return { ...pos, mark_price: livePrice.price };
          }
          return pos;
        });
        set({ positions: enriched });
        get().setDataError("positions", null); // clear error on success
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Position fetch failed";
        try {
          console.warn("[refreshPositions] failed:", msg);
        } catch {}
        get().setDataError("positions", msg);
        // Keep stale data — don't wipe
      }
    },

    // ---- Stream Price Handler (called by PriceStream on each SSE tick) ----
    // Single-pass: filter → update prices → selective PnL recompute → one batched set()
    handleStreamPrices: (updates: MarketPrice[]) => {
      const current = get().prices;
      let pricesChanged = false;
      const next: Record<string, MarketPrice> = { ...current };

      // Track which markets actually changed (for selective PnL)
      const changedMarkets = new Set<string>();

      for (const p of updates) {
        if (!Number.isFinite(p.price) || p.price <= 0) continue;

        const existing = current[p.symbol];
        // Timestamp guard: older data NEVER overrides newer
        if (existing && existing.timestamp >= p.timestamp) continue;

        next[p.symbol] = p;
        pricesChanged = true;
        changedMarkets.add(p.symbol);
      }

      if (!pricesChanged) return;

      // Selective PnL: only recompute positions whose market price changed
      const positions = get().positions;
      let positionsUpdated = false;
      let updatedPositions = positions;

      if (positions.length > 0 && changedMarkets.size > 0) {
        updatedPositions = positions.map((pos) => {
          if (!changedMarkets.has(pos.market)) return pos; // Market didn't change — skip
          const livePrice = next[pos.market];
          if (!livePrice || pos.mark_price === livePrice.price) return pos;
          positionsUpdated = true;
          return computePositionPnl(pos, livePrice.price);
        });
      }

      // Single batched store update — one set(), one re-render
      const patch: Partial<FlashStore> = { prices: next };
      if (positionsUpdated) patch.positions = updatedPositions;

      set(patch);
      if (get().dataStatus.pricesError) get().setDataError("prices", null);
    },

    setStreamStatus: (status: "connected" | "reconnecting" | "disconnected") => {
      set({ streamStatus: status });
    },

    // ---- Wallet ----
    // NOTE: refreshPositions is intentionally fired here without await — we
    // want the UI to update immediately on connect; the positions hydrate
    // asynchronously. WalletSync (in WalletProvider) is the single source of
    // truth for invoking this action; only one listener exists, so no race.
    setWallet: (address: string | null) => {
      set({
        walletAddress: address,
        walletConnected: !!address,
      });
      if (address) {
        // Successful connect — clear any prior wallet error.
        if (get().walletError) set({ walletError: null });
        get().refreshPositions();
      } else {
        set({ positions: [] });
      }
    },

    selectMarket: (symbol: string) => {
      set({ selectedMarket: symbol });
    },
  };
}
