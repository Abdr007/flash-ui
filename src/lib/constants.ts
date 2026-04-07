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
};

// Supported markets (from flash-x pool resolver)
export const MARKETS: Record<string, { pool: string; dotColor: string }> = {
  SOL:      { pool: "Crypto.1",     dotColor: "#9945FF" },
  BTC:      { pool: "Crypto.1",     dotColor: "#F7931A" },
  ETH:      { pool: "Crypto.1",     dotColor: "#627EEA" },
  BNB:      { pool: "Crypto.1",     dotColor: "#F3BA2F" },
  ZEC:      { pool: "Crypto.1",     dotColor: "#ECB244" },
  JUP:      { pool: "Governance.1", dotColor: "#00D18C" },
  PYTH:     { pool: "Governance.1", dotColor: "#7142CF" },
  JTO:      { pool: "Governance.1", dotColor: "#4E7CFF" },
  RAY:      { pool: "Governance.1", dotColor: "#4F46E5" },
  BONK:     { pool: "Community.1",  dotColor: "#F59E0B" },
  PENGU:    { pool: "Community.1",  dotColor: "#7DD3FC" },
  WIF:      { pool: "Community.2",  dotColor: "#A855F7" },
  FARTCOIN: { pool: "Trump.1",      dotColor: "#86EFAC" },
  ORE:      { pool: "Ore.1",        dotColor: "#F97316" },
  XAU:      { pool: "Virtual.1",    dotColor: "#FCD34D" },
  SPY:      { pool: "Equity.1",     dotColor: "#3B82F6" },
  NVDA:     { pool: "Equity.1",     dotColor: "#76B900" },
  TSLA:     { pool: "Equity.1",     dotColor: "#CC0000" },
};

// Aliases for natural language parsing
export const MARKET_ALIASES: Record<string, string> = {
  bitcoin: "BTC",
  btc: "BTC",
  solana: "SOL",
  sol: "SOL",
  ethereum: "ETH",
  eth: "ETH",
  ether: "ETH",
  bnb: "BNB",
  binance: "BNB",
  bonk: "BONK",
  wif: "WIF",
  dogwifhat: "WIF",
  jupiter: "JUP",
  jup: "JUP",
  pyth: "PYTH",
  jito: "JTO",
  jto: "JTO",
  raydium: "RAY",
  ray: "RAY",
  pengu: "PENGU",
  penguin: "PENGU",
  fartcoin: "FARTCOIN",
  fart: "FARTCOIN",
  ore: "ORE",
  gold: "XAU",
  xau: "XAU",
  spy: "SPY",
  nvidia: "NVDA",
  nvda: "NVDA",
  tesla: "TSLA",
  tsla: "TSLA",
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
export const MAX_LEVERAGE = 100;
export const MIN_COLLATERAL = 10;
export const DEFAULT_SLIPPAGE_BPS = 80;

// Refresh intervals
export const PRICE_REFRESH_MS = 5_000;
export const POSITION_REFRESH_MS = 10_000;
