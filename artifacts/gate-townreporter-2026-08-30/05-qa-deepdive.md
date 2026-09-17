# QA Engineer Deep-Dive — TownReporter 0.5.1
Gate: gate-townreporter-2026-08-30 · Role: QA Engineer

## Environment attestation

- Ran the product myself: built and booted a fresh copy of the checkout in an
  **isolated working directory** (`...\scratchpad\qa-townreporter`, a robocopy
  mirror of `townreporter-dev` excluding `.output`/`.git`/`node_modules`, with
  `node_modules` copied separately), rather than building inside
  `townreporter-dev` itself.
  **Why:** at the time I started, `townreporter-dev`'s shared `.output/` had
  just been rebuilt (mtime minutes old) and I found live `node.exe` processes
  in that checkout running `npm test`, `node --test ...`, and
  `.output/server/index.mjs` — almost certainly sibling gate roles building
  and testing concurrently. Per the standing "never build against production"
  rule (rebuilding a shared `.output` under a running server breaks it), and
  because `npm run build` overwrites that shared directory, building in place
  would have risked clobbering another role's live build or in-flight test
  run. The isolated copy gave me a private `.output` with no shared-state
  risk, while still exercising the real build (`npm run build`, including
  `patch-ssr`, asset copy, and `db:migrate`) and the real production server
  entrypoint (`node .output/server/index.mjs`), not `vite dev`.
- Server: `http://127.0.0.1:3890` (built + `npm start`-equivalent, not dev
  server), `HOST=127.0.0.1`, `PORT=3890`, `PUBLIC_SITE_URL`/`BETTER_AUTH_URL`
  pointed at that same origin.
