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

  const result = await client.addCompoundingLiquidity(
    nativeAmount,
    minOut,
    "USDC",
    pc.compoundingTokenMint,
    pc,
    true, // skipBalanceChecks — ATA may not exist yet
    undefined, // ephemeralSignerPubkey
    wallet.publicKey, // userPublicKey — explicit
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

  // Check compounding FLP balance first
  const flpMint = pc.compoundingTokenMint;
  let flpBalance = await getTokenBal(flpMint);
  let useRawLp = false;
  let unstakeFirst = false;

  // Fallback: check raw LP tokens (sFLP in token account)
  if (flpBalance.isZero()) {
    const rawLpMint = pc.stakedLpTokenMint;
    flpBalance = await getTokenBal(rawLpMint);
    if (!flpBalance.isZero()) {
      useRawLp = true;
    }
  }

  // Fallback: check stake PDA (sFLP staked in Flash protocol)
  if (flpBalance.isZero()) {
    try {
      const { PublicKey: PK } = await import("@solana/web3.js");
      const [stakePda] = PK.findProgramAddressSync(
        [Buffer.from("stake"), wallet.publicKey.toBuffer(), pc.poolAddress.toBuffer()],
        pc.programId,
      );
      const accInfo = await connection.getAccountInfo(stakePda);
      if (accInfo && accInfo.data.length >= 80) {
        const raw = Number(accInfo.data.readBigUInt64LE(72));
        if (raw > 0) {
          flpBalance = new BN(raw);
          unstakeFirst = true;
        }
      }
    } catch {}
    if (flpBalance.isZero()) {
      throw new Error("No FLP or sFLP found. Deposit first.");
    }
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

  // Build transaction
  let allInstructions: TransactionInstruction[] = [];
  let allSigners: Signer[] = [];

  if (unstakeFirst) {
    // User has sFLP.1 in stake PDA. Use migrateStake to convert to FLP.1 in wallet,
    // then user withdraws FLP.1 → USDC in a second step.
    const migrateResult = await client.migrateStake(withdrawAmount, flpMint, pc, true);
    allInstructions = migrateResult.instructions;
    allSigners = migrateResult.additionalSigners;
  } else if (useRawLp) {
    const result = await client.removeLiquidity("USDC", withdrawAmount, minOut, pc, true, true);
    allInstructions = result.instructions;
    allSigners = result.additionalSigners;
  } else {
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
    allInstructions = result.instructions;
    allSigners = result.additionalSigners;
  }

  return {
    instructions: allInstructions,
    additionalSigners: allSigners,
    poolConfig: pc,
  };
}

// ---- Convert FLP.1 → sFLP.1 (visible in wallet) ----
// Two atomic steps in one tx:
// 1. removeCompoundingLiquidity: burn FLP.1 → get USDC
// 2. addLiquidity: deposit USDC → get sFLP.1 in wallet token account
// This gives sFLP.1 as a regular SPL token (visible in Solflare/Phantom),
// NOT locked in a stake PDA like migrateFlp does.

export async function buildFlpToSflp(connection: Connection, wallet: Wallet, poolAlias: string): Promise<EarnTxResult> {
  const poolName = resolvePoolName(poolAlias);
  if (!poolName) throw new Error(`Unknown pool: ${poolAlias}`);

  const pc = getPoolConfig(poolName);
  const client = getClient(connection, wallet, poolName);
  const flpMint = pc.compoundingTokenMint; // FLP.1

  // Get FLP.1 balance
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const userFlpAccount = getAssociatedTokenAddressSync(flpMint, wallet.publicKey, true);

  let flpBalance: BN;
  try {
    const balResp = await connection.getTokenAccountBalance(userFlpAccount);
    flpBalance = new BN(balResp.value.amount);
  } catch {
    throw new Error("No FLP token account found. You may not have any FLP for this pool.");
  }

  if (flpBalance.isZero()) {
    throw new Error("Your FLP balance is zero. Nothing to convert.");
  }

  // Step 1: Burn FLP.1 → get USDC (removeCompoundingLiquidity)
  const removeResult = await client.removeCompoundingLiquidity(
    flpBalance,
    BN_ZERO, // min out = 0 (accept any USDC amount)
    "USDC",
    flpMint,
    pc,
    true, // createUserATA
    undefined,
    wallet.publicKey,
  );

  // Step 2: Deposit USDC → get sFLP.1 in wallet (addLiquidity)
  // We can't know exact USDC amount from step 1 in advance,
  // so we build a separate tx. User will need to click twice.
  // For now, just do step 1 (FLP.1 → USDC), then user deposits USDC → sFLP.1 separately.

  return {
    instructions: removeResult.instructions,
    additionalSigners: removeResult.additionalSigners,
    poolConfig: pc,
  };
}
