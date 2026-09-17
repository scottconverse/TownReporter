# Museum repeat: confirmed current behavior, not resolved

## Evidence

Read-only inspection of production `townreporter` on port 5433 found leads
136 and 146 both NEW, in newsroom 1, with the same museum source URL:
`https://longmontcolorado.gov/museum/`.

- 136: “Longmont Museum galleries closed for construction ahead of Oct. 17 reopening”, scan 21.
- 146: “Longmont Museum galleries stay closed until Oct. 17 grand reopening”, scan 22.
- Importantly, 146 **does** have `possible_duplicate_of = 136`. Earlier summaries
  that omitted this field were incomplete. Both `notes_json` values are `{}`.
- Comparing the saved evidence, both describe construction, restricted building
  hours, continuing programs, and the October 17 reopening. No new development
  was identified in these two records.

Executing the current pure matcher with those headlines and URL returned:

```json
{"matched":136,"strength":"possible","publishedExact":null}
```

No database writes, model calls, builds, or production changes were made for
this diagnosis.

## Cause

`src/lib/news/lead-match.ts` recognizes the relationship but reserves strong
matches for near-identical headline content tokens. The substantive `evidence`
and `why` fields are not compared. `src/lib/news/lead-filing.ts` explicitly files
possible matches to open leads as NEW; only possible matches to killed leads
start held. `src/components/desk-leads.tsx` displays a comparison link, but that
does not remove repeated work from the New queue.

This was intentional protection against merging different agenda items, not a
failure to run the matcher. It nevertheless does not satisfy the requested
editor outcome for this real pair.

An additional requirement gap is directly visible: `desk.ts` excludes published
leads from the match query, and the matcher excludes published status even for
an identical headline and URL. That behavior must not be described as preserving
published-story repeat decisions. Genuine updates must remain discoverable,
but an unconditional exemption cannot distinguish them from exact repeats.

## Next implementation boundary

Repair repeat handling using the actual story evidence, not merely a globally
lowered title-similarity threshold or moving every ambiguous story to Held.
Keep genuine developments and the existing history. Use this museum pair as the
positive reproduction and a changed date/decision on the same source as the
non-repeat counterpart. Reconcile the two existing records recoverably only
after checking their then-current editorial state. No records were reconciled
by this investigation, and no repair is claimed deployed.
