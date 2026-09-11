# Notice source mapping — September 10

Development 909e788, later documentation 04e161b. No source settings,
permissions, database rows, models, or publication changed.

Halo Research web_search (exa-anonymous) and web_fetch (direct-http) located
official City sources. Search/fetch were paginated; only relevant retained pages
were used, not claimed as exhaustive coverage. Calendar:
https://longmontcolorado.gov/events/ . Its body shows September 2026 events
despite a stale 2024/2025 HTML title; do not use that title as event chronology.

## Two real source shapes pass existing pure extractors

Used extractJsonLdEvents from src/lib/news/routine-notice-extract.ts with exact
City of Longmont OWNER_ISSUER context and explicitly synthetic positive
provenance IDs. This is structural source research, not a saved approval/check.
First probe accidentally used zero IDs and was refused for invalid
provenance.newsroomId; that was a diagnostic error, not a source failure.
Corrected probe returned HTTP200 and one parsed result each, exit0, no warnings.

| Family | URL | Preserved source values |
| --- | --- | --- |
| Parks/recreation | https://longmontcolorado.gov/event/itty-bitty-city-preschool-playtime-4/2026-09-11/ | Itty Bitty City Preschool Playtime; Memorial Building; 2026-09-11 09:00–11:00, explicit -06:00 |
| Community/arts | https://longmontcolorado.gov/event/3rd-annual-sunset-soiree/ | 3rd Annual Sunset Soiree; Longmont Museum; 2026-09-11 18:00–21:00, explicit -06:00 |

Both match the visible dates/times retained from the official calendar.
Both expose EventScheduled and an event #event identity.
Corrected response hashes (raw source not saved by this command):
- recreation: 90ca6d29270fa6b5bf79a9ea4ca8e3aab3af04a7104a4cc19c6d3395495e3d09; 308761 bytes.
- museum: 844d1662870c6f5782dc8f0dfcdacc955e800a8ec2be849f5f3634d0539578d9; 314212 bytes.

No claim that response bytes remain identical on refetch; dynamic page values
changed hashes between the first and corrected probes.

## Concrete mapping defect before activation

The museum mapper turns physical location.url
https://longmontcolorado.gov/venue/longmont-museum/ into onlineUrl and renders
it as Online. A venue information page is not a virtual attendance address.
Assigned Terra one regression for this actual source shape, with parent RED
before implementation. No general calendar rewrite requested.

## Remaining delivery

Save/verify actual source mappings through owner controls after the correction;
use reusable calendar discovery rather than treating two one-off event URLs as
a permanent feed. Library already has prior saved-source evidence. Registration,
waste and meeting source mappings remain unproved. Official calendar links to
https://longmont.primegov.com/public/portal ; this is only portal discovery,
not proof of the JSON endpoint required by the meeting adapter.
No family was enabled by this research. Editions/worker machinery already exists.

## Registration source gap: real source, not another engine

September 10 follow-up, source HEAD310362f. Existing registration dispatcher
accepts designated ICS or extractApplicationDeadlines. The latter reads
EducationalOccupationalProgram.applicationDeadline JSON-LD, not brochure text.
This is a concrete mapping limitation; source settings alone cannot solve it.

Halo Gateway Exa search located the official Fall2026 sports brochure:
https://longmontcolorado.gov/wp-content/uploads/2026/07/f26_sports.pdf
Direct PDF text retrieval confirmed page2 (printed page14) has Youth Basketball
League grades3–12, an explicit December13 registration deadline, and the brochure's
Fall2026 footer. That page supplies the registration link
https://bit.ly/recreationregistration . It also contains a September6 volleyball
deadline, already past at retrieval. Do not treat every brochure entry as current
or a January program start as its registration deadline. Search snippets alone
were not used as verification. Brochure tables/visual layout were not inspected;
this is source discovery, not an accepted automatic notice or a saved check.

The fetched event page
https://longmontcolorado.gov/event/recreation-fall-registration-begins/
announces registration OPENING August11, not a closing deadline. Its calendar
event cannot simply be approved as a deadline feed. Gateway fetch page2 contains
the relevant text; remaining navigation pages were not needed. Search coverage
was partial and did not establish absence of a better source.

