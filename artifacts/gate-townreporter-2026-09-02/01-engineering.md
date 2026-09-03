# GauntletGate — Full lane — Role 1: Principal Engineer

**Project:** TownReporter v0.6.3 · repo `C:\Users\scott\Desktop\Code\townreporter-dev` at `f9c2a1a`
**Run date:** 2026-09-02
**Scope:** architecture, correctness, security, performance, data provenance, dependencies, the
provider registry and fail-over logic, migrations 0025–0030 and the PGLite `ensure*` duplication.
**Method:** static review of the full `src/` tree (60,295 lines TS/TSX), `migrations/`, `server/`,
`scripts/`, plus targeted runtime probes against my own PGLite dev server on **port 3323** with the
repo's fake CLIs. Production (`townreporter.org`, `townreporter-web`) was never entered, built, run
or reached. Ports 3000 / 5432 / 5433 were never bound and no process was killed.
**Builds on:** `00-walkthrough.md` (first-run: reaches core feature; coverage VALID). I did not
re-walk the UI; where a finding is the same defect the Walkthrough lane found, it says so and is
flagged **shared — do not double-count**.

---

## Severity counts

| Blocker | Critical | Major | Minor | Nit |
|---|---|---|---|---|
| **0** | **1** | **5** | **6** | **2** |

Of the 5 Majors, **one (ENG-05) is the same defect as Walkthrough Finding 1** and should be counted
once in the gate roll-up.

