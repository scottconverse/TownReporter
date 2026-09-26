# Next TownReporter patch — the paper, re-laid out (unit BD)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or any live reading of the paper by a person. **No live paper and no production database was touched**: every measurement below came from a locally built server on port 8090, seeded with 22 invented stories in a throwaway in-memory PGlite, with `DATABASE_URL` empty. No AI model was called. The screenshots are programmatic captures, not a designer's or an owner's reading.

## The front page and the article page, to the handoff

Both pages were re-laid out to `docs/design/handoff-2026-09-26/README.md` ("Front page", "Article page") and its two prototypes, over the routes and data that already existed. Every route, read, provenance feature and correction feature is still there; what changed is the layout, the type scale and the surfaces.

1. **The front page** is a bled masthead row (56/800 wordmark, locality, section nav from `newsroom_sections`, search / saved / text-size), a yellow-ruled lead (50/800 headline, lh 1.02), a three-column section, a "This week" panel printed as an ink block, a six-cell story grid with section tags, an "Around the region" band, the opinion panel, a twelve-row river, and an ink footer. The story grid and river are the same reads they were (`PAGE_SIZE = 12`, `GRID_CELLS = 6`); the band reuses the stories already on the page.
2. **The article page** is a breadcrumb + section tag + 56/800 headline + dek header, a byline bar (TR badge, date and read time, save / share / text size), then a three-track layout: the "In this article" jump list (sticky, its current entry marked by the same `IntersectionObserver`), the body with "How we reported this" as a two-column source-card grid, and an aside carrying "Dates in this story". Corrections, the share panel and "Keep reading" keep their own headings and anchors (`#story-corrections`, `#related`), so every existing link still lands.
3. **Section tags** come from `newsroom_sections` and are used on the lead, the grid and the article page; the opinion tag is the one yellow-filled tag, with fixed `#111` text (yellow is a fill, never a text colour).
4. **The headline weight fix.** The lead headline inherited `font-weight: 500` from the reader's global `h1, h2, h3` rule and had no weight of its own, so it computed Bricolage 500 — a weight the scale does not use. It is now 800. Every headline the paper prints was then measured, not assumed: see the weight tally below.

## The geography pills, and the tag behind them

The pill row (Longmont · Nearby · Boulder County · Colorado) has been on the paper since the first build and has never been able to filter anything, because a printed story carried nothing that said which ground it stands on. The owner settled it on 2026-09-26 (DECISIONS.md, 1:58 PM, KICKOFF Q2, chosen "A"): the pills filter on a **new `area` tag on each printed story**, not on new sections or new sources per area.

- `migrations/0098_story_area.sql` adds `articles.area text` (nullable, newsroom-scoped) plus a partial index on `(newsroom_id, area, published_at desc) where status = 'published'`. Additive only: nothing existing is rewritten, and the old code runs against the new schema.
- The null rule is the owner's: **a story with no area counts as the home town (Longmont)**. That keeps the Longmont pill honest for the stories already printed instead of inventing a value that claims a person chose it.
- The mirror for tests that never run migrations (`createPgliteSql()` in a plain `node --test` process) lives in `src/lib/news/story-area.server.ts` as `STORY_AREA_SCHEMA`, applied through the existing `ensureSchemaOnce` fingerprinting.
- **The editor sets it at publish**, with one select on the publish step that is already there: `src/routes/desk.story.$leadId.tsx:2108-2111` (`<div id="story-area">` wrapping `<select id="story-area-select">`, labels from `src/lib/story-area.ts`). The desk's own re-layout is phase 2, so the control was fitted to the current screen rather than a new one.
- The pills are `src/components/paper/geo-pills.tsx`, ported from the prototype's `.jsx` to TypeScript. **No pill pressed is the whole paper** — which is the state the paper ships in — and pressing one adds exactly one `aria-current` and an "Everywhere" link back. The prototype draws Longmont ink-filled when nothing is chosen; that is a state claim the paper cannot back (an unfiltered page is not filtered to Longmont), so the deviation is deliberate and named here.

## This week, and Dates in this story

Both panels read one thing: the dated records (`document_date`) in `articles.provenance_json` of **published stories only** (`src/lib/news/story-dates.server.ts`, both queries carry `status='published'` and a `newsroom_id`). No meeting calendar and no unpublished lead can reach either panel — that is the owner's KICKOFF Q1 ruling. The front page asks for the next seven days on the paper's own calendar (`WEEK_DAYS = 7`, swept over the newest 60 printed stories `SOURCE_LIMIT`); the article page asks for every date the one story carries, past and future. Both stop at twelve rows. Usually the front-page panel is empty, and it says so in words rather than printing a calendar this schema does not have.

## Targeted evidence

