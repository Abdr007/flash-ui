import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logInfo, logError } from "@/lib/logger";
import { getClientIp, RateLimiter, rateLimitResponse, readBoundedBody, isValidSolanaAddress } from "@/lib/api-security";

const TokenPricesBody = z.object({ wallet: z.string().min(32).max(50) });

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

// Cache per wallet for 8s
const cache = new Map<string, { data: WalletTokens; ts: number }>();
const CACHE_TTL = 8_000;
const MAX_BODY_BYTES = 2_000;

// Rate limit: 30 req/min per IP
const limiter = new RateLimiter(30);

interface TokenBalance {
  symbol: string;
  mint: string;
  amount: number;
  pricePerToken: number;
  usdValue: number;
  logoUri?: string;
}

interface WalletTokens {
  solBalance: number;
  solUsd: number;
  tokens: TokenBalance[];
  totalUsd: number;
  // Staked FAF balance (Flash's own staking program) — included in totalUsd
  stakedFaf: number;
  stakedFafUsd: number;
}

const FAF_MINT = "FAFxVxnkzZHMCodkWyoccgUNgVScqMw2mhhQBYDFjFAF";

export async function POST(req: NextRequest) {
  // ---- Rate Limit ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  // ---- Body Size Limit (real read, not header-only) ----
  const bodyText = await readBoundedBody(req, MAX_BODY_BYTES);
  if (bodyText instanceof NextResponse) return bodyText;

  const start = Date.now();
  try {
    const body = JSON.parse(bodyText);
    let wallet: string;
    try {
      ({ wallet } = TokenPricesBody.parse(body));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
      }
      throw err;
    }
    if (!isValidSolanaAddress(wallet)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }
    logInfo("cache_miss", { wallet, data: { action: "fetch_start" } });

    // Check cache
    const cached = cache.get(wallet);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    // Helius DAS API — returns ALL tokens with prices in one call
    const resp = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "searchAssets",
        params: {
          ownerAddress: wallet,
          tokenType: "fungible",
          displayOptions: { showNativeBalance: true },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `RPC ${resp.status}` }, { status: 502 });
    }

    const data = await resp.json();
    const result = data.result ?? {};

    // Native SOL
    const native = result.nativeBalance ?? {};
    const solLamports = Number(native.lamports ?? 0);
    const solPrice = Number(native.price_per_sol ?? 0);
    const solBalance = solLamports / 1e9;
    let solUsd = solBalance * solPrice;

    // SPL tokens
    const tokens: TokenBalance[] = [];
    let totalUsd = solUsd;

    // Collect all mints first for Jupiter price lookup
    const unpricedMints: string[] = [];

    for (const item of result.items ?? []) {
      const info = item.token_info ?? {};
      const rawSymbol = info.symbol || item.content?.metadata?.symbol || item.content?.metadata?.name || "";
      const symbol = rawSymbol ? String(rawSymbol) : item.id ? String(item.id).slice(0, 6) + "…" : "???";
      const mint = String(item.id ?? "");
      const balance = Number(info.balance ?? 0);
      const decimals = Number(info.decimals ?? 0);
      const pricePerToken = Number(info.price_info?.price_per_token ?? 0);
      const amount = decimals > 0 ? balance / Math.pow(10, decimals) : balance;
      const usdValue = amount * pricePerToken;
      const logoUri = String(
        item.content?.links?.image ||
          item.content?.files?.[0]?.cdn_uri ||
          item.content?.files?.[0]?.uri ||
          info.image_uri ||
          "",
      );

      if (amount > 0) {
        tokens.push({ symbol, mint, amount, pricePerToken, usdValue, logoUri: logoUri || undefined });
        totalUsd += usdValue;
        // Track tokens without prices for Jupiter fallback
        if (pricePerToken === 0 && mint) unpricedMints.push(mint);
      }
    }

    // ---- Fetch staked FAF balance in parallel ----
    // Jupiter Portfolio shows wallet + staked FAF in the same total; match it.
    let stakedFaf = 0;
    let stakedFafUsd = 0;
    const stakedFafPromise = (async () => {
      try {
        const { Connection, PublicKey, Keypair } = await import("@solana/web3.js");
        const { getFafStakeInfo } = await import("@/lib/faf-sdk");
        const conn = new Connection(RPC_URL, { commitment: "confirmed" });
        const pubkey = new PublicKey(wallet);
        const kp = Keypair.generate();
        const dummyWallet = {
          publicKey: pubkey,
          signTransaction: async (tx: unknown) => tx,
          signAllTransactions: async (txs: unknown[]) => txs,
          payer: kp,
        } as unknown as import("@coral-xyz/anchor").Wallet;
        const info = await getFafStakeInfo(conn, dummyWallet, pubkey);
        stakedFaf = info?.stakedAmount ?? 0;
      } catch {
        // FAF stake unavailable — continue without it
      }
    })();

    // Re-price ALL tokens via Jupiter lite-api v3.
    //
    // Prior code used api.jup.ag/price/v2 which has been silently deprecated
    // and now returns empty data, causing FAF, FLP.1, and other long-tail
    // tokens to stay at usdValue=0 — which then got filtered out downstream,
    // making the Terminal's total balance ~$15 lower than Jupiter's. v3
    // returns { [mint]: { usdPrice, decimals, liquidity, priceChange24h } }
    // and works for any indexed SPL token including Flash's FAF and FLP mints.
    {
      const allMints = tokens.map((t) => t.mint).filter(Boolean);
      const solMint = "So11111111111111111111111111111111111111112";
      // Always include FAF mint so we can price staked FAF too
      const mintIds = Array.from(new Set([solMint, FAF_MINT, ...allMints])).join(",");
      try {
        const jupResp = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mintIds}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (jupResp.ok) {
          const jupPrices = (await jupResp.json()) as Record<string, { usdPrice?: number }>;
          // Re-price SOL
          const solUsdPrice = Number(jupPrices[solMint]?.usdPrice ?? 0);
          if (solUsdPrice > 0) {
            const diff = solBalance * solUsdPrice - solUsd;
            solUsd = solBalance * solUsdPrice;
            totalUsd += diff;
          }
          // Re-price every SPL token with Jupiter prices
          for (const t of tokens) {
            const usdPrice = Number(jupPrices[t.mint]?.usdPrice ?? 0);
            if (t.mint && usdPrice > 0) {
              const oldUsd = t.usdValue;
              t.pricePerToken = usdPrice;
              t.usdValue = t.amount * usdPrice;
              totalUsd += t.usdValue - oldUsd;
            }
          }
          // Wait for FAF stake info and price it with Jupiter FAF price
          await stakedFafPromise;
          const fafPrice = Number(jupPrices[FAF_MINT]?.usdPrice ?? 0);
          if (stakedFaf > 0 && fafPrice > 0) {
            stakedFafUsd = stakedFaf * fafPrice;
            totalUsd += stakedFafUsd;
          }
        }
      } catch {
        // Jupiter unavailable — continue with Helius prices
        await stakedFafPromise; // still await to avoid unhandled promise
      }
    }

    // Sort by USD value descending
    tokens.sort((a, b) => b.usdValue - a.usdValue);

    const walletTokens: WalletTokens = { solBalance, solUsd, tokens, totalUsd, stakedFaf, stakedFafUsd };

    cache.set(wallet, { data: walletTokens, ts: Date.now() });
    // Bound cache size
    if (cache.size > 50) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }

    logInfo("cache_miss", {
      wallet,
      data: {
        action: "fetch_ok",
        tokens: tokens.length,
        total_usd: Math.round(totalUsd * 100) / 100,
        latency_ms: Date.now() - start,
      },
    });
    return NextResponse.json(walletTokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    logError("cache_miss", { error: msg, data: { latency_ms: Date.now() - start } });
    return NextResponse.json({ error: "Failed to fetch token prices" }, { status: 500 });
  }
}
