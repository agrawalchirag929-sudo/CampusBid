# CampusBid

CampusBid is a real-time campus auction marketplace. This repository is a pnpm monorepo with the API in `apps/api`, shared contracts in `packages/shared`, and the reusable auction engine in `packages/auction-engine`.

## Requirements

- Node.js 20.19 or newer for the API (pnpm 11 tooling requires Node.js 22 or newer)
- pnpm 11.25.0 (use `corepack enable` if pnpm is not installed)
- MongoDB replica set for local API use; tests start an in-memory replica set

## Setup

```sh
pnpm install
Copy-Item .env.example .env
pnpm --filter @campusbid/api dev
```

The API listens on `PORT` (default `3000`) and exposes `GET /health`.

## Bid engine

The reusable engine lives in the auction-engine workspace package. The API
imports it through its package entry point; the engine build emits ESM and
TypeScript declarations to dist before API checks and tests. Bids are accepted
through one conditional MongoDB update and stored in the same transaction as
the auction change. The engine also handles bidder-scoped idempotency,
anti-sniping extensions, scheduled activation, and idempotent closing.

## Build and test

Install the frozen workspace dependencies, then build the packages before
running checks. Integration tests start an in-memory MongoDB replica set so
transaction behavior is exercised without a standalone MongoDB server.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
```
