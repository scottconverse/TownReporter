# Engineering Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-29
**Role:** Principal Engineer
**Scope audited:** Full repository at `C:\Users\scott\Desktop\Code\townreporter-dev` — application source (`src/`), server middleware (`server/`), build and ops scripts (`scripts/`, `ops/`), migrations, CI configuration, the built output in `.output/`, and the running built server at `http://127.0.0.1:3200`. Node v25.9.0 on Windows 11; PostgreSQL 5433.
**Auditor posture:** Balanced

---

## TL;DR

This is a well-built codebase with an unusually honest engineering culture — the comments record *why* a fix exists, prior audit findings are cited by ID in the code that closed them, and the security-critical paths (SSRF at connect time, the ops action allowlist, the desk authorization chokepoint, public evidence gating) are genuinely careful work that would pass review at a much larger shop. 534 unit tests pass, `tsc --noEmit` is clean, and `npm audit` reports zero vulnerabilities across 475 dependencies.

The top concern is not architecture, it is a **safety net that provably cannot fire**. The "reader privacy" check the 0.5.1 release notes present as a standing guarantee contains six regular expressions with literal `0x08` backspace bytes in them; every one of them matches nothing against any HTML, forever, and the Server page therefore reports "no outside requests" unconditionally. ESLint catches this exact defect (`no-control-regex`) and ESLint is not run in CI — which is the systemic root, not the typo.

Architectural debt is moderate and concentrated in two places: schema is declared twice (18 migration files *and* 33 inline `create table if not exists` statements re-executed on every request), and the Grok App-Builder platform scaffolding this project was born in is still welded into a product that now ships as a standalone self-hosted app — including a committed OAuth client secret and ~950 lines of dead connector/P2P code. Security posture is solid at the application layer and thin at the transport layer: there are no security response headers at all on an app whose admin desk can restart the machine.

## Severity roll-up (engineering)

| Severity | Count |
|---|---|
| Blocker | 1 |
| Critical | 2 |
| Major | 11 |
| Minor | 7 |
| Nit | 2 |

---

## What's working

- **SSRF is closed at the right layer.** `src/lib/news/fetch-url.ts:73-96` installs a `guardedLookup` on undici's connector so the address *approved* is the address *connected to*, and `fetchPublicHttpTracked` (lines 145-172 of the same file) re-validates every redirect hop with `redirect: "manual"`. The comment explains DNS rebinding correctly and the fix actually implements it. The address blocklist in `src/lib/news/url-guard.ts:27-51` covers IPv4-mapped IPv6 in both dotted and hex forms — `::ffff:7f00:1` resolves to 127.0.0.1 and is blocked. This is better than most production code I have reviewed.
- **The ops action surface is a real allowlist, not a claimed one.** `src/lib/ops/actions.ts` holds six literal ids and `src/lib/ops/actions.server.ts:27-91` maps each to a fixed executable plus a fixed argument array. No caller input reaches a command line. `runOpsAction` (`src/lib/ops/dashboard.ts:36-38`) validates against the allowlist *before* anything else touches the value, then rate-limits, then audits. Given that this feature can restart the machine, the care is proportionate.
- **Authorization has a single chokepoint and a script that guards it.** Every one of the ~70 desk server functions goes through `deskMiddleware` (`src/lib/news/desk-auth.ts`), which composes `assertSameSiteRequest` → `requireUserId` → `requireEditor`. I checked all 80 `createServerFn` declarations; the only ones without middleware are the deliberately public paper/evidence reads. `scripts/check-auth-invariant.mjs` exists to keep dev and build from disagreeing about the auth flag — a class of bug most teams discover in production.
- **Public evidence is gated by publication, not by obscurity.** `listPublicCaptureHistory` and `loadVersion` (`src/lib/news/evidence.ts:258-261`, `297-299`) both refuse any URL not present in `publishedSourceUrls()`. An anonymous caller cannot read captures from an unpublished Dark Desk investigation. There is a 317-line test file dedicated to this.
- **Prompt hygiene on the CLI path is deliberate.** `src/lib/news/ai-claude-code.server.ts:160-178` passes `--setting-sources ""`, an empty `--allowed-tools`, and sends the prompt over stdin rather than argv — with `assertNotAnArgument` making that a refusal rather than a convention. The reasoning about process-visible command lines is correct.
- **CI is broader than most.** `.github/workflows/ci.yml` runs typecheck, the unit suite, a lifecycle e2e against `npm run dev`, a desk-flows e2e, *and* a job that builds and boots `.output` — with a comment explaining that a 200 is not proof a page works. That last job exists because a real Blocker got past a green pipeline once.
- **Concurrency was fixed at the database, not in JavaScript.** `enqueueJob` (`src/lib/news/jobs.ts:157-193`) documents that check-then-act is not a guarantee and leans on the partial unique index from `migrations/0017_one_open_job.sql`, with `on conflict do nothing` making the loser silent. The claim-token heartbeat in `executeJob` is the right shape for a stale-reclaim guard.
- **Rendering is safe by construction.** The only `dangerouslySetInnerHTML` in the tree is a static literal. `src/components/story-body.tsx` renders model-authored article bodies through React escaping with an href regex constrained to `https?://` and `rel="noreferrer"` on every link.
- **Dependency surface is clean.** `npm audit` reports 0 vulnerabilities of any severity across 287 production and 137 dev dependencies. `tsc --noEmit` passes with no output.

---

## What couldn't be assessed

- **Production telemetry, real traffic, and real load.** All performance findings are reasoned from code plus local measurement against the Postgres on 5433. Where I project remote-database latency I say so and label it a projection.
- **The Linux/Vercel deployment paths.** `NITRO_PRESET=vercel` and non-Windows hosting are documented but I only exercised the Windows self-hosted build at `127.0.0.1:3200`. The Windows-only ops layer (ENG-017) is inferred from `process.platform === "win32"` branches and `powershell.exe` invocations, not from a Linux run.
- **The live-model paths.** `RUN_LIVE_MODEL_TESTS` was not set and I made no billed model calls, so Scan, Draft, Dark Desk and Opinion were reviewed as code and not exercised end to end. ENG-013 (prompt trust boundary) is therefore a code-reading finding, not a demonstrated exploit.
- **The desk UI behind sign-in.** I did not claim a desk on 3200, so `/desk/*` was observed only in its anonymous state and through source. ENG-002's timing race is demonstrated from the code and the served HTML, not from a stopwatch on a signed-in session.
- **`townreporter-web` and `townreporter.org`** were out of bounds by instruction and were not read or contacted.

---

## Findings

> **Finding ID prefix:** `ENG-`
> **Categories:** Architecture / Correctness / Security / Performance / Data provenance / Dependencies / Hygiene

### [ENG-001] — Blocker — Data provenance — The reader-privacy check can never fire; it reports "no outside requests" unconditionally

**Evidence**

`src/lib/ops/health.server.ts:331-338` builds the regexes that `checkThirdParty` uses to detect third-party assets in the served HTML. Rendered with `cat -A`, the source is:

```
    const autoLoaded = [
      /<script^H[^>]*^Hsrc="(https?:\/\/[^"]+)"/gi,
      /<link^H[^>]*^Hhref="(https?:\/\/[^"]+)"/gi,
      /<img^H[^>]*^Hsrc="(https?:\/\/[^"]+)"/gi,
      /<iframe^H[^>]*^Hsrc="(https?:\/\/[^"]+)"/gi,
      /<video^H[^>]*^Hsrc="(https?:\/\/[^"]+)"/gi,
      /<source^H[^>]*^Hsrc="(https?:\/\/[^"]+)"/gi,
    ];
```

`^H` is a **literal U+0008 backspace byte**, not the two-character escape `\b`. Codepoint dump of line 332 (`[...line].map(c => c.charCodeAt(0))`):

```
47 60 115 99 114 105 112 116 8 91 94 62 93 42 8 115 114 99 61 34 40 104
 /  <  s  c  r  i  p  t  ␈  [  ^  >  ]  *  ␈  s  r  c  =  "  (  h
```

The compiled pattern therefore requires a backspace character immediately after the tag name and immediately before `src=`. No HTML document contains that. Verified directly:

```
html = '<script src="https://www.googletagmanager.com/gtag/js"></script>'
/<script\x08[^>]*\x08src="(https?:\/\/[^"]+)"/gi  ->  []          (shipped)
/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi      ->  ['https://www.googletagmanager.com/gtag/js']   (intended)
```

`checkThirdParty` (`health.server.ts:339-359`) therefore always ends with an empty `hosts` set and always returns `state: "ok"`, `value: "no outside requests"`.

ESLint flags exactly this — `npx eslint .` reports `no-control-regex` errors on lines 332 through 337 — and ESLint is not in `.github/workflows/ci.yml` (see ENG-012). `grep` across all tracked source found control characters in this one file and nowhere else, so the defect is isolated; the gate that would have caught it is not.

There is no test for `checkThirdParty` anywhere in the tree (`grep -rn "checkThirdParty\|Reader privacy" --include="*.test.*"` returns nothing).

**Why this matters**

The 0.5.1 release notes lead with "The reader is nobody's product" and state: *"a cold load of the paper makes zero outside requests"* and *"The Server page checks that and will tell you if it stops being true."* The first half is currently true; the second half is not, and cannot become false in a way the operator would see. The module's own docstring says the check exists "as a standing check rather than a one-off audit" precisely because "the beacon and the Google font links were both invisible until someone looked at the served HTML."

A monitor that always reports green is worse than no monitor, because it is *believed*. If a future change reintroduces a Google Fonts link, an analytics beacon, or an embedded YouTube iframe on the public paper, the Server page will show a green "Reader privacy — no outside requests" row while readers are being tracked, and the operator has been told in the README that this row is the thing that would tell them otherwise. For a product whose entire differentiator is that it does not sell its readers, this is the single highest-consequence defect in the tree.

**Blast radius**
- Adjacent code: `checkThirdParty` is the only consumer of these regexes. The sibling probes in the same file (`checkPublic`, `checkTunnel`, `checkWatchdog`, `checkDisk`, `checkDatabase`, `checkJobs`) are unaffected and were spot-checked — none contain control characters.
- Shared state: the `HealthCheck` shape in `src/lib/ops/health.ts` and the "worst state decides the page" rollup are unchanged by the fix; only the `third-party` row's value changes.
- User-facing: after the fix the Server page will start reporting real findings on `/desk/ops`. Operators who have grown used to a permanent green row will see a warn state the first time anything legitimate appears (a story-embedded iframe, for example) — so the fix needs to land with the `<a href>`-excluded matching preserved, which the current logic already does correctly.
- Migration: none.
- Tests to update: none exist. A regression test is part of the fix, not optional — feed `checkThirdParty`'s matching logic a fixture containing a `<script src>` and a `<link href>` to an outside host and assert both are found, plus an `<a href>` to an outside host and assert it is *not*.
- Related findings: ENG-012 (ESLint red and absent from CI — the gate that would have caught this). Cross-role: the Test Engineer should see this as a coverage gap on the ops module; the Technical Writer should see the README's 0.5.1 privacy claim as unsupported until the fix lands.

