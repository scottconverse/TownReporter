# Contrasting-community discovery and drafting

Built candidate: ae0e4dd7174fc360ac155272c552a073a84f1227. Staging only:
port 3471, database `townreporter_stage_03efb7b_20260911`. Production untouched.

Created isolated acceptance newsroom 98912 and temporarily assigned only
`staging-editor` as its owner. Used the normal paper setup form to save
Burlington/Vermont, America/New_York, school district https://www.bsdvt.org/
and community calendar https://burlingtonvt.gov/calendar.aspx. No desired
story or answer was supplied to the scanner. These are accepted sources
2883/2884 scoped to that newsroom. Longmont sources/settings were unchanged.

## Actual normal application runs

- Scan job 117: completed 02:23:21.263075–02:23:38.756332 MDT, Sept 11.
  Two sources fetched, one school lead, zero proposed sources. No fallback:
  explicitly selected Codex Terra. Lead 139: BHS Heroes Club food-drive prize,
  score 7/20, schools. Its actual district announcement is dated September 9.
- Draft job 118: completed 02:24:31.770189–02:26:44.563760 MDT, explicit
  Codex Terra. Checkpoint draft 77 and final 78 preserved. UI returned the
  finished draft with six claims and exact captured-source references.
- Only one model job ran at a time. No publication, automatic schedule, or
  public test article was enabled. Zero queued/running jobs afterward.

## Lead's factual review, not model self-certification

Read final draft 78 against captured full texts 1583 (district), 1592 (VPA),
and 1593 (Market 32 / Price Chopper). The draft correctly attributes the
1,800-plus food items to students statewide, not BHS alone; calls the $500
prize-funded donation planned, not already completed; and attributes the
division rules, prizes, donation restrictions and historical event dates.
No substantive factual correction identified or applied. This is a usable
school/community brief, though the donation-item list could be shortened as
an editorial preference. No generalized accuracy or daily 3–5-story target
claim follows from this one sample. Review effort was approximately five
minutes, separately from model time; this is an estimate, not an instrumented
full-day editor-effort measurement.

The source captures were available in the UI with version/capture IDs. The
claims had no quoted excerpts for mechanical passage matching; the review
above used the actual full text, not the UI's existence-of-capture check.

## Limits found, retained rather than hidden

- The desk header/title remained Longmont despite the correctly scoped
  Burlington setup and reporting. Source diagnosis: root public PaperProvider
  supplies newsroom 1 to the desk chrome. A desk-only identity correction is
  being prepared; public identity must remain unchanged.
- The reporting pass found useful independent program sources but also
  fetched irrelevant historical renovation/election/contractor documents.
  Curated-tool/research relevance work remains open; this success does not
  waive item 8.
- Two sources and one lead establish contrasting-community discovery, not
  complete coverage breadth or dependable unattended daily output.

After terminal job verification, the staging editor was restored to its
original editor role in newsroom 1. Room 98912, its sources, captures, lead,
and both draft versions remain retained acceptance evidence. No rollback of
the broader staging database was performed.

## Desk identity correction prepared

Luna added a desk-level authenticated PaperProvider in `src/routes/desk.tsx`,
leaving the public root untouched. Lead reused the existing setup-config query
key so saving paper setup invalidates the displayed desk identity as well.
`npm run typecheck` exited 0, no diagnostics. This is code-first work, not a
TDD claim. Rebuilt-browser and fresh-owner onboarding checks remain pending;
the currently running staging build predates this desk-only correction.
No further model generation is required to verify it. No full-suite or
production release acceptance is claimed by this development checkpoint.

### Rebuilt desk identity checked

Built revision 9a7a565 with DATABASE_URL empty; `npm run build` exited 0,
migration skipped. Log `artifacts/desk-identity-build-20260911.log`.
Restarted only the owned staging server. Temporarily placed the staging editor
in 98912 (editor role), then reloaded story 139: the rendered link said
**Burlington acceptance paper** and header **EDITOR'S DESK — BURLINGTON**.
Clicked View paper: public page remained **TownReporter LONGMONT, COLORADO**.
Restored the editor to newsroom 1; zero queued/running jobs. Browser document
title still names the public paper; that cosmetic limit was not expanded into
another change. Fresh-owner onboarding was not separately exercised here.

### Next-action evidence: live queue changed

Read-only production query after this check found NEW 8, HELD 4, KILLED 97,
PUBLISHED 39. The earlier queue snapshot must not drive bulk mutation.
The user's executive-session/YouTube examples remain killed; Hover detour
lead 140 is held. Museum leads 136 and 146 are both NEW, both use exactly
`https://longmontcolorado.gov/museum/`, and both describe gallery closure until
October 17. Both notes_json values are empty. This is a concrete repeat case
to inspect against the dedup path, not permission to erase either record.

Recent live scan rows: 20 scheduled (Sep 10 22:05:01–22:05:41 MDT, 12 sources,
2 leads), 21 manual (139 sources, 2 leads), 22 manual (Sep 10 23:58–Sep 11
00:00:27 MDT, 140 sources, 12 leads). Do not describe the manual scans as
proof of the intended daily schedule. No production records were changed.
