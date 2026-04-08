import { NextRequest, NextResponse } from "next/server";

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
  try {
    const { wallet } = await req.json();
    if (!wallet) return NextResponse.json({ error: "No wallet" }, { status: 400 });

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
    const solUsd = solBalance * solPrice;

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

    // Re-price ALL tokens via Jupiter (same price source as Galileo) for exact balance match
    {
      const allMints = tokens.map((t) => t.mint).filter(Boolean);
      // Also include SOL mint for accurate SOL pricing
      const solMint = "So11111111111111111111111111111111111111112";
      const mintIds = [solMint, ...allMints].join(",");
      try {
        const jupResp = await fetch(
          `https://api.jup.ag/price/v2?ids=${mintIds}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (jupResp.ok) {
          const jupData = await jupResp.json();
          const jupPrices = jupData?.data ?? {};
          // Re-price SOL
          if (jupPrices[solMint]?.price) {
            const jupSolPrice = Number(jupPrices[solMint].price);
            const diff = (solBalance * jupSolPrice) - solUsd;
            solUsd = solBalance * jupSolPrice;
            totalUsd += diff;
          }
          // Re-price all tokens with Jupiter prices
          for (const t of tokens) {
            if (t.mint && jupPrices[t.mint]?.price) {
              const jupPrice = Number(jupPrices[t.mint].price);
              const oldUsd = t.usdValue;
              t.pricePerToken = jupPrice;
              t.usdValue = t.amount * jupPrice;
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

    return NextResponse.json(walletTokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