**Fix path**

1. Replace the six literal `0x08` bytes with the two-character escape `\b`. The intended pattern is `/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"/gi` and the analogues; I verified this matches correctly.
2. Extract the matching into a pure exported function — `extractAutoLoadedHosts(html: string, ownOrigin: string): string[]` — so it can be tested without a network fetch, and add the fixture test above to `src/lib/ops/ops.test.ts`.
3. Add `npx eslint .` to the CI `test` job (ENG-012). Without step 3 this exact class of defect can recur in any file.
4. Consider a repository-wide guard: a one-line test asserting no tracked source file contains bytes in `[\x01-\x08\x0b\x0c\x0e-\x1f]`. The sweep is cheap and this is the second-order lesson.

---

### [ENG-002] — Critical — Architecture — The desk sign-in redirect is an inline timer that string-matches the `<h1>`, and can eject a signed-in editor

**Evidence**

`src/routes/__root.tsx:69-74` injects this script into the `<body>` of **every page**, public and desk alike:

```js
setTimeout(function(){
  var h=document.querySelector("h1");
  if(!h)return;
  var t=h.textContent||"";
  if(t.indexOf("Checking sign-in")!==-1||t.indexOf("Opening the desk")!==-1)
    location.replace("/login");
},1200);
```

Observed against the running build at `127.0.0.1:3200`:

```
$ curl -s http://127.0.0.1:3200/desk | grep -o '<h1[^>]*>[^<]*</h1>'
<h1 class="mt-2 font-display text-3xl font-semibold">Opening the desk</h1>
```

`/desk` returns **200** for an anonymous visitor. The only thing that sends them to `/login` is this timer matching that string.

The problem is that "Opening the desk" is also what a **successfully signed-in** editor sees. `src/routes/desk.tsx:48-56`:

```tsx
if (user) {
  if (desk.isPending) {
    return <ScreenPending title="Opening the desk" kicker="Editor desk" hint="Checking this newsroom…" />;
  }
```

So if `myDesk()` has not resolved within 1200 ms of first paint, an editor who *is* signed in is redirected to `/login`. `myDesk()` → `requireEditor()` → `ensureNewsroomSchema()` runs two `create table if not exists`, an `alter table … add column if not exists`, and a `create unique index if not exists` before its two selects (`src/lib/news/membership.ts:48-98`) — five DDL round trips plus two queries before the page can render. On a remote Postgres, or during a cold PGLite bootstrap, exceeding 1200 ms is entirely plausible; see ENG-005.

`src/routes/login.tsx:314` also renders the literal string `"Opening the desk…"`. It is not currently an `<h1>`, so the timer does not fire on it — but nothing in the codebase records that this is load-bearing.

Nothing tests this behaviour. `grep` for either string across `*.test.*` and the e2e scripts finds only `scripts/site-walkthrough.mjs:140`, which *asserts on* the string rather than exercising the redirect.

**Why this matters**

This is the mechanism that implements the documented entry to the desk — the README tells a new operator to "Open http://localhost:8080/login and create an editor account", and every other route into the desk depends on this redirect. It is implemented as a substring match against rendered English copy, in a `setTimeout`, in an inline script with no test.

Two failure modes, both silent:

1. **A copy change breaks sign-in.** Renaming "Opening the desk" to anything else — a plausible UX edit — leaves anonymous visitors parked on a fake desk page indefinitely with no redirect and no error.
2. **A slow database ejects a real editor.** The signed-in `desk.isPending` state renders the matched string. Slow database, cold start, or a Dark Desk page paying the DDL cost in ENG-005 and the editor is bounced to `/login` mid-session. From the editor's seat this is indistinguishable from being signed out, and it gets *more* likely exactly when the system is already under stress.

To be precise about what this is **not**: no data is exposed. The server functions behind the desk are correctly gated — I confirmed an unauthenticated server-function call returns 403 — and the anonymous `/desk` page renders no newsroom content. This is a correctness and reliability failure on the primary flow, not an authorization bypass.

**Blast radius**
- Adjacent code: `src/routes/desk.tsx:48-56` and `:93-99` (both `ScreenPending` titles), `src/components/paper-chrome.tsx:271` (`title="Checking sign-in"`), `src/routes/login.tsx:314`. All four are coupled to the literal in `__root.tsx:72` with nothing declaring the coupling.
- Shared state: the `RedirectToSignIn` component in `desk.tsx:103` and `SESSION_WAIT_MS` are the intended mechanism the timer is compensating for; whatever made them insufficient is the actual bug to find.
- User-facing: after a proper fix, anonymous visitors to `/desk` get a deterministic redirect (ideally server-side), and signed-in editors stop being at risk of eviction on a slow load.
- Migration: none.
- Tests to update: none exist. The `desk-flows-e2e.mjs` suite should gain a case that loads `/desk` signed-out and asserts arrival at `/login`, and a case that throttles `myDesk()` past 1200 ms with a session present and asserts the editor stays on the desk.
- Related findings: ENG-005 (the DDL-per-request cost that makes the 1200 ms window reachable). Cross-role: the UI/UX auditor will likely see the same screens; the Test Engineer should see this as an untested primary flow.

**Fix path**

Move the decision out of the DOM. Preferred shape, in order of increasing effort:

1. **Short term (same sprint):** replace the substring match with an explicit signal. Have `desk.tsx` and `paper-chrome.tsx` set `document.documentElement.dataset.authState = "pending" | "anonymous"` and have the root script act on `anonymous` only — never on `pending`. That alone removes the eviction risk and the copy coupling.
2. **Correct shape:** resolve the session during SSR for `/desk` and return a `302` to `/login` when there is no session. `getSessionUser()` in `src/lib/auth/verify.server.ts:57` already does exactly this work and is safe to call from a route loader; the cookie is same-origin and rides the request. An anonymous visitor then never receives a desk shell at all, and the timer can be deleted.
3. Whichever path is chosen, add the two e2e cases above so the flow has a test that runs again.

---

### [ENG-003] — Critical — Security — Four documents instruct operators to set `NEWSROOM_SETUP_TOKEN` on a public host; the code path was removed

**Evidence**

`src/lib/news/membership.ts:1-19` opens with:

```
  There is no setup token.
  ...
  An audit raised it as a Critical: guessable, no throttling, no entropy floor.
  Removing the mechanism closes that more completely than hardening it
  ...
  The trade, stated in the README: on a fresh public deployment the first
  person to reach /login owns the desk. Sign in first.
```

`src/lib/news/membership.test.ts:86` enforces the removal: `assert.doesNotMatch(code, /NEWSROOM_SETUP_TOKEN/, "the token must be gone from the code path")`.

But the documentation still tells operators the opposite. `grep -rn "NEWSROOM_SETUP_TOKEN"` across the repo:

- `README.md:58` — "With no `NEWSROOM_SETUP_TOKEN`, the first account becomes the newsroom owner. **On a public host, set that token — signup alone does not own the desk.**"
- `README.md:195` — "**Set `NEWSROOM_SETUP_TOKEN` on a public host.**"
- `docs/setup.md:49` — "On a public host, set `NEWSROOM_SETUP_TOKEN` and paste it on Create the desk — signup alone does not own the desk."
- `docs/editor.md:32` — "If the operator set that token, Create the desk asks for it — an account without it does not own the newsroom."
- `docs/manual.md:709` — table row: "`NEWSROOM_SETUP_TOKEN` | **Required on a public host**, so signing up does not own the desk"
- `.env.example:76` — "Claim the desk on a public host. When set, the first owner must pass this token."

The trade the code comment says is "stated in the README" is not stated in the README. The README says the opposite.

**Why this matters**

The exposure window is real and the documentation makes it worse rather than better. On a public deployment, whoever reaches `/login` first owns the newsroom permanently — and once claimed, `deskIsClaimed()` makes every later signup a dead door (`src/lib/auth/server.ts:240-254`), so the legitimate operator cannot even create an account to contest it.

The removal of the token is a defensible engineering decision, argued well in the comment. The defect is that five documents and an env-var template tell the operator a control exists. An operator who reads `docs/manual.md:709` ("Required on a public host") will set the variable, believe the desk is protected, and take their time signing in — which is precisely the behaviour that loses the desk. The docs have converted a documented ninety-second race into an *undocumented* one, and given the operator a false reason to relax during it.

`.env.example:76` is the sharpest instance: an operator copying it to `.env` gets a commented-out variable that reads as a working security control.

**Blast radius**
- Adjacent code: `requireEditor` (`membership.ts:87-117`), `claimOwner` (`:154-176`), `deskIsClaimed` (`:120-127`), and the Better Auth `databaseHooks.user.create.before` block (`src/lib/auth/server.ts:240-254`) are the whole surviving mechanism. No code change is required for the doc fix.
- Shared state: `newsroom_members` and the `newsroom_members_one_owner` partial unique index in `migrations/0012_newsroom_appliance.sql`. Note that `ensureNewsroomSchema` swallows the index creation failure on PGLite (`membership.ts:81-83`), so on the embedded database the one-owner guarantee is JS-only — worth a line in whatever doc replaces this.
- User-facing: operators reading the corrected docs will know to sign in immediately after first boot. That is the actual mitigation and it needs to be stated as the first step of public deployment, not a footnote.
- Migration: none.
- Tests to update: `membership.test.ts:86` already asserts the code path is gone. Extend the same idea to the docs — assert that no tracked `.md` or `.env.example` file mentions `NEWSROOM_SETUP_TOKEN`. That converts this finding into a gate rather than a promise.
- Related findings: none in engineering. Cross-role: this is squarely a Technical Writer finding as well; the two roles should file one coordinated fix.

**Fix path**