Evidence artifacts live in
`C:\Users\scott\Desktop\Code\townreporter-dev\artifacts\gate-townreporter-2026-09-02\artifacts\01-engineering\`.

---

## Findings

### ENG-01 · **Critical** · Access control — the ops dashboard's owner gate is client-side only

**Evidence.** `src/lib/ops/dashboard.ts:20-45`. Both `getOpsHealth` and `runOpsAction` carry
`.middleware([deskMiddleware])` and nothing else. `deskMiddleware`
(`src/lib/news/desk-auth.ts:12-20`) resolves `requireEditor(userId)` and passes through for role
`"owner"` **or** `"editor"` — it returns the role in context but never checks it. The only
owner gate on this feature is in the browser: `src/routes/desk.ops.tsx:318`
(`const isOwner = me.data?.role === "owner"`) and `:367` (`if (!isOwner) return null;`).

The same repo enforces owner **server-side** on every comparable surface:

- `src/lib/news/provider-login.ts:36-39` — `assertOwner(role)`, called as the first act of all five
  handlers, with the comment "Exported so a test can prove the refusal".
- `src/lib/news/paper-settings.ts:364, 528` — `if (me.role !== "owner") …`
- `src/lib/news/provider-settings.ts:200, 243` — same.
- `src/lib/news/membership.ts:173, 279` — `createInvite` / `leaveAsEditor`.

So ops is the one operator-power surface that was left out, not a deliberate design choice.

Artifact: `artifacts/01-engineering/eng-07-ops-owner-check.txt` (all four excerpts side by side).

**Observed vs. expected.** Expected: an editor-role caller receives 403 from `runOpsAction`, the
way they do from `startProviderLogin`. Observed: the handler's only guard is membership, and the
allowlisted ids it then executes are `watchdog`, `restart-app`, `restart-tunnel`, `rotate-logs`,
`refresh-fonts`, `migrate` — each a fixed PowerShell command run on the operator's Windows box
(`src/lib/ops/actions.server.ts:28-75`), two of which take the public paper offline.

**Why it matters.** Editor invites are a shipped, migrated feature (`migrations/0020_editor_invites.sql`,
`membership.ts` `createInvite`/`acceptInvite`) whose whole purpose is seating a *second human*. That
human gets machine-level control of the operator's PC and a one-click outage of the public site,
purely because the check lives in React. `security-headers-e2e.mjs`'s own docstring calls `/desk/ops`
"a hole … because that page carries controls that restart the app and the Cloudflare Tunnel on the
operator's own machine" — the same reasoning applies to the endpoint behind it, not just the frame.

**Impact scope.** Every deployment that has ever accepted an editor invite. One extra identity;
full ops control; no audit distinction (the `audit()` row records the acting user, so it is
detectable after the fact, not preventable). Anonymous callers are unaffected — `deskMiddleware`
does hold against them (see *What's working*).

**Fix path.** Add `assertOwner(context.role)` as the first line of both handlers in
`src/lib/ops/dashboard.ts`, importing the existing helper from `provider-login.ts` (or lifting it
into `desk-auth.ts` so there is one). Consider whether `getOpsHealth` should be owner-only too —
it reports disk, ports and service state for the host.

**Suggested test.** A unit test on the exported guard in the shape of
`src/lib/news/provider-login.test.ts`'s `assertOwner` test, plus an editor-role call in
`src/lib/news/two-editors.e2e.test.ts` asserting 403 from `runOpsAction`.

**Honest limit on this evidence.** This is **code-verified, not runtime-verified.** I deliberately
did **not** execute `runOpsAction`: every allowlisted id mutates the operator's live machine
(`Start-ScheduledTask 'TownReporter Restart'`, `'TownReporter Tunnel Restart'`, `ops/watchdog.ps1`),
which the brief forbids. What I *did* confirm at runtime is that the RPC endpoint exists and is
reachable — `GET /_serverFn/<base64 id>` on port 3323 returns `403 Forbidden` to a request with no
matching `Origin`, i.e. the transport is live and only the origin/auth layers stand in front of it.

**Cross-role.** Also a **test gap** (no privilege-boundary test anywhere in the suite —
`two-editors.e2e.test.ts` covers concurrent-edit races only) and a **docs gap** (`docs/manual.md`
does not state what an invited editor may and may not do).

---

### ENG-02 · **Major** · The Dark Desk rebuild-recovery path recreates a schema its own queries cannot use

**Evidence — reproduced.** `DARK_SCHEMA_STATEMENTS` (`src/lib/news/dark.ts:219-281`) creates
`dark_runs`, `dark_signals` and `dark_promises` with **no `newsroom_id` column**, and adds no
`alter table … add column if not exists newsroom_id`. `migrations/0012_newsroom_appliance.sql:35`
adds it, and `dark.ts` queries require it (`:314`, `:1181`, `:1323`, `:1330`, `:1335`).

I applied the ensure list verbatim to a clean PGLite instance and ran the app's own statements:

```
statements in DARK_SCHEMA_STATEMENTS: 10
dark_runs:     has newsroom_id = false
dark_signals:  has newsroom_id = false
dark_promises: has newsroom_id = false
--- dark.ts:1181 insert ---  INSERT FAILED: column "newsroom_id" of relation "dark_runs" does not exist
--- dark.ts:314  select ---  SELECT FAILED: column "newsroom_id" does not exist
--- dark.ts:1323 select ---  SELECT FAILED: column "newsroom_id" does not exist
```

Artifact: `artifacts/01-engineering/eng-01-dark-ensure-missing-newsroom-id.txt`.

**Why it matters.** `ensureSchemaOnce` (`src/lib/db.ts`) exists specifically so that "PGLite's dev
instance and this repo's own integration tests routinely drop and recreate the database a
long-lived process is still pointed at" recovers cleanly. After such a rebuild the migrations have
gone with the database and are **not** re-run on the Postgres path (only `scripts/migrate.mjs` runs
them, at build/dev start). `ensureDarkSchema()` then rebuilds `dark_runs` in its 2019 shape and
every Dark Desk RPC 500s until someone remembers to run `db:migrate`. The property the design
advertises — "the check is only ever as stale as the database it reads, which cannot be stale" — is
true of the *marker*, and false of the *statement list*.

**And the guard test does not catch it.** `src/lib/news/dark-schema-rebuild.test.ts:130-147` stages
exactly this scenario (terminate backends → `DROP DATABASE` → `CREATE DATABASE` → call
`ensureDarkSchema()` again) and then asserts only
`select to_regclass('dark_runs') is not null`. The table comes back; the table comes back *unusable*.
A test written to prove recovery asserts a weaker property than its own docstring claims.

**Impact scope.** Dark Desk (a core feature — 1,733 lines + a 1,316-line route) after any
rebuild-under-live-process, which is the documented dev and integration-test workflow. Production
is not affected while the normal `build → db:migrate → start` sequence is followed.

**Fix path.** Add `alter table <t> add column if not exists newsroom_id integer not null default 1`
for all three tables to `DARK_SCHEMA_STATEMENTS` (changing the list changes the fingerprint, so it
re-applies automatically). Better: stop hand-mirroring and have the ensure path replay
`migrations/*.sql` the way `createPgliteSql` already does.

**Suggested test.** Strengthen `dark-schema-rebuild.test.ts` to assert the *column set* of
`dark_runs` after the rebuild matches what `migrations/` defines, and add a smoke query
(`select id from dark_runs where newsroom_id = 1`) rather than a `to_regclass` existence check.

**Cross-role.** **Test gap** — hand this to the Test lane as a live example of an assertion that is
narrower than the property it names.

---

### ENG-03 · **Major** · Migration/ensure drift is systemic, and runs in both directions

**Evidence.** I parsed every `create table if not exists` / `alter … add column if not exists` in
`migrations/*.sql` and in the runtime `ensure*` lists under `src/lib/`, and diffed the column sets
per table. Artifact: `artifacts/01-engineering/eng-02-schema-drift-migrations-vs-ensure.txt`.

Columns defined in migrations and **missing from the runtime ensure**: `artifact_blobs`,
`artifact_chunks`, `audit_events`, `dark_promises`, `dark_runs`, `dark_signals`, `desk_rate`
(`newsroom_id` in each); `drafts`, `leads` and `snapshots` have no runtime definition at all while
the code that writes them assumes one.

Columns defined only in the runtime ensure and **in no migration at all**:
`desk_jobs.claim_token` (`src/lib/news/jobs.ts:129`) and `dark_signals.investigation_id`
(`src/lib/news/dark.ts:270`). `claim_token` is load-bearing — it is what stops a reclaimed job's
original executor clobbering the new one's result (`jobs.ts:470-481`).

**Why it matters.** `scripts/migrate.mjs` and several migration headers state that `migrations/` is
"the single schema source". It is not: a database built only from `migrations/` lacks
`desk_jobs.claim_token`, and a database built only from the ensure lists lacks seven `newsroom_id`
columns. Today both hold because every path runs both, but the invariant nobody states is "you must
run both, in that order" — and only 4 of the 10 `ensure*` functions have a parity test
(`0017`, `0019`, `0027`, `0029` are checked; `0020`, `0021`, `0025`, `0026`, `0030` and the whole
of `investigate.ts`'s 105-statement list are not).

**Impact scope.** Any environment built from one source only: fresh Postgres restored from
`migrations/` alone, the `node --test` unit path where `import.meta.glob` throws and only the ensure
lists run (`src/lib/db.ts` migrate `catch`), and the rebuild path in ENG-02.

**Fix path.** Pick one source. Either (a) delete the hand-mirrored ensure lists and have the PGLite
and test paths replay `migrations/*.sql` (the glob already works in the Vite path; the Node path
needs an `fs` read), or (b) keep both and generalise the existing parity tests into one test that
diffs *every* ensure list against *every* migration, so a new column can only be added in one place
by failing the build.

**Suggested test.** Promote my diff script into a repo test: fail when any table's migration column
set and ensure column set disagree in either direction, with an explicit allowlist for intentional
exceptions.

**Cross-role.** **Docs gap** (migration headers claim a single source of truth that does not hold)
and **test gap** (parity tests cover 4 of 10 ensures).

---

### ENG-04 · **Major** · 26 write sites omit `newsroom_id` while every read filters on it

**Evidence.** Artifact: `artifacts/01-engineering/eng-08-inserts-missing-newsroom-id.txt`. Examples:

- `src/lib/news/desk.ts:238` `insert into leads (user_id, headline, why, topic, source_urls, evidence, newsworthiness, status)`
- `src/lib/news/desk.ts:258` `insert into drafts (user_id, lead_id, headline, dek, body, topic, source_urls)`
- `src/lib/news/desk.ts:611` `insert into snapshots (user_id, source_id, content_hash, excerpt)`
- `src/lib/news/dark.ts:896` `insert into dark_runs (user_id, model_choice)` — while `dark.ts:1181`
  in the *same file* writes `(user_id, newsroom_id, model_choice)`
- `src/lib/news/lead-filing.ts:79`, `src/lib/news/dark-open.ts:21`, nine `anomalies` inserts in
  `investigate.ts`, `ops.ts:53` and `:81`.

Meanwhile every read is scoped: `where newsroom_id = ${owned(context)}` appears ~50 times in
`dark.ts` alone, and `owned()` (`desk.ts:60`, `dark.ts:63`, `opinion.ts:21`) returns
`context.newsroomId ?? DEFAULT_NEWSROOM_ID`.

**Why it matters.** The writes are correct only because the column's `default 1` happens to equal
`DEFAULT_NEWSROOM_ID` and because `requireEditor`/`claimOwner`/`acceptInvite` all hard-code
newsroom 1. The `newsrooms` table is a `serial` and `newsroom_members.newsroom_id` is a real column
with a default, so the schema already models more than one. The first row with
`newsroom_id <> 1` makes that editor's hand-filed leads, drafts, snapshots and Dark Desk rounds land
in newsroom 1 and become invisible to their own reads — silent, not an error.

**Impact scope.** Zero today (verified: no code path writes a membership row with a newsroom id
other than `DEFAULT_NEWSROOM_ID`). It is the architecture-choice-that-forces-a-refactor case: the
multi-newsroom work this schema was shaped for cannot start until 26 write sites are corrected, and
each one is a silent-data-loss bug if missed.

**Fix path.** Thread `owned(context)` / `job.newsroom_id` into every insert listed in the artifact,
and add a lint or test that greps for `insert into <scoped table>` without `newsroom_id`. Drop the
`default 1` on those columns once the writes are explicit, so the next omission is a constraint
error rather than a wrong row.

---

### ENG-05 · **Major** · Automatic fails over on a lapsed login but not on a rung that answers unusably
*(shared — this is the same defect as Walkthrough Finding 1. Count once.)*

**Evidence.** `src/lib/news/automatic-failover.ts:51-68`. `planAutomaticFailover` returns `null`
unless `looksLikeProviderAuthFailure(input.error)` is true. Any other first-rung failure — including
exit 0 with a body `coerceDraft`/`parseJsonBlock` cannot read — never reaches the ladder walk at
`:61`. The user-facing end of that path is
`src/lib/news/desk-copy.ts:418` ("The draft came back in a form the desk could not read. Click Draft
with AI again.") and `:460` for Scan. The Walkthrough lane reproduced this end-to-end with the fake
CLI returning a plain `"ok"`-style reply; its transcript is at
`artifacts/walkthrough/02-dependency-present-failover-draft.txt`.

**Why it matters.** The picker's own copy promises "otherwise tries Claude Opus, then Codex Terra".
The module's docstring defends the narrowness ("a content refusal, a timeout, an empty response …
must never fail over"), and that reasoning is sound for a *refusal* — but an unparseable envelope is
not a refusal, it is a rung that did not produce a draft, which is exactly the condition the ladder
exists for. The result is a dead-ended job on a desk that had a working second provider available.

**Impact scope.** Every Automatic draft, scan, dark round and brief — the default choice on four
surfaces — whenever the first rung's CLI answers with anything the JSON-envelope parser cannot read
(a CLI version bump changing `--output-format json`, a chat-style reply, a truncated stream).

**Fix path.** In `planAutomaticFailover`, treat "ran, produced no parseable draft" as a fail-over
condition alongside auth failure, for `source === "auto"` only. Keep timeouts and explicit
content refusals excluded, and keep an explicit single-provider choice non-failing-over.

**Suggested test.** In `automatic-failover.test.ts`, a case where the first rung exits 0 with
non-JSON content and the plan advances to rung 2; plus a regression case proving a *refusal* still
does not advance.

---

### ENG-06 · **Major** · Cancelling a stale sign-in can `taskkill /T /F` an unrelated process

**Evidence.** `src/lib/news/provider-login.server.ts`:

- `killTree(pid, child)` (`:265-289`) runs `spawn("taskkill", ["/PID", String(pid), "/T", "/F"])`.
- `cancelProviderLogin` (`:504-516`) calls `killTree(entry?.child.pid ?? row.pid ?? undefined, …)`.
- `expire` (`:490-502`) does the same.
- The `live` map's own comment (`:255-259`) states the design: "The row's `pid` is the fallback for
  the case a restart lost this map."

So after the app process restarts (a routine event — `restart-app` is a shipped ops button), an
`awaiting_user` row still holds a PID belonging to a process this server no longer owns. Windows
recycles PIDs freely. Clicking **Stop** on that stale row, or letting the 10/15-minute expiry fire,
issues `taskkill /T /F` against whatever now holds that number — and `/T` takes its children too.

**Why it matters.** This is an unbounded-blast-radius action driven by a number read back out of a
database with no identity check. On this operator's machine that could be a build, another agent's
server, or a database process. `provider_logins.pid` also has no `finished_at`-aware cleanup on
startup, so a stale open row survives indefinitely (its `expiresInSeconds` reaches 0 and the next
`pollProviderLogin` or `startProviderLogin` calls `expire(id)` → `killTree`).

**Impact scope.** Any restart of the app while a provider sign-in is open — narrow, but the action
is unrecoverable and hits processes outside the product.

**Fix path.** Only kill PIDs this process started: on startup, sweep `provider_logins` rows in
`starting`/`awaiting_user` to `expired` **without** killing anything, and have `expire`/`cancel`
kill only when `live.get(id)` yields a child handle. If the DB fallback must stay, verify identity
before killing (image name + process start time later than the row's `started_at`).

**Suggested test.** A unit test asserting that `cancelProviderLogin` on a row whose id is absent
from `live` performs no kill; and a startup-sweep test that a pre-existing open row is retired
without a `taskkill` spawn.

---

### ENG-07 · **Minor** · The Claude status probe and the Claude login spawn with different environments

**Evidence.** `startProviderLogin` spawns with `env: childEnv()`
(`provider-login.server.ts:400-410`), whose docstring says: "A login spawned with a different HOME
or CODEX_HOME than the drafting calls use would write its credentials somewhere the desk never looks
— a sign-in that reports success and changes nothing." But `claudeAccount`
(`provider-login.server.ts:571-579`) and `probeClaudeCode`
(`ai-claude-code.server.ts:104-108`) both `spawn(plan.command, plan.args, { windowsHide, stdio })`
with **no `env`** and **no `cwd`**.

**Why it matters.** Two consequences. (1) On a host where `USERPROFILE`/`HOME` are unset, the login
writes to `childEnv()`'s derived root and the status probe reads the process default — the Server
page can report "Signed out" forever after a successful sign-in, which is the exact failure the
`childEnv` comment names. (2) Without `cwd`, the probe runs the CLI in the server's working
directory (the repo), where a stray `CLAUDE.md` can be discovered — the thing `claudeCodeChat`
spends `cwd: TMPDIR` and `--setting-sources ""` to prevent (`ai-claude-code.server.ts:246-249,267`).

**Fix path.** Route all three spawn sites through one helper that applies `childEnv()` and the
neutral `cwd`. **Suggested test:** assert the spawn options of the probe and the login are equal.

---

### ENG-08 · **Minor** · Provider error text is stored and displayed without redaction

**Evidence.** `src/lib/news/jobs.ts:475-481` writes `err.message.slice(0, 800)` straight into
`desk_jobs.error`, which the desk renders. On the gateway transport that message can be the
provider's own body: `src/lib/news/ai.ts:528-531` returns
``{ error: `${llm.label} API error: ${detail}` }`` where `detail` is `body.error.message` verbatim.
`provider-login.server.ts` takes the opposite view for its own column — `redactSecrets()` is applied
to `detail` before storage (`:143-150, :168-174`) precisely because "a CLI's last stderr line is not
a place anyone has promised not to print a token".

**Why it matters.** Some OpenAI-compatible gateways echo the presented `Authorization` header or the
key prefix in 401/400 bodies. That value would land in the database and on screen. The redactor
already exists and is already unit-tested; it is simply not on this path.

**Fix path.** Apply `redactSecrets()` in `executeJob`'s catch and in `ai.ts`'s error construction.
**Suggested test:** a job whose work throws an error containing `sk-…` stores `[redacted]`.

---

### ENG-09 · **Minor** · The rate limiter replays DDL on every call and never prunes its table

**Evidence.** `src/lib/news/ops.ts:40-51` runs `create table if not exists desk_rate` **and**
`create index if not exists desk_rate_window_idx` on every `assertRate` call — i.e. two extra round
trips before every Scan, Draft, Dark round, Opinion piece, provider login, provider test and ops
action. `audit()` (`:71-79`) does the same for `audit_events`. This is precisely the ENG-104 pattern
that `ensureSchemaOnce` was introduced for (`src/lib/db.ts`, "down from 111 to 2 on the Dark Desk
path"), and it was not applied here. Neither `desk_rate` nor `audit_events` is ever pruned, so both
grow without bound while only a one-hour window is ever read (`ops.ts:56-59`).

**Fix path.** Wrap both DDL batches in `ensureSchemaOnce`, and delete `desk_rate` rows older than
the window on write (or in the monitors tick). **Suggested test:** assert `assertRate` issues no
`create table` on its second call against the same database.

---

### ENG-10 · **Minor** · The dev server ships none of the security headers, with CORS wide open

**Evidence — runtime probe, port 3323.** Artifact:
`artifacts/01-engineering/eng-06-security-headers-probe.txt`.

```
/                     200  XFO=[] CSP=[] NOSNIFF=[]
/login                200  XFO=[] CSP=[] NOSNIFF=[]
/desk                 200  XFO=[] CSP=[] NOSNIFF=[]
/desk/ops             200  XFO=[] CSP=[] NOSNIFF=[]
/api/auth/get-session 200  XFO=[] CSP=[] NOSNIFF=[]
/api/cron/monitors    503  XFO=[] CSP=[] NOSNIFF=[]
/robots.txt           200  XFO=[] CSP=[] NOSNIFF=[]
```

`server/middleware/security-headers.ts` is registered through Nitro, and `vite.config.ts:312-327`
only adds the `nitro()` plugin when `command === "build" || isPreview` — so `npm run dev` has no
header layer at all. `.github/workflows/ci.yml:104-110` runs `security-headers-e2e.mjs` against the
**built** server on 3000, which is the right place to check, so production is covered.

Compounding it: `vite.config.ts:283-292` sets `cors: true` and `allowedHosts: true` on the dev
server (Vite's DNS-rebinding protection off), and `package.json` ships `dev:lan` = `--host 0.0.0.0`
for phone testing. A dev server started that way is framable, CORS-open to any origin, and answers
on any `Host`.

**Why it matters.** Not a production defect — but the desk in dev carries the same session cookie
and the same ops controls, and the header middleware's own docstring calls the unframed `/desk/ops`
"a real hole". It also means any audit run against `npm run dev` (including this gate's Walkthrough
lane) is not testing the header posture that ships.

**Fix path.** Either register the header middleware as a Vite `configureServer` middleware too, or
document plainly that `dev`/`dev:lan` are unhardened and must not be exposed. **Suggested test:**
run `security-headers-e2e.mjs` against the dev server as well, or assert the documented exception.

---

### ENG-11 · **Minor** · A still-valid session cookie can silently claim a rebuilt desk
*(root-cause note for Walkthrough Finding 3)*

**Evidence.** Two code paths combine:

1. `src/lib/auth/server.ts:276` — `session: { cookieCache: { enabled: true, maxAge: 300 } }`. Better
   Auth answers `getSession` from the signed `session_data` cookie for up to five minutes without a
   database round trip. `gate-session.server.ts:98-140` (`expireSessionDataCookie`) exists precisely
   because "The cache is signed against the old session and outlives it (5-min TTL), so without this
   `/get-session` keeps serving the replaced user" — the codebase already knows this.
2. `src/lib/news/membership.ts:99-113` — `requireEditor` promotes the caller to `owner` whenever
   `newsroom_members` is empty for newsroom 1.

Together: point the app at a database that has no owner (a rebuild, a restore from a backup taken
before the desk was claimed) while `BETTER_AUTH_SECRET` is unchanged, and whoever still holds an
unexpired cookie is authenticated without signing in **and** is auto-seated as owner. That is
exactly what the Walkthrough lane observed at `/login` → "Set up the paper" with the desk nav
already visible.

**Why it matters.** "The first person to reach `/login` owns the desk" (membership.ts's own header)
is the documented trade. The undocumented part is that a *stale cookie* counts as reaching `/login`,
so a restore-from-backup can hand ownership to a browser rather than to a person.

**Blind spot, stated.** I identified the mechanism by reading these two files; I did **not** isolate
`cookieCache` from an alternative explanation at runtime (that would need a paired probe with
`cookieCache` disabled). Treat the mechanism as the most likely of two, not as measured.

**Fix path.** Round-trip the session through the current database on the desk paths (or shorten
`cookieCache.maxAge` and re-verify the user row exists in `requireEditor`), and refuse the
first-user-becomes-owner promotion for a session whose user row is absent from the current database.
**Suggested test:** a valid-signature cookie for a user id that does not exist in the database is
rejected, and does not claim an empty desk.

---

### ENG-12 · **Minor** · The scan commit loop is a per-source round-trip chain

**Evidence.** `src/lib/news/desk.ts:604-616` — after the model returns, the code loops
`pendingHashes` issuing one `update sources set last_hash …` plus, for changed sources, one
`insert into snapshots …`, sequentially. `SCAN_WATCH_CAP = 200` (`:466`), so the tail of a full scan
is up to 400 serialised statements. The fetch phase is properly bounded (`mapLimit(watchSlice, 6, …)`)
and the payload is capped at `PAYLOAD_BUDGET = 48000` characters with a clean
break-when-over-budget loop (`:530-544`) — the input side is well controlled; only the commit side
is serial. `getInvestigation` (`dark.ts:442-655`) similarly issues 13 sequential queries per open.

**Why it matters.** On the Neon/`pg` path each statement is a network round trip; on PGLite it is
negligible, which is why it has not been felt. It is a background job, so nothing user-facing
blocks — this is why it is Minor and not Major.

**Fix path.** Batch the hash updates into one `update … from (values …)` and the snapshots into one
multi-row insert, inside `withTransaction`. **Suggested test:** count statements issued for an
N-source scan and assert it is O(1), not O(N).

**Measurement caveat.** I did not time this against Postgres — the finding is a round-trip count
read from code, not a measured latency.

---

### ENG-13 · **Nit** · Cron secret compared with `!==`

`src/routes/api/cron.monitors.ts:13` — `if (hdr !== \`Bearer ${secret}\`)`. Not constant-time. The
route fails closed when `CRON_SECRET` is unset (503, verified at runtime: `/api/cron/monitors` → 503
on port 3323 with an empty secret), and remote timing on a network path is impractical, so this is
preference, not a defect. `crypto.timingSafeEqual` on equal-length buffers if you want it gone.

### ENG-14 · **Nit** · `listPublishedDesk` reads every correction with no `LIMIT`

`src/lib/news/desk.ts:1335-1340` selects all `corrections` rows for the newsroom to build a map for
40 articles. Corrections are rare by nature; a `where article_id = any(...)` on the 40 ids would be
tidier.

---

## Cross-role notes

- **ENG-01** is also a **test gap** (no privilege-boundary test in the suite) and a **docs gap**
  (`docs/manual.md` never states an invited editor's limits).
- **ENG-02 / ENG-03** are primarily **test gaps**: an existing test asserts a weaker property than
  its docstring claims, and 6 of 10 `ensure*` functions have no parity test. Hand both to the Test
  lane.
- **ENG-03** is also a **docs gap**: several migration headers and `scripts/migrate.mjs` assert that
  `migrations/` is the single schema source; `desk_jobs.claim_token` and
  `dark_signals.investigation_id` exist only in code.
- **ENG-05** is the same defect as **Walkthrough Finding 1** — count once.
- **ENG-11** is the engineering root cause of **Walkthrough Finding 3**.
- **Correction to Walkthrough Finding 2.** It describes "the dev-convenience `.env` **committed** at
  the repo root". `.env` is **not** committed: `git check-ignore -v .env` → `.gitignore:4:.env`, and
  `git ls-files --error-unmatch .env` → *"did not match any file(s) known to git"*. It is an
  untracked local file, and the `TOWNREPORTER_CLAUDE_CODE=0` line in it is annotated
  *"GauntletGate dependency-absent pass"* — i.e. left behind by a prior gate run on this box, not
  shipped to contributors. The trap the finding describes is real for anyone working on **this
  machine**; the "committed" framing overstates its reach and should be corrected before it feeds a
  fix that edits the repo.

---

## What's working (specific, and credited)

- **The SSRF defence is genuinely two-layer, not decorative.** `assertPublicHttpUrl` resolves and
  screens the host, *and* the outbound fetch runs on an undici `Agent` whose `connect.lookup` is
  `guardedLookup` (`fetch-url.ts:73-132`) — so the address that was approved is the address that is
  dialled, closing the check-then-connect rebinding window rather than papering over it. Redirects
  are followed manually with a per-hop re-check (`:145-172`). The Playwright renderer gets the same
  treatment through a loopback proxy plus `page.route("**/*")` re-validating every subresource
  (`render-fetch.ts:163-199`). `isBlockedAddress` covers IPv4-mapped IPv6 in both dotted and hex
  spellings, CGNAT (100.64/10), link-local, ULA and multicast.
