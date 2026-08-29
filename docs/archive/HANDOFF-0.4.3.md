> **ARCHIVED — historical, describes 0.4.3, superseded by 0.5.1.**
>
> This was the product-memory handoff written for an agent taking the project
> over at 0.4.3. It is kept because its reasoning is still worth reading, not
> because it is accurate: the release, the provider architecture, the desk and
> the operations layer have all moved since.
>
> An audit found it contradicting the current release and provider design
> (TW-007). It is archived rather than rewritten because a second
> product-memory file alongside the manual is what let it drift in the first
> place — two documents describing one system, and only one of them maintained.
>
> **For the current system, read [docs/manual.md](../manual.md).**
> For what changed, read [CHANGELOG.md](../../CHANGELOG.md).

---

# TownReporter — handoff for the Grok taking this over

Paste this as your first working context. The repo is the truth; this is the product memory so you do not spend a day re-deriving it.

You are Grok Build in the TownReporter workspace. The human is Scott (GitHub `scottconverse`). He is a founder-operator, not a daily coder. He has strong product judgment. He will tell you what to do. Do that. Do not volunteer the next three features. Do not redesign. Do not “while we’re here.”

Repo: https://github.com/scottconverse/TownReporter  
This file: https://github.com/scottconverse/TownReporter/blob/main/HANDOFF.md  
Current release: **0.4.3** (tag `v0.4.3` on `main`)  
Source zip: https://github.com/scottconverse/TownReporter/archive/refs/tags/v0.4.3.zip  
GitHub Pages landing (marketing, not the app): https://scottconverse.github.io/TownReporter/

Read `/workspace/AGENTS.md` and `/workspace/AGENTS.project.md` before you write code or offer a download. Those files are law.

---

## What this is

TownReporter is a civic newsroom you run yourself. Public paper on `/`. Signed-in editor desk on `/desk`. Working edition watches **Longmont, Colorado**. Nothing prints until a person publishes.

It is not the Longmont Times-Call, not the city, and not a replacement for either. Drafts are AI-assisted. Models invent facts. The product promise is: **every material claim should be checkable against a document we show.** Dark Desk never prints.

Stack: TanStack Start + Vite + React, Better Auth (email/password, optional Grok OAuth), PGLite in preview / Postgres in production, Playwright Chromium for JS civic pages and YouTube transcripts, xAI (`XAI_API_KEY`) or any OpenAI-compatible gateway.

`package.json` is still named `app-builder-workspace`. That is leftover scaffold. Do not “fix” the name unless he asks. It is cosmetic and it churns lockfile noise.

---

## How he talks

- Short. Direct. “Do 1 and 2.” “Go.” “what's on the list.” “compact this conversation.”
- If he asks what something is, answer in product English first, then the table names.
- If he asks for a design, give the design. Do not implement until he says do it.
- Ranked lists beat essays. Honesty beats polish.
- He will paste audits. Verify the claim in the code before you agree. The 0.4.2 SSRF and provenance items were real. Some other audit items were product, not bugs.

---

## Hard rules (already burned tokens when broken)

1. **No cosmetic redesign.** No volunteer UI pass. A designer exists for Dark Desk; `docs/dark-desk-editor.md` is the contract for that person, not a license for you to restyle.
2. **Docs stay honest.** If it is not in the product, it is not in the README. There is no mailer, no city picker, no invite, no OCR. Image-only PDFs are unread. JPEG-as-chat is not OCR. The edition is Longmont.
3. **Do not retag a shipped release.** 0.4.0–0.4.3 are closed. New work is a new version.
4. **Version lockstep** on every ship: `package.json`, `package-lock.json` root only, `src/lib/version.ts`, `src/lib/source-zip-url.ts`, `CHANGELOG.md`, `README.md`, `docs/setup.md`, `docs/editor.md`, `docs/dark-desk-editor.md`. Enforced by `src/lib/paper.test.ts`. GitHub Pages `docs/index.html` does not carry a version stamp. Do not add one.
5. **Auth is not a dead door.** After the desk is claimed, `/login` is sign-in only. Paper top-right **Create editor** only while nobody owns the desk. Signed-in but not the editor sees “taken,” not an empty Scan page.
6. **Preview PGLite is in-memory.** Restarting Vite wipes the desk, the paper, membership, jobs, everything. Do not restart Vite to pick up a server-module HMR if you can avoid it. If you do restart, tell him the paper is empty because the database died, not because publish failed.
7. **First-user-owns** when `NEWSROOM_SETUP_TOKEN` is unset (preview). When the token is set (public host), signup does not own the desk until the token is presented.
8. **Leave as editor** drops *this newsroom’s* members, signs them out, paper stays, Create editor comes back, next person owns it. Do not make Leave “log out but keep owning.”
9. **No zip in the product UI.** No Download button on the paper/desk/login. Download method is in `AGENTS.project.md`. Durable copy is the GitHub tag.
10. **Do not implement held features** unless he names them: real OCR, city picker, mailer, invite a second editor.
11. **Do not mention localhost, 8080, or internal sandbox URLs in user-visible text.**
12. **Tests that copy production functions into the test file are lies.** The old SSRF script did that. Do not bring it back.

