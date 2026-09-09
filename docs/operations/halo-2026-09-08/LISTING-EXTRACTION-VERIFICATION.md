# Listing extraction verification

Executed September 8, 2026, MDT, in the development checkout. The raw artifact filenames below say `20260909`; that naming error is preserved, not presented as the execution date. No production change, model call, browser launch, build, Vite test, or database test was performed in this verification.

## Finding and bounded repair

The public `https://longmontcolorado.gov/news/` HTML already contained ten dated news cards. This was not proof of a missing AJAX payload. Readability retained 258 characters of filters/signup controls instead of the cards. The existing heuristic fallback also removed the actual `<main class="main h-header--mobile">` because its boilerplate class expression matched `header`.

`src/lib/news/article-extract.ts` now rejects paired standalone listing-control/signup labels as a Readability misparse and reuses the existing fallback. Class-based boilerplate removal preserves semantic main/article roots; descendant navigation/banner removal is unchanged. No renderer threshold, host list, or site-notice behavior was changed.

The reduced inline fixture in `article-extract.test.ts` preserves the relevant public-response structure and dates. A negative test retains ordinary article prose that discusses loading news, results, and sorting.

## Commands and results

All commands ran from `C:\Users\scott\Desktop\Code\townreporter-dev`. Baseline and both RED runs used this command with only `article-extract.test.ts` and their corresponding log filename. Final GREEN included the existing render tests:

```powershell
node --input-type=module -e "import {spawnSync} from 'node:child_process'; import {safeTestEnvironment} from './scripts/test-environment.mjs'; const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','src/lib/news/article-extract.test.ts','src/lib/news/render-fetch.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'});process.exit(r.status??1);" 2>&1 | Tee-Object -FilePath artifacts/listing-extract-final-green-20260909.log; exit $LASTEXITCODE
```

Baseline: 3 passed, 0 failed, duration 214.4709 ms. First RED: 4 passed, 1 failed, duration 217.4258 ms; expected dated headline was absent and extraction returned signup text. Second RED: 4 passed, 1 failed, duration 220.8045 ms; semantic main was removed and extraction returned empty text. Full assertion failures are preserved in the hashed logs.

Final verbatim summary:

```text
ℹ tests 8
ℹ suites 2
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 233.0568
```

Live public fetch/extraction command:

```powershell
node --experimental-strip-types --input-type=module -e "import{extractArticleText}from'./src/lib/news/article-extract.ts';import{needsRenderedFetch}from'./src/lib/news/render-detect.ts';import{htmlToPlainText}from'./src/lib/news/html-text.ts';const u='https://longmontcolorado.gov/news/';const r=await fetch(u);const h=await r.text();const e=extractArticleText(h,u);console.log(JSON.stringify({url:u,status:r.status,method:e.method,length:e.text.length,cleanAir:e.text.includes('Clean Air Champion'),date:e.text.includes('September 8, 2026'),cooling:e.text.includes('New Cooling Features'),renderRequested:needsRenderedFetch(new URL(u),htmlToPlainText(h),h,e.text.length),excerpt:e.text.slice(0,2600)},null,2));" 2>&1 | Tee-Object -FilePath artifacts/listing-extract-final-live-20260909.log
```

Observed HTTP 200, heuristic extraction, 1059 characters, both sampled headlines and September 8 date present, `renderRequested: false`. The full extracted text is in the log. An intermediate live check returned only `Skip to main content` (20 characters), exposing the semantic-main bug; that failed check is also preserved.

## Raw evidence SHA-256

Files are in the development checkout's `artifacts/` directory (local evidence, not necessarily tracked in Git).

| File | SHA-256 |
|---|---|
| listing-extract-baseline-20260909.log | A7306030C5C90C384048D2C585D336B1023317B69494C30328CC95A5AC3AFCFB |
| listing-extract-red-20260909.log | 525CB66B3A4E9CDFFC67515D830C69478AF8245291C6CD0BDD2E0430E4636748 |
| listing-extract-main-red-20260909.log | CB906EF753C3F47DA3C7F77EB51B4792008F2F8529E7CAAE1D68F5F2CB8BD07F |
| listing-extract-final-green-20260909.log | FD0C26CB8464B6147A8062DF8E3AD16115AEEE6F55214E287A6483960975922B |
| listing-extract-live-20260909.log (intermediate failure) | E0C7ED4BF1B95C211AF11C96B8DC0564B2FC82E7BC34CAF77470618BEA57A3AD |
| listing-extract-final-live-20260909.log | 1AACC5EB9762A2FFCFC09CBEB890B25B7A15EAC9D51C9B74E726662B71F0C67A |

`git diff --check` passed; Git emitted LF-to-CRLF normalization notices only. Some listing controls remain alongside recovered cards. This demonstrates source extraction, not a successful model scan, editorial result, deployment, or recovery test.

## Follow-up: actual scanner ingestion path

The subsequent candidate scan still returned navigation-only content. Tracing its actual caller found `performScanWork` uses `ingestUrl`, not `ingestDocument`. The former still stripped every HTML tag and sliced the first 14,000 characters: a large menu crowded out dated cards even after the extractor itself was corrected. The earlier proof above did not establish scanner integration.

The bounded follow-up changes only `src/lib/news/ingest.ts` and its existing test file. The HTML branch now calls the existing `extractArticleText` before the same 14,000-character cap. It uses the extracted title when present and preserves existing extras/feed discovery. Optional `notices` retains `extractSiteNotices` output separately, never mixed into article text. The scanner currently consumes body text, not that notice array; this does not prove notice-driven scanning. PDF, RSS, YouTube and PrimeGov paths are unchanged. No new renderer or network classifier was added.

