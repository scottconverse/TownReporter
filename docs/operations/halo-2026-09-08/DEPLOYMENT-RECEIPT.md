# Halo TownReporter v0.6.34 — deployment receipt

Date: September 8, 2026, America/Denver. Operator: Codex on Halo.

## Result

**DEPLOYED AND RUNNING:** TownReporter v0.6.34 at https://townreporter.org and http://127.0.0.1:3000. Independently checked at 14:58 MDT after promotion. Both returned HTTP 200, rendered version 0.6.34, and their referenced `/assets/index-BLinBzNK.js` returned 200. Neither contained the promotion script's error-boundary markers. Production HEAD is exactly `b097d288d9237be225bc6ed56851078ad064d208`, not a later main revision.

This is deployment proof, not certification that every release feature or editorial-quality target has passed. Unverified UI cases and the refused Codex smoke are listed below.

## 1. Authorization and release identity

Scott replaced the earlier 0.6.33 authorization with the complete 0.6.34 release, subsequently authorized the identified local-file preservation, and then explicitly authorized the ownership declarations and repository freeze required for promotion.

- Release: https://github.com/scottconverse/TownReporter/releases/tag/v0.6.34
- Operator procedure: https://github.com/scottconverse/TownReporter/blob/v0.6.34/docs/HALO-UPDATE-0.6.34.md
- Published, not draft; GitHub marks this release as a prerelease.
- Accepted SHA = tag commit = archive manifest commit = fetched origin/main = final production HEAD: `b097d288d9237be225bc6ed56851078ad064d208`.
- Application CI: https://github.com/scottconverse/TownReporter/actions/runs/34255611084 — completed/success for the exact SHA.
- Windows package/install: https://github.com/scottconverse/TownReporter/actions/runs/34255611028 — completed/success for the exact SHA.
- Archive: `TownReporter-0.6.34-windows-x64.zip`, 7,128,234 bytes, SHA-256 `DB56F79F788A0770B80170DC2AA05832922BD0B2EBD6512D832FEC473F801C03`.
- All seven release assets were downloaded and retained under `release/`; the archive hash matches its manifest. GitHub release metadata and workflow receipts are also saved there.

The existing Git-checkout deployment was upgraded using its documented promotion workflow. The portable ZIP was verified, not installed over this existing installation.

## 2. Resolved installation and ownership

- Production: `C:\Users\scott\Desktop\Code\townreporter-web`.
- Development/staging: `C:\Users\scott\Desktop\Code\townreporter-dev`.
- Production rollback source: `b52a3ae4d0a3980c150a9d2a10f1fdd063932562` (v0.6.23).
- PostgreSQL tools: `C:\Users\scott\scoop\apps\postgresql\18.6-1\bin`.
- PostgreSQL data: `C:\Users\scott\scoop\persist\postgresql\data`; configured port independently read as 5433.
- Databases: production `townreporter`; copied staging database `townreporter_dev`.
- Production listener before: PID 32016, port 3000, working directory independently verified as the production checkout.
- Production listener after: PID 18156, 127.0.0.1:3000, working directory independently verified as the same production checkout.

Original `.env` files are preserved as `production/env.before-ownership` and `development/env.before-ownership`. Only the four approved `TOWNREPORTER_LEGACY_OPS`, `TOWNREPORTER_LEGACY_ROOT`, `TOWNREPORTER_PG_BIN`, and `TOWNREPORTER_PG_DATA` declarations were added, with each root bound to its own checkout. Existing lines compare unchanged in both files. Credentials were not printed in the report.

The installed old promotion script differs from the accepted release version only by the new two-line ownership check. The exact accepted guard was copied temporarily under the production `ops` directory, executed against that actual root, and moved into this evidence directory before promotion. It passed. No guard was bypassed and no tracked production script was patched. The old promotion script then performed its otherwise-identical workflow and fast-forwarded to the accepted release, including the permanent new guard.

## 3. Backups and rollback materials