---

## Current ship (0.4.3) — what is true

### Desk / paper
- One newsroom row (`newsrooms.id = 1`, `DEFAULT_NEWSROOM_ID`). Members carry `newsroom_id`. Unique one-owner per newsroom.
- **Create editor** (paper, top right) while unclaimed. After claim it is gone.
- **Leave as editor** (desk, top left) → `leaveAsEditor` deletes `newsroom_members where newsroom_id = <theirs>`. Then sign-out so `requireEditor` does not auto-reclaim.
- `myDesk` does **not** auto-claim. Signed-in stranger gets taken-copy, not Scan.
- `deskIsClaimed()` / `requireEditor` empty-count / `claimOwner` empty-count are `newsroom_members where newsroom_id = DEFAULT_NEWSROOM_ID`.
- `requireEditor` auto-inserts owner if that newsroom is empty and no setup token. Race: two first users, unique index, one wins, the other 403s.

### Dark hops (0.4.1)
Investigation-scoped and shared with a later editor on the same file:
- `investigations`, `artifacts`, `frontier_items`, `capture_events`, `search_log`, `claims`, `hypotheses`, `anomalies`, `relationships` (the file’s trail)

`user_id` is still written on insert (who clicked). Queries for the file use `investigation_id` / `newsroom_id`, not “opener == current user.”

Test: `investigate.loop.test.ts` — “a later editor on the same file sees the hops” also asserts one `artifact_versions` row and one `source_monitors` row for the shared URL.

### Lookup tables (0.4.3)
Shared cache / watch / name tables, unique on `(newsroom_id, …)`:

| Table | Unique now | Who-clicked |
|---|---|---|
| `artifact_versions` | `(newsroom_id, url, content_hash)` | still written |
| `source_monitors` | `(newsroom_id, url)` | still written |
| `recurring_baselines` | `(newsroom_id, key)` | still written |
| `entities` | `(newsroom_id, canonical)` | still written |

`entity_aliases` / `entity_matches` unique keys are still `(user_id, …)`. Historical-match *reads* are newsroom-scoped. `dead_ends` resurface is newsroom-scoped. Do not unique-swap aliases/matches as a volunteer.

Migration: `migrations/0014_newsroom_lookup_keys.sql`. PGLite extras in `ensureInvestigateSchema` drop the old uniques and create the new indexes. Keep both.

Public paper / RSS: `articles where status = 'published' and newsroom_id = DEFAULT_NEWSROOM_ID`.

### Jobs (0.4.3)
Scan / Draft / Keep digging enqueue `desk_jobs` and return. Drain paths:
- `kickJobs()` → `setTimeout(0)` → `drainQueuedJobs()`
- vite in-process tick (first ~8s, then ~20s) in `vite.config.ts`
- `GET /api/cron/monitors` with `CRON_SECRET` also drains

A frozen serverless host **must** be pinged. A long-lived Node / this preview drains itself. Cron with no secret is fail-closed (0.4.0).

`executeJob` claims with `UPDATE … WHERE queued OR (running AND stale) RETURNING id`. Two drainers, one winner. `drainQueuedJobs` still has an in-process `draining` flag as a same-process shortcut. `setJobStage` refreshes `updated_at`. A scan that never calls `setJobStage` and runs past two minutes can be reclaimed by a second drainer — that is the stale-running path, on purpose.

### Provenance (0.4.2–0.4.3)
`resolveProvenance` in `src/lib/news/investigate.ts`:
1. Bind capture / version / URL as before.
2. If there is an excerpt, it must appear in `artifact_versions.full_text` or an `artifact_chunks` excerpt, after lowercase + whitespace collapse, minimum 12 characters.
3. Miss → `provenance_status = 'unresolved'`. The cited `version_id` is **kept** so the editor can see what the model pointed at.
4. Empty excerpt → `unresolved`, even if the model named a real id. The cited version is kept.

Helper: `evidenceAppearsInText`. `findEvidenceChunks` is now on the production path, not test-only.

**Product effect:** planner paraphrases (“Packet A awards the contract” vs the real sentence) are unresolved. That is the point. Tests that used paraphrases were updated to verbatim slices. Do not loosen the matcher to make Dark look greener.

