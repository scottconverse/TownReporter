# Durable reporting Pull proof

- Accepted revision: `6cc1d44` on `feature/dark-desk-bounded-runs` (base `434c2bf`).
- Phase and mode: `OPENAI_ONLY`, `OPEN_MULTI_AGENT`; delegation verified.
- Luna trial: `gpt-5.6-luna`, high reasoning, `/root/luna_pull_core`. The first pass added the durable worker, phase checkpoints, terminal guards, provider failure retention, and claimed lead mutations. Seven focused worker tests and typecheck passed. Lead review then added whole-run cancellation, attempt fencing, and shared-document excerpt handling. Worker elapsed time and provider usage were not exposed.
- UI review: `gpt-5.6-terra`, high reasoning, `/root/terra_pull_ui`. It found duplicate-line association, false deadline cancellation, dead-click feedback, resumed elapsed-time, accessibility, phone recovery, and newsroom visibility defects; the integrated revision addresses them.
- Acceptance review: `gpt-5.6-sol`, xhigh reasoning, `/root/sol_pull_acceptance`. Sol initially rejected the change for stale-worker, concurrent-save, start/continue-race, deadline, and shared-document excerpt defects. After correction, Sol accepted with no remaining material gap.
- Integrated checks: production build passed; TypeScript passed; focused ESLint reported zero errors; 79 focused search, cancellation, fetch, ingestion, PDF/OCR, and Pull tests passed.
- Browser/public-web proof: a clean production build created an editor and story, started a real mechanical Pull, showed live stages and counters, restored the job after reload, stopped and continued from its checkpoint, checked 1 search, 1 provider, 9 index pages, opened and saved 4 documents, displayed the opened-document list, and retained the pulled URL and excerpt after a second reload.
- AI usage by Pull: none. The path uses search providers and document extraction only.
- Deployment: not performed as part of this milestone.
- Unresolved limitations: no material Pull defect identified by the final independent review. External provider availability still determines which public records a particular run can retrieve.
