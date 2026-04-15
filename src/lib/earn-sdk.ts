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

const BN_ZERO = new BN(0);

// ---- Pool Name Mapping ----
const POOL_MAP: Record<string, string> = {
  crypto: "Crypto.1",
  gold: "Virtual.1",
  defi: "Governance.1",
  meme: "Community.1",
  community: "Community.1",
  wif: "Community.2",
  trump: "Trump.1",
  fart: "Trump.1",
  ore: "Ore.1",
  equity: "Equity.1",
};

export function resolvePoolName(alias: string): string | null {
  const lower = alias.toLowerCase().trim();
  return POOL_MAP[lower] ?? null;
}

// ---- SDK Client Initialization ----

let _client: PerpetualsClient | null = null;
let _lastWallet: string | null = null;

function getClient(connection: Connection, wallet: Wallet, poolName: string): PerpetualsClient {
  // Always recreate client to ensure wallet context is correct

  // Get program IDs FROM the pool config (matching CLI exactly)
  const pc = PoolConfig.fromIdsByName(poolName, "mainnet-beta");
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  _client = new PerpetualsClient(
    provider,
    pc.programId,
    pc.perpComposibilityProgramId,
    pc.fbNftRewardProgramId,
    pc.rewardDistributionProgram.programId,
    { prioritizationFee: 100 },
  );
  _lastWallet = wallet.publicKey.toBase58();
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
  asSflp = false, // true = addLiquidity (sFLP.1 in wallet), false = addCompoundingLiquidity (FLP.1)
): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  if (!Number.isFinite(amountUsd) || amountUsd < 1) throw new Error("Minimum deposit is $1");

  const pc = getPoolConfig(poolName);
  const client = getClient(connection, wallet, poolName);

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

  let result: { instructions: TransactionInstruction[]; additionalSigners: Signer[] };

  if (asSflp) {
    // addLiquidity: USDC → sFLP.1 (stakedLpTokenMint) — visible in wallet as SPL token
    result = await client.addLiquidity(
      "USDC",
      nativeAmount,
      minOut,
      pc,
      true, // skipBalanceChecks
    );
  } else {
    // addCompoundingLiquidity: USDC → FLP.1 (compoundingTokenMint) — auto-compounds
    result = await client.addCompoundingLiquidity(
      nativeAmount,
      minOut,
      "USDC",
      pc.compoundingTokenMint,
      pc,
      true,
      undefined,
      wallet.publicKey,
    );
  }

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

  const pc = getPoolConfig(poolName);
  const client = getClient(connection, wallet, poolName);

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

  // FLP.1 (compounding token) withdrawal only. sFLP handled by burn_sflp.
  const flpMint = pc.compoundingTokenMint;
  const flpBalance = await getTokenBal(flpMint);

  if (flpBalance.isZero()) {
    throw new Error("No FLP tokens found. If you have sFLP, say 'burn sflp' instead.");
  }

  const withdrawAmount = flpBalance.mul(new BN(Math.floor(percent))).div(new BN(100));
  if (withdrawAmount.isZero()) throw new Error(`${percent}% of balance rounds to zero`);

  let minOut = BN_ZERO;
  if (flpPrice > 0 && slippagePct > 0) {
    const sharesUi = parseInt(withdrawAmount.toString()) / 1_000_000;
    const expectedUsdc = sharesUi * flpPrice;
    const minUsdc = expectedUsdc * (1 - slippagePct / 100);
    minOut = new BN(Math.floor(minUsdc * 1_000_000));
  }

  {
    const result = await client.removeCompoundingLiquidity(
      withdrawAmount,
      minOut,
      "USDC",
      flpMint,
      pc,
      true,
      undefined,
      wallet.publicKey,
    );

    return {
      instructions: result.instructions,
      additionalSigners: result.additionalSigners,
      poolConfig: pc,
    };
  }
}

// ---- Burn sFLP → USDC (removeLiquidity) ----

export async function buildBurnSflp(
  connection: Connection,
  wallet: Wallet,
  percent: number,
  poolAlias: string,
): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  const pc = getPoolConfig(poolName);
  const client = getClient(connection, wallet, poolName);

  const { getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");
  const sflpMint = pc.stakedLpTokenMint; // sFLP.1

  let sflpBalance: BN;
  try {
    const ata = await getAssociatedTokenAddress(sflpMint, wallet.publicKey);
    const account = await getAccount(connection, ata);
    sflpBalance = new BN(account.amount.toString());
  } catch {
    throw new Error("No sFLP tokens found in your wallet.");
  }
  if (sflpBalance.isZero()) throw new Error("sFLP balance is zero.");

  const burnAmount = sflpBalance.mul(new BN(Math.floor(percent))).div(new BN(100));
  if (burnAmount.isZero()) throw new Error(`${percent}% rounds to zero.`);

  const result = await client.removeLiquidity(
    "USDC",
    burnAmount,
    BN_ZERO, // accept any USDC output (sFLP price differs from FLP price)
    pc,
    false, // closeLpATA
    true, // createUserATA
    false, // closeWSOL
    undefined,
    wallet.publicKey,
    false, // isWhitelistedUser
    true, // includeRemainingAccounts
  );

  return {
    instructions: result.instructions,
    additionalSigners: result.additionalSigners,
    poolConfig: pc,
  };
}

// ---- Convert sFLP → FLP (migrateStake) ----
// Takes staked sFLP.1 from stake PDA, outputs FLP.1 (compoundingTokenMint) to wallet ATA

