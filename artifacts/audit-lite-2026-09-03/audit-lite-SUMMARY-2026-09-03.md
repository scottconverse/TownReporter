# Audit-Lite Summary — TownReporter 0.6.6 → 0.6.12
**Date:** 2026-09-03
**Scope:** One audit-lite reviewer per shipped version this session, each on that version's exact diff. Static review only; no reviewer connected to the shared 5433 Postgres or promoted anything.
**Reviewer:** Claude (7× audit-lite), synthesized.

## Verdict per version

| Version | What it is | Verdict | Blk | Crit | Maj | Min | Nit | Escalate |
|--------|------------|---------|----|----|----|----|----|----------|
| 0.6.6 | CI walks → built server | Ship (caveat) | 0 | 0 | 1 | 0 | 1 | No |
| 0.6.7 | Fail over on timeout **(LIVE)** | Ship (caveat) | 0 | 0 | 1 | 2 | 0 | No |
| 0.6.8 | Durable "why it switched" note | Ship | 0 | 0 | 1 | 0 | 0 | No |
| 0.6.9 | Remove reader-privacy positioning | Ship (clean) | 0 | 0 | 0 | 1 | 1 | No |
| 0.6.10 | Local model pickable | **DO NOT SHIP** | 1 | 0 | 1 | 1 | 0 | **Yes** |
| 0.6.11 | newsroom_id data integrity | Ship w/ corrections | 0 | 0 | 2 | 1 | 1 | **Yes (scoped)** |
| 0.6.12 | killTree safety + Scan/Sources CI | Ship | 0 | 0 | 1 | 1 | 0 | No |

## The one that must not ship: 0.6.10 (Blocker)

Picking **Local model** for an **Opinion** editorial does the wrong thing: `checkOpinionReadiness()` (`src/lib/news/opinion-readiness.ts:50`) still hardcodes `candidates = ["claude-frontier"]`. So a Local-model editorial silently drafts on **Claude Opus** (and persists the wrong choice), or errors with an unrelated "sign into Claude Code" message. Also (Major): if `LLM_API_KEY`+`LLM_MODEL` are set without `LLM_BASE_URL`, a "local" pick falls through to the **real paid OpenAI cloud**. CI was green because no test exercises the Opinion local-model path.

## Cross-cutting themes (bigger than any one version)

