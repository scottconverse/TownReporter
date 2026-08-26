# CivicCast Product Spec (reverse-engineered from civiccast.ai)

**Document status:** Reverse-engineered product specification, written from the public website only.
**Sources reviewed:** https://civiccast.ai (marketing/single-page site) and https://bozeman.civiccast.ai (live pilot city site, including article pages and full link inventory). Reviewed 2026-08-24.
**Author's access:** Public pages only — no repository (not yet published), no dashboard, no internal documentation.
**Maintainer of record:** Mark Egge, mark@civiccast.ai, (406) 548-4488, Bozeman MT.

> **Note for Scott:** This product shares the "CivicCast" name with your own CivicCast program but is a different, unaffiliated product in the adjacent space (AI processing of public-meeting video). See the cover note in chat.

---

## 1. TL;DR

CivicCast is an **open-source civic journalism pipeline plus a hosted network of city news sites**. It automatically ingests recorded city-government meeting video, transcribes it with speaker identification, drafts a podcast episode and a written news article under wire-service editorial rules, routes everything through a mandatory human producer review, and publishes to a per-city news site, podcast feeds, and email newsletter. It is explicitly **non-commercial civic infrastructure**: MIT-licensed code, break-even sponsorship pricing ($50–100/month per city against ~$30–45/month operating cost), a public ledger, and a promise that published archives never go dark. The proof-of-concept is **The Bozeman Brief** (Bozeman, MT), live with 14+ boards covered twice weekly; Belgrade, MT and Watertown, SD are also live.

## 2. Problem & mission

- Local news deserts are at a record high (~50 million Americans with limited local news access, per State of Local News 2025), while cities record thousands of public meetings weekly that are posted online and watched by almost no one.
- Mission: turn the existing public record — meeting video — into journalism people actually use, structured to **outlast any single business or maintainer** (open source + community funding rather than a product sold to city hall).
- Positioning: complements local journalists rather than replacing them; covers the meetings nobody has time to sit through and always points back to the primary source.

## 3. Users & roles

| Role | Who | What they do in the product |
|---|---|---|
| Maintainer / operator | Central project (currently one person) | Runs hosted infrastructure, maintains code, stewards editorial standards, onboards cities. Design goal: **per-city maintainer labor near zero** — named as the constraint that killed prior efforts. |
| City sponsor / producer | Residents, civic groups, League of Women Voters chapters, libraries, local businesses, or the city itself | Pays $50–100/mo (shareable among multiple parties) and performs the **producer role**: verifies speaker identification and reviews every episode before publication. Gets an on-air public-radio-style underwriting credit and acknowledgement on the city site. |
| Contributors | Open-source community | Platform adapters (named as the most natural entry point), prompt refinement, dashboard features, documentation. |
| Self-hosters | Anyone, including commercial users | Run their own instance under MIT license with documentation support. |
| End audience | Residents, journalists, researchers | Listen ($0), read, search the permanent record, republish articles for free with credit. |

## 4. Product architecture: two halves

1. **Open-source framework** — full pipeline, dashboard, and editorial prompts under MIT license. Open code is justified three ways: trust (AI journalism methodology should be inspectable), continuity (any community can carry on regardless of the maintainer), contribution. *Status: repository not yet public — "being prepared for open release," goes live at launch.*
2. **Hosted network ("Adopt your city")** — the maintainer centrally operates the pipeline for sponsored cities. Sponsorship is priced to break even, not profit, and the sponsor supplies the local human accountability (producer review).

## 5. The pipeline (functional spec)

Every meeting flows through four stages; a human gate precedes any publication.

- **FR-1 Ingest.** Automatically pull meeting video from municipal streaming platforms after each session. Named platform adapters: **Granicus, Swagit, EvoGov**, "and other municipal platforms." Adapter architecture is extensible (community-contributed adapters expected).
- **FR-2 Transcribe.** AI transcription of full audio with **speaker identification by name** — commissioners, staff, and public commenters — plus timestamps.
- **FR-3 Draft.** AI writes (a) a two-host conversational podcast script and (b) a written recap, governed by a **wire-service standard: attributed claims, no editorializing, no loaded language**. Editorial prompts are part of the open-source release.
- **FR-4 Producer review & publish.** A human producer verifies speaker IDs and reviews every episode before it publishes to the podcast feed and the archive. **No fully-automated publication path exists.** Every episode carries a verbatim on-air disclaimer directing listeners to the original video and transcript.

