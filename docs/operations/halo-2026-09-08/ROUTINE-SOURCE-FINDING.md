# Routine source finding: Longmont Public Media

Observed: 2026-09-08 16:58:16 America/Denver (UTC-06:00).

Source: https://longmontpublicmedia.org/events/

## Operational conclusion

Do not activate automatic routine publication from this source on the strength of its current structured-data preview. Ordinary editor-reviewed discovery remains useful. No source settings or publication permissions were changed by this investigation.

The captured response contains contradictory event times between visible calendar cards and JSON-LD. Resolving the separate recurring-event identity collision would not resolve that contradiction.

## Exact observed times

All three cards are titled **LPM Orientation for 24/7 Members** and link to https://longmontpublicmedia.org/events/lpm-orientation-for-24-7-members/.

| Occurrence | Visible calendar card | JSON-LD startDate | JSON-LD endDate |
|---|---|---|---|
| September 2, 2026 | `6:00 pm - 7:00 pm` | `2026-09-02T12:00:00-06:00` | `2026-09-02T13:00:00-06:00` |
| September 16, 2026 | `6:00 pm - 7:00 pm` | `2026-09-16T12:00:00-06:00` | `2026-09-16T13:00:00-06:00` |
| October 7, 2026 | `6:00 pm - 7:00 pm` | `2026-10-07T12:00:00-06:00` | `2026-10-07T13:00:00-06:00` |

The JSON-LD explicitly describes noon to 1 pm at offset -06:00, not 6 to 7 pm at that offset. These values occur in the same downloaded response; this is not a comparison between differently aged captures. Visible values were extracted from each matching `article` using `.mec-event-date`, `.mec-event-month`, and `.mec-event-detail`. No screenshot or browser-rendering verification is claimed.

## Separate identity collision

The three orientation records reuse one page URL and supply no `@id`, `eventSchedule`, or `superEvent`. Podcast orientation likewise reuses https://longmontpublicmedia.org/events/orientation-podcasting/ for September 10, September 24, and October 8. Thus six otherwise parsed occurrences share two URL-only identities.

`src/lib/news/routine-notice-extract.ts` currently resolves `externalId` from `@id`, falling back to `url`. `src/lib/news/routine-notice-checks.server.ts` groups the hashed external identity and flags differing content fingerprints within each group. That explains the six conflicts reported by the parent's isolated preview; that preview's database receipt is not reproduced by this read-only source inspection.

Appending a timestamp or date to every URL would separate these records, but would also change what counts as a conflict. With no explicit occurrence identity, a changed date may mean a rescheduled event rather than another occurrence. No such workaround was implemented, and no conflict safeguard was removed.

## Preserved evidence

- Raw public HTTP response: `C:\Users\scott\Desktop\Code\townreporter-dev\artifacts\lpm-events-20260908-1658.html`
- Size: 246005 bytes.
- SHA-256: `0A1DE297E2FAE4E7ABEA1BAC8205B89D457E68744A35BA2EA0C773F8E6BB7E4C`
- Download command: `Invoke-WebRequest -Uri 'https://longmontpublicmedia.org/events/' -OutFile 'artifacts/lpm-events-20260908-1658.html'`
- Artifact is intentionally Git-ignored under the repository's existing artifacts policy; this report is the tracked finding.

## Limits and next decision

The observation does not establish which time is correct or why the publisher emitted inconsistent data. Do not silently add six hours, rewrite source evidence, or treat a stronger model as a cure. A future source-specific integration should reconcile the rendered occurrence details with structured data and refuse contradictions, or use a separately verified trustworthy feed. That is future engineering, not a prerequisite for keeping ordinary source discovery available.

No database mutation, model call, extraction-code change, publication, or automation activation occurred in this investigation. Only this report and the raw public-response artifact were created.
