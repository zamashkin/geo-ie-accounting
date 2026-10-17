# 0011 Session cookies, CSRF and tenant guards

Status: accepted (WS-05, 2026-10-16)

## Context
Better Auth runs inside the API (ARCHITECTURE §1). Locally the web app is on `http://localhost:3000` and the API on `http://localhost:4000`. The browser calls the API directly, and Next.js server components forward the cookie. The data is financial, so a CSRF or cross-tenant leak is the failure that matters most.

## Decision

**Endpoints.** Better Auth is mounted at `/v1/auth/*` (`basePath`), with Better Auth 1.7.7 pinned. That version cleared pnpm's minimum release age; 1.7.10 was a few hours old at the time. The methods are email + password (verification required before a password sign-in works), magic link (10 min, single use, token stored hashed) and password reset. IDs are UUID v7 from the app.

**Cookie.** `geo-ie-accounting.session_token` is httpOnly, `SameSite=Lax` and `Path=/`, and lasts 7 days, refreshed daily. Over HTTPS Better Auth adds `Secure` and the `__Secure-` prefix. Cookies ignore ports, so the cookie the API sets on `localhost:4000` is also sent to `localhost:3000`. `localhost:3000` and `localhost:4000` count as the same site, so `fetch(..., { credentials: 'include' })` from the web app carries it. CORS allows only `WEB_ORIGIN`, with credentials.

**Production.** Put web and API on sibling subdomains of one registrable domain, for example `app.example.ge` and `api.example.ge`. Set:

- `API_PUBLIC_URL=https://api.example.ge`, which turns on `Secure` cookies.
- `WEB_ORIGIN=https://app.example.ge`, the only trusted origin for CORS, CSRF and callback URLs.
- `AUTH_COOKIE_DOMAIN=example.ge`, so the cookie is shared with the web app's server components.
- `BETTER_AUTH_SECRET`: 32+ random bytes. Boot fails without it in production.

Keep the two hosts same-site so `SameSite=Lax` keeps working. Third-party-cookie restrictions would break a cross-site setup.

**CSRF.** There are two layers on top of `SameSite=Lax`:

1. Better Auth's own Origin and Fetch Metadata checks on `/v1/auth/*`, and its callback-URL validation against `WEB_ORIGIN`. Better Auth turns these off when `NODE_ENV=test`, so the config pins them on and the tests exercise them.
2. On `/v1` routes, the `requireAuth` / `requireRole` guards reject any POST, PUT, PATCH or DELETE that carries a cookie unless its `Origin`, or failing that its `Referer`, is a trusted origin. Browsers send `Origin` on every cross-origin request and on every non-GET fetch, so a missing Origin is rejected. GET and HEAD never mutate. Server-to-server callers that forward the cookie must set `Origin`.

**Tenant guards.** `requireRole(min)` runs in `onRequest`, before body parsing and validation. A non-member gets the same 404 (`Organization not found.`) for any org id, whether it exists or not. A member below `min` gets 403. An `onRoute` hook refuses to start the app if a `/v1/orgs/:orgId/*` route has no `requireRole`, or if it names the org parameter anything other than `:orgId`. The cross-tenant harness then probes every such route from the route table.

## Alternatives
- **Double-submit CSRF token**: an extra round-trip and more client code. It adds little over Origin checking plus SameSite for an API that only one first-party origin calls.
- **Bearer tokens in localStorage**: readable by any XSS. httpOnly cookies are not.
- **Proxying the API through Next.js (one origin)**: would hide the API behind the web app's runtime and goes against ADR 0002.

## Consequences
Better Auth endpoints answer with Better Auth's JSON errors (`{ code, message }`), not problem+json. Better Auth's rate limiter uses an in-memory store, which is per process; move it to the database or Redis before running several API instances.