1. Remove the variable from `.env.example`, `README.md` (both places), `docs/setup.md`, `docs/editor.md`, and `docs/manual.md`.
2. Replace it in each place with the real instruction, which the code comment already words well: *"On a fresh public deployment the first person to reach `/login` owns the desk. Sign in before you announce the address."* On `README.md:58` this should be a bolded warning, not a parenthetical — it is the only thing standing between a public deployment and a stranger owning the newsroom.
3. Add the docs assertion to `membership.test.ts` so the two cannot drift apart again.
4. Optional but cheap, and it would close the window rather than document it: bind the *first* claim to the loopback interface only — an operator on the box can claim, a stranger over the tunnel cannot. That preserves the "no shared secret" property the comment argues for while removing the race entirely.

---

### [ENG-004] — Major — Correctness — `leaveAsEditor` deletes every member of the newsroom, not the caller

**Evidence**

`src/lib/news/membership.ts:136-146`:

```ts
export async function leaveAsEditor(userId: string): Promise<void> {
  await ensureNewsroomSchema();
  const sql = await getSql();
  const mine = await sql<{ role: string; newsroom_id: number }>`
    select role, newsroom_id from newsroom_members where user_id = ${userId} limit 1
  `;
  if (!mine[0] || (mine[0].role !== "owner" && mine[0].role !== "editor")) {
    throw new ForbiddenError();
  }
  await sql`delete from newsroom_members where newsroom_id = ${mine[0].newsroom_id}`;
}
```

The final statement filters on `newsroom_id`, not on `user_id`. Any member — including a non-owner `editor` — who invokes "Leave as editor" deletes the owner's membership row along with their own. It is reachable through the `leaveEditor` server function (`src/lib/news/claim.ts:56`), which is behind `authMiddleware` but not behind any role check.

The docstring says "Owner/editor drops the desk. Paper stays. Next sign-in owns it," which describes the observed behaviour for the *owner* case and does not acknowledge the editor case.

Exposure is bounded by the fact that there is no invite UI: the README states plainly that a second editor must be added by hand to `newsroom_members`, so a newsroom with exactly one member — the common case — cannot hit this. It bites the two-person newsrooms that `docs/setup.md#a-second-editor` describes how to create.

**Why this matters**

In a two-editor newsroom, the junior editor clicking a button labelled "Leave as editor" silently evicts the owner. Both are then locked out of the desk (`deskIsClaimed()` returns false, so the *next* person to sign in — anyone, on a public host — becomes owner). On a tunnelled public deployment that is a privilege-escalation path: an editor who wants ownership can drop the desk and immediately re-claim it, and there is no audit event recording that they did (`leaveEditor` in `claim.ts` does not call `audit()`).

There is no recovery UI. Restoring the original owner requires direct SQL against `newsroom_members`.

**Blast radius**
- Adjacent code: `claimOwner` (`membership.ts:154-176`) and `requireEditor` (`:87-117`) both read from the same table and will behave correctly once the delete is scoped. `src/routes/desk.index.tsx` renders the button.
- Shared state: `newsroom_members` — and note the `newsroom_members_one_owner` partial index only constrains *how many* owners exist, not who may delete one.
- User-facing: after the fix, "Leave as editor" removes only the caller. An owner leaving a newsroom that still has editors needs a product decision (see below) — that is not purely an engineering call.
- Migration: none. No stored data shape changes; existing rows are unaffected.
- Tests to update: `src/lib/news/membership.test.ts` has no multi-member case. A test with an owner plus an editor, asserting that the editor leaving leaves the owner row intact, is the regression test.
- Related findings: ENG-003 (the same "first sign-in owns the desk" window is what makes the re-claim escalation possible on a public host).

**Fix path**

1. Scope the delete: `delete from newsroom_members where user_id = ${userId}`.
2. Decide the owner-leaves policy explicitly, since it is now a real branch. The safest default: an owner may only leave when they are the last member; otherwise refuse with a message naming the remaining editors. Promotion of an editor to owner is a separate deliberate action.
3. Add an `audit(userId, "membership", "left")` call in `leaveEditor` — every other privileged desk action audits and this one does not.
4. Add the two-member test.

---

### [ENG-005] — Major — Architecture — Schema is declared twice, and ~106 DDL statements re-run on every Dark Desk request with all errors swallowed

**Evidence**

The project has a real migration system: 18 files in `migrations/`, a runner in `scripts/migrate.mjs`, tracked in a `_migrations` table, applied atomically per file (`src/lib/db.ts:175-182`). `db.ts:212-214` states the intent clearly: *"Schema comes from `migrations/*.sql` … define tables there, never inline in server functions."*

Runtime code does the opposite in six modules. `grep -rn "create table if not exists" --include="*.ts" src/lib` (excluding tests) returns **33** statements across:

| File | statements |
|---|---|
| `src/lib/news/investigate.ts` | 20 |
| `src/lib/news/dark.ts` | 5 |
| `src/lib/news/editorial.server.ts` | 2 |
| `src/lib/news/membership.ts` | 2 |
| `src/lib/news/ops.ts` | 2 |
| `src/lib/news/jobs.ts` | 1 |
| `src/lib/db.ts` | 1 |

`ensureInvestigateSchema` (`src/lib/news/investigate.ts:426-`) splits a `SCHEMA_SQL` template — **73 statements**, counted by parsing the literal — and executes each one, then runs a further ~33 `alter table … add column if not exists` / `drop constraint if exists` / `create unique index if not exists` statements. Roughly **106 sequential round trips**. It is not memoized; there is no `schemaReady` flag in the file.

Every statement is wrapped in a bare swallow:

```ts
for (const stmt of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
  try {
    await sql.query(stmt);
  } catch {
    /* already exists / older PGLite */
  }
}
```

`ensureDarkSchema` (`src/lib/news/dark.ts:~200-218`) runs its own five tables and indexes and then calls `ensureInvestigateSchema()`. Every Dark Desk list server function calls it: `listDarkSignals` (`dark.ts:220`), `listDarkRuns` (`:236`), `listDarkPromises` (`:250`), `listInvestigations` (`:264`), `listWorthALook` (`:359`). The Dark Desk page mounts several of these together, so one page load can issue five hundred-plus DDL statements.

Measured cost, local Postgres on 5433, warm pooled connection:

```
116 sequential trivial round trips:          19 ms
116 sequential CREATE TABLE IF NOT EXISTS:   79 ms
```

So on this machine the cost is tens of milliseconds per call and is not itself alarming — I want to be accurate about that. The concern scales two ways I did **not** measure and am therefore labelling as projection: on a remote Postgres (the README documents Neon and RDS) at a 20 ms round trip, 106 sequential statements project to roughly 2 seconds per `ensure` call; on the PGLite WASM fallback each statement is materially slower than native.

The drift risk is acknowledged in-tree. `src/lib/news/jobs.ts:53-63`: *"It has to be in both places … Declared twice is a drift risk, so `jobs.test.ts` asserts the two definitions match — a duplicated invariant that nobody checks is how the last one failed."* That discipline was applied to exactly one of the 33 statements.

**Why this matters**

Three separate problems from one root:

1. **The swallowed catch hides real failures.** A genuinely failed migration — a permissions problem, a type conflict, a disk-full — is indistinguishable from "already exists". The system continues and fails later, somewhere else, with a confusing error. `investigate.ts` has 20 tables' worth of this.
2. **Two sources of truth drift.** `migrations/` is what a fresh Postgres gets; the `ensure*` functions are what a running process asserts. Only one pair of them is checked for agreement. When they diverge, preview and production have different schemas and the difference is invisible until a query fails on one and not the other.
3. **Latency scales with schema size, on every request.** The cost is paid per call, not per process, and it grows every time a table is added. It also feeds ENG-002: `myDesk()` pays `ensureNewsroomSchema`'s five statements before the desk can render, inside a 1200 ms window that redirects the editor away if it is missed.

**Blast radius**
- Adjacent code: all six modules listed above, plus `src/lib/news/dark-open.ts:10` and every desk server function that begins with an `ensure*` call. `src/lib/news/ops.ts:34-45` also runs `create table` + `create index` inside `assertRate`, i.e. before every rate-limited action.
- Shared state: the `_migrations` table and the 18 files in `migrations/`. The two systems currently do not know about each other — the `ensure*` functions do not record anything in `_migrations`.
- User-facing: no visible change from memoizing. Moving the definitions into migrations changes first-boot behaviour for the PGLite path, which currently relies on the inline DDL because `import.meta.glob` is unavailable under plain `node --test` (`db.ts:167-169`) — that dependency is real and needs handling, not deleting.
- Migration: **yes, and it needs care.** The `ensure*` functions include destructive-shaped statements (`drop constraint if exists`, `drop index if exists` on `artifact_versions`, `entities`, `source_monitors`, `recurring_baselines`). Those are one-time repairs that belong in a numbered migration, not in a hot path. Moving them is the migration work.
- Tests to update: `jobs.test.ts` already asserts the jobs index matches `0017`. `scripts/no-destructive-migrate.test.mjs` exists and should be extended to cover the inline DDL too. Expect the investigate/dark test files (`investigate.test.ts`, `investigate.forensics.test.ts`, `investigate.nongate.test.ts`, `dark.open.test.ts`) to depend on `ensureInvestigateSchema` for their fixtures — they will need a shared setup helper.
- Related findings: ENG-002 (the 1200 ms desk window), ENG-016 (`assertRate` running DDL per action).

**Fix path**

1. **Cheapest, highest value, do it first:** memoize each `ensure*` function on a module-level promise, the same pattern `db.ts:216` already uses for `getSql`. One line each, removes ~99% of the round trips, changes no semantics.
2. Replace the bare `catch {}` with a catch that rethrows anything that is not a duplicate-object error (Postgres SQLSTATE `42P07` table exists, `42710` object exists, `42701` column exists). Swallowing only the errors you mean to swallow is the difference between idempotence and blindness.
3. Move the schema itself into `migrations/` — `0019_investigate.sql` and friends — and reduce the `ensure*` functions to `await ensureDbReady()`. Keep a single inline fallback for the `node --test` path that `db.ts:167` documents, and make `jobs.test.ts`'s "the two definitions match" assertion the template for the rest.
4. Move the `drop constraint` / `drop index` repairs out of the request path into a one-time numbered migration.

---

### [ENG-006] — Major — Architecture — One serial in-process drainer means a single editorial starves every other job for up to 45 minutes

**Evidence**

`src/lib/news/jobs.ts:210-237`:

```ts
let draining = false;                                   // :28

export async function drainQueuedJobs(): Promise<{ ran: number }> {
  if (draining) return { ran: 0 };
  draining = true;
  ...
    for (let n = 0; n < 8; n++) {
      const next = await sql`… where status = 'queued' … order by id asc limit 1`;
      if (!next[0]) break;
      const took = await executeJob(next[0]);           // awaited, serial
      if (took) ran += 1;
    }
  ...
}
```