- **Chromium keeps its OS sandbox by default**, with `--no-sandbox` behind an explicit env opt-out
  and a loud warning on the initialise-failure fallback (`sandboxedLaunchArgs`, `render-fetch.ts:80-142`).
- **No prompt ever becomes an argument.** `assertNotAnArgument` enforces it, the editorial voice
  travels as a *path* that is canonicalised with `realpath` to defeat symlink escape
  (`voice.server.ts`), and `spawnPlan` refuses `.cmd`/`.bat` so no shell is ever involved
  (`cli-spawn.server.ts`). Model identifiers come from a closed union in `PROVIDER_REGISTRY`, so
  there is no route from client input into argv.
- **The ENG-107 refusal is structural**, not a convention: `claudeCodeChat` throws if
  `systemPromptFile` and `allowedTools` are ever combined, *before* it even locates the binary
  (`ai-claude-code.server.ts:220-227`).
- **Ops actions are a genuine allowlist**: six ids, each mapping to a fixed exe plus a fixed argv
  array built in one reviewed file, checked with `isOpsActionId` before anything else reads the
  value (`actions.ts`, `actions.server.ts`). The command-injection surface is closed — ENG-01 is
  about *who* may pull the lever, not about the lever.
- **SQL is parameterised everywhere.** The tagged template rebuilds `$1…$n` placeholders
  (`db.ts:88-95`); the only dynamic query text in the app is `patch()`'s `SET` list built from
  object keys the module itself owns (`provider-login.server.ts:255-261`). Every other `${}`-in-SQL
  hit is a scratch database name in a test file.
