# Authentication and access control

## Threat model

The API treats email, passwords, bearer tokens, cookies, user IDs and resource IDs supplied by a client as untrusted. Signup derives the college from the exact, lowercased email domain matched against an active college. A client cannot choose its college or roles. The API reloads the user from MongoDB on every bearer-token request, so a ban, email-verification change or role update takes effect without waiting for the access token to expire.

Authenticated user, admin, auction and future listing queries are constrained to the college recorded on that user. Admin authority is local to that college. A cross-college resource lookup is reported as not found so its existence is not disclosed. Public signup, login, verification and refresh-token bootstrap lookups begin with an email or a token hash because no authenticated college context exists yet; once an account or token is found, subsequent user and token operations are constrained by its stored college ID.

## Account lifecycle

Signup normalizes the email and accepts only an exact domain configured on an active college. Passwords are Argon2id hashes. Signup responses do not disclose whether a supported-domain email is already registered. New accounts receive a random, single-use verification token; only its SHA-256 hash is stored and it expires after 24 hours. Verified accounts receive BUYER and SELLER roles. Verification mail is enqueued in the Mongo-backed outbox in the same transaction as the user and verification token. Its payload is AES-GCM encrypted with the independent `MAIL_OUTBOX_KEY`; the worker clears it after delivery. The current ConsoleMailProvider is development/test only. Delivery is at least once, so a worker crash after sending can produce a duplicate email. Keep `MAIL_OUTBOX_KEY` stable until pending mail drains. Existing outbox payloads created before this key change must be drained or recreated before rollout; JWT secret rotation no longer affects queued mail.

Login checks the password before reporting that an account is unverified. Unknown email addresses are checked against a dummy Argon2id hash and receive the same generic failure as a wrong password. Banned users cannot log in or use refresh tokens. ADMIN is granted only by the API package's admin CLI, never by a route.

## Token lifecycle

A successful login returns an HS256 JWT that expires after 15 minutes. It includes subject, college, roles, issuer and audience. Verification requires the HS256 allowlist and expected issuer/audience, then reloads the active, verified user from the database.

A 30-day refresh token is a random opaque value. MongoDB stores only its SHA-256 hash, family ID, college/user IDs, expiry and revocation time. Refresh rotation is transactional: a conditional update consumes the old token only when `revokedAt` is null, and the successor is inserted in that same transaction. Tokens are retained until expiry for replay detection. Reuse within ten seconds returns 401 without revoking the family, allowing parallel requests to settle. Reuse after ten seconds revokes all still-live tokens in the family. Logout and banning revoke refresh tokens; the TTL index expires records only at their expiration time.

Refresh cookies are HttpOnly, SameSite=Lax, and Secure outside development. COOKIE_DOMAIN is optional; when omitted, the cookie is host-only. A separately hosted frontend should proxy `/api` through the frontend origin so the browser keeps the API and cookie same-site. The refresh cookie uses `Path=/` so it also reaches a proxy mounted under `/api`.

## Roles and ownership

BUYER is required to bid. Seller mutations must check that the resource belongs to the authenticated user's college and that its seller ID matches the user, unless the user is an ADMIN in that same college. Admin list, ban and unban operations are likewise college-scoped and re-check ADMIN in the service layer. A ban also revokes the user's refresh tokens.

## Deliberate limits

Cross-college visibility is deliberately unsupported. A future change could add an opt-in per-listing visibility field. There are no password reset, two-factor authentication, social login or production mail vendor integration yet. Resend integration is deferred to Phase 5. The current auction state machine cannot cancel draft or scheduled auctions, so the API does not add a cancellation route; Phase 3 can add one after the state transition is approved.