One process-wide boolean, one sequential loop, one job at a time. `kickJobs()` (`:196-200`) fires a `setTimeout` that returns immediately if `draining` is already true, so a newly enqueued job does not start anything.

The four job kinds have wildly different durations. `jobs.ts:4-9` documents it: *"'editorial' is the slow one … a piece takes ten to forty minutes — far longer than any other job here."* `.env.example` confirms the ceiling: `EDITORIAL_TIMEOUT_MS=2700000` (45 minutes), with the note *"Measured runs: 9m53s to >30m."*

`STALE_RUNNING_SECONDS` is 120 and the heartbeat (`executeJob:264-269`) refreshes `updated_at` every 30 s, so a long editorial is correctly *not* reclaimed — which is the right behaviour and also means nothing else can preempt it.

**Why this matters**

An editor starts an editorial at 10:00. At 10:05 they click "Draft" on a story in the queue, or "Run scan", or "Keep digging" on a Dark Desk file. That job is enqueued, `kickJobs()` no-ops because `draining` is true, and it sits at `status: 'queued'` until the editorial finishes — up to 45 minutes later. The desk shows it as queued with no explanation of what it is behind.

This is not a rare edge case; it is the normal shape of a working newsroom afternoon. The Server page's "Work queue" row (`health.server.ts:125-150`) will show `1 running · 3 queued` and the operator has no way to see that the one running job is the 40-minute one.

The `for (let n = 0; n < 8; n++)` bound also means a burst of more than eight queued jobs leaves the remainder waiting for the next `kickJobs()` or cron tick, with no scheduled retry inside the process.

**Blast radius**
- Adjacent code: every `enqueueJob` call site — `desk.ts` (`runScan`, `draftLead`, `pullTodo`), `dark.ts` (`runDarkDesk`, `openDarkInvestigation`, `continueInvestigation`, `findSomethingToDigInto`), `opinion.ts:194` (`startEditorial`). All four `perform*Work` functions in `executeJob:274-286`.
- Shared state: the `draining` module boolean is **process-local**, so it is also not a distributed lock. The `claim_token` + `STALE_RUNNING_SECONDS` mechanism is what makes multi-process safe, and it would continue to hold under a concurrent drainer — that is the good news for the fix.
- User-facing: after the fix, an editor can draft a story while an editorial is being written. Job status copy on `/desk/queue` and `/desk/opinion` should say what a job is waiting on.
- Migration: none if the fix is per-kind concurrency. If a `lane` column is added to `desk_jobs`, that is one additive migration and the partial unique index in `0017` must be reviewed against it.
- Tests to update: `src/lib/news/jobs.test.ts` covers the claim-token and one-open-job invariants; it has no concurrency-starvation case. Add one that enqueues a slow `editorial` and a `draft` and asserts the draft completes without waiting.
- Related findings: ENG-011 (the ops log read that also blocks) — both are "one slow thing blocks the observability of the slow thing".

**Fix path**

1. **Simplest correct fix:** make `draining` a per-kind map — `draining: Set<JobKind>` — and run one drainer per kind. `editorial` gets its own lane and stops blocking `scan`/`draft`/`dark`. The database-side claim (`executeJob:242-253`) already makes this safe; nothing about the locking needs to change.
2. Surface the wait in the UI: when a job is `queued` and another job is `running`, say what it is behind and roughly how long. The data is already in `desk_jobs`.
3. Raise or remove the `n < 8` bound and re-`kickJobs()` when the loop exits with work remaining, so a burst drains rather than waiting for a cron tick.

---

### [ENG-007] — Major — Security — No security response headers on any route

**Evidence**

Observed against the running built server:

```
$ curl -s -D- -o /dev/null http://127.0.0.1:3200/
HTTP/1.1 200
content-type: text/html; charset=utf-8
Date: Sun, 30 Aug 2026 00:33:25 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked
```

`grep -rni "content-security-policy\|x-frame-options\|strict-transport\|x-content-type-options\|referrer-policy"` across `src/`, `server/`, `scripts/`, `ops/` and `vite.config.ts` returns **nothing**. `server/middleware/` contains exactly two files — `canonical-host.ts` (a `www` → apex 308) and `grok-pwa.ts` — neither of which sets headers.

There is no CSP, no `X-Content-Type-Options: nosniff`, no `Referrer-Policy`, no `Strict-Transport-Security`, and no `frame-ancestors`.

**Why this matters**

The application-layer defences here are good, which is exactly why the missing transport layer stands out — there is no second line if one of them slips.

- **No CSP.** The root document already carries an inline `<script>` (`__root.tsx:69-74`), so a CSP would need a hash or nonce, but its absence means any future XSS — in a model-authored article body, a source title, a lead — executes with nothing in the way. The desk's `runOpsAction` can restart the machine; script execution on a signed-in editor's origin is the highest-value target in this app.
- **No `Referrer-Policy`.** The paper links out to civic sources on every story. Readers' visits to `townreporter.org/articles/<slug>` are leaked in the `Referer` to those third parties by default. For a product whose 0.5.1 headline is "The reader is nobody's product," this is on-theme and cheap to fix.
- **No `nosniff`.** `/feed`, `/sitemap.xml`, and the source-zip route serve content with types a sniffing browser could reinterpret.
- **No `frame-ancestors`.** I want to be honest about this one: clickjacking of `/desk/ops` is largely mitigated already, because the session cookie is `SameSite=Lax` and is therefore not sent in a cross-site iframe (`src/lib/auth/server.ts:265`). The framed desk would render signed-out. `frame-ancestors` is defence in depth here, not an open hole.

The docs endorse Cloudflare Tunnel, and Cloudflare can add some of these at the edge — but the product is self-hosted and the README explicitly supports "a host that can run Node 22", so the app should not depend on a specific front door for its baseline headers.

**Blast radius**
- Adjacent code: a new `server/middleware/security-headers.ts`, registered alongside `canonical-host.ts`. Nothing else changes.
- Shared state: the inline script at `__root.tsx:72` needs a `'sha256-…'` hash or a nonce in the CSP — or, better, it should be deleted as part of ENG-002's fix, which removes the constraint entirely.
- User-facing: none if the CSP is built correctly. A too-tight CSP breaks the paper silently, so it should ship in `Content-Security-Policy-Report-Only` first and be promoted after a walkthrough.
- Migration: none.
- Tests to update: none exist. `scripts/smoke-built-server.mjs` is the natural home for an assertion that each header is present on `/`, `/desk`, and `/feed`.
- Related findings: ENG-002 (whose fix removes the inline script that complicates the CSP), ENG-008 (the preview bridge, which is the only legitimate reason this app is ever framed — and only on `*.grok-sandbox.com`).

**Fix path**