- **The auth chokepoint holds.** 105 of 106 `createServerFn` call sites carry `authMiddleware` or
  `deskMiddleware`; the unguarded ones are the deliberately public reader surfaces, which have
  `public-surfaces.no-leak.test.ts` behind them. Both middlewares call `assertSameSiteRequest()`
  before `requireUserId()`. `requireUserId` fails closed when auth is disabled but `DATABASE_URL` is
  set, rather than sharing a dev user against a real database. Runtime-confirmed: an unauthenticated
  `GET /_serverFn/<id>` on 3323 returns **403** — the framework's own origin check backs the app's.
- **Rate limiting records before it counts** (`ops.ts:37-62`), which is the correct order for a cost
  ceiling; sign-in throttling is on by default rather than gated on `NODE_ENV`, with a per-account
  lockout that keys on the email being attacked so a rotated `x-forwarded-for` cannot move it — and
  the header-spoofing limit is written down honestly in the code rather than glossed.
- **The job queue's correctness lives in the database**: a partial unique index does the coalescing
  (`ON CONFLICT DO NOTHING` + re-select), a claim token stops a reclaimed job's original executor
  from clobbering the winner, and a 30s heartbeat inside a 120s reclaim window with an asserted
  timing invariant. Two lanes keep a 40-minute editorial from blocking a draft.
