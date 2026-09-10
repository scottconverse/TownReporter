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
