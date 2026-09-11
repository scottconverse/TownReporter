# Real Reddit discovery acceptance — 2026-09-11

Source revision: `71be20199ffa3869c18eeeead7c7d08edd2a0b96`.
Environment: built staging application at http://127.0.0.1:3471; database
`townreporter_stage_03efb7b_20260911`, newsroom 1, Staging Editor.
This is acceptance data, not production publication.

## Personally executed through the editor UI

- Opened Dark Desk and clicked **Check r/longmont** once.
- The paced request completed and re-enabled its button without intervention.
- Result: 50 posts read, six civic candidates, three newly filed tips, three
  already known. Searches: newest, government, infrastructure, business & work.
- Used **File as tip** on the score-4 near miss **Car Registration Mandatory
  Credit Card Fees**. The card changed to FILED and its resident excerpt appeared
  in the main pile, explicitly labeled unverified and requiring a public record.
- Independently read the acceptance database: new anomalies 1360 (grass /
  irrigation), 1361 (library outage), 1362 (Greenway), and manually filed 1363
  (registration fees). At completion there were zero queued/running desk jobs.
- No model generation, build, test suite, public publication, or production
  mutation was started for this check.

## Result and remaining limits

The real Reddit discovery → excerpt → manual filing path works. Existing URLs
were recognized, rather than all being inserted again. This is not a claim
that topical duplicates across distinct URLs are resolved.

Freshness is a demonstrated limitation: the newly filed library-outage card
is dated July 19 and Greenway card July 11, while this check ran September 11.
Historical material can still be useful, but an old transient outage should
not compete with current reporting as an unexplained new tip. The manual
registration-fee card also says **undated**, although it came from a feed.
Useful current discovery is therefore not fully accepted. Do not repeat this
same check merely to accumulate more identical receipts.

Separately, Luna's initial read-only inspection flagged city-biased queries.
Lead inspection corrected its scope: `primarySourceQueries` in
`src/lib/news/extract.ts` generates both a city-qualified subject query AND a
subject-only query. The first three queries used by drafting include both.
The Ramsey run's irrelevant Longmont follow-ups remain observed, but this
function alone does not establish their cause or justify adding the unanchored
query it already has. No query-construction change is justified by that claim.

Still open under item 6: useful breadth and freshness, a contrasting community,
and real ordinary-search / configured optional-Gateway acceptance. This receipt
does not close those requirements or waive curated investigative tools.

## Development repair after the live check

Luna implemented the date/author handoff and a visible 30-day automatic-filing
window. Old/undated results remain manually fileable. The age filter runs before
the selection limit. Lead corrected one missed callback type, added a database
assertion for the filed date/author, and made the window explicit in UI copy.
No existing stored tips were removed. No production deployment occurred.

Baseline command used the same safe environment launcher below with only
`src/lib/news/reddit.test.ts`: tests 35, suites 9, pass 35, fail 0, cancelled 0,
skipped 0, todo 0, duration_ms 113.9162.

Final command:
```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/reddit.test.ts','src/lib/news/reddit-tip-filing.test.ts'],{env:safeTestEnvironment(),stdio:'inherit',windowsHide:true}); process.exit(r.status??1);"
```
```text
ℹ tests 43
ℹ suites 12
ℹ pass 43
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11418.295
```

`npm run typecheck` initially exited 1:
```text
src/routes/desk.dark.tsx(807,51): error TS2345: Argument of type '{ url: string; title: string; excerpt: string; }' is not assignable to parameter of type '{ url: string; title: string; excerpt: string; updated: string; author: string; }'.
  Type '{ url: string; title: string; excerpt: string; }' is missing the following properties from type '{ url: string; title: string; excerpt: string; updated: string; author: string; }': updated, author
```
After the callback type correction, `npm run typecheck` exited 0 without
diagnostics. The final subsequent UI edit was explanatory text only.

These were code-first regression checks, not a demonstrated TDD red/green loop.
Focused tests used isolated PGLite, not staging or production. No full-suite,
rebuilt-browser, mobile, or production acceptance is claimed for this repair.
The running staging build still predates it. No dependency, auth boundary,
credential handling, or unsafe HTML rendering was added; metadata is ordinary
React text through the existing authenticated newsroom-scoped action.

## Rebuilt UI and real-provider check

Candidate `ae0e4dd7174fc360ac155272c552a073a84f1227` was built successfully
with `DATABASE_URL=''` and `npm run build`; migration explicitly skipped.
Build log: `artifacts/reddit-repair-build-20260911.log`. Existing warning:
```text
(node:28488) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
```
Only the owned staging server was stopped/restarted, on the same port/database.

The rebuilt normal Reddit button completed: 50 posts, two eligible civic
candidates, zero automatically filed, two already known. Dates/authors and
the 30-day explanation were visible. June/July posts remained visible with
manual-only labels. Through **File as tip**, a historical Harvest Junction
outage became staging anomaly 1364, preserving `Posted 2026-08-06 by
/u/FruitNCholula`; independently confirmed in the database. Existing tips were
not deleted. No model jobs were queued/running afterward. This proves the
rebuilt metadata/freshness surface, not the current news value of that old tip.

Direct real-provider smoke used `searchWithFallback('Longmont city council
agenda')` from the installed source, via `node scripts/with-app-env.mjs node
--experimental-strip-types --input-type=module -e ...`, outputting only
provider/state/counts and public result URLs. Ordinary configuration reported
Gateway unset, Exa MCP `SEARCH_SUCCESS_RESULTS`, eight hits. First results:
the official city agenda-management portal, September 8 council meeting page,
and council-meetings index. No model or database operations are performed by
this search function; the wrapper's first invocation printed its existing
development database selection, but that database was not queried or mutated.

The documented Gateway health endpoint on port 8765 refused connection. A
second smoke explicitly set `DATABASE_URL=''` and a process-local
`TOWNREPORTER_GATEWAY_MCP_URL=http://127.0.0.1:8765/mcp`. Actual lineage:
```text
halo-gateway: SEARCH_FAILED_PROVIDER, 0 hits
exa-mcp: SEARCH_SUCCESS_RESULTS, 8 hits
```
No saved configuration was changed and no Gateway service was started. This
proves real unavailable-Gateway fallback, not a healthy Gateway integration or
every downstream search provider. Those acceptance limits remain explicit.
