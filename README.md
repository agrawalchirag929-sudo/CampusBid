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

## Checks

```sh
pnpm lint
pnpm typecheck
pnpm test
```
