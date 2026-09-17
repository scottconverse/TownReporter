# Next TownReporter patch — unreleased

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or live-provider result.

## Operational fixes

### Windows promotion process match

The v0.6.51 production promotion initially refused to stop the verified TownReporter server because `ops/promote.ps1` looked for `.output/server/index.mjs` with forward slashes. Windows reports the command line with backslashes.

The candidate now checks the process through `Test-TownReporterServerProcess` in `ops/lib-port.ps1`. It normalizes slash direction and requires this checkout's exact absolute built-server path. It still rejects `node.exe` processes whose command line points somewhere else.

Targeted evidence:

- `node --test scripts/ops-promote-process.test.mjs` passed 1/1. The test executes the PowerShell helper and covers both the real Windows TownReporter command line and an unrelated Node command line.
- `node --test scripts/ops-scripts.test.mjs` passed 24/24.

These checks prove the focused process classifier behavior. They do not prove that a new candidate has been promoted to production.

## Windows installation

The Windows guide now names the installer asset to download
(`TownReporter-<version>-windows-x64.zip`) and tells the reader to stop if that
asset is missing rather than using the source ZIP. It adds the first-run
boundary (the first account owns the newsroom, there is no shared password and
no reset flow), what the app needs before it can write, the public and desk
addresses, and where data, logs and backups live.

Targeted evidence: `node --test scripts/windows-installer.test.mjs` passed 6/6.
The data-folder inventory the guide names was then checked against the packaged
installer source rather than assumed - `config.json`, `providers.json`,
`pgdata`, `initialize.log`, `postgres.log`, `dependencies.log`, `build.log`,
`migrate.log`, `app.out.log` and `app.err.log` are each created by
`installer/Install.ps1` or `installer/Start.ps1`.

A clean-data-root packaged install on 2026-09-17 extracted the exact candidate ZIP, provisioned Node.js 22.23.2 and PostgreSQL 17.11 on isolated ports 4388/15432, installed dependencies and Chromium, completed the production build and database setup, answered `/` with HTTP 200 and version 0.6.51 and `/desk` with HTTP 200, then stopped cleanly with persistent data retained. See [the clean-data-root proof](../proofs/windows-host-install-0651.md).

A separate Windows Sandbox attempt reached the real installer but failed during dependency download with `Invoke-WebRequest` "Unable to connect to the remote server"; no result was produced. See [the sandbox attempt](../proofs/windows-sandbox-attempt-0651.md). **No fresh-machine human acceptance was performed.**
## Dark Desk run meter

Three problems were reproduced and repaired against the run meter, using the
same isolated newsroom throughout.

1. Research consumed the whole wall clock. `darkRunBudget()` sized the run from
   the provider's wall clock and the meter was checked only at hop boundaries,
   so a five-hop round finished research at the wall and the signal desk never
   ran - two runs stopped `elapsed-time-limit` with zero eligible signals.
   Research now stops while the clock reserved for synthesis, verification and
   the brief is still on the meter.
2. A budget stop was counted as a verification failure. The adversarial review
   added `failed += 1` when the meter, not the signal, stopped it. Those
   signals are now counted as **deferred**; only an attempted signal with no
   usable verdict, or one whose trail could not be saved, counts as failed.
3. The hop's second model call could cross the reserve. A hop costs a planner
   call and a read-selection call, so a hop that began with headroom could
   finish below the reserve. The selector now yields the reserve and its
   candidates fall back to the ordinary read queue.

A fourth, separate defect was found in the run record itself: verification calls
were logged `provider: "injected", model: "injected"` on live runs, because
production passes a failover callback where the code assumed a test double. The
record now names the editor's actual choice.

Targeted evidence:

- `src/lib/news/dark-research-reserve.test.ts` 4/4, including the RED cases
  "research must not start a hop inside the reserve" (5 hops ran where 0 were
  allowed) and "the selector must not run inside the reserve".
- `src/lib/news/dark-verify-budget.test.ts` 3/3, including the RED case "a
  live provider call must not be logged as a test double".
- Neighbouring research and review suites 18/18 and 36/36; `npm run typecheck`
  and `npm run build` passed.