1. Add a Nitro/H3 middleware next to `canonical-host.ts` setting, on every response:
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer` on the public paper, which matches the product's stated posture)
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains` — only when the request arrived over HTTPS, so local `http://localhost` development is unaffected
   - `X-Frame-Options: DENY` plus CSP `frame-ancestors`, with the `*.grok-sandbox.com` exception the preview bridge needs (or unconditionally `DENY` once ENG-008's scaffolding is removed)
2. Ship a `Content-Security-Policy-Report-Only` first. `default-src 'self'`; `img-src 'self' data:`; `style-src 'self' 'unsafe-inline'` (Tailwind); `script-src 'self'` plus the hash for the root inline script if it still exists; `connect-src 'self'`. The paper genuinely loads nothing from outside — that is ENG-001's whole subject — so a strict policy is achievable here in a way it usually is not.
3. Assert the headers in `smoke-built-server.mjs` so they cannot silently disappear.

---

### [ENG-008] — Major — Architecture — Grok App-Builder platform scaffolding is still welded into a standalone self-hosted product

**Evidence**

TownReporter now ships as an MIT-licensed self-hosted app that a stranger clones and points at their own city. It was built inside the Grok App-Builder sandbox, and that platform's scaffolding is still first-class in the tree.

**A committed OAuth client secret.** `src/lib/auth/preview.ts:19-21`:

```ts
export const PREVIEW_CLIENT_ID = "grok_preview";
export const PREVIEW_CLIENT_SECRET =
  "8bcdb7fc5a33874ad933ca568918d5790388a0795e44c4d1dea691f801b17ec5";
```

To be fair to it: the docstring correctly describes this as a dedicated low-privilege client scoped to `*.grok-sandbox.com` callbacks, and I confirmed it does **not** reach the client bundle — `grep` finds it only in `.output/server/_ssr/server-Bv7pZS44.mjs`, never under `.output/public`. It is nonetheless a live shared secret committed to a public repository, and `src/lib/auth/server.ts:80-81` falls back to it whenever `GROK_AUTH_CLIENT_ID`/`SECRET` are unset — which is every self-hosted install.

**Dead modules with zero importers.** `grep -rn` across `src/` excluding each module's own directory:

| Module | Lines | Importers outside itself |
|---|---|---|
| `src/lib/multiplayer/` (`index.ts`, `p2p.ts`) | 570+ | 0 |
| `src/lib/app-data/` (5 files incl. a 369-line `client.server.ts`) | ~600 | 0 |

Neither is referenced from any route, component, or library module. `src/lib/app-data/server-only.ts:6` still emits guidance about "connector tools" that nothing calls.

**Preview bridge mounted on every reader's page.** `src/routes/__root.tsx:75` renders `<PreviewHostBridge />` unconditionally, on the public paper as well as the desk. It does correctly no-op at top level (`src/lib/preview-host-bridge.ts:74`: `if (window.parent === window) return () => {};`), so a normal reader pays only the import.

**The embedder allowlist trusts localhost at any port.** `src/lib/preview-embedder-origin.ts:1-12`:

```ts
if (host === "grok.com" || host.endsWith(".grok.com")) return true;
if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
```

On a self-hosted install, any page served from any port on the same machine can frame the paper and drive `navigate` and `history` messages. Impact is genuinely small — `isSafeBridgePath` (`preview-host-bridge.ts:51-64`) restricts navigation to same-origin paths and explicitly excludes `/auth/popup` and `.zip` — so this is a widened surface with no demonstrated exploit, not a hole.

**Other residue:** `package.json` still declares `"name": "app-builder-workspace"`, and `src/lib/auth/server.ts:1-31`'s module docstring describes a three-mode deployment model in which self-hosting is not one of the modes.

**Why this matters**

Grouped as one finding because it is one root cause and one coordinated fix. Individually each item is small; together they are a meaningful tax on the product's central claim:

- A self-hoster auditing this repo before pointing it at their city council finds a hardcoded secret and 1,100 lines of unreachable networking code. That is a trust cost on a product whose pitch is transparency.
- The dead code has to be read, typechecked, linted, and maintained by everyone who touches the repo, and it will be mistaken for live code at some point.
- The auth module's documented mental model does not match the deployment the README describes, which makes the auth code — the part most needing clarity — harder to reason about than it should be.

**Blast radius**
- Adjacent code: `src/lib/auth/server.ts:79-81` and `:127-148` (the preview fallbacks and `trustedOrigins` construction), `src/lib/auth/popup.server.ts`, `src/lib/auth/gate-*.ts`, `src/lib/news/membership.ts:43-46` (`isGrokPreviewHost`), `src/routes/__root.tsx:75`, `server/middleware/grok-pwa.ts`, `scripts/grok-pwa-*.mjs`.
- Shared state: `GROK_*` environment variables documented in `.env.example:100-107`, and the `.grok/app-env.json` file that `scripts/with-app-env.mjs` reads. The `__grok/` manifest and icons referenced from `__root.tsx:45-46` are live — the PWA manifest is a real feature and must not be removed along with the rest.
- User-facing: none if the removal is careful. If the preview bridge is removed outright, the app can no longer be previewed inside the Grok sandbox — that is a **product decision**, not an engineering one, and needs to be made before the work starts.
- Migration: none for the dead modules. Removing the preview OAuth fallback changes behaviour for anyone currently relying on it, so it needs to be staged.
- Tests to update: `scripts/grok-pwa-plugin.test.mjs` (536 lines) and `scripts/grok-pwa-shared.mjs` (564 lines) are substantial and cover the PWA path — keep them. Nothing tests `multiplayer/` or `app-data/`, which is itself the evidence they are dead.
- Related findings: ENG-007 (`frame-ancestors` becomes unconditional `DENY` if the bridge goes), ENG-009 (the PGLite payload is the other build-level residue of the same platform origin).

**Fix path**

1. **Decide first:** is `*.grok-sandbox.com` preview still a supported surface for this product? The answer determines everything below and is a product call.
2. If no: delete `src/lib/auth/preview.ts`, `src/lib/preview-host-bridge.ts`, `src/lib/preview-embedder-origin.ts`, `src/components/preview-host-bridge.tsx`, and the `GROK_*` fallbacks in `server.ts`. Keep the `__grok/` PWA manifest — that is a real feature with real tests.
3. If yes: keep the bridge but gate it on `isSandboxPreviewGuestHost(window.location.hostname)` at the top of `installPreviewHostBridge`, so it is inert on every self-hosted install rather than merely inert at top level. Drop `localhost`/`127.0.0.1` from `isGrokEmbedderOrigin` and put them behind an explicit dev flag.
4. Delete `src/lib/multiplayer/` and `src/lib/app-data/` regardless. Zero importers, ~1,100 lines.
5. Rename the package to `townreporter`. `src/lib/version.ts` has a test asserting `APP_VERSION` tracks `package.json`, so verify that test still passes after the rename.
6. Rotate `PREVIEW_CLIENT_SECRET` at the broker if the preview client survives step 2.

---

### [ENG-009] — Major — Performance — 16.4 MB of PGLite WASM is emitted into the public client asset directory on every build

**Evidence**

```
$ ls -laS .output/public/assets | head -4
-rw-r--r-- 10087563  pglite-Dvh6EH3w.wasm
-rw-r--r--  6293225  pglite-CY5zdaUl.data
-rw-r--r--   395059  initdb-D0MRRSih.wasm
-rw-r--r--   287431  index-iDBuFJRX.js

$ du -sh .output/public/assets
17M
```

Total client JavaScript across the whole build is 687 KB; the remaining 16.4 MB is PGLite's WebAssembly runtime and its bundled data file.

PGLite is server-only. `src/lib/db.ts:199-204` throws outright if `getSql()` is reached in a browser, and `getPglite()` (`:228-236`) is used only by the Better Auth Kysely dialect on the server. Nothing on the client can or does load these files — I confirmed the served home page contains no reference to them (`curl … / | grep -c pglite` → `0`).

The files are emitted because `@electric-sql/pglite` is dynamically imported (`db.ts:133`) from a module in the shared graph, so the bundler traces its assets into the public output.

**Why this matters**

Not a runtime cost to readers — no browser fetches these — but a real cost everywhere else:

- Every build writes and every deploy ships 16.4 MB of unreachable binary. On a Vercel deployment (`NITRO_PRESET=vercel`, documented in the README) that is 16.4 MB against the static-asset budget and upload time on every push.
- The self-hosted source archive at `/TownReporter.zip` and the `artifacts/` copies inherit the weight.
- More importantly it is a signal: a server-only database engine being traced into the client graph means the client/server boundary is not as clean as the codebase's careful `.server.ts` discipline suggests. The `youtube.ts` / `fetch-url.ts` / `render-fetch.ts` / `primegov.ts` chunks in `.output/public/assets` are the same phenomenon in a smaller form — the entire scraping pipeline is compiled into browser-reachable lazy chunks because `fetch-url.ts` is deliberately dual client/server (`fetch-url.ts:108-112` explains why). Those chunks are dead in a browser; they are also a free read of the ingest logic for anyone curious.

**Blast radius**
- Adjacent code: `src/lib/db.ts:128-194`, `src/lib/auth/pglite-dialect.ts`, `src/lib/auth/server.ts:166-168`. `vite.config.ts` is where the exclusion would go.
- Shared state: the PGLite fallback path is a documented product feature ("Unset `DATABASE_URL` → embedded PGLite"), so the server-side import must keep working — this is purely about what lands in `public/`.
- User-facing: none. No browser loads these files today.
- Migration: none.
- Tests to update: none exist. A build-output assertion in `scripts/smoke-built-server.mjs` — "no file in `.output/public` exceeds 1 MB" — would catch this and anything like it.
- Related findings: ENG-008 (same platform-origin root), ENG-015 (compression).

**Fix path**

1. Add `@electric-sql/pglite` to Vite's SSR externals / `optimizeDeps.exclude` so its assets are emitted into the server bundle only. Verify by rebuilding and confirming the PGLite fallback still boots with `DATABASE_URL` unset — `ensureDbReady()` at `db.ts:295-299` is the path to watch.
2. Add the build-output size assertion above.
3. Separately, consider whether `fetch-url.ts` genuinely needs to be client-reachable. Its docstring says a `.server.ts` module is "rejected outright by TanStack's import protection" — if the client only needs `assertHttpUrl` and `sha256`, splitting those two into a small pure module and moving the fetching half to `fetch-url.server.ts` would take the whole ingest pipeline out of the browser graph.

---

### [ENG-010] — Major — Security — `fetchSourceText` reads response bodies with no size cap, while the cap that exists is wired to only one of three fetch paths

**Evidence**

`src/lib/news/body-limit.ts` exists precisely for this, and its docstring is unambiguous (`:9-13`):

> *"The SSRF guard decides where the desk may connect. It says nothing about how many bytes are safe to accept once connected, and the desk fetches URLs it discovered from sites it does not control. One URL — chosen by an editor or turned up mid-investigation — could exhaust the worker and take every queued job with it."*

`readBodyCapped` is correct: it refuses an oversized declared `content-length` before opening the tap and stops mid-stream otherwise.

It has exactly one consumer. `grep -rn "body-limit\|readBodyCapped" --include="*.ts" src` (excluding tests):

```
src/lib/news/body-limit.ts:25  (definition)
src/lib/news/body-limit.ts:97  (definition)
src/lib/news/ingest.ts:8       import { limitFor, readBodyCapped }
```

`fetchSourceText` — the other main ingest entry point, reached from editor-supplied and model-discovered URLs — does not use it. `src/lib/news/fetch-url.ts:207`:

```ts
const html = await res.text();
```

Unbounded. The `.slice(0, 14000)` two lines later truncates for the *parser*, after the entire body is already resident. That is exactly the failure the `body-limit.ts` docstring says it was written to prevent.

Other unbounded reads on attacker-influenced responses: `src/lib/news/search-web.ts:205, 231, 252, 284, 398, 419, 462`; `src/lib/news/youtube.ts:90, 275, 299, 447, 613`; `src/lib/news/reddit.server.ts:110`; `src/lib/news/render-fetch.ts:204`.

**Why this matters**

`fetchSourceText` is on the path where untrusted URLs arrive: an editor pasting a link, a scan following a discovered URL, Dark Desk chasing an attachment. A hostile or merely broken server responding with a chunked body and no `content-length` streams until the Node process runs out of heap. The consequence named in the docstring is right: the worker dies and takes every queued job with it, including any in-flight editorial that has been running for thirty minutes.

This is not hypothetical for a civic scraper. Municipal portals serve large PDFs and occasionally misconfigured infinite responses; the desk follows links unattended.

**Blast radius**
- Adjacent code: `fetchSourceText` (`fetch-url.ts:187-222`) and its callers in `desk.ts` (scan/pull), `investigate.ts`, and `dark.ts`. The `search-web.ts`, `youtube.ts`, `reddit.server.ts` and `render-fetch.ts` reads listed above share the pattern and should be fixed in the same pass.
- Shared state: `BODY_LIMIT.html` (5 MB) and `BODY_LIMIT.pdf` (25 MB) are already chosen and justified. The `CappedRead` refusal type maps onto `fetch-outcome.ts`, so the editor-visible outcome vocabulary already has somewhere to put "body-too-large".
- User-facing: a page that exceeds the cap becomes a recorded fetch outcome the editor can see, instead of a dead worker. That is strictly better and matches how `ingest.ts` already behaves.
- Migration: none.
- Tests to update: `src/lib/news/body-limit.test.ts` covers `readBodyCapped` well. `fetch-url.test.ts` needs a case using the `setFetchImplForTests` seam (`fetch-url.ts:44`) that returns an oversized body and asserts a typed refusal rather than an OOM.
- Related findings: ENG-006 (a dead worker takes the whole serial queue with it — the two compound).

**Fix path**

1. In `fetchSourceText`, replace `await res.text()` with `readBodyCapped(res, limitFor(url.toString(), ctype))` and decode the returned bytes, mapping a refusal to the existing `fetch-outcome` vocabulary. The content-type gate above it (`fetch-url.ts:196-206`) already narrows the cases.
2. Do the same for the `search-web.ts`, `youtube.ts`, `reddit.server.ts` and `render-fetch.ts` reads. Those consume smaller documents, so `BODY_LIMIT.html` is the right ceiling for all of them.
3. Add the oversized-body test to `fetch-url.test.ts`.
4. Consider making `readBodyCapped` the only sanctioned way to read a response in `src/lib/news/`, enforced by a small lint rule or a grep-based test — the same "ship a gate, not a promise" pattern `no-destructive-migrate.test.mjs` already follows in this repo.

---

### [ENG-011] — Major — Performance — The Server page reads whole log files into memory, and two of those files can never be rotated while the app runs

**Evidence**

`src/lib/ops/health.server.ts:369-390` — `readLogs`, called by `collectHealth()` on every `/desk/ops` load:

```ts
const text = await readFile(path, "utf8");
const lines = text.split(/\r?\n/).filter(Boolean);
out.push({ name: w.name, path, lines: lines.slice(-perFile) });
```

Four files are read in full — `watchdog.log`, `app.err.log`, `app.out.log`, `cloudflared.err.log` — to display the last **12** lines of each.

`watchdog.log` self-rotates at 2 MB (`ops/watchdog.ps1:36-38`), so it is bounded. The other three are not. `ops/rotate-logs.ps1:30-37` explicitly declines to rotate them:

```powershell
  try {
    Copy-Item $f.FullName $prev -Force
    Set-Content -Path $f.FullName -Value "" -NoNewline -ErrorAction Stop
    $rotated += $f.Name
  } catch {
    # Held open by the process that writes it. Expected, not an error.
    $held += $f.Name
  }
```

with the header comment confirming the design: *"`app.out.log`, `app.err.log` and the cloudflared logs are the redirected stdout of live processes … nothing else can truncate or rename them until that process stops. Those files roll over on their own when their process restarts."*

So `app.out.log` grows monotonically for the lifetime of the server process — and TownReporter is designed to be long-lived (0.5.0's headline change was moving off Vercel precisely so the process would stay up). On this machine the logs are currently near-empty because the instances were freshly started, so I have not observed the failure; the growth path is structural rather than measured, and I am stating it as such.

**Why this matters**

The Server page is the page an operator opens *when something is wrong* — which is exactly when the logs are largest. A server that has been up for weeks with a chatty error can have a multi-hundred-megabyte `app.err.log`, and the page whose job is to explain that reads the whole thing into a string, then splits it into an array of every line, to show twelve. On a 200 MB file that is roughly 400 MB of transient allocation in the same process that is serving the paper.

The failure is self-reinforcing: the sicker the machine, the more likely the diagnostic page is to make it worse. The module's own docstring states the principle it is violating — *"a dashboard whose job is to tell you what is broken must never be the thing that is broken"* (`health.server.ts:25-27`) — and the per-probe try/catch discipline honours it everywhere except here.

**Blast radius**
- Adjacent code: `collectHealth` (`health.server.ts:399-418`), `getOpsHealth` (`src/lib/ops/dashboard.ts:20-25`), and the log panel in `src/routes/desk.ops.tsx`. `ops/rotate-logs.ps1` and `ops/start-townreporter.ps1` (which sets up the redirection) are the other half.
- Shared state: the `logs/` directory layout and the `LogTail` type. `ops/watchdog.ps1` writes to the same directory.
- User-facing: none visible — the same 12 lines are shown. The page stops being a memory hazard.
- Migration: none.
- Tests to update: `src/lib/ops/ops.test.ts` covers the health-state helpers but not `readLogs`. A test with a large fixture file asserting bounded memory (or at minimum bounded bytes read) is the regression test.
- Related findings: ENG-006 (both are "the slow path blocks the thing that would explain the slow path").

**Fix path**

1. Read from the end. Open the file, `stat` it, and read only the final ~64 KB with a positional read, then take the last 12 lines from that. Handles any file size in constant memory, roughly ten lines of code.
2. Give the app's own stdout a rotating writer rather than a raw shell redirect — either a size-capped Node stream in `ops/start-townreporter.ps1`, or have the watchdog restart-with-rotate when `app.out.log` exceeds a threshold. `ops/watchdog.ps1:36-38` already implements exactly this pattern for its own log; reuse it.
3. Add a disk-usage row for `logs/` to the Server page. The `checkDisk` probe already exists and this is one more `HealthCheck`.

---

### [ENG-012] — Major — Hygiene — ESLint reports 14 errors and is not run in CI

**Evidence**

```
$ npx eslint .
✖ 29 problems (14 errors, 15 warnings)
```

Seven of the 14 errors are `no-control-regex`. **Six of them — `src/lib/ops/health.server.ts:332-337` — are ENG-001, the Blocker in this report.** The configured linter identifies the highest-severity defect in the codebase, today, in under thirty seconds.

(The seventh, `src/lib/news/storable-text.ts:20`, is a false positive: that regex is a deliberate control-character *sanitizer* built from `\\u0000` escapes in ASCII source, and it is correct as written. It needs an inline `eslint-disable-next-line no-control-regex` with a one-line reason, not a change.)

`.github/workflows/ci.yml` runs, across its jobs: `npm ci`, `npm run typecheck`, `npm test`, `npx playwright install`, `node scripts/lifecycle-e2e.mjs`, `node scripts/desk-flows-e2e.mjs`, and a built-server smoke. It does not run `eslint`. `package.json` has no `lint` script.

The project has an ESLint configuration (`eslint.config.mjs`) with `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, and `eslint-config-prettier` — the team set the standard and then did not enforce it.

Warnings also include two genuine React hook issues in `src/routes/desk.dark.tsx:77` (ref-in-cleanup) and `:360` (missing `advance`, `digging`, `starting` dependencies) — the kind that produce stale-closure bugs in a page that runs long polling loops.

**Why this matters**

This is the systemic root of ENG-001 and the highest-leverage single change in this report. The CI in this repo is otherwise thoughtful — there is a long comment in `ci.yml` explaining that a green pipeline once let two Blockers through and describing the jobs added in response. The same reasoning applies here and was not extended to the linter.

A red linter also decays: with 14 standing errors, a fifteenth is invisible. That is how a control character survived in a security-adjacent file.

**Blast radius**
- Adjacent code: 8 files carry the 29 problems. Two errors and one warning are auto-fixable; the six `no-control-regex` errors are ENG-001; the remainder are unused variables and hook dependencies.
- Shared state: `eslint.config.mjs`, `package.json` scripts, `.github/workflows/ci.yml`.
- User-facing: none directly. Fixing the `desk.dark.tsx` hook dependencies may change Dark Desk polling behaviour — that needs a walkthrough of the page, not just a green lint.
- Migration: none.
- Tests to update: none. This *is* the test.
- Related findings: ENG-001 (caught by `no-control-regex`), and the two hook warnings are worth their own look during the Dark Desk UI pass.

**Fix path**

1. Fix the 14 errors. Six are ENG-001; one is the `storable-text.ts` false positive that needs a documented inline disable; the rest are small.
2. Add `"lint": "eslint ."` to `package.json` and `- run: npm run lint` to the `test` job in CI, **failing the build**. Not `--max-warnings` juggling to start with — errors only, so it goes green immediately after step 1 and stays meaningful.
3. Address the 15 warnings in a follow-up, then tighten to `--max-warnings 0`.
4. Consider adding `npm audit --audit-level=high` to the same job. The dependency surface is clean today (0 vulnerabilities across 475 packages) and a gate keeps it that way for free.

---

### [ENG-013] — Major — Security — Untrusted scraped content enters model prompts with no trust boundary, and the one path with network tools enabled ingests it

**Evidence**

The desk's whole function is to fetch documents it does not control — city pages, PrimeGov packets, YouTube auto-captions, Reddit posts — and put their text into model prompts. `src/lib/news/fetch-url.ts:187-222` returns raw extracted page text; `src/lib/news/ingest.ts`, `investigate.ts` and `dark.ts` assemble it into prompt packs.

I found no delimiting, escaping, or instruction-boundary marker around that content in the prompt assembly. `src/lib/news/dark-prompt.ts` and `claim-hygiene.ts:88` contain instruction text, and fetched content is concatenated into the same message.

For most paths this is well contained: `claudeCodeChat` defaults `allowedTools` to `[]` (`src/lib/news/ai-claude-code.server.ts:172-173`), so Scan, Draft and the Dark Desk planner are text-in/text-out with no tools to abuse. That is a deliberate, good decision.

The Opinion desk is the exception, by design. `ai-claude-code.server.ts:141-147`:

> *"The editorial writer needs WebSearch and WebFetch because its whole posture is receipts, and without them it is instructed to drop its own claims appendix."*

And the pointers the editorial follows are not all editor-typed. `src/lib/news/opinion.ts:173-179`:

```ts
for (const u of JSON.parse(art[0].source_urls) as string[]) {
  pointers.push({ what: "cited by our story", url: u });
}
```

Those URLs came from a published story, which came from a scan of civic sources. So: attacker-influenced page content → cited in a story → becomes a pointer → fetched by a model that has `WebFetch` and `WebSearch` and is writing a document the paper will publish under its own name.

**Why this matters**

I want to size this honestly. There is no demonstrated exploit here — I made no model calls (see "What couldn't be assessed"), the tool set is narrow (`WebSearch`, `WebFetch` — no file access, no bash), and the human publish gate is real and is the product's central safeguard. This is not an RCE path.

What it is: for a product whose entire proposition is that a reader can trust what the paper prints, a poisoned civic page that can steer an editorial's framing — or cause an outbound fetch to an attacker-chosen URL carrying investigation context in the path — is squarely in scope. The threat model of "we scrape adversarial documents and feed them to a model with network access" deserves an explicit answer in a release candidate, and right now the codebase does not have one. Compare this to how carefully the same file reasons about command-line visibility and harness inheritance: the rigour is there, it just has not been pointed at this.

**Blast radius**
- Adjacent code: `src/lib/news/dark-prompt.ts`, `investigate.ts` (prompt assembly), `opinion.ts:145-181` (pointer construction), `editorial.server.ts` (the job that runs it), `ai-claude-code.server.ts:141-178`.
- Shared state: the `editorial_requests.pointers_json` column, and `articles.source_urls` / `provenance_json` as the upstream of those pointers.
- User-facing: no change to legitimate use. Editorials continue to fetch their receipts.
- Migration: none.
- Tests to update: `src/lib/news/voice-boundary.test.ts` and `claim-hygiene.test.ts` are the closest existing coverage. A test that feeds a fixture page containing injected instruction text through the prompt assembly and asserts it lands inside the untrusted-content markers is the shape to add.
- Related findings: ENG-010 (same untrusted-fetch surface, different failure mode).

**Fix path**

1. Wrap all fetched document text in an explicit, unambiguous boundary in every prompt that carries it — a delimiter plus a standing instruction that content inside is data to be reported on and never instructions to follow. Cheap, and it is the single highest-value mitigation.
2. For the Opinion path specifically, distinguish pointer provenance. `pointers` already carries a `what` field ("pasted by the editor" vs "cited by our story"); pass that distinction through to the prompt so the model treats an editor-chosen URL and a scraped URL differently.
3. Record every `WebFetch` target the editorial run touches in the fact sheet, so an editor reviewing the draft can see where it went. The appendix machinery already exists for exactly this kind of receipt.
4. Write the threat model down — one section in `docs/manual.md` stating what the desk assumes about fetched content and what the human gate is responsible for. Half the value of this finding is making the assumption explicit.

---

### [ENG-014] — Major — Performance — Every unauthenticated evidence request full-scans and JSON-parses every published article

**Evidence**

`src/lib/news/evidence.ts:141-158`:

```ts
async function publishedSourceUrls(): Promise<Set<string>> {
  const sql = await getSql();
  const rows = await sql`
    select provenance_json, source_urls from articles where status = 'published'
  `;
  const urls = new Set<string>();
  for (const row of rows) {
    const items = provenanceFromRow(row.provenance_json);
    for (const item of items) if (item.url) urls.add(item.url);
    try {
      const listed = JSON.parse(row.source_urls || "[]") as unknown;
      ...
```

No `limit`, no index usage beyond the status filter, no cache. It is called by `loadVersion` (`:297`) and `listPublicCaptureHistory` (`:259`), which back four **unauthenticated** server functions: `getPublicEvidence`, `listPublicHistory`, `listPublicVersionsForUrl`, `comparePublicEvidence` (`:400-414`). `comparePublishedEvidence` with `a` and `b` set calls `loadVersion` twice, so two full scans per request.

None of these has a rate limit — `assertRate` is only applied to desk actions.

This is worth contrasting with `searchPublished` in `src/lib/news/public.ts:110-146`, where the same class of problem was found by a previous audit (ENG-008 in that pass), measured at 20,000 stories, fixed with GIN trigram indexes in `migrations/0018_search_index.sql`, and given a re-runnable proof (`npm run proof:search`). That is the right treatment; the evidence path did not receive it.

**Why this matters**

Both the row count and the per-row work grow forever — an archive is append-only by nature. Each row's `provenance_json` and `source_urls` are JSON blobs parsed on every request, and the resulting `Set` is discarded immediately. At Longmont's current scale this is invisible; at a few thousand stories with provenance lists it becomes tens of milliseconds of CPU and megabytes of transient allocation per anonymous request, on endpoints anyone can call in a loop.

Because the evidence routes are the paper's public proof-of-work — the thing a skeptical reader clicks to check a story — they are also the ones most likely to be hit hard when a story gets attention. The gating logic itself is correct and I credited it above; it is the cost of that gating that is unbounded.

**Blast radius**
- Adjacent code: `loadVersion` (`evidence.ts:281-329`), `listPublicCaptureHistory` (`:258-279`), `comparePublishedEvidence` (`:336-398`), and the routes `src/routes/evidence.$versionId.tsx` and `src/routes/evidence.compare.tsx`.
- Shared state: the `articles.provenance_json` and `articles.source_urls` columns, and `provenanceFromRow` / `parseUrlList` in `src/lib/paper.ts` and `findings.ts`.
- User-facing: none. Same answers, faster.
- Migration: yes if the recommended shape is taken — a `published_source_urls` lookup table (or a materialized set) maintained on publish/unpublish, which needs a backfill from existing published articles.
- Tests to update: `src/lib/news/evidence.public.test.ts` (317 lines) covers the gating thoroughly and is the safety net for this change. It must still pass unchanged — the gate's *behaviour* must not move, only its cost.
- Related findings: ENG-005 (both are "work that should happen once is happening per request").

**Fix path**

1. **Short term:** memoize the `Set` in the process with a short TTL (30–60 s) and invalidate it in `publishLead` / `deleteArticle` / `addCorrection`. One small module, no schema change, removes the scan from the hot path.
2. **Correct shape:** maintain a `published_source_urls (url text primary key, article_id int)` table written on publish and cleared on unpublish/delete, then replace `isPublicUrl` with an indexed lookup. Backfill from existing published rows in the same migration.
3. Consider a modest rate limit on the four public evidence functions — they are the only unauthenticated endpoints doing non-trivial per-request work.
4. Follow the `proof:search` precedent: a small script that measures the before/after at a realistic archive size, so the fix is demonstrated rather than asserted.

---

### [ENG-015] — Minor — Performance — Responses are served without compression

**Evidence**

```
$ curl -s -D- -o /dev/null -H "Accept-Encoding: gzip, br" http://127.0.0.1:3200/assets/index-iDBuFJRX.js
content-length: 287431
vary: Accept-Encoding
```

No `content-encoding`, despite the client offering gzip and brotli and the server declaring `Vary: Accept-Encoding`. The HTML document is likewise uncompressed (16 KB, chunked). Total client JavaScript is 687 KB, all served raw.

Caching is handled correctly — `cache-control: public, max-age=31536000, immutable` plus an `etag` on hashed assets — so this is the one missing piece of an otherwise well-configured static layer.

Honest mitigation: the documented deployment fronts the app with a Cloudflare Tunnel, and Cloudflare compresses at the edge, so public readers over that path are largely unaffected. Anyone reaching the app directly — on the LAN, on localhost, or behind a proxy that does not compress — pays the full 687 KB.

**Fix path**

Enable Nitro's `compressPublicAssets` (precompresses `.gz`/`.br` at build time) and add runtime compression for SSR HTML. One config change in `vite.config.ts` / the Nitro options. Optionally assert `content-encoding` in `scripts/smoke-built-server.mjs`.

---

### [ENG-016] — Minor — Hygiene — `desk_rate` and `audit_events` grow without bound, and both run DDL on every write

**Evidence**

`src/lib/news/ops.ts:34-48` — `assertRate` executes `create table if not exists desk_rate`, `create index if not exists desk_rate_window_idx`, then an insert, then a count, on **every** rate-limited action. `audit` (`:65-77`) does the same for `audit_events`.

Every row is kept forever. The count query filters to `created_at > now() - interval '1 hour'`, so old rows contribute nothing but storage and index size. There is no retention job, and neither table appears in `ops/rotate-logs.ps1` or the watchdog.

The removed newsletter code (documented in the comment at `src/lib/news/public.ts:171-193`) was faulted by a previous audit for exactly this — *"it inserted a rate-limit row before checking the ceiling, so rejected requests still wrote forever with no retention"* — and the retention half of that lesson was not carried over to `desk_rate`.

Note the insert-before-count ordering here is deliberate and correct (`ops.ts:21-29` explains it well); the issue is only retention and the per-call DDL.

**Fix path**

Move both `create table` statements into a migration (part of ENG-005). Add a cheap retention sweep — `delete from desk_rate where created_at < now() - interval '2 days'` on the monitors cron tick — and pick a deliberate retention for `audit_events` (it is a security log, so longer, but bounded and stated in the docs).

---

### [ENG-017] — Minor — Architecture — The ops layer is Windows-only, and CI runs only on Linux, so it has no automated coverage at all

**Evidence**

`src/lib/ops/actions.server.ts:107` resolves every PowerShell action to the literal `"powershell.exe"`. Four of the six ops actions — `watchdog`, `restart-app`, `restart-tunnel`, `rotate-logs` — are PowerShell. `src/lib/ops/health.server.ts:44` gates four probes on `process.platform === "win32"` and returns `"not a Windows host"` otherwise. The whole `ops/` directory is `.ps1` and `.vbs`.

`src/routes/desk.ops.tsx:162` renders `OPS_ACTIONS.map(...)` unconditionally — all six buttons appear regardless of platform. On a Linux host, four of them spawn a binary that does not exist; `runOpsActionById`'s catch (`actions.server.ts:119-130`) turns that into `"Failed with no output"` in the UI.

The README endorses non-Windows hosting: *"deploy to a host that can run Node 22, Playwright Chromium, and Postgres."*

`.github/workflows/ci.yml` uses `runs-on: ubuntu-latest` for every job, so the Windows-only code is never executed by CI — and the app's primary documented deployment is Windows self-hosted.

**Fix path**

Either (a) gate the UI: pass `process.platform` through `getOpsHealth` and render only the actions the host supports, with an honest note for the rest — the `OpsAction` type already has a `detail` field for saying what a button does; or (b) provide shell equivalents for the four PowerShell actions and dispatch by platform. Either way, add a `runs-on: windows-latest` matrix leg to the CI `test` job so the Windows path is executed somewhere.

---

### [ENG-018] — Minor — Security — `CRON_SECRET` is compared non-constant-time with no rate limit

**Evidence**

`src/routes/api/cron.monitors.ts:12-15`:

```ts
const hdr = request.headers.get("authorization") ?? "";
if (hdr !== `Bearer ${secret}`) {
  return new Response("forbidden", { status: 403 });
}
```

Credit where due: the endpoint fails closed when `CRON_SECRET` is unset (`503 "cron disabled"`), which I verified against the running server — `curl http://127.0.0.1:3200/api/cron/monitors` returns `503 cron disabled`. That is the important half and it is right.

The remaining issues are the `!==` comparison (not constant-time) and the absence of any rate limit or lockout on an unauthenticated endpoint that triggers model-spending work.

Realistically, remote timing attacks against a string compare over a network are impractical, so exposure here is low. The missing rate limit is the more actionable half: an attacker can guess at line speed with no penalty.

**Fix path**

Use `crypto.timingSafeEqual` on equal-length buffers (guarding the length check itself), and add a simple per-IP failure counter. Both are a handful of lines.

---

### [ENG-019] — Minor — Correctness — Child-process output accumulates without bound

**Evidence**

`src/lib/news/ai-claude-code.server.ts:229-234`:

```ts
child.stdout?.on("data", (d) => { stdout += String(d); });
child.stderr?.on("data", (d) => { stderr += String(d); });
```

No ceiling. A CLI that streams (a runaway generation, a stuck retry loop, a verbose error) accumulates into a JavaScript string until the timeout fires — up to 45 minutes on the editorial path (`EDITORIAL_TIMEOUT_MS=2700000`).

Contrast `src/lib/ops/actions.server.ts:115`, which correctly sets `maxBuffer: 2 * 1024 * 1024` on its `execFile` calls, and `health.server.ts:39` at 1 MB. The pattern is established in the codebase; this one path does not follow it.

**Fix path**

Cap both accumulators (a few megabytes is generous for a JSON envelope), and on exceeding the cap kill the tree via the existing `killTree` helper and return a typed error. `parseCliEnvelope` already handles unparseable output gracefully.

---

### [ENG-020] — Minor — Performance — Article list queries select full bodies to render summaries

**Evidence**

`src/lib/news/public.ts:37-44` (`listPublishedArticles`), `:86-93` (`listPublishedByTopic`) and `:132-141` (`searchPublished`) each `select … body … limit 30`, then run every row through `publicArticle` (`:11-31`), which unpacks the stored draft, strips the reporter notebook, and JSON-parses provenance — for a list view that renders headline, dek and topic.

Thirty full article bodies plus provenance JSON are read from the database, transformed, serialized, and sent to the client on every load of `/` — the paper's front page.

**Fix path**

Split the projection: a `listPublishedSummaries` selecting only the columns the card needs, with `getPublishedArticle` keeping the full read. `collapsePrintedDuplicates` (`desk-copy.ts`) operates on headlines and should not need the body — worth confirming when making the change.

---

### [ENG-021] — Minor — Hygiene — The package is still named `app-builder-workspace`

**Evidence**

`package.json:2` — `"name": "app-builder-workspace"`, in a repository published as TownReporter with an MIT license and a "clone it, point it at your city" README.

`src/lib/version.ts` has a passing test asserting `APP_VERSION` tracks `package.json`'s version, so the rename is safe as long as only `name` changes.

**Fix path**

Rename to `townreporter`. Grep for the old string first (`scripts/with-app-env.mjs` and the Grok tooling may reference it), and re-run `npm test` to confirm the version-lock test still passes.

---

### [ENG-022] — Nit — Hygiene — Unused imports flagged by the linter

`src/routes/login.tsx:7` imports `claimDesk` and never uses it; `src/lib/news/trash.ts:4` declares `keepACopy` unused. Both are `@typescript-eslint/no-unused-vars` warnings and both are auto-fixable. Folded into ENG-012's cleanup.

---

### [ENG-023] — Nit — Dependencies — No explicit TLS configuration on the Postgres pool

`src/lib/db.ts:115` constructs `new Pool({ connectionString })` with no `ssl` option, and `src/lib/auth/server.ts:167` does the same. `pg` does not negotiate TLS unless the connection string asks for it, so a `DATABASE_URL` without `?sslmode=require` connects in the clear. The README's example (`postgres://user:pass@host:5432/townreporter`) has no sslmode.

Not a defect — the operator controls the connection string, and the documented Neon URLs include it — but worth a line in `docs/setup.md` telling self-hosters with a remote database to include `?sslmode=require`.

---

## Patterns and systemic observations

**1. Verification is written down but not always executed — the gaps are where a gate is missing.**
ENG-001 (privacy regex), ENG-012 (ESLint absent from CI), ENG-002 (untested primary flow), and ENG-017 (Windows code never run by CI) are one pattern. This codebase's own comments repeatedly articulate the right principle: *"a duplicated invariant that nobody checks is how the last one failed"* (`jobs.ts:59`), *"A 200 is not proof a page works"* (`ci.yml`). Where those principles were turned into a running check, the code is solid. Where they were left as a comment, defects survived. **Adding `eslint` to CI is the single highest-leverage change in this report** — it closes the Blocker's root cause for the cost of one line.

**2. Work that should be per-process or per-deploy is being done per-request.**
ENG-005 (~106 DDL statements per Dark Desk call), ENG-014 (full article scan per evidence request), ENG-016 (`create table` inside the rate limiter), ENG-011 (whole log files read to show 12 lines), ENG-020 (full bodies for a list). Same shape five times, and they compound: the DDL cost in ENG-005 is what makes ENG-002's 1200 ms window reachable, and ENG-011's memory hazard fires on the very page an operator opens when ENG-006's queue is stuck. A single "do it once, cache it, invalidate deliberately" pass would clear most of this.

**3. The product outgrew the platform it was born in, and the scaffolding did not come out.**
ENG-008 (committed preview secret, ~1,100 lines of dead connector and P2P code, an embedder allowlist that trusts localhost), ENG-009 (16.4 MB of server-only WASM in the public asset directory), ENG-021 (`app-builder-workspace`), and the auth module's docstring describing a three-mode deployment model that does not include self-hosting. Individually small; together they are the largest source of *confusion* in the tree, and confusion in the auth module is expensive. One coordinated removal sprint, gated on a single product decision about whether sandbox preview is still supported.

**4. Prior audits were taken seriously, and it shows.**
Findings from earlier passes are cited by ID *in the code that closed them* — `ENG-004` at `jobs.ts:62`, `ENG-005` at `public.ts:155`, `ENG-007`/`UIUX-01`/`QA-001` at `public.ts:193`, `ENG-008` at `public.ts:118`, `ENG-010` in `.gitignore`, `TE-04` in `ci.yml`, `TW-006` in `.env.example`, `UIUX-05` in `opinion.ts:44`. The fixes are real fixes, not label changes, and several come with a re-runnable proof (`npm run proof:search`). This is a team that acts on audits, which is the main reason I have written the findings above with concrete fix paths rather than hedged recommendations.

---

## Dependency snapshot

`npm audit`: **0 vulnerabilities** — 0 critical, 0 high, 0 moderate, 0 low — across 475 total dependencies (287 production, 137 dev, 52 optional). `tsc --noEmit`: clean.

| Dependency | Version | Concern |
|---|---|---|
| `nitro` | `3.0.260610-beta` | Pre-release pinned exactly. The server runtime for the whole product is on a beta with no stable line to fall back to. Deliberate (TanStack Start requires it) and correctly pinned, but worth an explicit upgrade watch. |
| `vite` | `^8.2.0` | Major version ahead of the ecosystem's common baseline. Combined with the `nitro` beta, the build toolchain is on the leading edge; a broken transitive release would be hard to bisect. Consider `npm ci` with the committed lockfile as the only supported install path (CI already does this). |
| `@electric-sql/pglite` | `^0.5.4` | Pre-1.0 and, per ENG-009, currently emitting 16.4 MB into the public asset directory. Server-only in intent. |
| `playwright` | `^1.62.0` | Declared as a **production** dependency, not a dev dependency. Correct here — the app genuinely drives Chromium at runtime for YouTube transcripts and JS civic sites — but it means every install pulls the full browser tooling, and it should stay a conscious choice rather than an accident. |
| `nf3` | pinned `0.3.17` via `overrides` | An override with no comment explaining why. Undocumented pins are the ones nobody dares remove; a one-line note in `package.json` or `docs/setup.md` would age better. |
| `better-auth` | `~1.6.30` | Tilde-pinned, which is appropriate for the auth layer. Its env shim appears in the client bundle as getters over an empty object, not as values — I checked, and no secret is exposed. |
| `zod` | `^4.4.0` | Used for the preview bridge envelope schemas. Note that server-function `.validator()` calls across the codebase are mostly identity functions (`(id: string) => id`) rather than Zod schemas — a hardening opportunity rather than a current defect, since every consumer re-validates against an allowlist or parameterizes into SQL. |

License posture: MIT on the project itself; no copyleft dependency surfaced in the manifest review.

---

## Appendix: artifacts reviewed

**Read in full**

`README.md` · `package.json` · `.env.example` · `.gitignore` · `.github/workflows/ci.yml` (partial — first ~80 lines plus the `smoke-built` job header) · `src/lib/db.ts` · `src/lib/auth/server.ts` · `src/lib/auth/middleware.ts` · `src/lib/auth/verify.server.ts` · `src/lib/auth/isolation.server.ts` · `src/lib/auth/preview.ts` · `src/lib/news/desk-auth.ts` · `src/lib/news/membership.ts` · `src/lib/news/url-guard.ts` · `src/lib/news/fetch-url.ts` · `src/lib/news/body-limit.ts` · `src/lib/news/jobs.ts` · `src/lib/news/ops.ts` · `src/lib/news/public.ts` · `src/lib/news/ai-claude-code.server.ts` · `src/lib/ops/actions.ts` · `src/lib/ops/actions.server.ts` · `src/lib/ops/dashboard.ts` · `src/lib/ops/health.server.ts` · `src/lib/preview-embedder-origin.ts` · `src/components/story-body.tsx` · `src/components/preview-host-bridge.tsx` · `src/routes/api/cron.monitors.ts` · `server/middleware/canonical-host.ts` · `ops/rotate-logs.ps1`

**Read in part**

`src/lib/news/opinion.ts` (1–200) · `src/lib/news/evidence.ts` (141–414) · `src/lib/news/claim-hygiene.ts` (1–90) · `src/lib/news/investigate.ts` (415–470, plus `SCHEMA_SQL` parsed programmatically) · `src/lib/news/dark.ts` (205–235) · `src/lib/preview-host-bridge.ts` (1–120) · `src/routes/__root.tsx` (1–85) · `src/routes/desk.tsx` (30–110) · `ops/watchdog.ps1` (1–50) · `scripts/check-auth-invariant.mjs` (1–60) · `src/lib/news/storable-text.ts` (14–24)

**Commands run**

`npm test` (534 tests, 531 pass, 3 skipped, 0 fail, 14.6 s) · `npx tsc --noEmit` (clean) · `npm audit --json` (0 vulnerabilities / 475 deps) · `npx eslint .` (14 errors, 15 warnings) · repository-wide control-character sweep over all tracked source · `grep` audits of all 80 `createServerFn` declarations for middleware, of `dangerouslySetInnerHTML` / `eval` / `new Function` / `innerHTML`, of `child_process` call sites, of AWS/JWT/private-key patterns, and of inline `create table if not exists` statements · secret scan of `.output/public` and `.output/server` · build-output size inventory · `curl` probes of `/`, `/about`, `/how-we-report`, `/corrections`, `/feed`, `/sitemap.xml`, `/robots.txt`, `/desk`, `/login`, `/articles/does-not-exist`, `/api/cron/monitors`, one server-function endpoint, and one hashed asset (headers and compression) against `127.0.0.1:3200` · a Node probe measuring 116 sequential trivial queries and 116 sequential `CREATE TABLE IF NOT EXISTS` statements against Postgres on 5433 · a Node probe reproducing the shipped and intended `checkThirdParty` regexes against a fixture document.

**Not read, by instruction:** `C:\Users\scott\Desktop\Code\townreporter-web` and `https://townreporter.org`. No commits, pushes, or git-state changes were made; no rows were written to any application table (the two probe tables created were dropped).