## 6. Outputs per meeting

| Output | Spec |
|---|---|
| **Podcast episode** | Two-host conversational recap; published to Spotify, Apple Podcasts, and a dedicated per-city RSS feed (observed: feed hosted on Cloudflare R2); target latency "usually within a day." Observed durations 0:50–12:06 — includes ultra-short episodes for canceled meetings. |
| **Written recap** | Plain-language news article: what was decided — motions, votes, dollar figures, public comment. News-style headline, dek/summary paragraph, topic tags, board category, listen-along audio with duration. Free to republish with credit and link-back. |
| **Searchable archive** | Timestamped, speaker-identified transcripts linked to source video; "search any word, jump to the moment"; positioned as a permanent addition to the public record. *(Stated capability — see §13; not yet visible on the live pilot site.)* |

## 7. City news site (observed live at bozeman.civiccast.ai)

Each city gets a templated news site. Feature inventory observed on the live pilot:

- Featured-article homepage with news-style headlines, summary paragraphs, dates, and audio durations.
- **Full-text search** across all articles.
- **Topic filter chips** (Zoning, Budget, Infrastructure, Affordable Housing, Charter, all topics) via `?topic=` URLs.
- **Board taxonomy**: 17 board/category pages in Bozeman (City Commission, Study Commission, Community Development, Historic Preservation, Sustainability, Transportation, Downtown BID, Urban Renewal, TIF Advisory, Economic Vitality, Parks & Forestry, Board of Ethics, two GVMPO transportation committees, Inter-Neighborhood Council, weekly **Advisory Board Roundup**, and **Custom Episodes**).
- Chronological archive grouped by month ("Browse the full archive — 69 articles," oldest observed December 2025).
- **Email newsletter** ("new articles in your inbox as they publish — free, no spam").
- Podcast subscribe links: Spotify, Apple Podcasts, raw RSS.
- Article pages: related-articles by board, topic tags, newsletter signup, and a standing **republish license** ("free to reprint in whole or part with credit to CivicCast (The Bozeman Brief) and a link back; don't imply endorsement; verify details against the official meeting recording").
- Content types beyond per-meeting recaps: weekly multi-board roundup episodes, custom episodes, at least one labeled **editorial**, meeting-canceled notices, and "delayed publication" labeling — i.e., the format supports editorial judgment, not just mechanical recap.
- Footer links out to the city's official site and the local newspaper (reinforcing the "complements local journalism" stance).

## 8. Editorial & trust requirements (standing policies)

The site frames these as binding rules, not marketing:

- **TR-1 The archive never goes dark.** If sponsorship lapses: new episodes pause after a grace period; the city moves to "seeking sponsor" status; every published transcript and episode stays up permanently. The archive is the civic asset.
- **TR-2 Public corrections & methodology.** Every city site carries a visible corrections policy and a plain-language "how this is made" page; errors are acknowledged in the open.
- **TR-3 Source-linking.** Every recap links back to the original meeting video and transcript — "trust is verifiable, not asserted."
- **TR-4 Break-even economics in the open.** Sponsorships priced to cover costs; at launch, every dollar visible in a public ledger via Open Collective.
- **TR-5 Human in the loop, always** (see FR-4), plus the verbatim on-air source disclaimer.

## 9. Business model & economics

| Number | Value | Note |
|---|---|---|
| Sponsorship price | $50–100 / month / city | Sized to break even; shareable among multiple sponsors |
| Operating cost | ~$30–45 / month / city | Processing + hosting |
| Listener price | $0 | Free everywhere, free newsletter, free republication |
| Cadence (pilot) | 2× / week | ~20+ hours of meetings → ~1 hour of audio weekly |
| Cities live | 3 | Bozeman MT, Belgrade MT, Watertown SD |
| Sponsor compensation | Underwriting credit | "Support for this podcast comes from…" in every episode + site acknowledgement |

