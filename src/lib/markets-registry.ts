// ============================================
// Flash UI — Dynamic Markets Registry
// ============================================
// Single source of truth for every tradable market on Flash.
//
// Bootstrap: flash-sdk/dist/PoolConfig.json (static, always available)
// Upgrade:   https://flashapi.trade/pool-data (live maxLeverage + fees + price)
//
// All lookups are SYNCHRONOUS against an in-memory snapshot. The live fetch
// runs in the background and upgrades the snapshot — no async contagion
// through the tool pipeline.
//
// Filters out: stablecoins (USDC) and LSTs (JitoSOL). Devnet pools skipped.

import PoolConfig from "flash-sdk/dist/PoolConfig.json";

export type MarketCategory =
  | "crypto"
  | "equity"
  | "forex"
  | "metals"
  | "commodity";

export interface Market {
  symbol: string;
  pool: string;
  category: MarketCategory;
  isVirtual: boolean;
  pythPriceId: string | null;
  priceUi: number;
  maxLeverage: number;
  maxDegenLeverage: number;
  /**
   * Whether Flash supports degen mode for this market's pool.
   * Only Crypto.1, Virtual.1, and Governance.1 expose a degen tier —
   * Community/Trump/Ore/Equity pools don't.
   */
  degenSupported: boolean;
  openPositionFeeBps: number;
  utilization: number;
  custodyAccount: string;
  decimals: number;
}

// ---- Helpers ----

const SKIP_SYMBOLS = new Set(["USDC", "JitoSOL"]);
const DEVNET_PREFIX = "devnet";

// Per Flash's market-hours doc: metals share the FX session window,
// while crude oil + natgas use the commodity window.
const FOREX_SYMBOLS = new Set(["EUR", "GBP", "USDJPY", "USDCNH"]);
const METALS_SYMBOLS = new Set(["XAU", "XAG", "XAUt"]);
const COMMODITY_SYMBOLS = new Set(["CRUDEOIL", "NATGAS"]);

// ---- Leverage caps ----
//
// Source: flash.trade live UI, captured 2026-04-12. These values come
// directly from the production trading interface, not from on-chain
// ceilings (which are higher) or pool-level docs (which are outdated).
//
// Structure: per-symbol {normal, degen} pair.
//   - normal = cap when degen toggle is OFF
//   - degen  = cap when degen toggle is ON
//   - When normal === degen, the degen flag has no effect on leverage
//     (informational only — flat-cap markets).
//
// Only SOL/BTC/ETH have a tier distinction today: normal 100x, degen 500x.
// FX pairs (EUR/GBP/USDJPY/USDCNH) are flat 500x — "no degen but 500x"
// per the live UI — so their max is always 500x regardless of the flag.
interface SymbolCap {
  normal: number;
  degen: number;
}

const SYMBOL_CAPS: Record<string, SymbolCap> = {
  // ── Crypto.1 ── SOL/BTC/ETH support the degen tier (100x → 500x)
  SOL:      { normal: 100, degen: 500 },
  BTC:      { normal: 100, degen: 500 },
  ETH:      { normal: 100, degen: 500 },
  BNB:      { normal: 50,  degen: 50 },
  ZEC:      { normal: 10,  degen: 10 },

  // ── Virtual.1 — FX ── flat 500x, no degen gating
  EUR:      { normal: 500, degen: 500 },
  GBP:      { normal: 500, degen: 500 },
  USDJPY:   { normal: 500, degen: 500 },
  USDCNH:   { normal: 500, degen: 500 },

  // ── Virtual.1 — Metals ── 100x
  XAU:      { normal: 100, degen: 100 },
  XAG:      { normal: 100, degen: 100 },
  XAUt:     { normal: 100, degen: 100 }, // inferred — same as XAU

  // ── Virtual.1 — Commodities ──
  CRUDEOIL: { normal: 5,   degen: 5 },
  NATGAS:   { normal: 10,  degen: 10 },

  // ── Governance.1 ── Mixed caps per symbol
  JUP:      { normal: 50,  degen: 50 },
  PYTH:     { normal: 50,  degen: 50 },
  RAY:      { normal: 50,  degen: 50 },
  KMNO:     { normal: 50,  degen: 50 },
  JTO:      { normal: 10,  degen: 10 },
  MET:      { normal: 10,  degen: 10 },
  HYPE:     { normal: 20,  degen: 20 },

  // ── Community / Memes / Trump ── 25x
  BONK:     { normal: 25,  degen: 25 },
  PENGU:    { normal: 25,  degen: 25 },
  PUMP:     { normal: 25,  degen: 25 },
  WIF:      { normal: 25,  degen: 25 },
  FARTCOIN: { normal: 25,  degen: 25 },

  // ── Ore.1 ── 5x
  ORE:      { normal: 5,   degen: 5 },

  // ── Equity.1 ── 20x across the board
  SPY:      { normal: 20,  degen: 20 },
  NVDA:     { normal: 20,  degen: 20 },
  TSLA:     { normal: 20,  degen: 20 },
  AAPL:     { normal: 20,  degen: 20 },
  AMD:      { normal: 20,  degen: 20 },
  AMZN:     { normal: 20,  degen: 20 },
  PLTR:     { normal: 20,  degen: 20 }, // inferred — same as other equities
};

