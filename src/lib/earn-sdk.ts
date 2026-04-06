// ============================================
// Flash UI — Earn SDK Client (Browser-Side)
// ============================================
// Wraps flash-sdk PerpetualsClient for earn operations.
// Builds instructions only — signing + broadcast handled by caller.
//
// PARITY: matches flash-x/src/services/sdk-service.ts exactly.
// Same SDK methods, same parameters, same instruction output.

import { PublicKey, TransactionInstruction, type Connection, type Signer } from "@solana/web3.js";
import { AnchorProvider, type Wallet } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PerpetualsClient } from "flash-sdk";
import { PoolConfig } from "flash-sdk/dist/PoolConfig";

// ---- Constants (matching CLI) ----
const PROGRAM_ID = new PublicKey("FLASH6Lo1ibkVBFn6aCFTxzPQHc1yVwjfDAoX3F4qyZ5");
const COMPOSABILITY_ID = new PublicKey("EKFPoYCaPL6KpJcHjg7dPyqV9ihhA2Z2y3Q4K6ccPR7i");
const FB_NFT_REWARD_ID = new PublicKey("FbNFT28DgCi6CxK5BZELvHJvBY2LGxkWnee7WJYRgJL1");
const REWARD_DIST_ID = new PublicKey("9GAaBN5AWFkijEVBMtiSafNyBPFRq76N3FPKmJR8jzmB");
const BN_ZERO = new BN(0);

// ---- Pool Name Mapping ----
const POOL_MAP: Record<string, string> = {
  crypto: "Crypto.1",
  gold: "Virtual.1",
  defi: "Governance.1",
  meme: "Community.1",
  wif: "Community.2",
  fart: "Trump.1",
  ore: "Ore.1",
};

export function resolvePoolName(alias: string): string | null {
  const lower = alias.toLowerCase().trim();
  return POOL_MAP[lower] ?? null;
}

// ---- SDK Client Initialization ----

let _client: PerpetualsClient | null = null;
let _lastWallet: string | null = null;

function getClient(connection: Connection, wallet: Wallet): PerpetualsClient {
  const walletKey = wallet.publicKey.toBase58();
  if (_client && _lastWallet === walletKey) return _client;

  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  _client = new PerpetualsClient(
    provider,
    PROGRAM_ID,
    COMPOSABILITY_ID,
    FB_NFT_REWARD_ID,
    REWARD_DIST_ID,
    {},
  );
  _lastWallet = walletKey;
  return _client;
}

function getPoolConfig(poolName: string): PoolConfig {
  return PoolConfig.fromIdsByName(poolName, "mainnet-beta");
}

// ---- Deposit (addCompoundingLiquidity) ----
// Matches: flash-x/src/services/sdk-service.ts buildEarnDeposit

export interface EarnTxResult {
  instructions: TransactionInstruction[];
  additionalSigners: Signer[];
  poolConfig: PoolConfig;
}

export async function buildEarnDeposit(
  connection: Connection,
  wallet: Wallet,
  amountUsd: number,
  poolAlias: string,
  flpPrice: number,
  slippagePct = 0.5,
): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  if (!Number.isFinite(amountUsd) || amountUsd < 1) throw new Error("Minimum deposit is $1");

  const client = getClient(connection, wallet);
  const pc = getPoolConfig(poolName);

  // USDC = 6 decimals — same as CLI's uiDecimalsToNative
  const nativeAmount = new BN(Math.floor(amountUsd * 1_000_000));
  if (nativeAmount.isZero()) throw new Error("Amount too small");

  // Slippage protection: calculate minimum FLP out
  // FLP has 6 decimals (from poolConfig.lpDecimals)
  let minOut = BN_ZERO;
  if (flpPrice > 0 && slippagePct > 0) {
    const expectedShares = amountUsd / flpPrice;
    const minShares = expectedShares * (1 - slippagePct / 100);
    minOut = new BN(Math.floor(minShares * 1_000_000));
  }

  const result = await client.addCompoundingLiquidity(
    nativeAmount,
    minOut,
    "USDC",
    pc.compoundingTokenMint,
    pc,
  );

  return {
    instructions: result.instructions,
    additionalSigners: result.additionalSigners,
    poolConfig: pc,
  };
}

// ---- Withdraw (removeCompoundingLiquidity) ----
// Matches: flash-x/src/services/sdk-service.ts buildEarnWithdrawPercent

export async function buildEarnWithdraw(
  connection: Connection,
  wallet: Wallet,
  percent: number,
  poolAlias: string,
  flpPrice = 0,
  slippagePct = 0.5,
): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw new Error("Percent must be 1-100");

  const client = getClient(connection, wallet);
  const pc = getPoolConfig(poolName);

  // 1. Get FLP token balance (same logic as CLI)
  const { getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");

  const getTokenBal = async (mint: PublicKey): Promise<BN> => {
    try {
      const ata = await getAssociatedTokenAddress(mint, wallet.publicKey);
      const account = await getAccount(connection, ata);
      return new BN(account.amount.toString());
    } catch {
      return new BN(0);
    }
  };

  // Check compounding FLP balance first
  const flpMint = pc.compoundingTokenMint;
  let flpBalance = await getTokenBal(flpMint);
  let useRawLp = false;

  // Fallback: check raw LP tokens (from unstake path)
  if (flpBalance.isZero()) {
    const rawLpMint = pc.stakedLpTokenMint;
    flpBalance = await getTokenBal(rawLpMint);
    if (flpBalance.isZero()) {
      throw new Error("No FLP tokens found. Deposit first.");
    }
    useRawLp = true;
  }

  // Calculate withdraw amount from percentage
  const withdrawAmount = flpBalance.mul(new BN(Math.floor(percent))).div(new BN(100));
  if (withdrawAmount.isZero()) throw new Error(`${percent}% of balance rounds to zero`);

  // Slippage protection: calculate minimum USDC out
  let minOut = BN_ZERO;
  if (flpPrice > 0 && slippagePct > 0) {
    const sharesUi = parseInt(withdrawAmount.toString()) / 1_000_000;
    const expectedUsdc = sharesUi * flpPrice;
    const minUsdc = expectedUsdc * (1 - slippagePct / 100);
    minOut = new BN(Math.floor(minUsdc * 1_000_000));
  }

  // Build transaction (same branching as CLI)
  let result: { instructions: TransactionInstruction[]; additionalSigners: Signer[] };
  if (useRawLp) {
    result = await client.removeLiquidity("USDC", withdrawAmount, minOut, pc, true, true);
  } else {
    result = await client.removeCompoundingLiquidity(
      withdrawAmount,
      minOut,
      "USDC",
      flpMint,
      pc,
    );
  }

  return {
    instructions: result.instructions,
    additionalSigners: result.additionalSigners,
    poolConfig: pc,
  };
}
