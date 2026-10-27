# AGENTS.md - CampusBid

## Mission

You are the lead engineer on CampusBid, a real-time campus auction marketplace for BMSCE (multi-college ready). The product's value is TRUST and CORRECTNESS under concurrency. Optimize for correctness first, then clarity, then speed of delivery.

## Stack (do not change without asking)

- Backend: Node.js 20.19+, TypeScript (strict), Express, Mongoose, Socket.IO, Zod for validation, Pino for logs.
- Database: MongoDB on a replica set (Atlas). Never assume a standalone server.
- Frontend: React + Vite + TypeScript, Tailwind, TanStack Query, Socket.IO client.
- Email: Resend or Nodemailer behind a MailProvider interface, sent via a job queue (BullMQ or a Mongo-backed outbox).
- Tests: Vitest + Supertest + mongodb-memory-server (replica set mode); k6 or autocannon for load tests.
- Monorepo: /apps/api, /apps/web, /packages/shared (types, Zod schemas, event names).

## Non-negotiable engineering rules

1. The server is the only source of truth for time, price and winner. Never trust client clocks or client-computed prices.
2. Every bid goes through ONE function: placeBid(). It must be atomic: a single conditional update on the auction document (status active, now < endsAt, amount >= currentPrice + minIncrement, bidder != seller), plus the bid insert in the same transaction. No read-then-write bidding logic anywhere.
3. placeBid() requires an idempotency key. A retried request must return the original result, not create a second bid.
4. Money is stored as integer paise, never floats.
5. Auction state is a state machine: draft -> scheduled -> active -> ended -> (paid | unsold | cancelled). Transitions are explicit and tested; illegal transitions throw.
6. Auction closing is done by a worker that is safe to run twice (idempotent) and survives server restarts. Do not rely on setTimeout alone.
7. Role-based access control (ADMIN, SELLER, BUYER) is enforced in middleware AND re-checked in the service layer. Ownership checks on every mutation.
8. Validate every input with Zod at the edge. Never return stack traces or internal ids in errors.
9. Secrets only via environment variables; maintain .env.example. Never commit secrets.
10. Socket events are typed in /packages/shared. The server emits state changes AFTER the database commit, never before.

## Workflow

- Start every task by restating the goal and listing the files you expect to touch. For anything touching bidding, auction state or auth, write a short plan first and wait for approval.
- Work in small, reviewable steps; one concern per commit, conventional commit messages.
- Write or update tests with the code. A bid-engine change is not done without a concurrency test (N parallel bids on one auction; assert exactly one winner per price level, no lost updates, price strictly increasing).
- Run lint, typecheck and tests before declaring done; report the actual results, never claim success without running them.
- If a requirement is ambiguous or you would need to change the stack, data model or API contract, ask before coding.
- Do not add dependencies casually; justify each one in one line.
- Keep a /docs/DECISIONS.md log (ADR style, short) for each significant architectural decision.

## Code style

- Feature folders: modules/auctions, modules/bids, modules/users, modules/notifications.
- Thin controllers, logic in services, data access in repositories.
- No any; no silent catch; no TODO without an issue note.
- Small pure functions for pricing rules so they are unit-testable.

## Definition of done

Typechecks, lint clean, tests pass (including concurrency tests where relevant), README or docs updated, no secrets, and a short summary of what changed, what was tested, and what is risky.

## Communication

Be concise. Show diffs and test output, not essays. Flag risks and trade-offs proactively. Suggest improvements when you see them, but do not implement scope beyond the task without asking.
