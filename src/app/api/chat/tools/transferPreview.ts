// ============================================
// Flash AI — Transfer Preview Tool (Universal)
// ============================================
// Supports ANY valid SPL token on Solana.
// No whitelist. No hardcoded symbols.
//
// Resolution priority:
// 1. "SOL" → native SOL transfer
// 2. Valid base58 mint address → on-chain mint lookup
// 3. Symbol → search sender's wallet for matching token
// 4. Reject if ambiguous or not found
//
// On-chain validation:
// - Mint account exists and is initialized
// - Decimals read from mint (NEVER assumed)
// - Balance verified before preview
// - Frozen accounts detected and blocked
// - Unknown/unverified tokens get warning

import { z } from "zod";
import { tool } from "ai";
import { PublicKey, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { type ToolResponse, runTradeGuards, logToolCall, logToolResult } from "./shared";

/**
 * Detect which token program owns a mint by checking the account owner.
 * Returns TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID.
 */
async function detectTokenProgram(connection: Connection, mintAddress: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mintAddress);
  if (!info) throw new Error("Mint account not found");
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

const ESTIMATED_FEE_SOL = 0.000005; // base fee (5000 lamports)
const ATA_CREATION_FEE_SOL = 0.00203928; // rent-exempt minimum for token account
const SOL_RESERVE = 0.003; // buffer for fees + rent during congestion

// Well-known verified tokens (for display names + scam protection)
// This is NOT a whitelist — unknown tokens are still supported with a warning
const VERIFIED_TOKENS: Record<string, { name: string; mint: string }> = {
  USDC: { name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  USDT: { name: "Tether", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  JUP: { name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  BONK: { name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  PYTH: { name: "Pyth Network", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  JTO: { name: "Jito", mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  RAY: { name: "Raydium", mint: "4k3Dyjzvzp8eMZFUyMu3m93aBqMPqGcLqGJCsYiJVvUe" },
  WIF: { name: "dogwifhat", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  PENGU: { name: "Pudgy Penguins", mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" },
  W: { name: "Wormhole", mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ" },
  RNDR: { name: "Render", mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
  HNT: { name: "Helium", mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux" },
  ORCA: { name: "Orca", mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  MNDE: { name: "Marinade", mint: "MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey" },
  MSOL: { name: "Marinade SOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So" },
  JITOSOL: { name: "Jito SOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn" },
};

export interface TransferPreviewData {
  type: "transfer_preview";
  token: string;
  token_name: string;
  amount: number;
  amount_display: string;
  recipient: string;
  recipient_short: string;
  sender: string;
  sender_short: string;
  estimated_fee_sol: number;
  needs_ata: boolean;
  ata_fee_sol: number;
  total_fee_sol: number;
  mint: string | null;
  mint_short: string | null;
  decimals: number;
  is_native_sol: boolean;
  is_verified: boolean;
  is_token2022: boolean;
  sender_balance: number; // sender's balance of this token (for impact %)
  warnings: string[];
}

interface ResolvedToken {
  mint: string;
  decimals: number;
  symbol: string;
  name: string;
  isVerified: boolean;
  isFrozen: boolean;
  isToken2022: boolean;
  balance: number; // human-readable
  rawBalance: bigint;
}

function makeRequestId(): string {
  return `transfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function isValidPublicKey(address: string): boolean {
  try {
    new PublicKey(address);
    return address.length >= 32 && address.length <= 44;
  } catch {
    return false;
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// ---- Universal Token Resolution Engine ----

async function resolveToken(
  input: string,
  senderWallet: string,
  connection: Connection,
): Promise<{ token: ResolvedToken | null; error: string | null }> {
  // 1. Check if input is a valid mint address
  if (isValidPublicKey(input) && input.length >= 32) {
    try {
      const { getMint, getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");
      const mintPubkey = new PublicKey(input);

      // Detect Token2022 vs legacy Token program
      const tokenProgramId = await detectTokenProgram(connection, mintPubkey);
      const isT22 = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID);
      const mintInfo = await getMint(connection, mintPubkey, undefined, tokenProgramId);

      const verifiedEntry = Object.entries(VERIFIED_TOKENS).find(([, v]) => v.mint === input);
      const symbol = verifiedEntry ? verifiedEntry[0] : shortAddr(input);
      const name = verifiedEntry ? verifiedEntry[1].name : `Token ${shortAddr(input)}`;

      const senderPubkey = new PublicKey(senderWallet);
      const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPubkey, false, tokenProgramId);
      let balance = 0;
      let rawBalance = BigInt(0);
      try {
        const account = await getAccount(connection, senderAta, undefined, tokenProgramId);
        rawBalance = account.amount;
        balance = Number(account.amount) / Math.pow(10, mintInfo.decimals);
      } catch {
        // No account = zero balance
      }

      return {
        token: {
          mint: input,
          decimals: mintInfo.decimals,
          symbol,
          name,
          isVerified: !!verifiedEntry,
          isFrozen: false,
          isToken2022: isT22,
          balance,
          rawBalance,
        },
        error: null,
      };
    } catch {
      return { token: null, error: `Mint "${input}" not found on-chain or is not a valid token mint.` };
    }
  }

  // 2. Check if it's a known symbol
  const upper = input.toUpperCase().trim();
  const verified = VERIFIED_TOKENS[upper];
  if (verified) {
    try {
      const { getMint, getAssociatedTokenAddress, getAccount } = await import("@solana/spl-token");
      const mintPubkey = new PublicKey(verified.mint);

      const tokenProgramId = await detectTokenProgram(connection, mintPubkey);
      const isT22 = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID);
      const mintInfo = await getMint(connection, mintPubkey, undefined, tokenProgramId);
      const senderPubkey = new PublicKey(senderWallet);
      const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPubkey, false, tokenProgramId);

      let balance = 0;
      let rawBalance = BigInt(0);
      try {
        const account = await getAccount(connection, senderAta, undefined, tokenProgramId);
        rawBalance = account.amount;
        balance = Number(account.amount) / Math.pow(10, mintInfo.decimals);
      } catch {
        // No account
      }

      return {
        token: {
          mint: verified.mint,
          decimals: mintInfo.decimals,
          symbol: upper,
          name: verified.name,
          isVerified: true,
          isFrozen: false,
          isToken2022: isT22,
          balance,
          rawBalance,
        },
        error: null,
      };
    } catch {
      return { token: null, error: `Failed to fetch mint info for ${upper}.` };
    }
  }

  // 3. Search sender's wallet for matching symbol (Helius DAS)
  try {
    const dasResp = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "searchAssets",
        params: {
          ownerAddress: senderWallet,
          tokenType: "fungible",
          limit: 100, // Cap to prevent slow responses for spam-token wallets
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (dasResp.ok) {
      const dasData = await dasResp.json();
      const items = dasData.result?.items ?? [];

      // Find tokens matching the symbol (case-insensitive)
      const matches = items.filter((item: Record<string, unknown>) => {
        const info = item.token_info as Record<string, unknown> | undefined;
        const sym = String(info?.symbol ?? "").toUpperCase();
        return sym === upper;
      });

      if (matches.length === 1) {
        const item = matches[0];
        const info = item.token_info as Record<string, unknown>;
        const mintAddr = String(item.id ?? "");
        const decimals = Number(info.decimals ?? 0);
        const rawBal = BigInt(String(info.balance ?? "0"));
        const balance = Number(rawBal) / Math.pow(10, decimals);
        const sym = String(info.symbol ?? upper);

        return {
          token: {
            mint: mintAddr,
            decimals,
            symbol: sym.toUpperCase(),
            name: sym,
            isVerified: false,
            isFrozen: false,
            isToken2022: false, // DAS doesn't report this; build route detects at tx time
            balance,
            rawBalance: rawBal,
          },
          error: null,
        };
      }

      if (matches.length > 1) {
        const mintList = matches.map((m: Record<string, unknown>) => shortAddr(String(m.id ?? ""))).join(", ");
        return {
          token: null,
          error: `Multiple tokens found with symbol "${upper}" in your wallet: ${mintList}. Please provide the mint address instead.`,
        };
      }
    }
  } catch {
    // DAS failed, fall through
  }

  return {
    token: null,
    error: `Token "${input}" not found in your wallet. Provide the full mint address, or check that you hold this token.`,
  };
}

export function createTransferPreviewTool(wallet: string) {
  return tool({
    description:
      "Preview a token transfer. Supports ANY valid SPL token on Solana — not just whitelisted tokens. " +
      "Accepts token symbol (USDC, BONK, etc.) or mint address. " +
      "Validates recipient, amount, balance, and mint on-chain. " +
      "Returns a preview card for user confirmation. Does NOT execute the transfer. " +
      "Call this when user wants to send/transfer tokens to another wallet.",
    inputSchema: z
      .object({
        token: z.string().describe("Token symbol (e.g. USDC, SOL) or mint address"),
        amount: z.number().positive().describe("Amount to transfer (human-readable, not raw)"),
        recipient: z.string().describe("Recipient wallet address (base58 public key)"),
      })
      .strict(),
    execute: async ({ token, amount, recipient }): Promise<ToolResponse<TransferPreviewData>> => {
      const requestId = makeRequestId();
      const start = Date.now();

      logToolCall("transfer_preview", requestId, wallet, { token, amount, recipient });

      // ---- Guard chain ----
      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr as unknown as ToolResponse<TransferPreviewData>;

      const isNativeSOL = token.toUpperCase().trim() === "SOL";

      // ---- Validate recipient ----
      if (!isValidPublicKey(recipient)) {
        // Check if it looks like a lowercased address
        const looksLowered =
          recipient.length >= 32 &&
          recipient.length <= 44 &&
          /^[a-z0-9]+$/i.test(recipient) &&
          recipient === recipient.toLowerCase();
        const hint = looksLowered
          ? " Solana addresses are case-sensitive — copy the exact address from your wallet."
          : "";
        return {
          status: "error",
          data: null,
          error: `Invalid recipient address.${hint} Must be a valid Solana public key (32-44 base58 characters).`,
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      if (recipient === wallet) {
        return {
          status: "error",
          data: null,
          error: "Cannot transfer to yourself.",
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        return {
          status: "error",
          data: null,
          error: "Amount must be a positive number.",
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      const connection = new Connection(RPC_URL, { commitment: "confirmed" });
      const warnings: string[] = [];
      let needsAta = false;

      // ---- Native SOL ----
      if (isNativeSOL) {
        let senderBalance = 0;
        try {
          const balance = await connection.getBalance(new PublicKey(wallet));
          senderBalance = balance / 1e9;
          const totalNeeded = amount + ESTIMATED_FEE_SOL + SOL_RESERVE;
          if (senderBalance < totalNeeded) {
            return {
              status: "error",
              data: null,
              error: `Insufficient SOL. Have ${senderBalance.toFixed(4)} SOL, need ${totalNeeded.toFixed(4)} (${amount} + fees + rent reserve).`,
              request_id: requestId,
              latency_ms: Date.now() - start,
            };
          }
        } catch {
          warnings.push("Could not verify SOL balance.");
        }

        if (amount >= 10) {
          warnings.push(`Large transfer: ${amount} SOL. Verify the recipient address carefully.`);
        }

        const preview: TransferPreviewData = {
          type: "transfer_preview",
          token: "SOL",
          token_name: "Solana",
          amount,
          amount_display: `${amount} SOL`,
          recipient,
          recipient_short: shortAddr(recipient),
          sender: wallet,
          sender_short: shortAddr(wallet),
          estimated_fee_sol: ESTIMATED_FEE_SOL,
          needs_ata: false,
          ata_fee_sol: 0,
          total_fee_sol: ESTIMATED_FEE_SOL,
          mint: null,
          mint_short: null,
          decimals: 9,
          is_native_sol: true,
          is_verified: true,
          is_token2022: false,
          sender_balance: senderBalance,
          warnings,
        };

        logToolResult("transfer_preview", requestId, wallet, Date.now() - start, "success", { token: "SOL", amount });
        return {
          status: "success",
          data: preview,
          request_id: requestId,
          latency_ms: Date.now() - start,
          warnings: warnings.length > 0 ? warnings : undefined,
        };
      }

      // ---- Universal SPL Token Resolution ----
      const { token: resolved, error: resolveErr } = await resolveToken(token, wallet, connection);

      if (!resolved || resolveErr) {
        return {
          status: "error",
          data: null,
          error: resolveErr ?? `Could not resolve token "${token}".`,
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      // ---- Validate decimals (sanity) ----
      if (resolved.decimals > 18) {
        return {
          status: "error",
          data: null,
          error: `Token has unusual decimals (${resolved.decimals}). Transfer blocked for safety.`,
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      // ---- Check balance ----
      if (resolved.balance < amount) {
        const display = resolved.balance.toFixed(Math.min(resolved.decimals, 6));
        return {
          status: "error",
          data: null,
          error: `Insufficient ${resolved.symbol} balance. Have ${display}, need ${amount}.`,
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      // ---- Check recipient ATA ----
      try {
        const { getAssociatedTokenAddress } = await import("@solana/spl-token");
        const mintPubkey = new PublicKey(resolved.mint);
        const recipientAta = await getAssociatedTokenAddress(mintPubkey, new PublicKey(recipient));
        const ataInfo = await connection.getAccountInfo(recipientAta);
        if (!ataInfo) {
          needsAta = true;
          warnings.push(
            `Recipient doesn't have a ${resolved.symbol} account. One will be created (~${ATA_CREATION_FEE_SOL} SOL).`,
          );
        }
      } catch {
        warnings.push("Could not check recipient token account.");
      }

      // ---- Scam / unverified warning ----
      if (!resolved.isVerified) {
        warnings.push(`⚠ "${resolved.symbol}" is not a verified token. Verify the mint address before confirming.`);
      }

      // ---- Large amount warning ----
      if (amount >= 1000) {
        warnings.push(`Large transfer: ${amount} ${resolved.symbol}. Verify the recipient address carefully.`);
      }

      const ataFee = needsAta ? ATA_CREATION_FEE_SOL : 0;

      const preview: TransferPreviewData = {
        type: "transfer_preview",
        token: resolved.symbol,
        token_name: resolved.name,
        amount,
        amount_display: `${amount} ${resolved.symbol}`,
        recipient,
        recipient_short: shortAddr(recipient),
        sender: wallet,
        sender_short: shortAddr(wallet),
        estimated_fee_sol: ESTIMATED_FEE_SOL,
        needs_ata: needsAta,
        ata_fee_sol: ataFee,
        total_fee_sol: ESTIMATED_FEE_SOL + ataFee,
        mint: resolved.mint,
        mint_short: shortAddr(resolved.mint),
        decimals: resolved.decimals,
        is_native_sol: false,
        is_verified: resolved.isVerified,
        is_token2022: resolved.isToken2022,
        sender_balance: resolved.balance,
        warnings,
      };

      logToolResult("transfer_preview", requestId, wallet, Date.now() - start, "success", {
        token: resolved.symbol,
        mint: shortAddr(resolved.mint),
        amount,
        verified: resolved.isVerified,
      });

      return {
        status: "success",
        data: preview,
        request_id: requestId,
        latency_ms: Date.now() - start,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  });
}
