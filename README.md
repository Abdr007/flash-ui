<div align="center">

# Flash Terminal

**AI-Powered Perpetual Trading on Solana**

Chat-first trading terminal built on [Flash Trade](https://flash.trade) protocol.
Market orders, limit orders, trigger orders, FAF staking, earn yield, instant transfers — all through natural language.

[![CI](https://github.com/Abdr007/flash-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/Abdr007/flash-ui/actions/workflows/ci.yml)

[Live Demo](https://flash-ui-eight.vercel.app) &bull; [Flash Trade](https://flash.trade)

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
| **Trading** | Market orders, limit orders, degen mode (500x), TP/SL bundled in tx |
| **Order Management** | View orders, cancel limit orders, edit (cancel+replace), trigger orders |
| **Position Management** | Close, partial close, reverse/flip, add/remove collateral |
| **FAF Staking** | Stake, unstake, claim rewards, VIP tiers, cancel unstake |
| **Earn** | 11 pools, deposit, withdraw, positions, live APY |
| **Transfers** | SOL + SPL tokens, cheapest fees on Solana (5000 lamports base) |
| **Portfolio** | Live PnL (with fees), wallet tokens via Helius DAS, 60+ prompt patterns |

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict mode) |
| AI | Claude Sonnet 4.6 + Haiku 4.5 via Vercel AI SDK v6 |
| State | Zustand (3 domain slices) |
| Blockchain | Solana (web3.js), Flash SDK, Pyth oracles |
| Styling | Tailwind CSS 4, custom design system |
| Testing | Vitest (231 tests), Playwright (E2E) |
| CI/CD | GitHub Actions, Vercel, husky + lint-staged |
| Deployment | Vercel (Fluid Compute) |

## Quality

| Metric | Value |
|---|---|
| Unit tests | 231 |
| E2E tests | 5 |
| AI tools | 26 |
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
      chat/          # AI chat route + 26 tools
      broadcast/     # Multi-endpoint tx broadcast
      faf/           # FAF staking tx builder
      health/        # Health check (Flash API + RPC + Pyth)
      transfer/      # Token transfer builder
    page.tsx         # Main app shell
    landing/         # Landing page
  components/
    chat/
      cards/         # 18 card components (split from monolith)
      ChatPanel.tsx  # Chat UI
    portfolio/       # Portfolio hero + panels
    earn/            # Earn modal
    ui/              # Skeleton, ThemeToggle
  hooks/             # useExecuteTx, useLivePnl, usePriceStream
  lib/               # Core: api, parser, firewall, pnl, metrics, errors
  store/             # Zustand: data-slice, trade-slice, chat-slice
  i18n/              # Translation system (7 locales ready)
```

## Setup

```bash
# Install
npm install

# Dev
npm run dev

# Build
npm run build

# Test
npm test              # Unit tests (231)
npm run test:e2e      # Playwright E2E

# Quality
npm run lint          # ESLint
npm run format:check  # Prettier
npm run type-check    # TypeScript
npm run validate      # All of the above + build
```

## Environment Variables

```env
# Required
HELIUS_RPC_URL=https://...          # Solana RPC (HTTPS required)
ANTHROPIC_API_KEY=sk-ant-...        # Claude AI
WALLET_AUTH_SECRET=...              # HMAC signing secret

# Optional
SIMULATION_MODE=false               # Paper trading mode
TRANSFERS_ENABLED=true              # Transfer kill switch
TRADING_ENABLED=true                # Trading kill switch
NEXT_PUBLIC_SENTRY_DSN=...          # Error tracking
NEXT_PUBLIC_FLASH_API_URL=...       # Flash API override
```

---

<div align="center">
  <sub>Built with precision. Shipped with confidence.</sub>
</div>
