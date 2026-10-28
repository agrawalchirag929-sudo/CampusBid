# Bid engine atomicity

`placeBid()` is the only path that changes an auction price. It starts a MongoDB
transaction, checks the bidder-scoped idempotency key, and then issues one
conditional `findOneAndUpdate()` on the auction. The filter requires an active,
not-yet-ended auction in the bidder's college, excludes the seller, and compares
the proposed paise amount against the current document's minimum. The first bid
uses the start price; later bids must include the minimum increment.

The update is a Mongoose aggregation-pipeline update with `updatePipeline: true`.
Its `$cond` reads the document's current `endsAt` and `extensionCount` while the
database applies the update. A bid in the configured final window extends the
end by the configured amount only while the cap has room. Price, current bid,
end time, extension count, and version therefore move together in that one
atomic update. Version increases by one for an ordinary bid and by two for a
bid that extends the clock.

After the auction update succeeds, the engine inserts the append-only bid using
the same transaction session. The transaction commits both records together; if
the insert or commit fails, the price update rolls back too. The bid stores the
resulting auction snapshot so a retry with the same key returns the original
bid result. Reusing that key with a different amount returns
`IDEMPOTENCY_CONFLICT`. Unique indexes protect both bidder-scoped idempotency
keys and accepted prices.

Before opening a transaction, the engine checks for an existing idempotent
bid and reads the auction on the primary. It only returns a fast price rejection
when the auction is active, has not ended, belongs to the bidder's college, and
the bidder is not the seller. Those checks preserve the existing rejection
priority for ended, inactive, self-bid, and cross-college cases. Prices only
increase, so an older primary read can only have a lower or equal minimum than
the committed auction state: if the bid is below that older minimum it is also
below the current minimum. If the read is behind a newer price, the bid may
continue to the transaction, where the atomic filter rejects it. The
transactional conditional update remains the only authority for accepting bids.

Within one process, placeBid calls for the same auction are serialized by a
keyed async queue. Idle keys are removed, including when a queued call throws.
This reduces local write conflicts but does not coordinate separate processes;
MongoDB conditional updates and bounded retries remain necessary across
instances. Transient transaction and write-conflict errors get at most thirty-two
attempts with capped exponential full jitter. Each retry is logged at debug
level with a per-operation retry counter and MongoDB error code. Set LOG_LEVEL
to debug to emit these records.

The per-auction queue currently has no maximum pending length. A future
backpressure change may add a queue bound and a typed BUSY result.
A failed conditional update may read the current auction only to choose a
rejection code and populate its price/version fields. That read never feeds a
later bid update. Rejections are normal return values.

Closing workers select due candidates, then each close is a transaction with a
conditional `active -> ended` update. Only the worker that changes the active
record returns it as closed. No-bid or reserve-miss auctions transition from
`ended -> unsold` in that same transaction. A winner is recorded when a current
bid exists and the reserve is absent or met. Activation similarly conditions
its update on `scheduled` and `startsAt <= now`, so competing workers cannot
activate the same auction twice.

## Clock choice

The engine receives an injectable application clock. Production defaults to
`new Date()` on the API/worker, and each bid retry samples it again. Worker
calls pass their server-generated `now` to activation/closing. This keeps the
comparison and anti-sniping boundary explicit and makes tests deterministic;
production API and worker hosts must keep their clocks synchronized. MongoDB
`$$NOW` is not used because the service also needs one testable clock for
rejection classification and scheduled worker boundaries.

## Cancellation race

`cancelAuction()` uses one conditional update on the auction document. Its filter
requires the caller's college and a draft/scheduled status, or an active status
with no current bid. The same write sets `cancelled` and increments the version.
A bid uses a conditional update that requires `active`; MongoDB serializes these
writes on the same document. The bid and cancellation therefore cannot both
win: if a bid commits first, the no-current-bid condition fails; if cancellation
commits first, the bid's active-status condition fails. A follow-up scoped read
is used only to distinguish a missing auction from a present but non-cancellable
one; it never feeds another update.