Next implementation choice: use existing PDF page extraction and source-bound
notice validation to map actual brochure deadlines, or find the registration
system's explicit deadline fields. No new scheduler, edition engine or generalized
research platform is required. Do not enable an unsupported HTML/PDF mapping
and call registration completed.

## Physical venue versus virtual attendance correction

Terra added a constructed mixed Place/VirtualLocation regression (not a byte
copy of the real event). Parent observed RED with:
`node scripts/with-app-env.mjs node --experimental-strip-types --test src/lib/news/routine-notice-extract.test.ts`
Exit1, assertion actual `https://longmontcolorado.gov/venue/longmont-museum/`
versus expected `https://events.example/sunset-stream`.

```text
ℹ tests 16
ℹ suites 2
ℹ pass 15
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 249.1582
```

Implementation now takes onlineUrl only from explicit Schema.org VirtualLocation
types, retaining venue names and the actual URL locators. No new dependency,
endpoint, credential, migration or publication change. Parent reviewed the diff.
Parent then ran:
`node scripts/with-app-env.mjs node --experimental-strip-types --test src/lib/news/routine-notice-extract.test.ts src/lib/news/routine-notice-editions.test.ts`
Exit0, no warnings/errors:

```text
[with-app-env] DATABASE_URL unset -- PGLite in-memory
ℹ tests 23
ℹ suites 2
ℹ pass 23
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 275.0901
```

Source correction accepted; saved real-source workflow and activation still
outstanding. The retained development build predates this small correction;
do not present its hash as including it. Known CI browser failures remain.

## Real PrimeGov saved-source check

Lead reviewed Luna's `artifacts/notice-real-source-check.mjs` and executed it
once on September 10 at 21:50 UTC. It fetched the public upcoming-meetings
endpoint once and passed those bytes through the normal owner saved-check
function with an injected fetch result, in fresh in-memory PGLite. This was
not a browser-control test or a production check. Native model providers were
disabled; no model, publication, or scheduler was invoked.

Result: HTTP 200, 12,719 bytes, 12 entries; five parsed candidates, seven
structural refusals (six at `/`, one at `/documentList`), zero conflicts
reported by this single-feed check. Capture, artifact-version and blob hashes
matched `dcd12d8e30417c25f23b5f68ed5f05e129148fbc26465e55848d3ea61ff9a36e`.
Stored source URL, original text and byte length also matched. Automatic
editions remained disabled. The test policy allowed checking (`paused=false`);
the script's introductory comment calling the policy paused is inaccurate.

Receipt: `artifacts/notice-real-source-check/receipt-2026-09-10T21-50-21.508Z.json`.
Execution session 44112 exited 0. A subsequent Windows process check found
only the unchanged production Node pair 23012/22152, no test process.

Limit: this does not establish cross-document consistency. Earlier retrieval
of meetingTemplateId=17256 showed a portal heading of September 15 at midnight
while the agenda body and API said September 14 at 6 PM. Resolve that source
discrepancy before enabling publication; zero internal feed conflicts does not
prove the heading agrees. Registration and waste mappings remain open.

## Parks and arts saved-source checks (later September 10)

Parent extended the existing ignored real-source helper with --parks/--arts,
using the two URLs above. No product code changed. Each invocation fetched once
and passed the actual bytes to the normal owner saved-check path in fresh PGLite,
then checked reload equality, stored raw-byte/version hashes, times and disabled
automation. Arts also asserted absence of onlineUrl for the physical venue.

- `node artifacts/notice-real-source-check.mjs --parks`: exit0, ok:true,
  parsed1/refused0/conflicts0, HTTP200,308761bytes. Receipt
  `artifacts/notice-real-source-check/receipt-2026-09-10T22-37-15.129Z.json`,
  SHA256 `463E5CF4BA765A1585D09F41D0A64E741BF74BFF50CE77F2FCEEA15EF594C1E4`.
- `node artifacts/notice-real-source-check.mjs --arts`: exit0, ok:true,
  parsed1/refused0/conflicts0, HTTP200,314212bytes. Receipt
  `artifacts/notice-real-source-check/receipt-2026-09-10T22-37-41.656Z.json`,
  SHA256 `507AFF7E4F86D3CA47BC6219E8DE84D7862B9E597B6611E6DE2A1CE67ECAC734`.

