# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Explorer Index is a fact-indexing service for the [Orcfax Explorer](https://github.com/orcfax/explorer.orcfax.io). It syncs published Fact Statements from Cardano blockchains (Mainnet and Preview) via a Kupo chain indexer, stores them in PocketBase, and enriches them with Arweave archive data and Xerberus risk ratings.

## Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Run with hot reload (nodemon + tsx)
pnpm build            # Clean build dir and compile TypeScript
pnpm start            # Run compiled output (node build/index.js)
pnpm lint             # ESLint check
pnpm format           # Prettier auto-format src/**/*.ts
```

There is no test suite in this project.

## Architecture

**Entry point**: `src/index.ts` — boots networks from DB (or seeds), populates empty indexes, starts cron jobs.

### Core Modules

- **`src/kupo.ts`** — Blockchain indexing. Fetches UTXO matches from Kupo, decodes CBOR datums into fact statements, handles initial population (`populateIndex`) and incremental sync (`syncFactStatements`). Tracks chain checkpoints with ETags for efficient polling. Handles rollbacks by deleting facts when checkpoint decreases.

- **`src/db.ts`** — PocketBase abstraction layer. All database operations go through typed wrapper functions. Uses a generic `fetchAndParse<T>()` utility that validates responses with Zod schemas. Handles duplicate detection via unique constraint violation codes.

- **`src/cron.ts`** — Two scheduled jobs:
  - **Index sync** (every 10 min): syncs feeds from GitHub, checks policy changes, syncs facts, indexes Arweave archives. Uses a lock to prevent overlapping runs.
  - **Xerberus ratings** (daily at midnight UTC): bulk-fetches risk ratings for assets.

### Utilities (`src/util/`)

- **`types.ts`** — Zod schemas for all domain models (FactStatement, Feed, Network, Policy, Node, Source, Asset, Kupo/Archive types). This is the source of truth for data shapes.
- **`network.ts`** — Network seed data (Mainnet/Preview), slot-to-date conversion functions.
- **`feeds.ts`** — Syncs feed definitions from GitHub `cer-feeds.json`, manages asset creation.
- **`archives.ts`** — Fetches and parses TAR.GZ archives from Arweave (primary + secondary endpoints), enriches facts with node/source metadata. Uses p-limit (concurrency: 5).
- **`logger.ts`** — Winston logger with Discord webhook integration for production/test errors.
- **`xerberus.ts`** — Xerberus risk rating API integration.

### Data Flow

1. Kupo provides UTXO matches at FSP (Fact Statement Policy) smart contract addresses
2. CBOR-encoded datums are decoded to extract feed info and price pairs
3. Facts are stored in PocketBase with references to feeds, networks, and policies
4. Archives from Arweave enrich facts with participating nodes and data sources
5. Express server exposes the indexed data (port 3000)

### Key Domain Concepts

- **Network**: Cardano blockchain (Mainnet or Preview), each with its own Kupo instance and policies
- **Policy**: A Fact Statement Policy (FSP) smart contract version, tracked by activation slot/date
- **Feed**: An asset pair (e.g., ADA/USD) with source type (CEX/DEX), calculation method, heartbeat, and deviation thresholds
- **Fact Statement**: A published oracle data point — the core indexed entity

## Code Style

- Prettier: single quotes, no trailing commas, 120 char line width, semicolons
- ESM modules (`"type": "module"`) — imports use `.js` extensions even for `.ts` files
- Zod for all external data validation
- `Promise.allSettled()` for batch operations (fault tolerance over fail-fast)
- Pre-commit hook runs format + lint via husky

## Environment

Required env vars are typed in `environment.d.ts`: DB credentials (PocketBase), chain index URLs (Kupo for Mainnet/Preview), Discord webhook, Arweave endpoints, Xerberus API credentials.

## Deployment

Docker multi-stage build (Alpine Node 20.9.0, pnpm). PocketBase must be pre-configured with the required collections. Uses CapRover for deployment (`captain-definition`).
