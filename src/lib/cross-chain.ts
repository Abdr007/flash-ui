// ============================================
// Flash AI — Cross-Chain Infrastructure
// ============================================
// Abstraction layer for multi-chain transfers.
// Uses trusted bridge providers — no custom bridge logic.
//
// Architecture:
// 1. Chain detection (from user input or token)
// 2. Bridge provider selection
// 3. Fee + time estimation
// 4. Preview for user confirmation
// 5. Execution via provider SDK
//
// Supported chains (infrastructure-ready, not all active):
// - Solana (native)
// - Ethereum
// - BSC
// - Polygon
// - Arbitrum
// - Base
// - Avalanche

export interface ChainInfo {
  id: string;
  name: string;
  nativeToken: string;
  explorerUrl: string;
  isActive: boolean; // whether bridge integration is live
}

export const SUPPORTED_CHAINS: Record<string, ChainInfo> = {
  solana:    { id: "solana",    name: "Solana",    nativeToken: "SOL", explorerUrl: "https://solscan.io",     isActive: true },
  ethereum:  { id: "ethereum",  name: "Ethereum",  nativeToken: "ETH", explorerUrl: "https://etherscan.io",   isActive: false },
  bsc:       { id: "bsc",       name: "BNB Chain", nativeToken: "BNB", explorerUrl: "https://bscscan.com",    isActive: false },
  polygon:   { id: "polygon",   name: "Polygon",   nativeToken: "MATIC", explorerUrl: "https://polygonscan.com", isActive: false },
  arbitrum:  { id: "arbitrum",  name: "Arbitrum",  nativeToken: "ETH", explorerUrl: "https://arbiscan.io",    isActive: false },
  base:      { id: "base",      name: "Base",      nativeToken: "ETH", explorerUrl: "https://basescan.org",   isActive: false },
  avalanche: { id: "avalanche", name: "Avalanche", nativeToken: "AVAX", explorerUrl: "https://snowtrace.io",  isActive: false },
};

export interface BridgeProvider {
  id: string;
  name: string;
  supportedChains: string[];
  estimatedTimeMinutes: { min: number; max: number };
  feePercent: number; // approximate
}

export const BRIDGE_PROVIDERS: BridgeProvider[] = [
  {
    id: "wormhole",
    name: "Wormhole",
    supportedChains: ["solana", "ethereum", "bsc", "polygon", "arbitrum", "base", "avalanche"],
    estimatedTimeMinutes: { min: 1, max: 20 },
    feePercent: 0.04,
  },
  {
    id: "debridge",
    name: "deBridge",
    supportedChains: ["solana", "ethereum", "bsc", "polygon", "arbitrum", "base", "avalanche"],
    estimatedTimeMinutes: { min: 1, max: 5 },
    feePercent: 0.05,
  },
  {
    id: "mayan",
    name: "Mayan Finance",
    supportedChains: ["solana", "ethereum", "polygon", "arbitrum", "base"],
    estimatedTimeMinutes: { min: 1, max: 3 },
    feePercent: 0.05,
  },
];

// Chain aliases for natural language detection
const CHAIN_ALIASES: Record<string, string> = {
  sol: "solana", solana: "solana",
  eth: "ethereum", ethereum: "ethereum",
  bnb: "bsc", bsc: "bsc", "binance smart chain": "bsc",
  matic: "polygon", polygon: "polygon",
  arb: "arbitrum", arbitrum: "arbitrum",
  base: "base",
  avax: "avalanche", avalanche: "avalanche",
};

/**
 * Detect destination chain from user input.
 * Returns null if input refers to Solana (same-chain) or is unrecognizable.
 */
export function detectDestinationChain(input: string): ChainInfo | null {
  const lower = input.toLowerCase().trim();

  // Check for explicit chain mentions
  for (const [alias, chainId] of Object.entries(CHAIN_ALIASES)) {
    if (lower.includes(alias)) {
      const chain = SUPPORTED_CHAINS[chainId];
      if (chain && chainId !== "solana") return chain;
    }
  }

  // Check for EVM-style addresses (0x prefix)
  if (/\b0x[a-fA-F0-9]{40}\b/.test(lower)) {
    // Could be Ethereum, BSC, Polygon, etc. — ambiguous, ask user
    return null; // caller should ask which chain
  }

  return null;
}

/**
 * Find bridge providers that support a source→destination route.
 */
export function findBridgeProviders(sourceChain: string, destChain: string): BridgeProvider[] {
  return BRIDGE_PROVIDERS.filter(
    (p) => p.supportedChains.includes(sourceChain) && p.supportedChains.includes(destChain)
  );
}

export interface CrossChainPreview {
  sourceChain: ChainInfo;
  destinationChain: ChainInfo;
  token: string;
  amount: number;
  bridgeProvider: BridgeProvider;
  estimatedFee: number;
  estimatedTimeMinutes: { min: number; max: number };
  isActive: boolean;
}

/**
 * Build a cross-chain transfer preview.
 * Returns null if route is not supported.
 */
export function buildCrossChainPreview(
  destChainId: string,
  token: string,
  amount: number,
): CrossChainPreview | null {
  const sourceChain = SUPPORTED_CHAINS["solana"];
  const destChain = SUPPORTED_CHAINS[destChainId];
  if (!sourceChain || !destChain) return null;

  const providers = findBridgeProviders("solana", destChainId);
  if (providers.length === 0) return null;

  // Pick best provider (lowest fee)
  const best = providers.sort((a, b) => a.feePercent - b.feePercent)[0];
  const estimatedFee = amount * (best.feePercent / 100);

  return {
    sourceChain,
    destinationChain: destChain,
    token,
    amount,
    bridgeProvider: best,
    estimatedFee,
    estimatedTimeMinutes: best.estimatedTimeMinutes,
    isActive: destChain.isActive,
  };
}
