# Scan attachment evidence repair

Scott authorized takeover implementation and isolated staging on September 11.
Production remains 0.6.35 at fe53b6e; this repair is development only.

## Demonstrated defect and repair

`performScanWork` fetched up to four linked documents and appended their text
after the parent page, then took only the beginning of that combined string
for the model request. A long parent therefore removed every attachment URL
and fact from the prompt despite successful fetches.

The narrow repair preserves the parent and attachment texts separately until
excerpt selection. The existing 800/2800-character per-source and 48000-character
payload limits remain. Included documents retain complete URL headings; a
partial-reading notice tells the model to read originals before drafting.
Full capture/hash bookkeeping and lead matching policy are unchanged.

## Verification

- A regression executed the real `performScanWork` with in-memory PGLite and
  controlled ingestion/model seams. Before the repair, the five existing cases
  passed and the new long-parent/attachment case failed because both the
  attachment URL and fact were absent.
- Final focused file: 7 passed, 0 failed, 0 skipped, exit 0 (11.279 seconds).
  This includes four separately attributed documents within both excerpt limits.
- `npm run typecheck`: exit 0.
- Development build using the exact isolated database: exit 0, migrations up to date.
- ESLint on the helper and focused test: exit 0. Formatting after the build
  changed whitespace only; no later application behavior changed.

These establish prompt wiring and bounded excerpts, not live model usefulness.
No successful scan or publication is claimed for this takeover trial yet.

## Fresh staging provenance

- Source base: f308a014d2f15db54a172156f787d34b61b2043b.
- Database: `townreporter_editorial_f308a01_20260912` (UTC-date name).
- Backup: `C:\Users\scott\Desktop\Code\townreporter-backups\townreporter-before-editorial-f308a01-20260912.dump`.
- SHA256: `20477c9addb73145146404c1233a0e718ff23cd1bbf15478e74fd47490a8585e`.
- Production snapshot: 42 published items, 0 queued/running jobs, 0 known fixture newsrooms.
- Destination did not exist before creation; restore used a single transaction
  with exit-on-error. After exact database identity checks, copied monitors and
  daily/routine automation were disabled in this destination only. The ordinary
  Staging Editor was added; the owner's identity and role were preserved.
- Port 3471, separate auth secret and data root. No Gateway or production restart.
- Work scripts, logs, private transport-capture plumbing and stage data:
  `C:\Users\scott\Documents\Codex\2026-09-11\files-pasted-by-the-user-you\work`.

The first server (PID 28872) was positively identified and stopped before the
repair build. No broad process termination occurred. Any later server PID is
recorded in `work/stage-serve-pid.json` and must be reverified before stopping.

## Remaining blocker

Automatic approval review rejected the staging UI's Run scan action, citing
external-provider payload authorization and the staging filing mutation. The
action was not submitted. A precise approval request is pending for the current
public-source/coverage-memory/published-story payload to Codex Terra. It does
not include the still-unimplemented proposed unpublished-lead context.

The full sixteen-item mandate remains open, particularly fresh discovery,
repeat usefulness, accurate drafts, investigation, notices and the daily-paper
target. This report closes only the demonstrated attachment packing defect.
