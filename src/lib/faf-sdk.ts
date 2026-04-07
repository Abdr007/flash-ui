// ============================================
// Flash UI — FAF Staking SDK Client
// ============================================
// Wraps flash-sdk PerpetualsClient for FAF staking.
// Builds instructions only — signing handled by wallet.
//
// PARITY: matches flash-terminal/src/token/faf-data.ts exactly.

import { PublicKey, type Connection, type Signer, TransactionInstruction } from "@solana/web3.js";
import { AnchorProvider, type Wallet, BN } from "@coral-xyz/anchor";
import { PerpetualsClient } from "flash-sdk";
import { PoolConfig } from "flash-sdk/dist/PoolConfig";

// ---- Constants (from flash-terminal/src/token/faf-registry.ts) ----

export const FAF_MINT = new PublicKey("FAFxVxnkzZHMCodkWyoccgUNgVScqMw2mhhQBYDFjFAF");
export const FAF_DECIMALS = 6;
export const UNSTAKE_UNLOCK_SECONDS = 90 * 24 * 3600; // 90 days

// VIP tier thresholds
export const VIP_TIERS = [
  { level: 0, name: "None",    fafRequired: 0,         feeDiscount: 0,    referralRebate: 2 },
  { level: 1, name: "Level 1", fafRequired: 20_000,    feeDiscount: 2.5,  referralRebate: 2.5 },
  { level: 2, name: "Level 2", fafRequired: 40_000,    feeDiscount: 3.5,  referralRebate: 3 },
  { level: 3, name: "Level 3", fafRequired: 100_000,   feeDiscount: 5,    referralRebate: 4 },
  { level: 4, name: "Level 4", fafRequired: 200_000,   feeDiscount: 7,    referralRebate: 5.5 },
  { level: 5, name: "Level 5", fafRequired: 1_000_000, feeDiscount: 9.5,  referralRebate: 7.5 },
  { level: 6, name: "Level 6", fafRequired: 2_000_000, feeDiscount: 12,   referralRebate: 10 },
];

export const VOLTAGE_TIERS = [
  { name: "Rookie",      multiplier: 1.0 },
  { name: "Degenerate",  multiplier: 1.2 },
  { name: "Flow Master", multiplier: 1.4 },
  { name: "Ape Trade",   multiplier: 1.6 },
  { name: "Perp King",   multiplier: 1.8 },
  { name: "Giga Chad",   multiplier: 2.0 },
];

// ---- Types ----

export interface FafStakeInfo {
  stakedAmount: number;
  level: number;
  tierName: string;
  feeDiscount: number;
  pendingRewardsFaf: number;
  pendingRevenueUsdc: number;
  pendingRebateUsdc: number;
  withdrawRequestCount: number;
  tradeCounter: number;
  nextTier: typeof VIP_TIERS[number] | null;
  amountToNextTier: number;
}

export interface FafUnstakeRequest {
  index: number;
  lockedAmount: number;
  withdrawableAmount: number;
  timeRemainingSeconds: number;
  progressPercent: number;
  estimatedUnlockDate: string;
}

export interface FafInstructionResult {
  instructions: TransactionInstruction[];
  additionalSigners: Signer[];
}

// ---- SDK Client ----

const DEFAULT_POOL = "Crypto.1"; // FAF staking uses Crypto.1 pool

let _client: PerpetualsClient | null = null;
let _lastWallet: string | null = null;

function getClient(connection: Connection, wallet: Wallet): PerpetualsClient {
  const walletKey = wallet.publicKey.toBase58();
  if (_client && _lastWallet === walletKey) return _client;

  const pc = PoolConfig.fromIdsByName(DEFAULT_POOL, "mainnet-beta");
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  _client = new PerpetualsClient(
    provider,
    pc.programId,
    pc.perpComposibilityProgramId,
    pc.fbNftRewardProgramId,
    pc.rewardDistributionProgram.programId,
    { prioritizationFee: 50_000 },
  );
  _lastWallet = walletKey;
  return _client;
}

function getPoolConfig(): PoolConfig {
  return PoolConfig.fromIdsByName(DEFAULT_POOL, "mainnet-beta");
}