| Purpose | Absolute path | Bytes | SHA-256 |
|---|---|---:|---|
| Production before staging | `C:\Users\scott\Desktop\Code\townreporter-backups\townreporter_pre-v0.6.34_20260908.sql` | 202747092 | `E8E354B61F4E9D1782DF88C748E908AAD173F180746312B597FDE2BA992A38EE` |
| Promotion-created production backup | `C:\Users\scott\Desktop\Code\townreporter-backups\townreporter_2026-09-08_1455.sql` | 202747614 | `E6FA5429D391DD65E6FE5447A864A4A3E276C3FC581FF9AF423ACC7816C52401` |
| Development before replacement with copied production | `C:\Users\scott\Desktop\Code\townreporter-backups\pre-0.6.34-local-files-20260908-125442\development\database-before-stage.sql` | 199507463 | `1CCC1623C30673DB54F4802CD7319B0236BF1EFFB45BBE54E104195968DA7BB6` |

The explicit pre-stage pg_dump returned exit 0. Its real-data restore passed the SQL-error scan and staged-table checks. The promotion script created its separate backup and accepted its size. Its numeric pg_dump exit code is not separately instrumented by the existing script; no pg_dump error appeared in its captured output. Neither database was automatically restored after promotion.

The earlier untracked scripts, older backup, and generated route-file copies are preserved under this directory. `RECEIPT.md` describes that initial preservation phase; its old stop conditions are historical, superseded by this receipt.

Rollback has **not** been executed. Eleven migrations ran in production. Do not blindly reset code or restore a database. A recovery must first decide whether code-only rollback is compatible with the migrated schema; any data recovery must use an explicitly reviewed restore of the exact retained backup. Do not overwrite subsequent user work.

## 4. Staging

- The development checkout was fast-forwarded to the accepted SHA. Its remote is named `github`, not `origin`; an initial origin fetch failed harmlessly, then the exact accepted object was fetched from the already-verified production repository. No remote was changed.
- Prior development servers were stopped only after matching their PIDs and actual working directories. Production, shared PostgreSQL, tunnels, DSH, LM Studio, Ollama, and CivicCast were not stopped during staging.
- `npm ci`: 449 packages installed; audit reported zero vulnerabilities. Deprecation warnings are retained.
- `ops/stage.ps1 -Backup <exact pre-stage backup>` restored only `townreporter_dev`, built v0.6.34, applied migrations 0044–0054, and started loopback port 3100.
- Restore output was inspected for SQL ERROR/FATAL/PANIC; none found. Real copied tables were present. Production has 34 articles/123 leads/55 drafts. Staging finished with 34 articles/124 leads/56 drafts: the one extra lead and draft are the disposable supplied-material smoke input, not published content.
- Staging was a **Git checkout**, not a packaged/non-Git installation test.
- Disposable editor sign-in, command center, queue, public edition, an existing published Niwot article, and existing draft/story 86 were exercised through the browser.
- Story 86 showed the cited Council Communication PDF as one available record with version 992 and capture event 1429. Opening the cited capture returned the actual stored PDF text. The editor-selected and draft-cited areas were separately presented. No judgment or publication action was submitted.
- The inspected real draft had zero returned structured claims. Singular-one-claim wording and live unavailable/unreadable cases were **not exercised with a matching real-data example**; they must not be reported as passed browser acceptance.
- The Server route opened, but its owner-only health panel refused the disposable editor: “Only the owner can do that.” That is an access limitation, not proof of the owner's Server panel.
- Codex supplied-material smoke: the application saved the fictional input as staging lead 124/draft 59, then refused generation: “Use only supplied material requires Claude or a local/API model. Codex has external tools enabled. Choose another model or Research public sources.” No draft-generation job was enqueued. This is a refusal, not a successful Codex generation. No fallback provider was substituted.
- New-editor source initialization added 11 default sources belonging to `staging-editor`. The original owner's 75 source rows remain byte-for-byte equal under the recorded canonical row hash. No production sources were added.
- Browser screenshot capture failed twice with “Unable to capture screenshot.” Browser accessibility observations were obtained; no screenshot proof is claimed. The release asset screenshot is upstream evidence, not a local screenshot.
- Staging stderr recorded a Better Auth client-IP fallback warning and a PDF font warning. Captured text was still returned. These are retained, not silently removed.

### Focused 0.6.34 captured-record smoke — PASS

The actual bounded pack builders were called against investigation 6 in the copied database, with zero model calls and no network research. Its inventory contained 35 artifacts. `2027BudgetMessage.pdf`, artifact 253 / version 701 / capture 1037, ranked 34th by recency, was selected into both packs. Five substantive stored-text prefixes from its persisted chunks were asserted present in both outputs.

