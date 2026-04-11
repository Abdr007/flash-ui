// ============================================
// Flash UI — Constants
// ============================================

export const FLASH_API_URL =
  process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade";

// Token metadata — logos, full names, colors
// Logos use CoinGecko CDN (reliable, public, no auth needed)
export const TOKEN_META: Record<string, { name: string; logo: string; color: string }> = {
  SOL:      { name: "Solana",            logo: "https://assets.coingecko.com/coins/images/4128/standard/solana.png",          color: "#9945FF" },
  BTC:      { name: "Bitcoin",           logo: "https://assets.coingecko.com/coins/images/1/standard/bitcoin.png",            color: "#F7931A" },
  WBTC:     { name: "Wrapped BTC",       logo: "https://assets.coingecko.com/coins/images/7598/standard/wrapped_bitcoin_wbtc.png", color: "#F7931A" },
  ETH:      { name: "Ethereum",          logo: "https://assets.coingecko.com/coins/images/279/standard/ethereum.png",         color: "#627EEA" },
  BNB:      { name: "BNB",              logo: "https://assets.coingecko.com/coins/images/825/standard/bnb-icon2_2x.png",     color: "#F3BA2F" },
  USDC:     { name: "USD Coin",          logo: "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",            color: "#2775CA" },
  USDT:     { name: "Tether",            logo: "https://assets.coingecko.com/coins/images/325/standard/Tether.png",           color: "#50AF95" },
  JUP:      { name: "Jupiter",           logo: "https://assets.coingecko.com/coins/images/34188/standard/jup.png",            color: "#00D18C" },
  PYTH:     { name: "Pyth Network",      logo: "https://assets.coingecko.com/coins/images/31924/standard/pyth.png",           color: "#7142CF" },
  JTO:      { name: "Jito",              logo: "https://assets.coingecko.com/coins/images/33228/standard/jto.png",            color: "#4E7CFF" },
  RAY:      { name: "Raydium",           logo: "https://assets.coingecko.com/coins/images/13928/standard/PSigc4ie_400x400.jpg", color: "#4F46E5" },
  BONK:     { name: "Bonk",              logo: "https://assets.coingecko.com/coins/images/28600/standard/bonk.jpg",           color: "#F59E0B" },
  WIF:      { name: "dogwifhat",         logo: "https://assets.coingecko.com/coins/images/33566/standard/dogwifhat.jpg",      color: "#A855F7" },
  PENGU:    { name: "Pudgy Penguins",    logo: "https://assets.coingecko.com/coins/images/44411/standard/PENGU.jpg",          color: "#7DD3FC" },
  FARTCOIN: { name: "Fartcoin",          logo: "https://assets.coingecko.com/coins/images/43527/standard/fartcoin.jpg",       color: "#86EFAC" },
  ORE:      { name: "Ore",               logo: "https://assets.coingecko.com/coins/images/36523/standard/ore_logo.png",       color: "#F97316" },
  XAU:      { name: "Gold",              logo: "https://assets.coingecko.com/coins/images/34558/standard/tether-gold.png",    color: "#FCD34D" },
  NVDA:     { name: "Nvidia",            logo: "https://assets.coingecko.com/coins/images/33033/standard/nvidia.png",         color: "#76B900" },
  TSLA:     { name: "Tesla",             logo: "https://assets.coingecko.com/coins/images/33031/standard/tesla.png",          color: "#CC0000" },
  // Liquid staking tokens
  JITOSOL:  { name: "Jito Staked SOL",   logo: "",                                                                             color: "#45AA5B" },
  MSOL:     { name: "Marinade SOL",      logo: "https://assets.coingecko.com/coins/images/17752/standard/mSOL.png",           color: "#308D8A" },
  BSOL:     { name: "BlazeStake SOL",    logo: "https://assets.coingecko.com/coins/images/26636/standard/blazeStake.png",     color: "#E87E34" },
  HSOL:     { name: "Helius Staked SOL", logo: "https://assets.coingecko.com/coins/images/34511/standard/hsol.png",            color: "#FF6B35" },
  VSOL:     { name: "Validator SOL",     logo: "https://assets.coingecko.com/coins/images/32440/standard/vsol.png",            color: "#5B21B6" },
  INF:      { name: "Infinity SOL",      logo: "https://assets.coingecko.com/coins/images/35288/standard/inf.png",             color: "#22D3EE" },
  // FAF
  FAF:      { name: "Flash Trade",       logo: "/ft-logo.svg",                                                                 color: "#33C9A1" },
  // DeFi & memes
  HYPE:     { name: "Hyperliquid",       logo: "",                                                                            color: "#00E5A0" },
  TRUMP:    { name: "TRUMP",             logo: "https://assets.coingecko.com/coins/images/44261/standard/trump.jpg",           color: "#D4AF37" },
  RENDER:   { name: "Render",            logo: "https://assets.coingecko.com/coins/images/11636/standard/rndr.png",            color: "#1F1F3D" },
  HNT:      { name: "Helium",            logo: "https://assets.coingecko.com/coins/images/4284/standard/Helium_HNT.png",      color: "#474DFF" },
  ONDO:     { name: "Ondo Finance",      logo: "https://assets.coingecko.com/coins/images/26580/standard/ONDO.png",            color: "#1C2333" },
  W:        { name: "Wormhole",          logo: "https://assets.coingecko.com/coins/images/35087/standard/w.png",               color: "#A8D8EA" },
  WEN:      { name: "Wen",               logo: "https://assets.coingecko.com/coins/images/34856/standard/wen.png",             color: "#F472B6" },
  TNSR:     { name: "Tensor",            logo: "https://assets.coingecko.com/coins/images/35972/standard/tnsr.png",            color: "#FF5733" },
  KMNO:     { name: "Kamino",            logo: "https://assets.coingecko.com/coins/images/36059/standard/kamino.png",           color: "#2563EB" },
  ME:       { name: "Magic Eden",        logo: "https://assets.coingecko.com/coins/images/40225/standard/me.png",              color: "#E11D48" },
  S:        { name: "Sonic SVM",         logo: "https://assets.coingecko.com/coins/images/44038/standard/sonic.png",            color: "#0EA5E9" },
  AAVE:     { name: "Aave",              logo: "https://assets.coingecko.com/coins/images/12645/standard/aave-token-round.png", color: "#B6509E" },
  ENA:      { name: "Ethena",            logo: "https://assets.coingecko.com/coins/images/36530/standard/ethena.png",           color: "#4F46E5" },
  TIA:      { name: "Celestia",          logo: "https://assets.coingecko.com/coins/images/31967/standard/tia.jpg",             color: "#7C3AED" },
  SEI:      { name: "Sei",               logo: "https://assets.coingecko.com/coins/images/28205/standard/Sei_Logo.png",        color: "#CC2936" },
  ORCA:     { name: "Orca",              logo: "https://assets.coingecko.com/coins/images/17547/standard/Orca_Logo.png",       color: "#FFD700" },
  DOGE:     { name: "Dogecoin",          logo: "https://assets.coingecko.com/coins/images/5/standard/dogecoin.png",            color: "#C2A633" },
  PEPE:     { name: "Pepe",              logo: "https://assets.coingecko.com/coins/images/29850/standard/pepe-token.jpeg",     color: "#3CB043" },
  XRP:      { name: "XRP",               logo: "https://assets.coingecko.com/coins/images/44/standard/xrp-symbol-white-128.png", color: "#23292F" },
  LINK:     { name: "Chainlink",         logo: "https://assets.coingecko.com/coins/images/877/standard/chainlink-new-logo.png", color: "#2A5ADA" },
  AVAX:     { name: "Avalanche",         logo: "https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png", color: "#E84142" },
  ADA:      { name: "Cardano",           logo: "https://assets.coingecko.com/coins/images/975/standard/cardano.png",           color: "#0033AD" },
  DOT:      { name: "Polkadot",          logo: "https://assets.coingecko.com/coins/images/12171/standard/polkadot.png",        color: "#E6007A" },
  LTC:      { name: "Litecoin",          logo: "https://assets.coingecko.com/coins/images/2/standard/litecoin.png",            color: "#345D9D" },
  NEAR:     { name: "NEAR",              logo: "https://assets.coingecko.com/coins/images/10365/standard/near.jpg",            color: "#000000" },
  ATOM:     { name: "Cosmos",            logo: "https://assets.coingecko.com/coins/images/1481/standard/cosmos_hub.png",       color: "#2E3148" },
  ARB:      { name: "Arbitrum",          logo: "https://assets.coingecko.com/coins/images/16547/standard/arb.jpg",             color: "#28A0F0" },
  OP:       { name: "Optimism",          logo: "https://assets.coingecko.com/coins/images/25244/standard/Optimism.png",        color: "#FF0420" },
  APT:      { name: "Aptos",             logo: "https://assets.coingecko.com/coins/images/26455/standard/aptos_round.png",     color: "#2DD8A3" },
  MATIC:    { name: "Polygon",           logo: "https://assets.coingecko.com/coins/images/4713/standard/polygon.png",          color: "#8247E5" },
  SUI:      { name: "Sui",               logo: "https://assets.coingecko.com/coins/images/26375/standard/sui.png",             color: "#6FBCF0" },
  ZEC:      { name: "Zcash",             logo: "https://assets.coingecko.com/coins/images/486/standard/circle-zcash-color.png", color: "#ECB244" },
  SPY:      { name: "S&P 500",           logo: "https://assets.coingecko.com/coins/images/34654/standard/spy.png",             color: "#3B82F6" },
  SPYX:     { name: "SPX6900",           logo: "",                                                                             color: "#1E40AF" },
  SPX:      { name: "SPX6900",           logo: "",                                                                             color: "#1E40AF" },
};