- Eight bounded live runs on an isolated database with `codex-luna`, including
  the September 3-8 replay. Run 7 - the same newsroom, model and dig as run 5 -
  finished **every** stage including the editor brief, which run 5 never
  reached. Run 6 (the replay) stopped at `hop-limit` by design with 4/4
  verifications attempted, 0 failed, 0 deferred. Records:
  `docs/proofs/dark-desk-run-budget-0651.md`.

**Limits.** One newsroom and one model, so no cross-model claim. Signals are
leads, not findings. The reserve is a check *before* a call rather than a cap
*on* it, so a call that starts just above the line can still cross it; run 8
showed a round can still end on the clock with the brief attempted and timing
out. At dig 4/10 with a verification limit of 6 the configured work can exceed
the 420-second wall at this provider's observed 10-90 seconds per call.
**Resizing the whole-run clock is a product decision and is not made here.**

## Editorial and intake

- **Queue redraft.** A completed or failed batch now returns its exact persisted
  `modelChoice` and `modelEffort` and rehydrates the picker once, so changing
  from a local pick to a cloud one cannot strand **Redraft**.
  `draft-batch.test.ts` 24/24 (RED first: the stored choice returned
  undefined), `draft-batch-result-render.test.mjs` 4/4.
- **OCR Automatic.** Automatic document transcription derived a bespoke Haiku
  default instead of the shared ladder's Claude Sonnet rung. It now reads the
  registry. OCR routing and suite 34/34, model pickers 16/16, model-choice and
  registry 50/50.
- **Long PDF packets.** Completed pages were discarded when a later page
  failed, so a 15-page scan could never finish: every retry restarted at page
  one. Pages are now checkpointed individually (`extraction_pages`, migration
  0063) and a retry resumes at the first unread page.
  `story-documents.test.ts` 6/6, including a 15-page packet that resumes at
  page 13 without rereading. Failed or oversized pages stay explicitly unread.

## Verification of existing paths

- **Pull.** The repository's browser walk ran against a fresh in-memory
  database: the mechanical-stage notice appeared, counters were live, the job
  reattached after a full reload, **Stop** made the checkpoint continuable,
  **Continue** lost no progress, and the run finished with four documents saved
  whose URL survived a second reload.
- **Story evidence-check.** The isolated Story workspace uploaded a 100-byte meeting record, drafted with `codex-luna`, and ran **Check draft against evidence**. The check completed, validated the uploaded passage, loaded a checked version with one proposed change, and kept Keep/Restore/Publish as separate editor decisions. See [the proof](../proofs/story-evidence-check-live-0651.md). Limits: one small text document and one provider.
- **Image-only PDF OCR.** A one-page image-only PDF was uploaded through the isolated Desk composer and recorded as **read · 1/1 parts read**, with 208 extracted characters retained. See [the proof](../proofs/image-pdf-ocr-live-0651.md). Limits: one synthetic page; it does not prove scanned-packet quality or that every OCR fact reaches the draft.
- **Live provider recovery.** One explicit Claude Sonnet draft completed on the isolated build. A separate supplied-material draft requested an intentionally unreachable Custom API connection and completed on **Codex Terra**, with the workspace recording that the draft moved because the Custom API connection was unavailable. See [the second-provider proof](../proofs/live-second-provider-0651.md) and [the failover proof](../proofs/live-failover-0651.md). Limits: one forced connection-unavailable failure, not every mid-call failure class or provider pair.

- **Corrections.** The live public corrections page was read without
  submitting: the form renders, its prepared link is
  `mailto:townreporter@gmail.com`, and the page states it has not sent
  anything. **Delivery is not proved** - a `mailto:` hands off to the reader's
  own mail client.

## Documentation corrections

Several real defects were found and fixed. `docs/manual.md` listed a page-watches URL
in its route table that no route serves - the panel is mounted inside the Dark
Desk page. The same file described five job kinds
where `JobKind` defines nine; the missing four are now listed. Operator guides now match the live Server panel labels and include Grok/custom-connection entries in the picker lists. Two guards were
added: `scripts/docs-links.test.mjs` (50 files, 229 relative links, 0 missing)
and `scripts/docs-routes.test.mjs` (28 routes, 27 documented paths, 0
unresolved).

## Not asserted by this document

No release, tag, GitHub publication, production deployment, promoted candidate,
completed fresh-machine Windows install, or email delivery is asserted here. The
fresh-machine attempt is recorded as inconclusive. Every live result above names
the record behind it, and each carries its limit.