<div align="center">

<img src="public/favicon-192.png" alt="Flash Terminal" width="80" />

# Flash Terminal

**AI-Powered Perpetual Trading on Solana**

Chat-first trading terminal built on [Flash Trade](https://flash.trade) protocol.
34 markets, limit orders with TP/SL, on-chain trigger orders, FAF staking, earn yield, instant transfers — all through natural language.

[![CI](https://github.com/Abdr007/flash-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/Abdr007/flash-ui/actions/workflows/ci.yml)

[Live App](https://flash-ui-eight.vercel.app) &bull; [Landing Page](https://flash-ui-eight.vercel.app/landing) &bull; [Flash Trade](https://flash.trade) &bull; [Docs](https://docs.flash.trade)

</div>

---

## How It Works

```
User types: "long SOL 5x $100 tp 200 sl 120"
```

```
Input
  │
  ├─ Fast-Path Parser (4 regex formats, <5ms) ──── 65-75% of requests
  ├─ FAF Patterns (40+ patterns) ────────────────── staking commands
  ├─ Direct Tool Match (30+ patterns) ───────────── prices, positions, orders
  ├─ NLP Parser (confidence threshold 0.8) ──────── complex intents
  ├─ Conversational Intents (wizards) ───────────── guided flows
  └─ AI Fallback (Claude Sonnet 4.6, 26 tools) ─── everything else
```

**Most requests resolve with zero AI inference.** The system is regex-first, AI-fallback.

## Markets

| Category | Markets | Max Leverage |
|----------|---------|-------------|
| **Crypto (Degen)** | SOL, BTC, ETH | 100x / 500x |
| **Crypto** | BNB, JUP, PYTH, RAY, KMNO, HYPE, JTO, MET, ZEC | 10-50x |
| **Meme** | BONK, WIF, PENGU, FARTCOIN, PUMP | 25x |
| **Forex** | EUR, GBP, USDJPY, USDCNH | 500x |
| **Metals** | XAU, XAG, XAUt | 100x |
| **Commodities** | CRUDEOIL, NATGAS | 5-10x |
| **Equities** | SPY, NVDA, TSLA, AAPL, AMD, AMZN, PLTR | 20x |

All 34 markets verified against Flash Trade SDK PoolConfig.

## Features

| Category | Capabilities |
|---|---|
| **Trading** | Long/short any market, 4 input formats, degen mode (500x), TP/SL bundled atomically, limit orders with wizard |
| **Order Management** | View orders, cancel/edit limit orders, trigger orders (TP/SL on existing positions) |
| **Position Management** | Close, partial close (reduce %), reverse/flip, add/remove collateral, "close all" |
| **FAF Staking** | Stake, unstake, claim rewards + revenue + rebates, VIP tiers, cancel unstake |
| **Earn** | 8 pools (Crypto/DeFi/Gold/Meme/WIF/TRUMP/Ore/Equity), deposit, withdraw |
| **Transfers** | SOL + any SPL token, cheapest fees on Solana, address book |
| **Portfolio** | Live PnL with fees, wallet tokens via Helius DAS, liquidation prices |
| **Cross-Tab Safety** | Web Locks API prevents concurrent trades across browser tabs |

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript (strict mode) |
| AI | Claude Sonnet 4.6 + Haiku 4.5 fallback via Vercel AI SDK |
| State | Zustand (3 slices: data, trade, chat) |
| Blockchain | Solana web3.js, Flash SDK, Pyth oracles (SSE streaming) |
| Styling | Tailwind CSS 4, custom glass-card design system |
| Testing | Vitest (231 tests), Playwright E2E |
| CI/CD | GitHub Actions, husky + lint-staged |
| Deployment | Vercel |

## Security

| Layer | Protection |
|---|---|
| **Input** | Zod schemas on every API route, sanitized error messages |
| **Trade Firewall** | Per-market leverage caps, TP/SL direction validation, position conflict detection |
| **Auth** | Wallet signature auth (HMAC-SHA256), timing-safe token verification |
| **Rate Limiting** | Per-IP on all routes, per-wallet tool rate limits |
| **TOCTOU** | Price cross-validation at execution time, volatility circuit breaker |
| **Transaction** | Pre-sign simulation, cross-tab lock, cancel blocked during signing |
| **Data** | No synthetic data, 60s price staleness check, cache bounds on all stores |

## Project Structure

```
src/
  app/
    api/
      chat/              # AI chat route + 26 tools + system prompt
        tools/           # buildTrade, limitOrders, triggerOrders, fafTools, earnPools, etc.
      broadcast/         # Multi-endpoint Solana tx broadcast
      faf/               # FAF staking tx builder
      earn/              # Earn pool data
      transfer/          # Token transfer builder
      health/            # Health check endpoint
    landing/             # Landing page with self-typing terminal demo
    page.tsx             # Main app
  components/
    chat/
      cards/             # 20 card components (TradePreview, Orders, Portfolio, etc.)
      ChatPanel.tsx      # Chat UI with autocomplete + AI SDK
      WizardCard.tsx     # Multi-step guided trade wizard
    portfolio/           # PortfolioHero with spring-animated balance
    earn/                # EarnPage + EarnModal with simulation
  hooks/                 # useExecuteTx, useLivePnl, usePriceStream, useWalletAuth, useSpring
  lib/                   # Core: api, parser, trade-firewall, pnl, cross-tab-lock, certification
  store/                 # Zustand: data-slice, trade-slice, chat-slice
```

## Setup

```bash
npm install
npm run dev          # Development server
npm run build        # Production build
npm test             # 231 unit tests
npm run validate     # Full CI gate (lint + types + test + build)
```

## Environment

```env
# Required
HELIUS_RPC_URL=https://...          # Solana RPC (HTTPS enforced)
ANTHROPIC_API_KEY=sk-ant-...        # Claude AI
WALLET_AUTH_SECRET=...              # Min 32 chars, HMAC signing

# Optional
SIMULATION_MODE=false               # Paper trading mode
TRANSFERS_ENABLED=true              # Transfer kill switch
TRADING_ENABLED=true                # Trading kill switch
```

## Quality

| Metric | Value |
|---|---|
| TypeScript errors | 0 |
| ESLint warnings | 0 |
| Tests | 231 passing |
| Build | Clean |
| CI | Green |
| Markets | 34 verified |
| AI tools | 26 |
| Card components | 20 |
| Deep audit rounds | 8 |
| Issues found & fixed | 89 |

---

<div align="center">
  <sub>Built on <a href="https://flash.trade">Flash Trade</a> · Powered by <a href="https://solana.com">Solana</a></sub>
</div>