Revenue model is deliberately non-commercial: no ads, no paywalls, no sales to city hall; self-hosting (even commercial) is allowed and merely gets "documentation and a friendly wave."

## 10. Onboarding & operations

- **City onboarding is a config file**: a video source, a board list, and voice settings — "not a weekend of custom work."
- City lifecycle states: live → (sponsorship lapses) grace period → "seeking sponsor" (archive stays up, new episodes paused) → re-sponsored.
- The design constraint called out explicitly: keep a local human accountable in every city while keeping the maintainer's per-city labor near zero.

## 11. Licensing

- Code: **MIT** (pipeline, dashboard, editorial prompts) — at launch.
- Content: free republication with attribution and link-back; no-endorsement clause; verify-against-source clause.

## 12. Non-functional requirements

- **Latency:** episode + article published "usually within a day" of the meeting.
- **Cost ceiling:** a city must run at ~$30–45/month all-in — this bounds model/hosting choices.
- **Scalability:** per-city marginal labor for the maintainer ≈ 0; onboarding ≈ config only.
- **Permanence:** published record survives sponsorship lapse and (via open source) maintainer loss.
- **Transparency:** finances, methodology, corrections, and prompts are all public surfaces.

## 13. Current state vs. stated commitments (gaps observed 2026-08-24)

| Stated capability | Live today? | Evidence |
|---|---|---|
| Podcast + article pipeline, 3 cities | **Yes** | Live sites, 69-article Bozeman archive since Dec 2025 |
| Search, topics, boards, newsletter, feeds | **Yes** | Observed working surfaces on bozeman.civiccast.ai |
| Open-source repository (MIT) | **Not yet** | "Being prepared for open release… goes live at launch" |
| Searchable timestamped transcripts / chronicle | **Not visible** | No transcript pages in the Bozeman site's full link inventory (95 links) |
| Per-article link to source video & transcript (TR-3) | **Not visible** | Article pages link only to related articles; republish note says "verify against the official recording" without linking it |
| Corrections + "how this is made" pages (TR-2) | **Not visible** | No such routes on the live city site |
| Public Open Collective ledger (TR-4) | **Not yet** | Promised "at launch" |

Reading: the content pipeline is real and producing; the **trust surfaces (transcripts, source links, corrections/methodology pages, ledger, public repo) are the launch backlog** — they are currently commitments, not shipped features.

## 14. Open questions (not answerable from the site)

1. Which ASR/LLM stack powers transcription, speaker ID, and drafting — and is it cloud or self-hostable models? (Bears directly on the $30–45/mo cost claim and on self-hosting.)
2. What does the producer dashboard actually look like — review UI, speaker-correction workflow, publish gate?
3. Text-to-speech for the two-host podcast: which voices ("voice settings" is a config item), and what latency/cost?
4. How are public commenters' names handled (privacy policy for private citizens in a permanent AI-generated record)?
5. Correction mechanics: how do corrections propagate to already-published audio episodes?
6. Accessibility: no captions/accessibility claims are made anywhere on the site (notable for a civic-record product).
7. Governance: single-maintainer today; what happens to the hosted network (as opposed to the code) if the maintainer stops?

## Appendix: pilot observations

- Bozeman: 14 boards claimed on the marketing site; 17 board/category taxonomies on the live site; 69 articles; twice-weekly cadence; episode durations observed 0:50–12:06; full City Commission recaps ~11–12 min; roundups ~3–7 min.
- Article quality: specific votes (e.g., "voted 6-0"), dollar figures ($355,712 CDBG plan, $689M budget), named officials, and named public programs — consistent with the attributed-claims standard.
- Distribution: Spotify + Apple Podcasts + R2-hosted RSS; email newsletter; free republication offered to other outlets.
