# Real Reddit discovery acceptance — 2026-09-11

Source revision: `71be20199ffa3869c18eeeead7c7d08edd2a0b96`.
Environment: built staging application at http://127.0.0.1:3471; database
`townreporter_stage_03efb7b_20260911`, newsroom 1, Staging Editor.
This is acceptance data, not production publication.

## Personally executed through the editor UI

- Opened Dark Desk and clicked **Check r/longmont** once.
- The paced request completed and re-enabled its button without intervention.
- Result: 50 posts read, six civic candidates, three newly filed tips, three
  already known. Searches: newest, government, infrastructure, business & work.
- Used **File as tip** on the score-4 near miss **Car Registration Mandatory
  Credit Card Fees**. The card changed to FILED and its resident excerpt appeared
  in the main pile, explicitly labeled unverified and requiring a public record.
- Independently read the acceptance database: new anomalies 1360 (grass /
  irrigation), 1361 (library outage), 1362 (Greenway), and manually filed 1363
  (registration fees). At completion there were zero queued/running desk jobs.
- No model generation, build, test suite, public publication, or production
  mutation was started for this check.

## Result and remaining limits

The real Reddit discovery → excerpt → manual filing path works. Existing URLs
were recognized, rather than all being inserted again. This is not a claim
that topical duplicates across distinct URLs are resolved.

Freshness is a demonstrated limitation: the newly filed library-outage card
is dated July 19 and Greenway card July 11, while this check ran September 11.
Historical material can still be useful, but an old transient outage should
not compete with current reporting as an unexplained new tip. The manual
registration-fee card also says **undated**, although it came from a feed.
Useful current discovery is therefore not fully accepted. Do not repeat this
same check merely to accumulate more identical receipts.

Separately, Luna's read-only inspection identified that `primarySourceQueries`
in `src/lib/news/extract.ts` always adds the current paper city. Both drafting
and explicit follow-up searches supply that city. This explains a query-level
source of Longmont-biased follow-ups for the retained Ramsey historical PDF;
it does not prove a search-provider ranking defect. A bounded source-aware
query adjustment remains to be implemented and checked.

Still open under item 6: useful breadth and freshness, a contrasting community,
and real ordinary-search / configured optional-Gateway acceptance. This receipt
does not close those requirements or waive curated investigative tools.