- Stage-one synthesis: 26,013 / 28,000 characters.
- Final brief: 22,000 / 22,000 characters.
- Exact receipts, excerpts and pack outputs: `capture-smoke.json`, `capture-smoke.log`, `capture-smoke.json.synthesis.txt`, `capture-smoke.json.brief.txt`.
- Initial PostgreSQL read-only execution refused an idempotent schema setup. The retry was against staging only; no investigation/model/publication was triggered.
- The four-gate implementation was not changed or rerun. No five-investigation or historical replay was started.

Staging was stopped using `ops/stage.ps1 -Stop`: parent PID 31580 and its owned children exited; port 3100 is free. Evidence: `stage-stop.log`, `stage-stopped.json`.

## 5. Promotion and independent verification

Promotion began at 14:55:33 MDT. Immediately preceding it, fetched origin/main still equaled the authorized SHA, the production tree was clean, the ownership guard passed, and open desk jobs were zero. The owner-authorized freeze was in force.

`ops/promote.ps1 -WaitForJobs` ran from production without `-Force`. It created its backup, stopped only the proven production app, fast-forwarded to the accepted SHA, ran npm ci because the lockfile changed, built, applied all 11 migrations, and restarted. Its own local/page-asset/public/story-count checks all passed.

The promote process printed its final success and exited. Its outer logging wrapper remained waiting on inherited server pipes; the numeric promotion exit code was therefore not captured. Only that completed wrapper PID 34516 was stopped after confirming it had no direct child, without a process-tree kill. The production listener remained PID 18156. This logging limitation does not replace the separate running-site checks.

Independent checks are in `served-verification.json`, `production-process-after.json`, `source-identity-after.txt`, `production-config-after.txt`, and `status-after.log`:

- Local and public HTTP 200; actual rendered footer version 0.6.34 on both.
- The actual page-referenced JS asset returned 200 on both.
- No known app error-boundary markers.
- Production SHA/tag/origin-main all match the accepted commit.
- 34 published stories before and after; zero open desk jobs at final SQL check.
- `/health` is not a route in this checkout (404). Version proof uses the actual rendered footer, not an invented health endpoint. Owner-only Server UI was not impersonated.
- Database answering on 5433; existing public tunnel remained running.

## 6. Configuration preservation

- Source count: **75 → 75**; all-row hash `b518ada1beb1f21970fbf4eb6ed87478` unchanged.
- Paper-settings all-row hash: `b816bdd60e37e8d2b2da8980a152380c` unchanged.
- New routine-publication automations, approvals and policies: zero rows in both production and staging. Nothing was enabled or widened.
- Both `.env` files' existing lines unchanged, excluding only the explicitly authorized ownership additions.
- All seven scheduled-task action definitions and enabled states match the initial inventory. Watchdog alone was disabled during promotion and restored at 14:57:02 after the promotion/build processes had ended. No task was reinstalled.
- Existing Nightly Proof still targets the development checkout, as before; its proof script owns port 3318, not staging 3100. It was not run or repointed. Production operational tasks remain pointed to production. No cron endpoint was called by this deployment.
- Generated route files showed no substantive Git diff after builds; copies were preserved and files normalized back to the accepted source. No application source modifications were introduced beyond the authorized release fast-forward.

## 7. Evidence and boundaries

All local evidence lives beside this file. Raw staging/promotion logs, release assets, hashes, source/settings comparisons, preserved local files, and rollback references are retained. A copy of this operator receipt is also placed in Scott's Halo Stack Research folder.

The deployment checklist skill was used to separate release identity, copied-data staging, production promotion, rollback readiness and actual served-site verification. It did not turn skipped or refused cases into passes.

This receipt does not prove the five travel-local investigations, September 3–8 historical replay, factual correctness, editorial output quality, the 60-minute target, or the 3–5-useful-item target. Their release-report limitations remain limitations. No test content was published. No unrelated project or model runtime was reconfigured.

Post-deployment coordination: the app's automatic approval review rejected an attempted completion notice to the other TownReporter thread because it contained local infrastructure/evidence paths. The notice was not delivered and was not retried through another channel. Scott is being asked whether to authorize that notification. The deployment itself is complete; the other session has not been told to release its hold.
