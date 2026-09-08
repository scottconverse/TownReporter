# Municipal-record retrieval check — 2026-09-08

Scope: read-only pack checks against persisted investigation 10 and artifact 149, followed by one explicitly authorized exact-candidate build and one UI brief rewrite. The pack checks made no database changes; the UI action persisted brief job 15 and replaced the saved investigation brief.

## Before the selection correction

- Artifact 149 contained 52,747 extracted characters. `Connection Church Annexation Referral` began at character 3,471 and `8979 Nelson Road` at 3,628.
- The prior synthesis pack was 24,111 characters. It omitted artifact 149's URL and Connection Church passage because the newest-12 selection excluded artifact 149. The address appeared only in unresolved frontier labels. The 28,000-character whole-pack cap was not reached.
- The prior per-document 1,600-character prefix would also have excluded the target passage.

## Current frozen-worktree check

- `buildDarkSynthesisPack(10, "", 1)` returned 23,150 characters, below its 28,000-character bound. It included the artifact URL, Connection Church, `DV-ANNREF-26-00001`, approximately 1 acre, and Mixed-Use Employment (MU-E).
- The first `buildDarkBriefPromptPack(1, 10)` check returned 11,504 characters, below its 22,000-character bound, and included the artifact URL but omitted the four target facts. This was a real failed check: `briefPack` clipped the selected artifact evidence at 1,200 characters. The result is provisional because the implementation was immediately returned for correction; no model call followed.

## Frozen reclip correction check

- After the focused 1,200-character reclip fix was frozen, synthesis remained green at 23,150/28,000 characters with the URL and all five target markers.
- The brief remained red at 10,313/22,000 characters. It contained none of the artifact URL, Connection Church, `DV-ANNREF-26-00001`, approximately 1 acre, or MU-E markers. Artifact 149 actually ranked first: score 112 from 12 question-term hits and 52 frontier-term hits, with an 8,212-character rendered entry. Artifact 146 then used 372 characters. Artifact 159 was clipped against the remaining 1,416 characters, but `capText` reserved 24 characters for a 25-character suffix, producing 1,417; the internal total became 10,001 and two entry separators added another four characters. The resulting 10,005-character documents value exceeded `briefPack`'s 10,000-character section budget, so the whole documents section was omitted. The final brief had zero capture headers. No model call or build followed this failure.

## Frozen marker/separator correction check

- Synthesis: 23,149/28,000 characters, with the artifact URL, Connection Church, `DV-ANNREF-26-00001`, approximately 1 acre, MU-E, capture 149, version 40, and stored hash prefix `18f6b3833332` all present.
- Brief: 20,303/22,000 characters, with the same eight evidence and provenance markers all present.
- Result: both actual persisted-data pack builders pass within their separate bounds. No application build or model call was used.

## Exact-candidate UI brief acceptance

- Source: clean commit `7fc0b2bb344ebd6442cd88717a95e335feb03a0d`, TownReporter 0.6.34. One `DATABASE_URL=''` build completed successfully before the runtime check.
- Runtime: built app on port 4393 against the preserved isolated PostgreSQL database on 15436. Existing investigation 10 was opened; the UI displayed Codex Terra with no fallback.
- One `Rewrite the brief` action created brief job 15. It started at 10:12:05.217 and completed at 10:12:41.656 MDT: 36.439 seconds of application execution, excluding editor setup and review time.
- Visible result: `WORTH YOUR TIME`; the headline said the City activity record identifies a proposed annexation of 8979 Nelson Road while service and tax effects remain undocumented. It correctly included FIL Connection Church Annexation Referral, approximately one acre, proposed MU-E zoning, the unchanged religious-assembly use, adjacency to annexed City land, and unknown project-specific service/tax terms. It incorrectly named Founders Block, LLC as the applicant. In the source table, `Mark Sullivan, Founders Block, LLC` is the applicant cell ending the preceding Coffman Street Apartments row; the Connection Church row begins immediately after `FIL` and its own trailing applicant cell is `Doug, Connection Church Longmont INC`. Runtime acceptance is therefore held for source-row attribution, despite successful evidence retrieval.
- No new dig, search, queue handoff, or publication occurred.
- Cleanup: the exact owned app process was stopped and port 4393 verified free. The installation's supported stop command then stopped its owned PostgreSQL process, retained the database files, and port 15436 was verified free.

