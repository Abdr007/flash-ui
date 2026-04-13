<div align="center">

# Flash Terminal

**AI-Powered Perpetual Trading on Solana**

Chat-first trading terminal built on [Flash Trade](https://flash.trade) protocol.
Market orders, limit orders with TP/SL, on-chain trigger orders, FAF staking, earn yield, instant transfers — all through natural language.

[![CI](https://github.com/Abdr007/flash-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/Abdr007/flash-ui/actions/workflows/ci.yml)

[Live App](https://flash-ui-eight.vercel.app) &bull; [Flash Trade](https://flash.trade)

</div>

---

## Architecture

```
User Input
    |
    v
+------------------+     +------------------+     +------------------+
|   Fast-Path      | --> |   FAF Patterns   | --> |  Direct Tool     |
|   (4 regex       |     |   (40+ patterns) |     |  Match (30+)     |
|   formats, <5ms) |     |                  |     |                  |
+------------------+     +------------------+     +------------------+
    |                         |                         |
    | miss                    | miss                    | miss
    v                         v                         v
+------------------+     +------------------+     +------------------+
|   NLP Parser     | --> |  Conversational  | --> |   AI Fallback    |
|   (confidence    |     |  Intents         |     |   Sonnet 4.6     |
|   threshold 0.8) |     |  (wizards)       |     |   (26 tools)     |
+------------------+     +------------------+     +------------------+
```

**65-75% of requests resolve with zero AI inference.** The system is regex-first, AI-fallback.

## Features

| Category | Capabilities |
|---|---|
| **Market Orders** | Long/short any market, 4 input formats, degen mode (500x), TP/SL bundled atomically |
| **Limit Orders** | On-chain limit orders with TP/SL, step-by-step wizard builder, LIMIT badge on card |
| **Order Management** | View all orders, cancel limit orders, edit (cancel+replace preserving TP/SL), trigger orders |
| **Position Management** | Close, partial close (reduce %), reverse/flip, add/remove collateral |
| **FAF Staking** | Stake, unstake, claim rewards/revenue, VIP tiers, cancel unstake, 91 prompts tested |
| **Earn Yield** | 11 pools (Crypto/DeFi/Gold/Meme/WIF/FART/TRUMP/Ore/Stable/Equity), deposit, withdraw |
| **Transfers** | SOL + any SPL token, cheapest fees on Solana (5000 lamports), base58 case-preserved |
| **Portfolio** | Live PnL with fees, wallet tokens via Helius DAS, 60+ prompt patterns |
| **Dark/Light Mode** | System preference + manual toggle, CSS variables, localStorage persist |
| **i18n Ready** | Translation system with 80+ keys, 7 locales prepared |

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Server Components) |
| Language | TypeScript (strict mode, zero `any`) |
| AI | Claude Sonnet 4.6 + Haiku 4.5 (runtime fallback) via Vercel AI SDK v6 |
| State | Zustand (3 domain slices: data, trade, chat) |
| Blockchain | Solana web3.js, Flash SDK, Pyth oracles (SSE streaming) |
| Styling | Tailwind CSS 4, custom glass-card design system |
| Testing | Vitest (231 unit tests), Playwright (5 E2E tests) |
| CI/CD | GitHub Actions (lint + typecheck + test + build), husky + lint-staged |
| Security | Zod schemas, trade firewall, rate limiting, TOCTOU protection |
| Deployment | Vercel (Fluid Compute) |

## Quality

| Metric | Value |
|---|---|
| Unit tests | 231 |
| E2E tests | 5 |
| AI tools | 26 |
| Card components | 21 |
| Prompts chaos-tested | 450+ |
| ESLint warnings | 0 |
| Prettier | All files formatted |
| Build | Clean |
| CI | Green |

## Project Structure

```
src/
  app/
    api/
      chat/            # AI chat route + 26 tools + system prompt
        tools/         # buildTrade, closePosition, limitOrderTools, placeTriggerOrder, etc.
      broadcast/       # Multi-endpoint Solana tx broadcast
      faf/             # FAF staking tx builder (SDK-powered)
      health/          # Health check (Flash API + RPC + Pyth + metrics)
      transfer/        # Universal token transfer builder
    page.tsx           # Main app shell with Suspense + ErrorBoundary
    landing/           # Landing page
  components/
    chat/
      cards/           # 21 card components (TradePreview, Orders, TriggerOrder, etc.)
      ChatPanel.tsx    # Chat UI with autocomplete
    portfolio/         # PortfolioHero with live PnL + skeleton loading
    earn/              # EarnModal with simulation + signing
    ui/                # Skeleton, ThemeToggle
  hooks/               # useExecuteTx, useLivePnl, usePriceStream, useWalletAuth
  lib/                 # Core: api, parser, trade-firewall, pnl, metrics, errors, env
  store/               # Zustand: data-slice, trade-slice, chat-slice, types
  i18n/                # Translation system (en + 6 locale slots)
```

## Setup

```bash
# Install dependencies
npm install

# Development
npm run dev

# Production build
npm run build

# Testing
npm test              # 231 unit tests
npm run test:e2e      # Playwright E2E (requires: npx playwright install)

# Quality checks
npm run lint          # ESLint (0 warnings)
npm run format:check  # Prettier
npm run type-check    # TypeScript strict
npm run validate      # All checks + build (full CI gate)
```

## Environment Variables

```env
# Required
HELIUS_RPC_URL=https://...          # Solana RPC (HTTPS enforced)
ANTHROPIC_API_KEY=sk-ant-...        # Claude AI (Sonnet + Haiku)
WALLET_AUTH_SECRET=...              # HMAC signing secret

# Optional
SIMULATION_MODE=false               # Paper trading mode
TRANSFERS_ENABLED=true              # Transfer kill switch
TRADING_ENABLED=true                # Trading kill switch
NEXT_PUBLIC_SENTRY_DSN=...          # Error tracking (Sentry)
NEXT_PUBLIC_FLASH_API_URL=...       # Flash API override
```

## Security

- **Trade Firewall** — Zod strict schema, per-market leverage caps, TP/SL direction validation, position conflict detection
- **Rate Limiting** — Per-IP with Retry-After headers, per-wallet tool rate limits
- **TOCTOU Protection** — Price cross-validation at execution time, volatility circuit breaker
- **Env Validation** — Startup Zod schema, HTTPS enforcement on RPC URLs
- **Broadcast Security** — Transaction signer verification, base64 size limits

---

<div align="center">
  <sub>Built with precision. Shipped with confidence.</sub>
</div>