function safe(n: unknown): number {
  if (n == null) return 0;
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

function bnToUi(bn: { toNumber?: () => number; toString?: () => string } | null | undefined): number {
  if (!bn) return 0;
  try {
    const num = typeof bn.toNumber === "function" ? bn.toNumber() : Number(String(bn));
    return safe(num / Math.pow(10, FAF_DECIMALS));
  } catch {
    return 0;
  }
}

// ---- Tier Calculation ----

export function getVipTier(stakedFaf: number): typeof VIP_TIERS[number] {
  for (let i = VIP_TIERS.length - 1; i >= 0; i--) {
    if (stakedFaf >= VIP_TIERS[i].fafRequired) return VIP_TIERS[i];
  }
  return VIP_TIERS[0];
}

export function getNextTier(stakedFaf: number): { tier: typeof VIP_TIERS[number]; amountNeeded: number } | null {
  const current = getVipTier(stakedFaf);
  const nextIdx = current.level + 1;
  if (nextIdx >= VIP_TIERS.length) return null;
  const next = VIP_TIERS[nextIdx];
  return { tier: next, amountNeeded: next.fafRequired - stakedFaf };
}

// ---- Read Operations ----

export async function getFafStakeInfo(
  connection: Connection,
  wallet: Wallet,
  userPubkey: PublicKey,
): Promise<FafStakeInfo | null> {
  const client = getClient(connection, wallet);
  const poolConfig = getPoolConfig();

  const account = await client.getTokenStakeAccount(poolConfig, userPubkey);
  if (!account) return null;

  const stakedAmount = bnToUi(account.activeStakeAmount);
  const tier = getVipTier(stakedAmount);
  const next = getNextTier(stakedAmount);

  return {
    stakedAmount,
    level: safe(account.level),
    tierName: tier.name,
    feeDiscount: tier.feeDiscount,
    pendingRewardsFaf: bnToUi(account.rewardTokens),
    pendingRevenueUsdc: bnToUi(account.unclaimedRevenueAmount),
    pendingRebateUsdc: bnToUi(account.claimableRebateUsd),
    withdrawRequestCount: safe(account.withdrawRequestCount),
    tradeCounter: safe(account.tradeCounter),
    nextTier: next?.tier ?? null,
    amountToNextTier: next?.amountNeeded ?? 0,
  };
}

export async function getFafUnstakeRequests(
  connection: Connection,
  wallet: Wallet,
  userPubkey: PublicKey,
): Promise<FafUnstakeRequest[]> {
  const client = getClient(connection, wallet);
  const poolConfig = getPoolConfig();

  const account = await client.getTokenStakeAccount(poolConfig, userPubkey);
  if (!account || !account.withdrawRequest) return [];

  return account.withdrawRequest.map((req, index) => {
    const locked = bnToUi(req.lockedAmount);
    const withdrawable = bnToUi(req.withdrawableAmount);
    const timeRemaining = safe(typeof req.timeRemaining?.toNumber === "function"
      ? req.timeRemaining.toNumber()
      : Number(String(req.timeRemaining ?? 0)));

    const elapsed = UNSTAKE_UNLOCK_SECONDS - timeRemaining;
    const progress = UNSTAKE_UNLOCK_SECONDS > 0
      ? Math.min(100, Math.max(0, (elapsed / UNSTAKE_UNLOCK_SECONDS) * 100))
      : 100;

    const unlockDate = new Date(Date.now() + timeRemaining * 1000);

    return {
      index,
      lockedAmount: locked,
      withdrawableAmount: withdrawable,
      timeRemainingSeconds: timeRemaining,
      progressPercent: Math.round(progress),
      estimatedUnlockDate: unlockDate.toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      }),
    };
  });
}

// ---- Write Operations (return instructions only) ----

export async function buildStakeInstructions(
  connection: Connection,
  wallet: Wallet,
  userPubkey: PublicKey,
  amountUi: number,
): Promise<FafInstructionResult> {
  const client = getClient(connection, wallet);
  const poolConfig = getPoolConfig();
  const nativeAmount = new BN(Math.round(amountUi * Math.pow(10, FAF_DECIMALS)));

  const result = await client.depositTokenStake(
    userPubkey, userPubkey, nativeAmount, poolConfig,
  );

  return {
    instructions: result.instructions as TransactionInstruction[],
    additionalSigners: result.additionalSigners as Signer[],
  };
}

export async function buildUnstakeInstructions(
  connection: Connection,
  wallet: Wallet,
  userPubkey: PublicKey,
  amountUi: number,
): Promise<FafInstructionResult> {
  const client = getClient(connection, wallet);
  const poolConfig = getPoolConfig();
  const nativeAmount = new BN(Math.round(amountUi * Math.pow(10, FAF_DECIMALS)));

  const result = await client.unstakeTokenRequest(
    userPubkey, nativeAmount, poolConfig,
  );

  return {
    instructions: result.instructions as TransactionInstruction[],
    additionalSigners: result.additionalSigners as Signer[],
  };
}

export async function buildClaimRewardsInstructions(
  connection: Connection,
  wallet: Wallet,
  userPubkey: PublicKey,
): Promise<FafInstructionResult> {
  const client = getClient(connection, wallet);
  const poolConfig = getPoolConfig();

  const result = await client.collectTokenReward(userPubkey, poolConfig);

  return {
    instructions: result.instructions as TransactionInstruction[],
    additionalSigners: result.additionalSigners as Signer[],
  };
}

export async function buildClaimRevenueInstructions(
  connection: Connection,
  wallet: Wallet,
  userPubkey: PublicKey,
): Promise<FafInstructionResult> {
  const client = getClient(connection, wallet);
  const poolConfig = getPoolConfig();

  const result = await client.collectRevenue(userPubkey, "USDC", poolConfig);

  return {
    instructions: result.instructions as TransactionInstruction[],
    additionalSigners: result.additionalSigners as Signer[],
  };
}

export async function buildCancelUnstakeInstructions(
  connection: Connection,
  wallet: Wallet,
  userPubkey: PublicKey,
  requestIndex: number,
): Promise<FafInstructionResult> {
  const client = getClient(connection, wallet);
  const poolConfig = getPoolConfig();

  const result = await client.cancelUnstakeTokenRequest(
    userPubkey, requestIndex, poolConfig,
  );

  return {
    instructions: result.instructions as TransactionInstruction[],
    additionalSigners: result.additionalSigners as Signer[],
  };
}
