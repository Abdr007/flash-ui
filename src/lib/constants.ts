// ============================================
// Flash UI — Constants
// ============================================

export const FLASH_API_URL =
  process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade";

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
