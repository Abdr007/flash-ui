// ============================================
// Flash UI — Pyth Feed ID Registry
// ============================================
// Auto-sourced from flash-sdk/dist/PoolConfig.json — the authoritative list
// of every tradable perp on Flash. Every custody with a pythPriceId gets a
// feed entry, which means the Hermes SSE stream picks up every market
// (MET, EUR, HYPE, AAPL, etc.) without hand-maintenance.
//
// Stablecoins and LSTs are excluded because they aren't tradable perps.

import PoolConfig from "flash-sdk/dist/PoolConfig.json";

const SKIP_SYMBOLS = new Set(["USDC", "JitoSOL"]);
const DEVNET_PREFIX = "devnet";

interface CustodyStatic {
  symbol?: string;
  pythPriceId?: string;
}
interface PoolStatic {
  poolName?: string;
  custodies?: CustodyStatic[];
}

function buildFeeds(): Record<string, string> {
  const out: Record<string, string> = {};
  const pools =
    (PoolConfig as { pools?: PoolStatic[] }).pools || [];
  for (const pool of pools) {
    const poolName = pool.poolName || "";
    if (poolName.startsWith(DEVNET_PREFIX)) continue;
    for (const c of pool.custodies || []) {
      const symbol = c.symbol;
      const feed = c.pythPriceId;
      if (!symbol || !feed || SKIP_SYMBOLS.has(symbol)) continue;
      if (out[symbol]) continue; // first pool wins
      out[symbol] = feed;
    }
  }
  return out;
}

export const PYTH_FEED_IDS: Record<string, string> = buildFeeds();

// Reverse map: feed ID → symbol (for SSE parsing)
export const FEED_TO_SYMBOL: Record<string, string> = {};
for (const [symbol, feedId] of Object.entries(PYTH_FEED_IDS)) {
  // Store without 0x prefix for matching against SSE data
  FEED_TO_SYMBOL[feedId.replace("0x", "")] = symbol;
}

export const HERMES_SSE_URL = "https://hermes.pyth.network/v2/updates/price/stream";