- **`ensureSchemaOnce` records its state in the database, not in process memory**, with the
  reasoning for rejecting the obvious boolean written out — the right call, and the reason ENG-02 is
  a gap in the statement list rather than in the design.
- **Dependencies are clean and mostly pinned.** `npm audit`: **0 vulnerabilities across 482
  packages** (`eng-03-npm-audit.json`). `jose@6.2.9` and `nitro@3.0.260610-beta` are exact-pinned,
  `better-auth@~1.6.30` is patch-pinned, and there is an `overrides` entry for a transitive.
- **`npm run typecheck` is clean** (`eng-04-typecheck.txt`) and **`eslint` reports 0 errors / 11
  warnings** against a 40-warning cap (`eng-05-lint.txt`).
- **The test environment fails closed.** `scripts/test-environment-guard.mjs` refuses to let the
  suite run outside `run-tests-safe.mjs`, so an inherited production `DATABASE_URL` cannot turn
  destructive fixture cleanup into a real cleanup. I hit that guard myself trying to run four test
  files directly; it worked.
- **Migrations 0025–0030 are correct and unusually well-annotated.** 0025 defensively creates
  `editorial_requests` so a clean database can reach it, 0026 explains why `model_choice_source` has
  to exist separately from `model_choice`, 0027 states that no credential lands in
  `provider_logins`, 0028 records the grep that justified having no PGLite counterpart, and 0029/0030
  name their mirrors. The drift in ENG-02/03 is in older tables, not in this range.

