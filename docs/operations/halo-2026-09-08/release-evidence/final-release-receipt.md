# TownReporter 0.6.34 beta release receipt

Published 2026-09-08 as a GitHub prerelease. GitHub publication is not Halo deployment.

- PR40: https://github.com/scottconverse/TownReporter/pull/40
- Reviewed candidate: `f48047b87dca796fdc2c6ebb426b47cc6cd5d434`
- Normal merge / exact main source: `b097d288d9237be225bc6ed56851078ad064d208`.
- Candidate and merge have identical Git tree `08f88ac6c0a6b0b16283e86b3a80c410647427dd`.
- Candidate CI `34253760705`: 16/16 successful; npm test comprised two layers: script runner 342 total / 333 passed / 0 failed / 9 skipped; TypeScript runner 1,615 total / 1,570 passed / 0 failed / 45 skipped across 365 suites; combined 1,957 total / 1,903 passed / 0 failed / 54 skipped.
- Candidate Windows package/install `34253760702`: 2/2 successful.
- Exact-main CI `34255611084`: 14/14 successful; npm test comprised two layers: script runner 342 total / 333 passed / 0 failed / 9 skipped; TypeScript runner 1,615 total / 1,570 passed / 0 failed / 45 skipped across 365 suites; combined 1,957 total / 1,903 passed / 0 failed / 54 skipped.
- Exact-main Windows package/install `34255611028`: 2/2 successful.
- Exact-main Pages `34255609625`: successful.
- Review: root accepted the final source and runtime proof; three GitHub review threads were fixed and resolved before merge.

## Focused runtime evidence

Fourteen focused tests passed. Preserved-data inputs contained the complete relevant PDF page once and correct applicant tail: stage-one synthesis 23,077/28,000 characters; final brief 20,303/22,000. One exact-candidate build passed. Final job17 used Codex Terra with no fallback and completed in 19.157 seconds. The persisted brief named Doug / Connection Church Longmont, preserved the project ID/address/approximately one acre/MU-E/unchanged religious use, left project-specific service and tax effects unestablished, and contained neither Founders Block nor Mark Sullivan. No dig, search, handoff, publication, or second model call occurred. The owned app and PostgreSQL processes stopped cleanly and their ports were free.

Evidence attachments:
- `municipal-record-retrieval-2026-09-08.md`
- `audit-lite-municipal-record-retrieval-2026-09-08.md`
- `nelson-final-brief-f48047b8-job17.png`

## Limits

This bounded correction and one accepted generated brief do not establish exhaustive retrieval, universal model accuracy, independent corroboration, completion of the September 3–8 replay, Halo deployment, or measured normal-day performance. Large-investigation SQL performance has not received a separate benchmark. Exact-main ZIP `TownReporter-0.6.34-windows-x64.zip` is 7,128,234 bytes with SHA-256 `db56f79f788a0770b80170dc2aa05832922bd0b2ebd6512d832fec473f801c03`. Its manifest and sidecar agree on version and source. Independent expansion matched all 808 tracked blobs: 808 files present, zero missing and zero mismatched. Annotated tag `v0.6.34` peels to exact main `b097d288d9237be225bc6ed56851078ad064d208`. Published package assets were downloaded again and matched the tested package bytes. Focused rendered release, download, tagged Halo prompt, manual, and landing links were checked separately; this is not a whole-site visitor audit.