export async function buildSflpToFlp(
  connection: Connection,
  wallet: Wallet,
  percent: number,
  poolAlias: string,
): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  if (!Number.isFinite(percent) || percent < 1 || percent > 100) throw new Error("Percent must be 1-100");

  const pc = getPoolConfig(poolName);
  const client = getClient(connection, wallet, poolName);

  // Read staked balance from PDA at offset 72 (u64 LE, 6 decimals)
  const FLASH_PROGRAM = pc.programId;
  const userKey = wallet.publicKey;
  const poolKey = pc.poolAddress;

  const [stakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), userKey.toBuffer(), poolKey.toBuffer()],
    FLASH_PROGRAM,
  );

  const accInfo = await connection.getAccountInfo(stakePda);
  if (!accInfo || accInfo.data.length < 80) {
    throw new Error("No staked position found for this pool.");
  }

  // Check stake PDA first
  let stakedBalance = BN_ZERO;
  if (accInfo && accInfo.data.length >= 80) {
    const raw = Number(accInfo.data.readBigUInt64LE(80));
    stakedBalance = new BN(raw.toString());
  }

  // If stake PDA has balance, use migrateStake (PDA → FLP)
  if (!stakedBalance.isZero()) {
    const migrateAmount = stakedBalance.mul(new BN(Math.floor(percent))).div(new BN(100));
    if (migrateAmount.isZero()) throw new Error(`${percent}% rounds to zero.`);

    const result = await client.migrateStake(migrateAmount, pc.compoundingTokenMint, pc, true);
    return { instructions: result.instructions, additionalSigners: result.additionalSigners, poolConfig: pc };
  }

  // Fallback: check sFLP in wallet token account
  const { getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");
  const sflpMint = pc.stakedLpTokenMint;
  let sflpBalance = BN_ZERO;
  try {
    const ata = await getAssociatedTokenAddress(sflpMint, userKey);
    const account = await getAccount(connection, ata);
    sflpBalance = new BN(account.amount.toString());
  } catch {}

  if (sflpBalance.isZero()) {
    throw new Error("No sFLP found (neither in wallet nor staked). Nothing to convert.");
  }

  // sFLP in wallet → burn for USDC (removeLiquidity), user then deposits USDC → FLP separately
  const burnAmount = sflpBalance.mul(new BN(Math.floor(percent))).div(new BN(100));
  if (burnAmount.isZero()) throw new Error(`${percent}% rounds to zero.`);

  const result = await client.removeLiquidity(
    "USDC",
    burnAmount,
    BN_ZERO,
    pc,
    false,
    true,
    false,
    undefined,
    userKey,
    false,
    true,
  );
  return { instructions: result.instructions, additionalSigners: result.additionalSigners, poolConfig: pc };
}

// ---- Collect Stake Rewards (collectStakeFees) ----
// Collects accumulated USDC fee rewards from staked sFLP position

export async function buildCollectRewards(
  connection: Connection,
  wallet: Wallet,
  poolAlias: string,
): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  const pc = getPoolConfig(poolName);
  const client = getClient(connection, wallet, poolName);

  // Check if stake PDA exists (offset 72 > 0)
  const FLASH_PROGRAM = pc.programId;
  const userKey = wallet.publicKey;
  const poolKey = pc.poolAddress;

  const [stakePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), userKey.toBuffer(), poolKey.toBuffer()],
    FLASH_PROGRAM,
  );

  const accInfo = await connection.getAccountInfo(stakePda);
  if (!accInfo || accInfo.data.length < 80) {
    throw new Error("No staked position found for this pool.");
  }

  const raw = Number(accInfo.data.readBigUInt64LE(80));
  if (raw === 0) throw new Error("No staked position found.");

  // Find tokenStakeAccount PDA
  const [tokenStakeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_stake"), userKey.toBuffer()],
    FLASH_PROGRAM,
  );

  // Check if tokenStakeAccount exists
  const tsaInfo = await connection.getAccountInfo(tokenStakeAccount);
  const tsaPubkey = tsaInfo ? tokenStakeAccount : undefined;

  const result = await client.collectStakeFees(
    "USDC",
    pc,
    tsaPubkey,
    true, // createUserATA
  );

  return {
    instructions: result.instructions,
    additionalSigners: result.additionalSigners,
    poolConfig: pc,
  };
}

// ---- Convert FLP.1 → sFLP.1 (single tx via migrateFlp) ----
// Burns FLP.1 from wallet, credits sFLP.1 in stake PDA.
// One instruction, one signature. sFLP visible in earn positions (not wallet).

export async function buildFlpToSflp(connection: Connection, wallet: Wallet, poolAlias: string): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  const pc = getPoolConfig(poolName);
  const client = getClient(connection, wallet, poolName);
  const flpMint = pc.compoundingTokenMint;

  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const userFlpAccount = getAssociatedTokenAddressSync(flpMint, wallet.publicKey, true);

  let flpBalance: BN;
  try {
    const balResp = await connection.getTokenAccountBalance(userFlpAccount);
    flpBalance = new BN(balResp.value.amount);
  } catch {
    throw new Error("No FLP.1 tokens found in your wallet.");
  }
  if (flpBalance.isZero()) throw new Error("Your FLP.1 balance is zero.");

  // migrateFlp: FLP.1 (wallet) → sFLP.1 (stake PDA). Single instruction.
  const result = await client.migrateFlp(flpBalance, flpMint, pc);

  return { instructions: result.instructions, additionalSigners: result.additionalSigners, poolConfig: pc };
}
