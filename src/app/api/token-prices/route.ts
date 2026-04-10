import { NextRequest, NextResponse } from "next/server";
import { logInfo, logError } from "@/lib/logger";

const RPC_URL = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";

// Cache per wallet for 15s
const cache = new Map<string, { data: WalletTokens; ts: number }>();
const CACHE_TTL = 8_000;

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
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  try {
    const { wallet } = await req.json();
    if (!wallet) return NextResponse.json({ error: "No wallet" }, { status: 400 });
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
      const symbol = String(info.symbol ?? "???");
      const mint = String(item.id ?? "");
      const balance = Number(info.balance ?? 0);
      const decimals = Number(info.decimals ?? 0);
      const pricePerToken = Number(info.price_info?.price_per_token ?? 0);
      const amount = decimals > 0 ? balance / Math.pow(10, decimals) : balance;
      const usdValue = amount * pricePerToken;
      const logoUri = String(
        item.content?.links?.image
        || item.content?.files?.[0]?.cdn_uri
        || item.content?.files?.[0]?.uri
        || info.image_uri
        || ""
      );

      if (amount > 0) {
        tokens.push({ symbol, mint, amount, pricePerToken, usdValue, logoUri: logoUri || undefined });
        totalUsd += usdValue;
        // Track tokens without prices for Jupiter fallback
        if (pricePerToken === 0 && mint) unpricedMints.push(mint);
      }
    }

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
      const mintIds = [solMint, ...allMints].join(",");
      try {
        const jupResp = await fetch(
          `https://lite-api.jup.ag/price/v3?ids=${mintIds}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (jupResp.ok) {
          const jupPrices = (await jupResp.json()) as Record<string, { usdPrice?: number }>;
          // Re-price SOL
          const solUsdPrice = Number(jupPrices[solMint]?.usdPrice ?? 0);
          if (solUsdPrice > 0) {
            const diff = (solBalance * solUsdPrice) - solUsd;
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
              totalUsd += (t.usdValue - oldUsd);
            }
          }
        }
      } catch {
        // Jupiter unavailable — continue with Helius prices
      }
    }

    // Sort by USD value descending
    tokens.sort((a, b) => b.usdValue - a.usdValue);

    const walletTokens: WalletTokens = { solBalance, solUsd, tokens, totalUsd };

    cache.set(wallet, { data: walletTokens, ts: Date.now() });
    // Bound cache size
    if (cache.size > 50) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }

    logInfo("cache_miss", {
      wallet,
      data: { action: "fetch_ok", tokens: tokens.length, total_usd: Math.round(totalUsd * 100) / 100, latency_ms: Date.now() - start },
    });
    return NextResponse.json(walletTokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    logError("cache_miss", { error: msg, data: { latency_ms: Date.now() - start } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