// Fallback cap for any symbol that ends up in PoolConfig but is missing
// from SYMBOL_CAPS (e.g. a newly-listed market not yet captured from the
// UI). Conservative default: 25x normal, 25x degen.
const FALLBACK_CAP: SymbolCap = { normal: 25, degen: 25 };

function getSymbolCap(symbol: string): SymbolCap {
  return SYMBOL_CAPS[symbol] ?? FALLBACK_CAP;
}

/**
 * A market "supports degen" when its degen cap is strictly higher than
 * its normal cap — i.e. the degen toggle actually unlocks something.
 * Today this is only SOL/BTC/ETH. FX pairs are 500x flat, not degen.
 */
export function isDegenSupported(symbol: string): boolean {
  const cap = SYMBOL_CAPS[symbol.toUpperCase()] ?? SYMBOL_CAPS[symbol];
  return cap != null && cap.degen > cap.normal;
}

function classify(pool: string, symbol: string): MarketCategory {
  if (pool === "Equity.1") return "equity";
  if (pool === "Virtual.1") {
    if (FOREX_SYMBOLS.has(symbol)) return "forex";
    if (METALS_SYMBOLS.has(symbol)) return "metals";
    if (COMMODITY_SYMBOLS.has(symbol)) return "commodity";
    return "commodity"; // default Virtual.1 fallback
  }
  return "crypto";
}

// Flash SDK scales rates by 10^RATE_DECIMALS (RATE_DECIMALS=9), so
// openPositionFeeRate = rawRatio * 1e9. To convert raw → bps:
//   ratio = raw / 1e9
//   bps   = ratio * 1e4
//   => bps = raw / 1e5
// Example: raw 510_000 → 5.1 bps (0.051%). raw 1_000_000 → 10 bps.
function parseFeeRateToBps(raw: unknown): number {
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8; // 8 bps default
  return n / 100_000;
}