## Frozen continuation correction check

- Synthesis remained 23,149/28,000 characters; brief remained 20,303/22,000.
- Both packs contained the artifact URL, Connection Church, `DV-ANNREF-26-00001`, approximately one acre, MU-E, capture 149, version 40, hash prefix `18f6b3833332`, `Doug`, `Connection Church Longmont INC`, and the continuation locator `page:1:char:4000-4130`.
- This no-model check proves the correct adjacent same-page row tail reaches both prompts. It does not replace a subsequent generated-brief correctness check.

Artifact accounting correction was recorded separately in `dark-desk-five-investigations-2026-09-08.md`. No screenshot file was saved; the rendered result was inspected in the authenticated browser before shutdown.

## Final metadata-ranking and deduplication recheck

- Against the preserved investigation 10 database, the frozen PR40 worktree produced a 23,149/28,000-character synthesis pack and a 20,303/22,000-character brief pack.
- Both contained the official `ADL20260217.pdf` URL, Connection Church, `DV-ANNREF-26-00001`, `8979 Nelson`, approximately 1 acre, MU-E, `Doug`, `Connection Church Longmont INC`, and continuation locator `page:1:char:4000-4130`.
- The selected document header format is `[capture:149 version:40 hash:…]`; the URL and continuation locator therefore remained bound to capture 149/version 40 in both packs. This was a no-model, no-build check. A first bootstrap invocation failed before loading the module because a Windows module path lacked a `file:` URL; the corrected invocation ran once and passed.
- The owned PostgreSQL instance was stopped afterward; port 15436 was free and persistent data was retained.

## Exact candidate `7d4b314d` UI brief acceptance

- The one authorized `DATABASE_URL=''` build passed for exact commit `7d4b314d45562b11725948cf69f2448468fec76d` (version 0.6.34).
- One authenticated `Rewrite the brief` action created job 16 using `codex-balanced` (the configured Codex Terra choice). It started at `2026-09-08 10:39:29.760878-06` and finished at `10:39:55.864566-06`, 26.104 seconds later, without fallback or an additional dig/search action.
- Acceptance failed on factual attribution. Job 16 was persisted as `completed`/`Done` with no error and the normal void-job `result_json={}`; `investigation_briefs.generated_at` was `2026-09-08 10:39:55.861037-06`, immediately before the job finished. The stored thin brief correctly retained the project ID, address, approximate acreage, MU-E zoning, unchanged religious-assembly use, and unknown service/tax effects, but incorrectly named `Mark Sullivan of Founders Block, LLC` as the Connection Church applicant instead of the source row's `Doug, Connection Church Longmont INC`.
- The screenshot is `release-034-evidence/nelson-final-brief-7d4b314d-job16.png` and displays that generated thin brief. The initial automated text locator selected the nested empty-state region and was misleading; the persisted brief row and screenshot establish the actual output.
- No retry was made. The owned app and PostgreSQL processes were stopped cleanly; ports 4393 and 15436 were free and persistent data was retained.

## Exact candidate `f48047b8` UI brief acceptance

- The one authorized `DATABASE_URL=''` build passed for exact commit `f48047b87dca796fdc2c6ebb426b47cc6cd5d434` (version 0.6.34).
- One authenticated `Rewrite the brief` action created job 17 with `codex-balanced` (the configured Codex Terra choice), no fallback. It started at `2026-09-08 10:53:44.462081-06` and finished at `10:54:03.619457-06`, 19.157 seconds later.
- The persisted brief and populated `Read this first` panel both identify `Doug` of `Connection Church Longmont` as the applicant. They retain `DV-ANNREF-26-00001`, 8979 Nelson Road, approximately one acre, Mixed-Use Employment/MU-E zoning, and the unchanged religious-assembly use. They say the supplied file does not establish project-specific municipal-service or tax effects. Neither `Founders Block` nor `Mark Sullivan` appears in the generated brief.
- Screenshot: `release-034-evidence/nelson-final-brief-f48047b8-job17.png`. The text was captured from the populated bordered brief panel after job 17's persisted completion; no empty-state selector was used for the accepted output.
- No dig, search, publication, fallback, or second model call occurred. The owned app and PostgreSQL instance were stopped; ports 4393 and 15436 were free and persistent data was retained.