### SSRF (0.4.2)
`src/lib/news/url-guard.ts`. Node’s URL parser turns `[::ffff:127.0.0.1]` into `[::ffff:7f00:1]`. The old guard only unwrapped mapped v6 when the string contained a **dot**, so production never hit the branch.

Now: hex and dotted `::ffff:` both unwrap to v4 and run the v4 blocklist. Unparseable mapped forms are blocked. Tests in `fetch-url.test.ts` hit **this** module. `scripts/ssrf-check.test.mjs` asserts there is no copied `isBlockedAddress(` in the script.

Still allowed, on purpose until he says otherwise: `http://example.com:22/` (public hostname, weird port). Do not add a port allowlist as a volunteer.

Chromium fetch aborts private-net subrequests (0.4.0). Keep that.

### OCR
`productionOcr` returns empty. Image-only PDFs stay unread. Tests may still exercise an OCR impl; production does not. Do not ship JPEG-as-chat and call it OCR.

---

## Leftovers — not 0.4.3, do not start these unless he names them

### 1. Held product
- **Real OCR** — scanned packets. Not JPEG-as-chat.
- **City picker** — Longmont is the edition. A half-built picker would lie.
- **Mailer** — newsletter promise was removed. There is no mailer.
- **Invite a second editor** — first-user-owns / Leave is the 0.4 contract. Multi-user is a different product.

### 2. Open audit items (verified, not done)
Ranked the way earlier sessions ranked them. 0.4.2 closed the top three. 0.4.3 closed lookup keys, job CAS, empty-excerpt, and `deskIsClaimed` scope. The rest wait.

| Item | Status |
|---|---|
| Mapped IPv6 SSRF | **Done, 0.4.2** |
| Quote-in-document provenance | **Done, 0.4.2** |
| Leave unbounded `DELETE` | **Done, 0.4.2** — scoped to `newsroom_id` |
| Newsroom-keyed URL history / monitors / names | **Done, 0.4.3** |
| Empty excerpt still resolved | **Done, 0.4.3** — unresolved, version kept |
| Job double-claim | **Done, 0.4.3** — CAS in `executeJob` |
| `deskIsClaimed` global count | **Done, 0.4.3** — this newsroom |
| `entity_aliases` / `entity_matches` unique still `(user_id, …)` | True. Reads are newsroom-scoped. Do not unique-swap as a volunteer. |
| `VITE_AUTH_ENABLED` only flips UI; server always has Better Auth | Product, sloppy env name. Do not “fix” by making auth optional. |
| Some hop tables still ignore `newsroom_id` on query (they key by `investigation_id`) | True. Single-newsroom appliance. |
| `investigate.ts` ~2.6k lines; `researchLoop` ~500; `reportAndDraft` ~370 | True. Do not split unless he asks. |
| `findings.ts` duplicates ~200 lines of `report.ts`; the public-page copy is the untested one | True. |
| ~23 swallowed `catch` in `investigate.ts` | True. |
| Few FKs, no index on `newsroom_id`, DDL at request time, schema defined twice | True. Appliance reality. |
| `npm test` lists files by hand. `src/lib/news/coerce-draft.test.ts` exists and is **not** in the list, so it never runs | True. Add it to the script if you touch coerce-draft; do not as a drive-by. |
| Checkout hygiene: `attachments/`, `artifacts/`, `screenshots/`, `.grok/skills` committed | True. Do not mass-delete unless he wants a hygiene release. |
| Security tests in `scripts/` that were regex-over-source | SSRF copy is gone. Other `scripts/*.test.mjs` may still be shallow. |
| Login heading is **Create the desk**; paper CTA is **Create editor**; button is **Create editor account** | True. Do not unify the copy as a volunteer. |

---

## Map (where to look)

| Concern | File |
|---|---|
| URL / SSRF / hash | `src/lib/news/url-guard.ts`, used by `fetch-url.ts`, `desk.ts`, `search-web.ts`, `schema.ts` |
| Fetch + DNS re-check | `src/lib/news/fetch-url.ts` |
| Dark hop engine | `src/lib/news/investigate.ts` (`researchLoop`, `resolveProvenance`, `persistPlan`) |
| Dark HTTP API / list | `src/lib/news/dark.ts`, `dark-open.ts` |
| Jobs | `src/lib/news/jobs.ts`, `monitors-cron.ts`, `vite.config.ts` tick |
| Membership / Leave / claim | `src/lib/news/membership.ts`, `claim.ts` |
| Desk gates | `src/lib/news/desk.ts`, `src/routes/desk*.tsx`, `login.tsx` |
| Auth | Better Auth; `src/lib/auth/`; `verify.server.ts`. `VITE_AUTH_ENABLED` is UI chrome. |
| OCR stub | `src/lib/news/ocr.ts` → `productionOcr` |
| Copy (login/taken/create) | `src/lib/news/desk-copy.ts` |
| Version | `src/lib/version.ts` + `paper.test.ts` |
| Public paper | `src/lib/paper.ts`, `src/lib/news/public.ts`, `findings.ts` |
| Draft coerce | `src/lib/news/coerce-draft.ts` (+ unlisted test) |
| Lifecycle E2E | `scripts/lifecycle-e2e.mjs` — create desk → lead → publish → correction |

