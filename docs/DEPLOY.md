# Backend deployment

Build the workspace before starting the API:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @campusbid/api start
```

The production start script runs `node dist/server.js`. Use Node.js 20.19 or
newer. `MONGO_URI` must point to a MongoDB replica set because bidding and
account workflows use transactions.

## Environment variables

| Variable                | Required   | Purpose                                                                                                                |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`              | Yes        | Set to `production` for deployment.                                                                                    |
| `MONGO_URI`             | Yes        | MongoDB replica set connection string.                                                                                 |
| `PORT`                  | No         | HTTP port; defaults to `3000`.                                                                                         |
| `LOG_LEVEL`             | No         | Pino level; defaults to `info`.                                                                                        |
| `JWT_SECRET`            | Yes        | At least 32 characters; signs access tokens.                                                                           |
| `MAIL_OUTBOX_KEY`       | Yes        | At least 32 characters; encrypts queued email payloads. Keep it stable while jobs are pending.                         |
| `COOKIE_NAME`           | Yes        | Refresh-cookie name, for example `campusbid_refresh`.                                                                  |
| `COOKIE_DOMAIN`         | No         | Omit for a host-only refresh cookie.                                                                                   |
| `CORS_ORIGINS`          | Yes        | Comma-separated allowed HTTP(S) origins.                                                                               |
| `TRUST_PROXY`           | No         | `false` by default; set `true` or a trusted proxy hop count when deployed behind a proxy.                              |
| `RUN_WORKER`            | No         | Defaults to `false`. Set `true` on one API instance to run auction activation, closing, and email delivery in-process. |
| `CLOUDINARY_CLOUD_NAME` | No         | Enables signed photo uploads when set with the API key and secret.                                                     |
| `CLOUDINARY_API_KEY`    | No         | Cloudinary upload-signing key.                                                                                         |
| `CLOUDINARY_API_SECRET` | No         | Cloudinary upload-signing secret.                                                                                      |
| `SMTP_HOST`             | Production | SMTP server hostname.                                                                                                  |
| `SMTP_PORT`             | Production | SMTP port; port `465` uses a secure connection.                                                                        |
| `SMTP_USER`             | Production | SMTP authentication user.                                                                                              |
| `SMTP_PASS`             | Production | SMTP authentication password.                                                                                          |
| `MAIL_FROM`             | Production | Sender address, optionally with a display name.                                                                        |

Production startup fails when any SMTP setting is missing. Console email is
available only in development and tests. The mail worker reads encrypted jobs
from the Mongo-backed outbox; notification event keys are unique so a stream
restart or another API instance cannot enqueue the same event twice.

For a single demo deployment, set `RUN_WORKER=true` on the API instance. If API
traffic later needs several instances, keep `RUN_WORKER=false` on those
instances and run the standalone `auction:worker` and `mail:worker` scripts as
separate processes. Change streams continue to observe auction and bid events
on every API instance; the outbox's unique event key controls mail duplication.

See [`.env.example`](../.env.example) for a copyable variable template.
