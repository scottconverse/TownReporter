# Editor delivery checkpoint — September 10, 2026

Production is unchanged. Source base: `7fc7ac8`, plus the two browser-script
corrections and five operator-document updates in this checkpoint.

## Candidate and browser checks

`node artifacts/build-delivery-candidate.mjs` exited 0. It cleared the database
configuration and model credentials before building; migrations were skipped.
Full log: `artifacts/delivery-build-1789087062907.log`.
Built server entry SHA-256:
`BCA254F22D496F3366309A60468EA77042FE22322CCB3FB00B3EFE58415C5CAC`.
This is the entry-file hash, not a manifest of the entire output tree.

The stale CI tests used a hidden model selector and superseded checkbox/result
labels. The corrections open the actual Model/change disclosure and use the
current accessible checkbox, workbench-link and saved-draft labels. Selection
limits, explicit runtime, both terminal results and queue-count checks remain.

Commands, run serially against fresh in-memory PGLite:

```text
node artifacts/resume-publishing-check.mjs desk-flows-e2e.mjs
{ "ok": true, "steps": 23, "email": "flows-1789087238462@townreporter.test" }

node artifacts/resume-publishing-check.mjs scan-desk-e2e.mjs
{"ok":true,"test":"scan-desk-e2e.mjs","buildHash":"bca254f22d496f3366309a60468ea77042fe22322ccb3fb00b3efe58415c5cac"}
```

The scan receipt contains 27 completed steps, including two fake-provider drafts
with saved draft IDs and the real New-to-Drafted count update. It does not prove
AI reporting quality or a live scheduled scan. Desk used CI-equivalent absent
Codex; scan used the existing fake Claude CLI, not a real Claude invocation.

Full logs (including every warning/error and the completed-step lists):

- `artifacts/resume-desk-flows-e2e.mjs-1789087236149.log`
- `artifacts/resume-scan-desk-e2e.mjs-1789087441768.log`

Earlier failures are retained, not represented as successes:

- `artifacts/resume-desk-flows-e2e.mjs-1789087119677.log`: local wrapper disabled
  Codex, unlike CI's missing executable; selection was correctly disabled.
- `artifacts/resume-scan-desk-e2e.mjs-1789087268858.log`: old workbench link text.
- `artifacts/resume-scan-desk-e2e.mjs-1789087359688.log`: old Completed text, while
  the screen actually showed both saved draft IDs. The final run requires those IDs.

All owned browser-test servers were stopped by the wrapper. Browser console
checks passed; server logs still contain Better Auth missing-client-IP warnings
and aborted-navigation ECONNRESET errors. They are preserved, not called clean
server logs. Build warnings remain in the complete build log.

## Release boundary

At this check, current GitHub main remains accepted v0.6.34
`b097d288d9237be225bc6ed56851078ad064d208`. CI run `34538469502`
passed its main test job and all jobs except the two stale browser scripts;
Windows run `34538469500` passed packaging and fresh installation. Those are
base-candidate results, not proof of the new commit's CI or production promotion.
No production database, service, publication or settings were changed here.

Real selected-page PDF acceptance is a separate live check; browser fixture
success is not substituted for it. Raw receipts stay local because browser
artifacts can contain temporary authentication material.

## Real editor-selected PDF page — completed

`node artifacts/run-real-pdf-delivery.mjs` exited 0 with `activeJobs:0` and
owned server PID29552 exited. It used native Codex Terra (`codex-balanced`),
the retained public Ramsey council PDF, fresh in-memory PGLite and no separately
paid API. The UI requested pages13–13, created exactly one artifact-ocr job,
and displayed the returned transcript. Result: `pagesRead:1`, `pagesTotal:44`,
`provider:"Codex"`, `reason:null`. The original empty extraction and 16,254,338
PDF bytes remained unchanged.

- Original PDF SHA-256: `14E16CFD9584A413955F915DDD96C56CF31E7D02C8C330CD2F2C374F1ADD7C20`.
- Receipt: `artifacts/real-pdf-page-reader-acceptance/receipt-2026-09-11T00-46-09.410Z.json`.
- Receipt SHA-256: `ADC9892F188865BE7347FA55CA5D67297221F864F5563535D15A5D50138878AF`.
- Full log: `artifacts/real-pdf-delivery-1789087567911.log`.
- Completed UI: `artifacts/real-pdf-page-reader-acceptance/completed-2026-09-11T00-46-09.410Z.png`.

Lead independently rendered source page13 with Poppler and compared the image
to the saved transcript. It recovered all four action-tracker rows and their
key dates, including the July10 update and June24 planning meeting. Important
limit: the source's color-only RAG status cells (red/red/red/green) became empty
transcript cells. There is also a minor `met` → `meet` verb error. The rotated
source page was read, but this is not table-perfect OCR or whole-packet quality
acceptance. PDF ordinal13 is printed page11; the transcript preserves both.

The first attempt failed in the test helper's account-navigation wait before
queuing any model job. It exited with activeJobs0. Its receipt and log remain:
`receipt-2026-09-11T00-44-38.668Z.json` and
`artifacts/real-pdf-delivery-1789087477114.log`. The helper was aligned with
the existing working first-account browser flow; no application code was
changed to make this check pass. Server warnings remain in both full logs.

Luna independently accepted the browser-selector diff as preserving the
behavioral checks, and completed the five operator-document updates. Tests
and the real PDF run were executed by the lead, not delegated.