Do not trust comments that say 0.4.0 still owns hops. That was true until 0.4.1.

---

## How to run work in this sandbox

- Preview is already the product. Prefer HMR. **Vite restart = empty PGLite.**
- `npm test` — hand-listed files. `npm run typecheck`. `npm run build` before you call it shipped.
- Tests use `node --experimental-strip-types --test …`. PGLite per process.
- Tag format: `v0.4.x`. Changelog first person-product, not “feat:”. GitHub release notes match the changelog.
- Push: `scottconverse/TownReporter`, `main`.
- After tag, `SOURCE_ZIP_URL` must be that tag. Verify the GitHub zip is `PK` (codeload 302 is fine if the body is a zip).

Ship checklist (every version):
1. He named the work. You did only that.
2. Tests for the behavior, not a regex over the source.
3. Docs honesty — README “this release”, CHANGELOG, manuals version stamp.
4. Lockstep versions.
5. typecheck + targeted tests + build.
6. Commit, **new** tag, push, `gh release create`.
7. Do not commit `.vercel/`, `artifacts/`, or screenshots. This handoff belongs in the repo.

---

## Auth / preview traps (already hit)

- If Scan files nothing and Publish bounces: someone (often you, from a prior test) already claimed the desk. `myDesk` then 403s the actual user. Leave, or wipe PGLite by restarting Vite, or use the claimed-copy path. Do not “fix” by auto-claiming every signed-in user.
- Playwright “Create editor still visible after claim” was SSR pending copy containing “already has an editor.” Copy was tightened. Do not put “editor” in the unclaimed pending string.
- Signup after claim must 403 (`assertSignupOpen`). There is a `databaseHooks.user.create.before` path and `POST /api/auth/sign-up/email`. Keep both.
- GitHub Pages `docs/index.html` had a stale **v0.3.9** chip. It is gone. Do not paint 0.4.x on that landing.
- Login heading is **Create the desk**. Paper CTA is **Create editor**. Button is **Create editor account**. The lifecycle gate that went red after 0.4.2 died on the last `Read on the paper` click, not the heading. Do not “fix” CI by renaming the heading in the test. After the correction, `goto` the article URL already opened.

A later Grok opened [PR 1](https://github.com/scottconverse/TownReporter/pull/1) (Pages stamp — keep) and two `v0.4.3-quality` PRs (lifecycle heading guess, then a version bump with no lookup-key code — both closed, branches deleted). He said Grok Bot is not good at this yet. 0.4.3 is the named leftover (lookup keys, job CAS, empty excerpt, `deskIsClaimed` scope). Do not invent 0.4.4 from leftover audit items.

---

## What he already decided (do not re-ask)

- 0.4.0 is hardening. Closed.
- 0.4.1 is hops-on-the-file + jobs wake-up + Create/Leave/claimed-door. Closed.
- 0.4.2 is quote-in-document + mapped-IPv6 SSRF + scoped Leave. Closed.
- 0.4.3 is newsroom-keyed URL history / monitors / names + job CAS + empty-excerpt unresolved + `deskIsClaimed` this newsroom. Closed.
- OCR / city picker / mailer / invite: hold.
- Provenance verifies text, not merely ids. Done.
- Do not retag.

If you are unsure whether to build, ask one sentence, ranked options, wait.

---

## First moves on arrival

1. `git log -1 --oneline` and `APP_VERSION` — confirm you are on 0.4.3 / tag `v0.4.3` or later. If someone shipped past this handoff, believe git, not this file.
2. Read `CHANGELOG.md` and `AGENTS.project.md`.
3. Do not restart Vite. Do not claim the desk yourself.
4. Wait for his instruction. If he says “what’s leftover,” the leftover section above is the answer. If he says “go,” make him name which leftover. Last time “go” on leftovers meant lookup keys, which are now 0.4.3.

---

## Voice on the paper and in docs

Plain. Civic. A little defiant. No “leverage,” no “robust pipeline,” no “AI-powered.” Captions are not minutes. Dark Desk does not print. Corrections are public. Longmont, not a generic city.

If you write copy, match `src/lib/news/desk-copy.ts` and the README warning block.
