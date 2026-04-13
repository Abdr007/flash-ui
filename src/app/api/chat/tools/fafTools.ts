// ============================================
// Flash AI — FAF Staking Tools
// ============================================
// AI tools for FAF staking operations.
// Calls faf-sdk DIRECTLY (no HTTP self-fetch).
// Works on Vercel serverless — no localhost dependency.

import { z } from "zod";
import { tool } from "ai";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import type { Wallet } from "@coral-xyz/anchor";
import type { ToolResponse } from "./shared";
import { runReadGuards, runTradeGuards, logToolCall, logToolResult } from "./shared";

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

function makeRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeDummyWallet(pubkey: PublicKey): Wallet {
  const kp = Keypair.generate();
  return {
    publicKey: pubkey,
    signTransaction: async (tx: unknown) => tx,
    signAllTransactions: async (txs: unknown[]) => txs,
    payer: kp,
  } as unknown as Wallet;
}

function isValidPubkey(addr: string): boolean {
  try {
    new PublicKey(addr);
    return addr.length >= 32;
  } catch {
    return false;
  }
}

// ---- faf_dashboard ----

export function createFafDashboardTool(wallet: string) {
  return tool({
    description:
      "Show FAF staking dashboard: staked amount, pending rewards (FAF + USDC), " +
      "VIP tier, fee discount, unstake requests, and progress to next tier. " +
      "Call when user says 'faf', 'faf status', 'staking dashboard', or asks about their FAF stake.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId("faf_dash");
      const start = Date.now();
      logToolCall("faf_dashboard", requestId, wallet);

      const guardErr = runReadGuards(requestId, wallet);
      if (guardErr) return guardErr;

      if (!isValidPubkey(wallet)) {
        return {
          status: "error",
          data: null,
          error: "Connect your wallet to view FAF staking.",
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      try {
        const { getFafStakeInfo } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const dummyWallet = makeDummyWallet(pubkey);

        const info = await getFafStakeInfo(conn, dummyWallet, pubkey);

        if (!info) {
          return {
            status: "success",
            data: {
              type: "faf_dashboard",
              hasAccount: false,
              message: "No FAF stake found. Stake FAF to start earning rewards and fee discounts.",
            },
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        logToolResult("faf_dashboard", requestId, wallet, Date.now() - start, "success");
        return {
          status: "success",
          data: { type: "faf_dashboard", hasAccount: true, ...info },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load FAF data";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ---- faf_stake ----

export function createFafStakeTool(wallet: string) {
  return tool({
    description:
      "Preview STAKING (depositing) FAF tokens. Shows amount, estimated tier change, and fee discount. " +
      "User must confirm before execution. Call ONLY when user wants to STAKE/DEPOSIT — NOT for unstake/withdraw. " +
      "Trigger: 'faf stake <amount>', 'stake 10 faf', 'i want to stake'.",
    inputSchema: z
      .object({
        amount: z.number().positive().describe("Amount of FAF to stake"),
      })
      .strict(),
    execute: async ({ amount }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId("faf_stake");
      const start = Date.now();
      logToolCall("faf_stake", requestId, wallet, { amount });

      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr;

      if (!Number.isFinite(amount) || amount <= 0) {
        return {
          status: "error",
          data: null,
          error: "Amount must be positive.",
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      try {
        const { getFafStakeInfo, getVipTier, FAF_MINT, FAF_DECIMALS } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const dummyWallet = makeDummyWallet(pubkey);

        // Check FAF balance — matches CLI faf-data.ts:getFafBalance() exactly
        let fafBalance = 0;
        try {
          const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
          const accounts = await conn.getTokenAccountsByOwner(pubkey, {
            mint: FAF_MINT,
            programId: TOKEN_PROGRAM_ID,
          });
          if (accounts.value.length > 0) {
            const data = accounts.value[0].account.data;
            const rawAmount = data.readBigUInt64LE(64);
            fafBalance = Number(rawAmount) / Math.pow(10, FAF_DECIMALS);
          }
        } catch {
          // No FAF token account = 0 balance
        }

        if (fafBalance < amount) {
          return {
            status: "error",
            data: null,
            error:
              fafBalance === 0
                ? "You don't have any FAF tokens in your wallet. Buy FAF first to start staking."
                : `Insufficient FAF balance. You have ${fafBalance.toFixed(2)} FAF but want to stake ${amount}.`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        const info = await getFafStakeInfo(conn, dummyWallet, pubkey);
        const currentStake = info?.stakedAmount ?? 0;
        const currentTier = info?.tierName ?? "None";
        const newTier = getVipTier(currentStake + amount);

        logToolResult("faf_stake", requestId, wallet, Date.now() - start, "success");
        return {
          status: "success",
          data: {
            type: "faf_stake_preview",
            amount,
            currentStake,
            newStake: currentStake + amount,
            currentTier,
            newTier: newTier.name,
            newFeeDiscount: newTier.feeDiscount,
            tierChanged: currentTier !== newTier.name,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build stake preview";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ---- faf_unstake ----

export function createFafUnstakeTool(wallet: string) {
  return tool({
    description:
      "Preview UNSTAKING (withdrawing) FAF tokens. Warns about 90-day lock period. " +
      "Call when user wants to UNSTAKE/WITHDRAW/REMOVE staked FAF — NOT for staking/depositing. " +
      "Trigger: 'faf unstake <amount>', 'unstake 10 faf', 'i want to unstake', 'withdraw faf'.",
    inputSchema: z
      .object({
        amount: z.number().positive().describe("Amount of FAF to unstake"),
      })
      .strict(),
    execute: async ({ amount }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId("faf_unstake");
      const start = Date.now();
      logToolCall("faf_unstake", requestId, wallet, { amount });

      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr;

      try {
        const { getFafStakeInfo, getVipTier } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const dummyWallet = makeDummyWallet(pubkey);

        const info = await getFafStakeInfo(conn, dummyWallet, pubkey);
        const currentStake = info?.stakedAmount ?? 0;

        if (amount > currentStake) {
          return {
            status: "error",
            data: null,
            error: `Cannot unstake ${amount} FAF. You only have ${currentStake} FAF staked.`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        const newTier = getVipTier(currentStake - amount);
        const unlockDate = new Date(Date.now() + 90 * 24 * 3600 * 1000);

        return {
          status: "success",
          data: {
            type: "faf_unstake_preview",
            amount,
            currentStake,
            remainingStake: currentStake - amount,
            newTier: newTier.name,
            newFeeDiscount: newTier.feeDiscount,
            unlockDate: unlockDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
            lockDays: 90,
            warning: "Unstaked FAF will be locked for 90 days. You can cancel during this period to re-stake.",
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build unstake preview";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ---- faf_claim ----

export function createFafClaimTool(wallet: string) {
  return tool({
    description:
      "Claim FAF staking rewards and/or USDC revenue. " +
      "Call when user says 'faf claim', 'claim rewards', 'claim revenue'.",
    inputSchema: z
      .object({
        claim_type: z.enum(["all", "rewards", "revenue"]).optional().describe("What to claim"),
      })
      .strict(),
    execute: async ({ claim_type }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId("faf_claim");
      const start = Date.now();
      logToolCall("faf_claim", requestId, wallet, { claim_type });

      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr;

      try {
        const { getFafStakeInfo } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const dummyWallet = makeDummyWallet(pubkey);

        const info = await getFafStakeInfo(conn, dummyWallet, pubkey);
        if (!info) {
          return {
            status: "error",
            data: null,
            error: "No FAF stake account found.",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        const type = claim_type ?? "all";
        const fafRewards = info.pendingRewardsFaf ?? 0;
        const usdcRevenue = info.pendingRevenueUsdc ?? 0;

        if (type === "rewards" && fafRewards <= 0)
          return {
            status: "error",
            data: null,
            error: "No FAF rewards to claim.",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        if (type === "revenue" && usdcRevenue <= 0)
          return {
            status: "error",
            data: null,
            error: "No USDC revenue to claim.",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        if (type === "all" && fafRewards <= 0 && usdcRevenue <= 0)
          return {
            status: "error",
            data: null,
            error: "No rewards or revenue to claim.",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };

        return {
          status: "success",
          data: {
            type: "faf_claim_preview",
            claim_type: type,
            fafRewards: type === "revenue" ? 0 : fafRewards,
            usdcRevenue: type === "rewards" ? 0 : usdcRevenue,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ---- faf_requests ----

export function createFafRequestsTool(wallet: string) {
  return tool({
    description:
      "Show pending unstake requests with progress bars and countdown timers. " +
      "Call when user says 'faf requests', 'faf pending', or asks about unstake status.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId("faf_req");
      const start = Date.now();
      logToolCall("faf_requests", requestId, wallet);

      const guardErr = runReadGuards(requestId, wallet);
      if (guardErr) return guardErr;

      try {
        const { getFafUnstakeRequests } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const dummyWallet = makeDummyWallet(pubkey);

        const requests = await getFafUnstakeRequests(conn, dummyWallet, pubkey);

        return {
          status: "success",
          data: { type: "faf_requests", requests },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ---- faf_cancel_unstake ----

export function createFafCancelUnstakeTool(wallet: string) {
  return tool({
    description:
      "Cancel a pending unstake request by index. Returns staked FAF to active stake. " +
      "Call when user says 'faf cancel <index>'.",
    inputSchema: z
      .object({
        index: z.number().int().min(0).describe("Request index (0-based)"),
      })
      .strict(),
    execute: async ({ index }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId("faf_cancel");
      const start = Date.now();
      logToolCall("faf_cancel", requestId, wallet, { index });

      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr;

      try {
        const { getFafUnstakeRequests } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const dummyWallet = makeDummyWallet(pubkey);

        const requests = await getFafUnstakeRequests(conn, dummyWallet, pubkey);

        if (index >= requests.length) {
          return {
            status: "error",
            data: null,
            error: `Request #${index} not found. You have ${requests.length} pending request(s).`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        const target = requests[index];

        return {
          status: "success",
          data: {
            type: "faf_cancel_preview",
            index,
            amount: target.lockedAmount + target.withdrawableAmount,
            progressPercent: target.progressPercent,
            timeRemainingSeconds: target.timeRemainingSeconds,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ---- faf_tier ----

export function createFafTierTool(wallet: string) {
  return tool({
    description:
      "Show VIP tier details: current tier, benefits, requirements for next tier. " +
      "Call when user says 'faf tier', 'faf tiers', 'vip tier'.",
    inputSchema: z.object({}),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId("faf_tier");
      const start = Date.now();
      logToolCall("faf_tier", requestId, wallet);

      const guardErr = runReadGuards(requestId, wallet);
      if (guardErr) return guardErr;

      try {
        const { VIP_TIERS, getFafStakeInfo } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const dummyWallet = makeDummyWallet(pubkey);

        const info = await getFafStakeInfo(conn, dummyWallet, pubkey);
        const stakedAmount = info?.stakedAmount ?? 0;
        const currentLevel = info?.level ?? 0;

        return {
          status: "success",
          data: {
            type: "faf_tiers",
            currentLevel,
            stakedAmount,
            tiers: VIP_TIERS,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}
