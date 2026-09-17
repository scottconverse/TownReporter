# Candidate 03efb7b clean staging

Candidate: `03efb7be24a948287e0796851f40b0496283c59f`, PR #43.

The interrupted build was not restarted. Its existing log
`logs/stage-03efb7b-build.log` ends with runtime asset copying and migrations
reporting up to date against `townreporter_stage_03efb7b_20260911`.
A subsequent elevated process scan found no matching DEV build process.
The original command exit status was lost across compaction; this is not a
claim to have recovered that exit code.

The fresh copied database's provenance is backup
`C:\Users\scott\Desktop\Code\townreporter-backups\townreporter-before-03efb7b-20260911.dump`,
recorded SHA256 `9AC3362B043F7217DED0CD71A383369AF4DF446E2D1F7B8361C6B5F615D7D36B`.
Previous preparation disabled its copied schedules and monitors. The old
contaminated database was not reused or removed.

After checking `current_database()` equals the exact new staging name, an
explicit transaction used the existing `upsertStagingEditor` export to create
the disposable editor. No production account was changed. The stock helper's
CLI restriction was not weakened.

The built candidate started on loopback port 3471. Database, auth URL/secret,
and data root were explicitly isolated; tunnel and native Claude/Codex
generation were disabled for this first check. Browser sign-in through the
normal email/password form succeeded and rendered the desk, Sources and Server.
The copied queue visibly linked the Development Services hours item to its
previously killed story. This proves rendering of the relationship, not full
repeat-handling acceptance.

Owner-only notice controls were correctly unavailable to this disposable
editor. A real repaired calendar check and repaired model briefing remain
outstanding. No publication or production promotion occurred.

CI snapshot for this exact SHA: fourteen successful checks; source test and
fresh Windows ZIP installation checks still running. This is not release green.

Luna's read-only historical-window review found an existing explicit date-range
control (`dark-dials-panel.tsx`) and saved preference snapshotting. Run 12's
90-day window reflects its saved setting, not a demonstrated date-engine bug.
Use the existing historical range for the next historical investigation;
do not add an unrelated date-control rewrite.

## Real calendar and briefing checks

`node scripts/stage-03efb7b-calendar-check.mjs` ran with DATABASE_URL explicitly
set to this copied database and both native model switches off. Exit0:
`{"state":"parsed","counts":{"parsed":19,"refused":1,"conflicts":0}}`.
The real category capture is event2404/version1534, observed
2026-09-11T05:28:24Z. Full result: `artifacts/stage-03efb7b-calendar-result.json`.
The remaining refusal is `structurally-invalid` at `script[1].$[9]`.
The script verifies database identity and disabled automation, temporarily
unpauses only the copied policy for the manual check, then re-pauses it in
finally. A subsequent SQL read confirmed paused=true. No publication occurs.
Luna independently reviewed the script, saved result, and adapter: accepts
this source-specific parser result, not a claim that every occurrence parses
or that automatic publication is already ready.

The first staging server (tool session75111) was deliberately stopped. Its
replacement (session22108, same loopback3471 and isolated database/auth/data)
enabled only native Codex for acceptance, explicitly mapping Terra to
`gpt-5.6-terra`. Production had zero active desk jobs before this call.
Through the editor UI, select Codex Terra, open copied investigation9, and
click Rewrite the brief. Job110 ran as `codex-balanced`, from
2026-09-11T05:30:58.083Z to05:31:44.406Z (46.323 seconds), completed/error=null.
No fallback, added source, injected answer, or changed investigation question.
The UI displayed 'The brief is written.'

The regenerated summary correctly reports Dalal7799 ahead of Crist6593 and
Levison5090, with Hidalgo-Fahring12501 winning. It no longer claims the official
result contradicts the finance report; the allegation remains unknown for lack
of affiliation/voter-transfer evidence. This is one repaired briefing result,
not comprehensive investigative acceptance or a finding about voter behavior.
Original production output is unchanged. Saved staging result/job receipt:
`artifacts/stage-03efb7b-brief-result.json`.

