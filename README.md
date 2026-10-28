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

## Authentication setup

The API requires separate 32 character `JWT_SECRET` and `MAIL_OUTBOX_KEY` values, a `COOKIE_NAME`, and a comma
separated `CORS_ORIGINS` allowlist. `COOKIE_DOMAIN` is optional; when unset,
refresh cookies are host-only. In development, signup and resend-verification
messages are dispatched from the Mongo-backed outbox by the console mail provider. Run the worker with `pnpm --filter @campusbid/api mail:worker`. Seed the BMSCE college with
`pnpm --filter @campusbid/api college:seed`, then grant an administrator from
the CLI with `pnpm --filter @campusbid/api admin:grant <email>`. Admin grants
require an existing verified account. See [docs/AUTH.md](docs/AUTH.md) for the
token lifecycle and current security boundaries.

## Bid engine

The reusable engine lives in the auction-engine workspace package. The API
imports it through its package entry point; the engine build emits ESM and
TypeScript declarations to dist before API checks and tests. Bids are accepted
through one conditional MongoDB update and stored in the same transaction as
the auction change. The engine also handles bidder-scoped idempotency,
anti-sniping extensions, scheduled activation, and idempotent closing.

## Listings and auctions

Listings and auctions are scoped to the authenticated user’s college. Sellers
create both records together; uploads use short-lived signed Cloudinary
parameters for the college’s fixed folder. Configure `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` to enable photo signing.

The auction worker polls for scheduled starts and due closes every five seconds.
Run it separately with `pnpm --filter @campusbid/api auction:worker`, or set
`AUCTION_WORKER_MODE=inline` to run the same worker in the API process. Multiple
workers are safe to run together.

For local demos, run `pnpm --filter @campusbid/api auction:seed`. It creates 25
BMSCE-style listings and verified seller/buyer accounts. Newly generated demo
passwords are printed once at creation; existing demo account passwords are not
changed or printed again. The seed refuses to run in production.

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