**Red first.** Before the fix, the reader stylesheet's global rule was `.reader h1, .reader h2, .reader h3 { font-weight: 500 }` and the lead's own rule set size, leading and family but **no weight** — `git show acfa86a3:src/reader-astra.css` shows `.reader .lead h2 { font-family: var(--fd); font-size: 42px; line-height: 1.16; ... }` with no `font-weight` line, so the lead computed 500. The same command shows every other headline rule in that file carrying an explicit 700 or 800, which is what made the lead's inheritance a bug rather than a house rule.

Every check below was run in the unit that wrote this, and the exit code is the one the shell printed:

- `npm run -s lint` — **exit 0.** `npm run -s typecheck` — **exit 0.** `npm run -s typecheck:test` — **exit 0.**
- `node scripts/with-app-env.mjs npx vite build` — **exit 0**; then `node scripts/patch-ssr-exports.mjs` **exit 0** and `node scripts/copy-runtime-assets.mjs` **exit 0**, without which the built server cannot answer a database route.
- `node scripts/contrast-audit.mjs` — **exit 0**, 3/3.
- `node --test scripts/desk-min-font.test.mjs scripts/docs-routes.test.mjs` — **exit 0**, 6/6. The docs check resolves 29 routes / 28 documented paths, 0 unresolved, so the re-layout removed no route.
- `src/lib/news/story-area.test.ts` — **exit 0**, 8/8. It applies `migrations/*.sql` **from disk** and then reads the pills' own query back.
- `src/lib/news/schema-parity.test.ts` — **exit 0.** `scripts/migration-plan.test.mjs` — **exit 0.**
- The 14 test files that build the `articles` table by hand (delete, evidence.public, follow-ups, import-stories, jobs, lead-origin-projection, meeting-article-revision, paste-one-story, reader-river, search-index, sections, stats-reports, views, corrections-newsroom-boundary) — **exit 0**, 149 pass / 4 skipped / 0 fail, 153 tests. None of them renders a reader page, so the new nullable column changes none of them; the migration-from-disk test above is the one that exercises it.
- `node scripts/ai-disclosure-render.test.mjs` — **exit 0**, 3/3: the disclosure sentence still renders above `id="sources"`, the routine-notice variant still refuses to claim AI wrote it, and `/how-we-report` still carries the sentence word for word.
- The paper itself, driven in real Chromium against the built server on `http://127.0.0.1:8090`: **20/20** page loads (front and article × 1440 / 1280 / 1024 / 900 / 390 × both themes) had `scrollWidth === innerWidth` — no horizontal scroll at any width, including 390.
- Minimum computed font size across those 20 loads: **14 px**, with **0** elements under 14 px.
- Headline weights measured off the rendered page: **280 headline rows, all in Bricolage Grotesque, every one 700 or 800** (200 at 700, 80 at 800). The front lead reads 800 at 50 px, the article `h1` 800 at 56 px, the grid cells 700 at 23 px, the river rows 700 at 21 px, panel and section heads 800 at 28 px. No 500 anywhere.
- Anchors and ids: 0 duplicate ids and 0 unresolved in-page anchors across all 20 loads.
- The pill filter, checked in the browser rather than assumed: `?area=county`, `?area=nearby` and `?area=colorado` each printed exactly one pressed pill, one matching `aria-current`, an "Everywhere" clear link, and the lead belonging to that ground (Story 09 / 08 / 10).
- The repo's own reader audit, `node scripts/public-a11y-floor.mjs` against the same server — **exit 0**, **0 violations on all 8 routes** it walks.
- Eight PNGs at 1280 and 390, light and dark, front and article (`evidence/BD/paper-01…08`), each next to the `paper-0N` capture of the same page.

## Limits

- `scripts/sources-reach-the-reader.mjs` (the editor-desk publish e2e) **was not run**: it is not one of this unit's named checks, and it drives the desk's publish flow rather than the public paper. The desk's publish step was changed only by adding one select, and the publish-request path is covered by the desk tests above.
- `scripts/contrast-audit.mjs` audits the **desk's** tokens only — a grep of it for the reader's tokens returns nothing — so it says nothing about the paper's own palette. The paper's contrast rests on the rule that yellow is a fill and never a text colour, and on the measured 14 px floor.
- The area column is exercised on PGlite (in-memory, migrations applied from disk, and via the schema mirror). **PostgreSQL was not started and no production database was contacted**; `0098` is additive and nullable, so the old code runs against it, but the migration itself was not run against a real Postgres by this unit.
- No person has looked at the screenshots. Every claim above is a programmatic measurement or a test result; whether the pages *read* like the handoff is a judgement this document does not make.
- The pill row's unfiltered default is a deliberate deviation from the prototype (see above). If the owner wants Longmont ink-filled on an unfiltered front page, that is one line in `src/components/paper/geo-pills.tsx` and it is a product decision, not a defect.
