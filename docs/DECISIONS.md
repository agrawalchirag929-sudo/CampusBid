# Architecture decisions

## 2026-10-26: TypeScript pnpm monorepo for Phase 0

- **Decision:** Use pnpm workspaces with strict TypeScript packages for the API, shared contracts, and reusable auction engine. The API uses Express, Mongoose, Pino, and Zod; Vitest and Supertest cover API behavior.
- **Reason:** The engine can be mounted into another application independently, while shared types and schemas stay in one package. Strict typing and replica-set-backed tests support the correctness requirements for later transactional auction work.
- **Consequences:** Local database integration tests require downloading and starting a MongoDB binary through `mongodb-memory-server`; the test helper starts a single-node WiredTiger replica set so MongoDB transactions are available.

## 2026-10-27: Transactional bid engine

- **Decision:** Keep auction models and the transaction-oriented bid engine in
  `packages/auction-engine`, with Express handling edge validation and calling
  the engine. Use Mongoose 9's explicit `updatePipeline: true` for the single
  conditional bid update. The API/worker clock is injected into the engine; it
  is sampled again on transaction retries, and production hosts must be time
  synchronized.
- **Reason:** The bid price, current bid, anti-sniping extension, and version
  must commit as one auction-document update with the append-only bid in the
  same MongoDB transaction. Mongoose 9 supports explicit update-pipeline opt-in;
  the bid record keeps the original auction snapshot for idempotent retries.
- **Consequences:** Production and integration tests require a MongoDB replica
  set. Bid transactions retry transient conflicts at most thirty-two times with
  capped exponential full jitter. API authentication remains a non-production header stub until
  Phase 2. All workspace package manifests require Node.js 20.19 or newer for
  the Mongoose 9 runtime baseline; CI runs on Node.js 22.

## 2026-10-27: Per-process bid queue and contention handling

- **Decision:** Serialize bids per auction within each engine instance, perform
  a primary-read price pre-check only after the idempotency lookup and only for
  eligible active auctions, and retain the atomic conditional update as the
  acceptance authority. Retry transient conflicts up to thirty-two attempts
  with capped exponential full jitter; emit retry counters through an injected
  debug logger.
- **Reason:** Local serialization removes avoidable same-process write
  conflicts. The monotonic price invariant makes a stale price pre-check safe
  for early rejection, while transactions and atomic filters remain necessary
  when multiple engine instances or processes compete.
- **Consequences:** Queue keys are deleted when idle and after thrown work. The
  queue is currently unbounded; a future change may add a per-auction queue
  limit and typed BUSY rejection.
