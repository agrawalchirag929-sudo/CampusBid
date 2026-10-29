# CampusBid web

## Local development

Build the shared package once, then run the web app and API in separate terminals:

```sh
pnpm --filter @campusbid/shared build
pnpm --filter @campusbid/web dev
pnpm --filter @campusbid/api dev
```

The browser calls same-origin `/api`. Vite forwards those requests to
`http://localhost:3000` and removes the `/api` prefix. Refresh cookies remain
host-only and are sent by the browser through the dev proxy.

## Vercel

Set the Vercel project root to `apps/web` and configure `BACKEND_URL` to the
backend origin without a trailing slash. The supported `vercel.ts` configuration
uses a normal external rewrite for `/api/*` and a fallback for client-side routes.
Vercel's programmatic config is used because static `vercel.json` cannot resolve
environment variables at configuration time.

Socket.IO is configured separately with `VITE_SOCKET_URL`; it connects directly
to the backend and sends the in-memory access token in the handshake auth payload.