The rendered check exposed a separate concrete data-loss defect: connection
bullets are sliced at240 characters, cutting source URLs in the saved JSON.
Focused citation-preservation repair is in progress. The raw Markdown link
syntax is also displayed as text; no rich-text redesign was included in these
checks. The earlier brief result is preserved, not silently rewritten.

## Focused citation repair evidence

Luna implemented only the parsed connection/support limits and their regression.
Lead removed the serialized JSON slice and added the persistence regression.
No prompt facts, election names, or desired answer were added by this repair.

Luna's exact command (with DATABASE_URL and RUN_LIVE_MODEL_TESTS empty and
TOWNREPORTER_TEST_ENV_VERIFIED=1):
`node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test src/lib/news/dark-brief.test.ts`.
Baseline: `tests 15; suites 3; pass 15; fail 0; cancelled 0; skipped 0; todo 0; duration_ms 93.7696`.
RED: `tests 16; suites 3; pass 15; fail 1; cancelled 0; skipped 0; todo 0; duration_ms 98.7438`.
Assertion ERR_ASSERTION: the actual240-character prefix did not equal the full
citation-bearing expected string. Full assertion/stack: `logs/brief-citations-red.log`.
GREEN: `tests 16; suites 3; pass 16; fail 0; cancelled 0; skipped 0; todo 0; duration_ms 96.5464`.

Lead's same guarded command targeting `src/lib/news/dark-synthesis-scope.test.ts`:
baseline exit0, `tests 3; suites 0; pass 3; fail 0; cancelled 0; skipped 0; todo 0; duration_ms 11295.2415`.
Persistence RED exit1, `tests 4; suites 0; pass 3; fail 1; cancelled 0; skipped 0; todo 0; duration_ms 11301.41`.
Failure: `SyntaxError: Unterminated string in JSON at position 12000 (line 1 column 12001)`
at JSON.parse, dark-synthesis-scope.test.ts:172. Full output/stack:
`logs/brief-storage-red.log`. The slice was restored before this RED after an
initial one-line trial edit; the test was not misrepresented as preceding that
first exploratory edit.

Integrated exact command, same guarded environment:
`node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test --test-concurrency=1 src/lib/news/dark-brief.test.ts src/lib/news/dark-synthesis-scope.test.ts`.
Exit0, complete summary from `logs/brief-citations-integrated-green.log`:
```text
ℹ tests 20
ℹ suites 3
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11378.1588
```
`npm run typecheck` exit0, no diagnostics (`logs/brief-citations-typecheck.log`).
These are deterministic parsing/storage checks, not another live model run.
At that checkpoint the staging build predated this citation change. The rebuild
and subsequent acceptance are recorded below; production promotion is still pending.

## Rebuilt citation candidate and second real brief

Candidate `de226429df5d473d9ac1f3f06fafa059cb57bdff` built successfully
(exit 0, `logs/stage-de22642-build.log`). The prior staging server was stopped
before the rebuilt server started on the same isolated loopback port 3471,
database and data root. No production service was restarted.

Through the staging editor UI, another explicit Codex Terra rewrite completed
as job111 (`codex-balanced`, error null), from 2026-09-11T05:40:28.132Z
to 05:40:56.885Z: 28.753 seconds. Its retained result is
`artifacts/stage-de22642-brief-result.json`. The brief preserved the correct
vote ordering and uncertainty about voter transfer. A subsequent read of
captured artifact542 independently confirmed Crist's $8,379.63 and Levison's
$13,362.89 figures; Dalal's $17,140 had already been checked in that capture.
Job111 was completed and the staging database had zero queued/running jobs.

This output used short source labels, so it does not independently exercise
the greater-than-240-character URL regression. The focused deterministic
checks above prove that particular parsing/storage behavior. No third model
rewrite was launched to manufacture that coverage.

Hosted CI for this exact candidate was rechecked: 14 successful checks, with
the main test and fresh Windows ZIP installation jobs still in progress.
This remains a development acceptance result, not a production deployment or
proof that all investigative reporting is reliable.