Both terminal handles completed serially; no model generation, production rows,
publication or activation. No warnings/errors in returned execution output.
These supersede the earlier pure-extraction-only status for parks/arts. They
prove the saved-source path for these actual pages, not reusable calendar
discovery or the complete operational family. The museum response hash changed
since the first probe; the retained receipt records the bytes actually checked.

## September 11 meeting discrepancy recheck

Direct current reads of the official upcoming-meetings API and rendered HTML
agenda agree for meeting3801 / template17256: Transportation Advisory Board,
September14 2026 at 6:00PM, City Council Chambers, 350 Kimbark Street.

- https://longmont.primegov.com/api/v2/PublicPortal/ListUpcomingMeetings
  returned dateTime `2026-09-14T18:00:00`, date `Sep 14, 2026`, time `06:00 PM`.
- https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=17256
  in Chrome displayed `September 14, 2026 - 6:00 PM` within the agenda heading.
  A separate raw HTML read also contained that date/time, and no September15
  or ISO September14/15 heading matched the date-field search.

The previously recorded midnight disagreement was not reproduced on this
current agenda. This clears that specific current-source discrepancy, not
all future API/agenda pairs; it does not prove when or why the older heading
differed. No publication or production policy change occurred. The API's
unoffset wall time still needs the explicitly configured America/Denver zone.

Halo Gateway web_fetch failed reaching http://127.0.0.1:8765/mcp. Hosted web
fetch also could not open PrimeGov. Direct public HTTPS plus Chrome supplied
the evidence above; do not count this as Gateway acceptance. The official
City Council calendar was also reachable, but its council sessions are not
the Transportation Advisory Board event and were not substituted for it.

## Reusable parks and arts calendars found — September 11

The official https://longmontcolorado.gov/events/ filter metadata explicitly
names Museum (slug museum), Recreation Services (recreation-services), and
Parks and Natural Resources (parks-and-natural-resources). Using the same
category URL structure as the established library feed, direct HTTPS checks
returned:

| Candidate | HTTP | Bytes | JSON-LD scripts |
|---|---:|---:|---:|
| https://longmontcolorado.gov/events/category/museum/ | 200 | 518939 | 2 |
| https://longmontcolorado.gov/events/category/recreation-services/ | 200 | 519920 | 2 |
| https://longmontcolorado.gov/events/category/parks-and-natural-resources/ | 200 | 430069 | 1 |

Museum JSON-LD included Art & Sip: Watercolor Watermelon; recreation included
Recreation Center Pool Closures. Parks had only the site/breadcrumb names in
the inspected block, so no current event coverage is claimed for it. These are
ongoing category sources, unlike the previously tested single-event URLs.
This is source discovery, not application parser or scheduled-publication proof.
Next use the museum and recreation categories through normal saved source checks.
Do not label the mixed citywide /events/ feed as both families and double-count it.

## PrimeGov actual ingestion repair

Staging check8 exposed a gap in the earlier injected-response acceptance:
ingestPrimeGov normalized API URLs into text/title/extras without rawBytes.
The real saved-source path therefore failed, even though the injected raw
response passed. The fix lets PublicPortal API paths fall through to the
existing HTTP reader; portal and document behavior remains unchanged.

Luna's regression reported RED on missing rawBytes, then GREEN. Lead reviewed
the two-file diff and independently ran:

```powershell
$env:DATABASE_URL=''; $env:RUN_LIVE_MODEL_TESTS=''; $env:TOWNREPORTER_TEST_ENV_VERIFIED='1'; node --import ./scripts/test-environment-guard.mjs --experimental-strip-types --test --test-force-exit --test-concurrency=1 --test-timeout=20000 --test-name-pattern='PrimeGov|raw-byte ingestion' src/lib/news/ingest.test.ts src/lib/news/primegov.test.ts
```

```text
ℹ tests 4
ℹ suites 3
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 893.4222
```

Exit0, no test warnings. This focused run explicitly force-exits after tests;
it is not proof of natural process shutdown. Before it, lead found three
worker test groups still alive (parents27492,32164,19956; children28948,32720,
34144), stopped only the verified children, and confirmed zero remaining
ingest.test processes. Starting replacement tests while those lived violated
the serialized-lane instruction. The worker's green summary did not establish
cleanup. No production process was stopped. Rebuilt real-source acceptance
remains necessary; no full-suite or production completion claim is made.