// ---- Supported markets ----
//
// Populated at module load from `flash-sdk/dist/PoolConfig.json` — the
// authoritative list of every tradable perp on Flash. Live values
// (maxLeverage, price, fees) come from the markets registry which refreshes
// from /pool-data; this constant is only used for symbol membership checks
// and UI dot colors.
//
// Stablecoins (USDC) and LSTs (JitoSOL) are filtered out. Devnet pools are
// skipped.
import PoolConfigStatic from "flash-sdk/dist/PoolConfig.json";

const _POOL_SKIP = new Set(["USDC", "JitoSOL"]);
const _POOL_DEVNET_PREFIX = "devnet";

function _buildMarkets(): Record<string, { pool: string; dotColor: string }> {
  const out: Record<string, { pool: string; dotColor: string }> = {};
  const pools =
    (PoolConfigStatic as { pools?: Array<{ poolName?: string; custodies?: Array<{ symbol?: string }> }> })
      .pools || [];
  for (const pool of pools) {
    const poolName = pool.poolName || "";
    if (poolName.startsWith(_POOL_DEVNET_PREFIX)) continue;
    for (const c of pool.custodies || []) {
      const symbol = c.symbol;
      if (!symbol || _POOL_SKIP.has(symbol)) continue;
      if (out[symbol]) continue; // first pool wins
      const dotColor = TOKEN_META[symbol]?.color ?? "#555";
      out[symbol] = { pool: poolName, dotColor };
    }
  }
  return out;
}