- Database: my own scratch Postgres database `townreporter_qa_gate` on the
  shared instance at `127.0.0.1:5433` (created and migrated by me; not
  touched by, and not touching, `townreporter`, `townreporter_dev`, or any
  other role's database). Dropped at the end of this session.
- I own the first account: created `qa-editor@example.org` as the first
  signup, so I hold the one newsroom-owner slot for this instance (per
  0.5.1's "first account owns the desk" model).
- `TOWNREPORTER_CLAUDE_CODE=0` — no model calls made; scan/draft/editorial AI
  paths were not exercised end-to-end (out of scope for runtime auth/routing
  QA, and consistent with the walkthrough lane's model-absent finding).
- Evidence saved under
  `artifacts\gate-townreporter-2026-08-30\qa-evidence\`.

## Severity counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 0 |
| Major | 1 |
| Minor | 3 |
| Nit | 0 |

## Findings

### QA-01 — Major — `robots.txt` hardcodes the production domain's sitemap on every self-host
**Category:** correctness / self-host config
**Evidence:** `public/robots.txt:25` (static file, shipped byte-for-byte to
every install):
```
Sitemap: https://townreporter.org/sitemap.xml
```
Confirmed on my instance — `curl http://127.0.0.1:3890/robots.txt` returned
this exact line verbatim (`qa-evidence/00-basic-routes.txt`,
`qa-evidence/07-sitemap-empty.xml` for comparison against my instance's own,
correctly-scoped `sitemap.xml`, which does read `PUBLIC_SITE_URL` and
produced `http://127.0.0.1:3890/...` URLs). `sitemap.xml.ts` is generated
dynamically from `PUBLIC_SITE_URL`; `robots.txt` is a static file in
`public/` and was never wired to the same variable.

**Why it matters:** TownReporter's entire premise is "self-hosted local civic
newspaper" — every non-Anthropic-run instance is a different domain. Every
one of those operators' `robots.txt` currently advertises the *production*
site's sitemap, not their own. Two consequences: (1) their own sitemap is
never discovered via the standard `robots.txt` → `Sitemap:` crawl path, hurting
indexing of the exact archive pages the file's own comment says exist to make
reachable ("without this the archive is reachable only by following links");
(2) it points crawler traffic at `townreporter.org`, unrelated infrastructure,
from every self-hosted copy in the wild.

**Impact scope:** every self-hosted deployment except the reference
production instance itself (which is the one domain where the hardcoded
value happens to be correct). Confirmed on my instance; the file is static
so this is not environment-specific — it will reproduce identically on any
other self-host.

**Fix path:** generate `robots.txt` the same way `sitemap.xml.ts` is
generated (a route handler reading `PUBLIC_SITE_URL`), or templatize the
static file at build time the way other `VITE_`-prefixed values are baked
in. Either removes the one line that diverges per-deployment.

### QA-02 — Minor — No app-level security response headers
**Category:** runtime / defense-in-depth
**Evidence:** `qa-evidence/09-headers.txt` — response headers for `GET /` on
the built server: no `Content-Security-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, or `Referrer-Policy`. Confirmed the same absence on
`/desk`, `/login`, and API-adjacent routes.
**Why it matters:** the intended deployment is "reachable from the internet
through a Cloudflare Tunnel" run by a non-technical single operator. Whatever
headers Cloudflare's edge adds are outside this app's control and not
guaranteed by anything in this repo; the app itself ships none. This is not
an exploited vulnerability today (I found no injection point — see What's
Working), but it removes a cheap layer of blast-radius reduction for the one
operator who is least equipped to compensate for it herself.
**Impact scope:** every deployment, all routes.
**Fix path:** add a small header-setting middleware (Nitro/H3 supports this
cleanly) for `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, and at least a starter
CSP.

### QA-03 — Minor — Protected desk shell serves HTTP 200 for signed-out visitors, redirect is client-side only
**Category:** runtime behaviour
**Evidence:** `qa-evidence/00-basic-routes.txt`, `01-desk-queue-noauth.html`.
`GET /desk/queue` with no cookie returns `200 text/html`, not `401`/`302`.
The body (4.6 KB) is a genuine loading shell — an "Opening the desk" spinner
with a hard 8-second `setTimeout` fallback to `/login`, and I confirmed by
reading it end-to-end that it carries **no queue/lead/source data** — the
real gating happens client-side after a session check, and the underlying
`listSources`/`listLeads`/etc. server functions are wrapped in
`deskMiddleware`, confirmed applied to all 22 exported server functions in
`src/lib/news/desk.ts` (`grep` count 22/22).
**Why it matters:** no data leak was found — this is correctly a UI-shell
pattern, not an authorization bug. Flagging as Minor because a `200` on every
protected route (rather than `401`/redirect) means anything that judges
"is this page public" by status code alone (basic scanners, naive uptime
monitors, a future regression test) will misjudge it, and a slow/failed
client-side session check leaves a visitor looking at a bare spinner for up
to 8 seconds with no server-driven fallback.
**Fix path:** none required for security; consider an SSR-side session check
that 302s to `/login` when there is no cookie at all, reserving the
client-shell path for the ambiguous "cookie present, still verifying" case.

### QA-04 — Minor — Raw `/_serverFn/*` calls are hard to test outside a live browser session; auth-failure status on the wire not independently confirmed
**Category:** test-coverage / could-not-verify
**Evidence:** `qa-evidence/02-listSources-noauth-body.txt` (unknown function
id, no session context → `403 Forbidden`, via `assertSameSiteRequest()` —
same-site protection fires before any function lookup, which is a good
defense-in-depth property); `qa-evidence/03b-listSources-samesite-nocookie.txt`
and `04-realfn-nocookie-noauth.txt` (attempts at a same-site, no-cookie call
against a real content-hashed function id, hand-encoding the `seroval`
payload format observed in the browser's network log) both returned `500`,
but with two *different* error bodies (`"HTTPError"` vs `"Seroval Error
(step: 3)"`), which tells me my hand-built payloads were malformed, not that
I reproduced a genuine unauthenticated-but-well-formed request.
**What I could not verify, and why:** whether a well-formed, same-origin,
cookie-less call to a real desk server function returns a clean `401`
(matching the `UnauthorizedError.status = 401` thrown by
`src/lib/auth/verify.server.ts`) or something else on the wire. TanStack
Start's server-function RPC uses content-addressed function IDs plus a
`seroval`-encoded query payload that I could not reliably hand-construct
from outside a real client bundle in the time available, and the browser
tool's cookie jar meant a second tab was not a clean "signed-out" client to
observe the real request against. Static review shows the typed error and
its `status` field exist and that the client deliberately matches on
`err.message === "Unauthorized"` rather than HTTP status
(`src/routes/desk.sources.tsx:60,83`) — so the app may not depend on the wire
status being `401` at all — but I did not independently confirm the wire
status for a real signed-out call.

## What's working

- **First-run flow is real, not a demo.** Booted against a genuinely empty,
  freshly migrated database (18/18 migrations applied cleanly, in order,
  with no manual intervention) and got the actual "Create the desk — first
  person in owns the newsroom" screen, not a stub. Created the account
  through the real form, landed on a populated `/desk` command-center view
  in the same session — full loop, no shortcuts taken.
- **Source seeding on first login is correct and complete.** The desk
  auto-seeded exactly the 11 official Longmont sources defined in
  `SEED_SOURCES` (city council, city clerk, PrimeGov, planning, NextLight,
  schools, county, library, two YouTube channels), each with the right
  tier/kind, on the very first `listSources` call — verified by reading the
  live `/desk/sources` page, not by reading the seed list in source.
- **Server functions are consistently gated.** Every one of the 22 exported
  `createServerFn`s in `src/lib/news/desk.ts` carries
  `.middleware([deskMiddleware])` — no ad hoc or missing guard on any of
  them (`bootstrapDesk` through `deleteArticle`), and `deskMiddleware` itself
  layers same-site request assertion, session verification, and newsroom
  membership before returning any context.
- **Reflected input is safely escaped.** Submitted
  `<script>window.__xss=1</script>"><img src=x onerror=alert(1)>` as a
  source name through the real add-source form; confirmed via
  `window.__xss === undefined` after submission and a clean console (no
  errors, no unexpected script execution) that React's default escaping held
  — no naive `dangerouslySetInnerHTML` path caught this input.
- **Cron endpoint fails closed.** With `CRON_SECRET` unset (the shipped
  default), `GET /api/cron/monitors` returns `503 cron disabled` for both no
  secret and a guessed one — matches the documented "empty = disabled"
  contract, verified live, not just read in `.env.example`.
- **Reader/editor boundary held under adversarial IDs.** `/evidence/1`,
  `/evidence/999999` (non-existent evidence rows) render a specific,
  honest "That capture is not in this edition" state rather than a stack
  trace, a generic 500, or a silently-empty page that could be mistaken for
  real (absent) evidence.
- **`robots.txt` correctly walls off the desk** (`/desk`, `/desk/`,
  `/login`, `/api/`, `/_serverFn/`, `/newsletter/confirm`) even though (see
  QA-01) its `Sitemap:` line is wrong.

## Not assessed / out of scope for this pass

- AI-backed scan/draft/editorial flows: ran with `TOWNREPORTER_CLAUDE_CODE=0`
  (no model calls), so the actual scan → lead → draft → publish pipeline
  content quality was not exercised end-to-end here — the walkthrough lane
  already covers the model-absent state; I did not duplicate that.
- Second-identity signup rejection (the "first account owns the desk, later
  identities are 403" contract mentioned in `deskMiddleware`'s docstring) —
  I created and used the first account but ran out of budget before
  registering a second identity to confirm the 403 live.
- `ops/*.ps1` scripts were read, not executed, per the brief's explicit
  instruction not to start/stop/restart any scheduled task or service on
  this machine; no runtime findings from that layer beyond what static
  reading shows (nothing alarming noted).
