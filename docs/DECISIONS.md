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
  capped exponential full jitter. Phase 2 replaces the temporary development/test header stub with database-backed authentication. All workspace package manifests require Node.js 20.19 or newer for
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

## 2026-10-27: Compiled workspace package exports

- **Decision:** Build the auction engine as ESM plus declaration files in its
  dist directory. The API depends on the engine through workspace:* and imports
  its package exports. Root build runs workspace package builds before
  typechecking and tests; CI also runs the build explicitly.
- **Reason:** A compiled package entry point works in both TypeScript checks and
  Node deployments without reaching into another workspace package's source
  tree.
- **Consequences:** Clean installs must run pnpm build before starting the API
  directly. The root typecheck and test scripts perform that build first. The API
  uses pnpm's standard workspace link and imports only the compiled package
  entry point.

## 2026-10-28: Authentication, college scoping, and refresh rotation

- **Decision:** Store colleges, users, email-verification tokens, and refresh-token families in MongoDB. Normalize emails/domains, enforce unique indexes, and assign BUYER/SELLER only after email verification. ADMIN is granted through a CLI command only. Authenticate HS256 JWTs for 15 minutes and reload the active, verified user from MongoDB on every request.
- **Reason:** Database-backed roles and status make bans and role changes effective immediately. Exact domain matching and unique email/domain indexes make college assignment deterministic. Passwords use Argon2id. Auth token collections retain only SHA-256 hashes; pending verification mail payloads are encrypted separately in the outbox.
- **Consequences:** Authentication bootstrap lookups by email or token hash cannot begin with an authenticated college; after resolving the account/token, follow-up operations use its stored college ID. Authenticated user/admin/resource queries must use the college-scope helper. Refresh rotation atomically consumes a token and inserts its successor in one transaction. Reuse within ten seconds returns 401 without family revocation; later reuse revokes the family. Rotated tokens remain until expiry for replay detection.

## 2026-10-28: Same-site refresh cookie and cross-college visibility

- **Decision:** Refresh cookies are HttpOnly, SameSite=Lax and Secure except in development. COOKIE_DOMAIN is optional, with no default; omission sets a host-only cookie. CORS uses an explicit origin allowlist and TRUST_PROXY is configured from the environment.
- **Reason:** Same-site cookies reduce cross-site token exposure and work with a frontend/API deployment under one browser site.
- **Consequences:** A separately hosted frontend should proxy `/api` through its own origin to keep cookies same-site. Cross-college visibility is deliberately unsupported; it may be added later as an opt-in per-listing visibility field. Phase 3 permits cancellation from draft, scheduled, or bid-free active auctions; cancellation is a college-scoped conditional update. Cross-college visibility remains deliberately unsupported and may later be added as an opt-in per-listing visibility field.

## 2026-10-28: Phase 2 security dependencies

- **Decision:** Use @node-rs/argon2 for Argon2id without a native compile step; jose for JWT signing/verification; Helmet for response headers; cors for the origin allowlist; express-rate-limit for per-IP/per-email limits; and cookie-parser to read refresh cookies. Use a ConsoleMailProvider in development and tests; defer Resend to Phase 5. Use Mongoose QueryFilter<T> in the college-scope helper so scoped filters typecheck directly against Mongoose repositories.
- **Reason:** These packages provide the required password, token, browser-cookie, and request-protection functions without introducing a mail vendor before its planned phase.
- **Consequences:** ConsoleMailProvider refuses startup outside development/test. Production mail delivery remains unavailable until the Phase 5 provider is configured.

## 2026-10-28: Mongo-backed verification mail outbox

- **Decision:** Enqueue verification mail in MongoDB in the same transaction as account and token creation. Encrypt the queued recipient, name and raw verification token with AES-256-GCM using the independent MAIL_OUTBOX_KEY; clear the encrypted payload after successful delivery. A separate worker claims jobs with an atomic lease, retries failures with capped backoff, and uses the development/test-only console provider.
- **Reason:** Durable queued delivery is required by the project rules, while the verification-token collection must retain only a SHA-256 hash.
- **Consequences:** Delivery is at least once, so a crash after provider send but before acknowledgement may duplicate mail. Keep MAIL_OUTBOX_KEY stable until pending outbox jobs drain; rotating the JWT secret does not affect queued mail. Production mail delivery remains unavailable until a production provider is added.

## 2026-10-28: College-scoped listings, auction cancellation, and upload signing

- **Decision:** Store listing photos as Cloudinary URLs/public IDs, and sign uploads with a server-generated fixed `campusbid/<collegeId>` folder, allowed formats, and maximum file size. Keep auction/listing API response contracts in a new shared package module. Search uses a compound text index whose first key is `collegeId`; every authenticated query includes its college.
- **Reason:** College-scoped index prefixes make search require the same college filter as ordinary reads. Signed folder and file restrictions prevent a client from choosing another folder or weakening upload limits. Shared contracts let clients consume the same response types.
- **Consequences:** Cloudinary signing is unavailable with a clear 503 until its three environment values are configured. Cross-college visibility is not supported. Cloudinary parameters are signed with Node's built-in crypto, so no SDK dependency is added. The 10 MB value is included in the signed parameters and response; Cloudinary's published direct Upload API does not document `max_file_size` as an enforced upload parameter, so a provider-side size limit must be verified before relying on it as a security boundary.

- **Decision:** Cancel an auction with one conditional update scoped by college. Draft and scheduled auctions may be cancelled; active auctions may be cancelled only while `currentBidId` is null. Seller ownership or same-college ADMIN access is checked in the API service.
- **Reason:** The condition serializes cancellation against the bid engine's active-auction update. If the bid commits first, cancellation no longer matches; if cancellation wins first, the bid's active-status filter no longer matches.
- **Consequences:** Cancellation increments auction version once. Competing workers and requests can retry the conditional update, but cannot both win the bid/cancel race.

- **Decision:** Poll auction activation and closing every five seconds in a standalone worker by default, with an opt-in `AUCTION_WORKER_MODE=inline` API mode. Demo seed data is idempotent, refuses production, and generates passwords only when creating the demo accounts.
- **Reason:** Database state and conditional updates make multiple worker processes and restarts safe; polling discovers due records without relying on in-process timers as the closing mechanism.
- **Consequences:** Each newly created demo account’s generated password is printed once. A rerun keeps existing passwords unchanged and does not reveal them again.