The regression calls real `ingestUrl` through the existing stub HTTP seam, using a public-IP URL to avoid DNS, a reduced listing fixture, and more than 14,000 characters of navigation before the dated cards. It asserts both recovered headlines and a date, absent menu text, notice separation, title, RSS discovery and exactly one stub request. No network, browser, Vite/database test, model, build or deployment ran in this follow-up.

Exact commands from the development checkout:

```powershell
node --experimental-strip-types --test src/lib/news/ingest.test.ts 2>&1 | Tee-Object artifacts/ingest-listing-baseline-20260908.log; exit $LASTEXITCODE
node --experimental-strip-types --test src/lib/news/ingest.test.ts 2>&1 | Tee-Object artifacts/ingest-listing-red-20260908.log; exit $LASTEXITCODE
node --experimental-strip-types --test src/lib/news/ingest.test.ts src/lib/news/article-extract.test.ts src/lib/news/render-fetch.test.ts 2>&1 | Tee-Object artifacts/ingest-listing-green-20260908.log; exit $LASTEXITCODE
```

Verbatim summaries, baseline then RED then widened GREEN:

```text
ℹ tests 18
ℹ suites 8
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 764.6424

ℹ tests 19
ℹ suites 9
ℹ pass 18
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 777.1721

ℹ tests 27
ℹ suites 11
ℹ pass 27
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 851.2856
```

The genuine RED asserted `/Clean Air Champion/` against the returned capped navigation text. Its complete assertion output is preserved in the raw RED log. Each run also emitted the existing malformed-PDF fixture warnings below, in this order:

```text
Warning: Invalid PDF header version: invalid
Warning: Invalid PDF header version: invalid
Warning: Indexing all PDF objects
Warning: Invalid PDF header version: invalid
Warning: Invalid PDF header version: invalid
Warning: Indexing all PDF objects
Warning: Indexing all PDF objects
Warning: Indexing all PDF objects
Warning: Indexing all PDF objects
Warning: Indexing all PDF objects
Warning: Indexing all PDF objects
```

| Raw artifact in `artifacts/` | SHA-256 |
|---|---|
| ingest-listing-baseline-20260908.log | 17BA36C4D6F00B46AB2E6EDC104F8B7DD6C481FD4C02B0BC4B364319A5F38E24 |
| ingest-listing-red-20260908.log | 727235C573B730D223F2A44FCE9AABA9278C56FA8BE0942D260661A96E1DDCB8 |
| ingest-listing-green-20260908.log | 44424F1F6FEB0A117A83ECFAE1F2E28BBD868EDC14A32A82270B2FE1553C9619 |

`git diff --check` passed with LF-to-CRLF normalization notices only. No source changes followed this verification. This proves the scanner's ingestion entry point against stubbed HTTP, not a completed live model scan or editorial result. The main agent owns candidate rebuild and live acceptance; this report does not claim either outcome.

## Full-suite regression caught and repaired: text/plain

The main agent's subsequent isolated full-suite r2 run found five failures in unchanged `scan-section-cache.test.ts` cases. They were caused by this ingestion change: plain-text responses were incorrectly sent through the HTML extractor and rejected as unreadable. This was an introduced regression, not a fixture defect. Existing assertions and their text/plain HTTP fixtures were not changed.

The narrow correction dispatches explicit `text/plain` (including charset parameters) before HTML parsing, retaining whitespace normalization, 14,000-character cap and 40-character minimum. A new ingest test supplies a plain report with a literal `<` and proves it remains readable. PDF/feed precedence and HTML extraction remain unchanged.

Exact RED and widened GREEN commands:

```powershell
node --input-type=module -e "import{spawnSync}from'node:child_process';import{safeTestEnvironment}from'./scripts/test-environment.mjs';const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','src/lib/news/ingest.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'});process.exit(r.status??1);" 2>&1 | Tee-Object artifacts/ingest-plaintext-red-20260908.log; exit $LASTEXITCODE
node --input-type=module -e "import{spawnSync}from'node:child_process';import{safeTestEnvironment}from'./scripts/test-environment.mjs';const r=spawnSync(process.execPath,['--import','./scripts/test-environment-guard.mjs','--experimental-strip-types','--test','--test-concurrency=1','src/lib/news/scan-section-cache.test.ts','src/lib/news/ingest.test.ts','src/lib/news/article-extract.test.ts','src/lib/news/render-fetch.test.ts'],{env:safeTestEnvironment(),stdio:'inherit'});process.exit(r.status??1);" 2>&1 | Tee-Object artifacts/ingest-plaintext-green-20260908.log; exit $LASTEXITCODE
```

RED failed with `Error: Page had almost no readable text` from `ingestUrl` on the new readable-text fixture; full stack is in the raw log. Verbatim summaries:

```text
ℹ tests 20
ℹ suites 9
ℹ pass 19
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 837.3867

ℹ tests 33
ℹ suites 11
ℹ pass 33
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12490.9669
```

Both runs emitted the same eleven pre-existing PDF-fixture warnings reproduced above. The widened test ran with explicit safe environment overrides and the preload guard; its database-backed cache cases used isolated PGLite, not staging/production PostgreSQL. No model, build or deployment ran. All five existing cache cases passed unchanged. `git diff --check` passed with LF-to-CRLF notices only.

| Raw artifact in `artifacts/` | SHA-256 |
|---|---|
| ingest-plaintext-red-20260908.log | E05913627A51E801208E0576413EB85312705879FEA05B5EADF09C9B06BB1B19 |
| ingest-plaintext-green-20260908.log | 642AA49508740ED2B99BB69A562510959A60C3E726708BB54C451390BC4BAA48 |

This supersedes the prior source snapshot for ingestion verification; a whole-repository rerun and live editorial acceptance remain the main agent's responsibility.