function parseFloatSafe(raw: unknown, fallback: number): number {
  const n = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---- Bootstrap from PoolConfig.json ----

interface CustodyStatic {
  symbol: string;
  isStable?: boolean;
  isVirtual?: boolean;
  pythPriceId?: string;
  custodyAccount?: string;
  decimals?: number;
}

interface PoolStatic {
  poolName: string;
  custodies?: CustodyStatic[];
}

function bootstrap(): Map<string, Market> {
  const map = new Map<string, Market>();
  const pools = (PoolConfig as { pools: PoolStatic[] }).pools || [];

  for (const pool of pools) {
    const poolName = pool.poolName || "";
    if (poolName.startsWith(DEVNET_PREFIX)) continue;

    for (const c of pool.custodies || []) {
      const symbol = c.symbol;
      if (!symbol || SKIP_SYMBOLS.has(symbol)) continue;

      // Dedupe: first pool wins (mainnet pools appear before devnet, and
      // no mainnet symbol lives in two pools today).
      if (map.has(symbol)) continue;

      const cap = getSymbolCap(symbol);
      map.set(symbol, {
        symbol,
        pool: poolName,
        category: classify(poolName, symbol),
        isVirtual: !!c.isVirtual,
        pythPriceId: c.pythPriceId || null,
        priceUi: 0,
        maxLeverage: cap.normal,
        maxDegenLeverage: cap.degen,
        degenSupported: cap.degen > cap.normal,
        openPositionFeeBps: 8,
        utilization: 0,
        custodyAccount: c.custodyAccount || "",
        decimals: c.decimals ?? 6,
      });
    }
  }

  return map;
}

let snapshot: Map<string, Market> = bootstrap();
let lastFetchMs = 0;
let inflight: Promise<void> | null = null;

const LIVE_TTL_MS = 60_000;
const FLASH_API_URL =
  process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade";

// ---- Live upgrade from /pool-data ----

interface LiveCustody {
  symbol?: string;
  priceUi?: string;
  openPositionFeeRate?: string;
  utilizationUi?: string;
}
interface LivePool {
  poolName?: string;
  custodyStats?: LiveCustody[];
}
interface LivePoolData {
  pools?: LivePool[];
}

async function refreshLive(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(`${FLASH_API_URL}/pool-data`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`pool-data ${res.status}`);
    const data = (await res.json()) as LivePoolData;
    if (!data?.pools || !Array.isArray(data.pools)) return;

    const next = new Map(snapshot);

    for (const pool of data.pools) {
      const poolName = pool.poolName || "";
      if (poolName.startsWith(DEVNET_PREFIX)) continue;
      for (const c of pool.custodyStats || []) {
        const symbol = c.symbol;
        if (!symbol || SKIP_SYMBOLS.has(symbol)) continue;
        const existing = next.get(symbol);
        if (!existing) continue; // unknown symbol in live data — skip

        // Leverage caps come from the SYMBOL_CAPS table (captured from the
        // live flash.trade UI), NOT from live /pool-data. On-chain ceilings
        // are much higher than what the UI offers (e.g. Crypto.1=1000x live,
        // SOL UI cap 500x) and shouldn't override our UX-aligned caps.
        // Live data only upgrades: price, fee rate, utilization.
        next.set(symbol, {
          ...existing,
          priceUi: parseFloatSafe(c.priceUi, existing.priceUi),
          openPositionFeeBps: parseFeeRateToBps(c.openPositionFeeRate),
          utilization: parseFloatSafe(c.utilizationUi, 0) / 100,
        });
      }
    }

    snapshot = next;
    lastFetchMs = Date.now();
  } catch {
    // swallow — keep existing snapshot
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kick off a background refresh if the snapshot is stale. Does NOT block.
 * Call this at the top of request handlers so the next request benefits.
 */
export function refreshIfStale(): void {
  const age = Date.now() - lastFetchMs;
  if (age < LIVE_TTL_MS || inflight) return;
  inflight = refreshLive().finally(() => {
    inflight = null;
  });
}

/**
 * Await a refresh if the snapshot has never been populated from live data.
 * Used by first-request entry points where the caller wants live numbers.
 */
export async function ensureLoaded(): Promise<void> {
  if (lastFetchMs > 0) {
    refreshIfStale();
    return;
  }
  if (!inflight) {
    inflight = refreshLive().finally(() => {
      inflight = null;
    });
  }
  try {
    await inflight;
  } catch {
    /* bootstrap snapshot stands */
  }
}

// ---- Public lookups (all sync) ----

export function listMarkets(): Market[] {
  return Array.from(snapshot.values());
}

export function getMarket(symbol: string): Market | null {
  return snapshot.get(symbol.toUpperCase()) || snapshot.get(symbol) || null;
}

export function hasMarket(symbol: string): boolean {
  return getMarket(symbol) !== null;
}

export function getMaxLeverage(
  symbol: string,
  _mode?: "normal" | "degen",
): number {
  const m = getMarket(symbol);
  if (!m) return 0;
  // Always return the highest available leverage for the market.
  // Users can type any leverage up to the max (e.g. 500x on SOL)
  // without needing to enable degen mode.
  return m.maxDegenLeverage;
}

export function getPythPriceId(symbol: string): string | null {
  return getMarket(symbol)?.pythPriceId || null;
}

/**
 * Resolve a user input (symbol or alias) to a canonical market symbol.
 * Import MARKET_ALIASES separately for natural-language aliases.
 */
export function resolveSymbol(input: string): string | null {
  if (!input) return null;
  const upper = input.toUpperCase().trim();
  if (snapshot.has(upper)) return upper;
  // Exact-case match for mixed-case symbols like "XAUt"
  if (snapshot.has(input.trim())) return input.trim();
  return null;
}