1. **Test/ops tooling defaults to PRODUCTION resources — this is the incident's root pattern.**
   - `pg-admin.ts` admin URL falls back to the shared **5433** Postgres when `TEST_POSTGRES_ADMIN_URL` is unset (found in 0.6.11's new parity test).
   - `smoke-built-server.mjs` defaults to **port 3000** (the live app) when `SMOKE_BASE_URL` is unset (a 0.6.9 reviewer hit the live homepage with read-only GETs by forgetting to set it).
   - Same class as today's outage: shared DB, no isolation. **Highest-priority systemic fix.**
2. **Green CI ≠ road-tested.** 0.6.10's Blocker and the outage both slipped through all-green CI because no test/check exercised the real failure path.
3. **A shipped claim overstated its fix.** 0.6.11's changelog says the `investigate.ts` tables (anomalies/artifacts/artifact_blobs) are newsroom-fixed; that file still hardcodes the default newsroom. Self-consistent today, but the claim is wrong.
4. **"Single source of truth" not enforced.** The switch-reason wording (0.6.7/0.6.8) is duplicated by hand in `desk.ts`, `dark.ts`, `scan-model-run.ts` — matches by coincidence, nothing guards drift.

## Must-fix before ANY promote of the 0.6.8–0.6.12 stack

- [ ] **0.6.10 Blocker:** thread the selected provider through `checkOpinionReadiness()`/opinion commit; add a test for the Opinion local-model path.
- [ ] **0.6.10 Major:** refuse/guard a "local" pick that has no `LLM_BASE_URL` so it can never hit paid OpenAI cloud.
- [ ] **Systemic:** make test/ops tooling never default to prod — `pg-admin.ts` off 5433, `smoke-built-server.mjs` off 3000; fail loudly if the target isn't explicitly set.
- [ ] **Outage robustness (separate from these diffs):** the public page must fall back to `DEFAULT_PAPER_IDENTITY` when `getPaperIdentityFn()` yields undefined, and `promote.ps1` must verify real page content, not just HTTP 200.
- [ ] **0.6.11:** correct the changelog claim (or actually thread `investigate.ts`); fix the parity test's 5433 default.

## Shippable as-is (caveats are test-strength / latent, not live defects)
0.6.6, 0.6.7 (already live), 0.6.8, 0.6.9, 0.6.12 — each has at most a Major about test strength or future-drift, none a live defect.

## Escalation
- **0.6.10 → yes** (1 Blocker triggers the audit-lite escalation rule).
- **0.6.11 → yes, scoped** — a focused `audit-team` pass on `investigate.ts` newsroom-awareness (a 2,900-line file GauntletGate never reviewed line-by-line), plus a short follow-up on the shared-port test defaults.
- All other versions stay at audit-lite.

## Per-version reports
`audit-lite-0.6.6-2026-09-03.md` … `audit-lite-0.6.12-2026-09-03.md` in this folder.

## Verification ledger

Verified firsthand by the synthesizer this turn:
VERIFIED: 0.6.10 Blocker — Opinion readiness hardcodes a single provider (`const candidates = ["claude-frontier"] as const;`) | src/lib/news/opinion-readiness.ts:50
VERIFIED: test admin DB defaults to the shared 5433 server when `TEST_POSTGRES_ADMIN_URL` is unset (`?? "postgres://postgres@127.0.0.1:5433/postgres"`); the DB-heavy tests are opt-in on that env var | src/lib/test-support/pg-admin.ts:29,74
VERIFIED: smoke check defaults to the live port 3000 when `SMOKE_BASE_URL` is unset (`process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000"`) | scripts/smoke-built-server.mjs:21
VERIFIED: an OpenAI-kind provider's base URL defaults to `https://api.openai.com/v1` when `LLM_BASE_URL` is unset (basis of the 0.6.10 cloud-fallback Major) | src/lib/news/ai.ts:98
VERIFIED: (incident diagnosis this turn) the public page's paper context is fed by `getPaperIdentityFn()` in the root loader and rendered via `<PaperProvider value={paper}>` (an undefined value overrides the context default) | src/routes/__root.tsx:58,177 ; getPublicPaperConfig returns UNCONFIGURED only when not onboarded | src/lib/news/paper-settings.ts:168 ; prod row is onboarded=t with null name/timezone and 21 published articles (checked via psql on the townreporter DB, 5433).

Relayed from the seven per-version audit subagents; NOT re-opened at the source by the synthesizer:
UNVERIFIED: 0.6.6 fake-CLI 1500ms delay races the 2000ms UI poll (test flake risk) - relayed, not re-checked
UNVERIFIED: 0.6.7 failOverAndRetry/performDarkRound wiring has no regression test - relayed, not re-checked
UNVERIFIED: 0.6.8 `failoverReasonPhrase` duplicated by hand in dark.ts/scan-model-run.ts - relayed, not re-checked
UNVERIFIED: 0.6.9 SECURITY.md cross-reference has no automated guard - relayed, not re-checked
UNVERIFIED: 0.6.11 investigate.ts still hardcodes DEFAULT_NEWSROOM_ID for anomalies/artifacts/artifact_blobs despite the changelog claim - relayed, not re-checked
UNVERIFIED: 0.6.12 the "happy path still kills the real child" test asserts status only, not that the child died - relayed, not re-checked
UNVERIFIED: the per-version severity rollups and ship/don't-ship verdicts in the table above - each is the relayed conclusion of that version's audit subagent, not independently re-derived by the synthesizer