---

## What I could not assess, and why

1. **Production behaviour.** `townreporter.org` / `townreporter-web` are out of scope by the brief;
   nothing in this report is a claim about the live paper.
2. **Real query cost.** I ran no queries against Postgres on 5433. ENG-09, ENG-12 and ENG-14 are
   round-trip *counts* read from code, not measured latencies. `npm run proof:search` exists and
   would settle the search-index claim; I did not run it.
3. **The editor-vs-owner boundary at runtime (ENG-01).** Every allowlisted ops action mutates the
   operator's live machine, so I did not execute one. The finding rests on code, plus a runtime
   confirmation that the RPC route is live.
4. **Security headers on the built server.** I probed the dev server only. CI covers four HTML
   routes on the built output; I did not verify the header middleware's behaviour on `/_serverFn/*`,
   on static assets, or on the "middleware returned something that is not a `Response`" branch it
   documents at `security-headers.ts:80-89` — that branch says another layer will apply the headers
   without naming one.
5. **The full test suite — partially observed only.** I ran `npm test` under a 25-minute cap. The
   first batch (`scripts/**/*.test.mjs`) completed: **278 tests, 276 pass, 0 fail, 2 skipped**. The
   second batch (`src/**/*.test.ts`, `--test-concurrency=1`) was still emitting passing tests when
   the cap fired and produced **no summary block**, so it is *incomplete, not green*: 908 lines of
   output, `✖` count 0, but the run did not finish. Log:
   `C:\tr-gate-eng\npmtest.log`. A clean full run is **not** proven here — the Test lane owns that
   verdict, and it should note that the suite does not finish inside 25 minutes on this box.
   Separately: running any test file directly is blocked by `scripts/test-environment-guard.mjs`
   (correct behaviour, see *What's working*), so there is no fast path to a subset.
6. **The `investigate.ts` 105-statement ensure list** was read for schema drift (ENG-03) but its
   2,945 lines of investigation logic were not reviewed line by line; forensics correctness is
   outside this pass.
7. **The multiplayer/P2P module** (`src/lib/multiplayer/p2p.ts`, 570 lines) was not reviewed — I
   found no route importing it in the desk surfaces I audited, but I did not trace every import, so
   read that as "not examined", not "unused".