export const MARKETS: Record<string, { pool: string; dotColor: string }> = _buildMarkets();

// ---- Natural-language aliases ----
//
// Maps user-typed names to canonical symbols. The registry handles exact
// symbol matches; this map is only for words like "bitcoin" → BTC.
export const MARKET_ALIASES: Record<string, string> = {
  // Crypto majors
  bitcoin: "BTC",
  btc: "BTC",
  solana: "SOL",
  sol: "SOL",
  ethereum: "ETH",
  eth: "ETH",
  ether: "ETH",
  bnb: "BNB",
  binance: "BNB",
  zcash: "ZEC",
  zec: "ZEC",
  // Memes / community
  bonk: "BONK",
  wif: "WIF",
  dogwifhat: "WIF",
  pengu: "PENGU",
  penguin: "PENGU",
  pump: "PUMP",
  pumpfun: "PUMP",
  fartcoin: "FARTCOIN",
  fart: "FARTCOIN",
  // Governance
  jupiter: "JUP",
  jup: "JUP",
  pyth: "PYTH",
  jito: "JTO",
  jto: "JTO",
  raydium: "RAY",
  ray: "RAY",
  kamino: "KMNO",
  kmno: "KMNO",
  met: "MET",
  metaplex: "MET",
  hype: "HYPE",
  hyperliquid: "HYPE",
  // Ore / other
  ore: "ORE",
  // Commodities
  gold: "XAU",
  xau: "XAU",
  silver: "XAG",
  xag: "XAG",
  xaut: "XAUt",
  tethergold: "XAUt",
  oil: "CRUDEOIL",
  crude: "CRUDEOIL",
  crudeoil: "CRUDEOIL",
  wti: "CRUDEOIL",
  natgas: "NATGAS",
  gas: "NATGAS",
  // Forex
  eur: "EUR",
  euro: "EUR",
  gbp: "GBP",
  pound: "GBP",
  usdjpy: "USDJPY",
  jpy: "USDJPY",
  yen: "USDJPY",
  usdcnh: "USDCNH",
  cnh: "USDCNH",
  yuan: "USDCNH",
  // Equities
  spy: "SPY",
  "s&p": "SPY",
  sp500: "SPY",
  nvidia: "NVDA",
  nvda: "NVDA",
  tesla: "TSLA",
  tsla: "TSLA",
  apple: "AAPL",
  aapl: "AAPL",
  amd: "AMD",
  amazon: "AMZN",
  amzn: "AMZN",
  palantir: "PLTR",
  pltr: "PLTR",
};

// Top markets for the ticker bar
export const TICKER_MARKETS = ["SOL", "BTC", "ETH", "BONK", "JUP", "WIF"];

// Default leverage per pool
export const DEFAULT_LEVERAGE: Record<string, number> = {
  "Crypto.1": 5,
  "Virtual.1": 5,
  "Governance.1": 3,
  "Community.1": 3,
  "Community.2": 3,
  "Trump.1": 3,
  "Ore.1": 2,
  "Equity.1": 3,
};

// Risk thresholds
export const HIGH_LEVERAGE_THRESHOLD = 20;
// Absolute ceiling for Zod input validation. Real per-market caps come
// from the markets registry (FlashEdge-parity pool caps, see
// markets-registry.ts POOL_CAPS). FlashEdge max cap is 500x (Crypto.1
// degen); this ceiling is set just above that so the Zod schema never
// preempts the per-market check.
export const MAX_LEVERAGE = 500;
export const MIN_COLLATERAL = 10;
export const DEFAULT_SLIPPAGE_BPS = 80;

// Refresh intervals
export const PRICE_REFRESH_MS = 5_000;
export const POSITION_REFRESH_MS = 10_000;
