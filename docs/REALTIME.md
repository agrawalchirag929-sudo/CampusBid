# Realtime auction updates

CampusBid uses Socket.IO to notify browsers about committed auction changes.
MongoDB is the event source: each API process watches inserts in `bids` and
status updates in `auctions`. The bid insert is visible only after its
transaction commits, and it contains the auction snapshot written with that
bid. Auction activation, ending, unsold and cancellation events come from the
auction update's `updateDescription`. The change stream filters out unrelated
collections and operations. HTTP bid routes do not emit socket events.

Each socket sends its access token in the Socket.IO handshake. The server checks
the JWT with the same HS256, issuer and audience rules as HTTP, then reloads the
active, verified user and roles from MongoDB. A socket is disconnected at the
token's expiry. HTTP authentication reloads the account on every request, so a
banned user is blocked from HTTP immediately; an already-connected socket can
remain connected until the access token expires, for up to 15 minutes.
After an expiry disconnect, the browser should use the HTTP refresh endpoint
and reconnect with the newly issued access token; the refresh cookie is never
sent in the Socket.IO handshake.

Clients join `auction:<auctionId>` after the server confirms the auction is in
their college. Cross-college joins return the same not-found response as a
missing auction. Each socket may join at most 20 auction rooms. Event payloads
contain auction and bid IDs where needed, but never user IDs or email addresses.
Bidder names are stable masked labels such as `Bidder 1`.

Every event has a `serverTime`. State changes carry the auction version. The
client should deduplicate the bid feed by `bidId`, and apply price (`amountPaise`)
and `endsAt` only when the event version is newer than the highest version it
has seen. When it receives `auction.resync`, it should send
`auction.replay` with its last seen version. The server returns the bounded
sequence of missed `bid.placed` events when every version is accounted for; if
the gap is too large or includes a state transition that cannot be replayed as
bids, it returns a full `auction.state` snapshot.

The `room.viewers` count is per API process. Without a shared Socket.IO adapter,
it is approximate when several API instances serve the same auction. It is
informational only and must not be used for authorization or auction decisions.

The change stream restarts with capped backoff after errors. On every stream
start or restart, the process emits `auction.resync` to its joined rooms so
clients can recover from any interval that was not observed.
