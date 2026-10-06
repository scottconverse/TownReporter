# Longmont, Colorado — Source Registry

Starting source configuration for the Civic Source Scanner. It includes strong public-record coverage and selected local reporting/community signals; it is not a complete map of Longmont's civic life. Confirm URLs, schedules, and coverage gaps at each run. City Council schedule and portal guidance below were checked against City of Longmont pages on 2026-09-25; meeting changes still need a fresh portal check for each run.
All sources are classified by tier (A/B/C) per the Civic Grounding Protocol.

---

## Civic beat coverage map

| Beat | Sources currently mapped | Gap to resolve in `discover` |
|------|--------------------------|------------------------------|
| Government, elections, land use | City, county, state, planning sources below | Verify current portals and meeting archive |
| Schools & youth | SVVSD board and district sources below | Map colleges and youth organizations as relevant |
| Housing | City planning and building permits; local reporting | Map housing providers and original project records |
| Business & jobs | Chamber and economic development; local reporting | Map original employer announcements and labor data |
| Health & public safety | City and county government sources | Map health providers and public safety data |
| Transportation & utilities | RTD, Longmont Power & Communications, flood district | Verify current project and service feeds |
| Environment | Flood district and government sources | Map monitoring and conservation sources |
| Arts, culture & neighborhoods | Local reporting and community signals | Map venues, libraries, nonprofits, and neighborhood organizations |

---

## Tier A — Official records currently mapped

These records are the primary evidence for government actions. Nongovernment stories also require original, claim-specific evidence; map those sources before calling a broad scan complete. A source's own announcement proves what it announced, not every claimed effect.

### City Council & Government

| Source | URL | Type | Schedule |
|--------|-----|------|----------|
| City Council Agendas and packets | https://longmontcolorado.gov/city-clerk/agenda-management-portal/ | City portal links to PrimeGov | Check posted meeting calendar and cancellations |
| City Council Minutes | https://longmontcolorado.gov/government/city-council-meetings/ | Minutes archive linked by City | Check actual posting status; do not assume a one-week lag |
| City published records | https://longmontcolorado.gov/city-clerk/public-records/ | Self-service records portal, including annexation documents, ordinances, resolutions, and minutes | Ongoing; use published records only |
| City Budget Documents | https://www.longmontcolorado.gov/departments/finance | Annual + amendments | Annual cycle |
| Building Permits | https://www.longmontcolorado.gov/departments/community-development | Permit database | Ongoing |
| Planning & Zoning | https://www.longmontcolorado.gov/departments/community-development/planning | Agendas + decisions | As scheduled |
| Municipal Code | https://library.municode.com/co/longmont | Municode | Updated with ordinances |

### Official Meeting Recordings

| Source | URL | Notes |
|--------|-----|-------|
| City of Longmont YouTube | https://www.youtube.com/@CityofLongmont | Auto-transcripts available |
| Council Meeting Recordings | https://longmontcolorado.gov/city-clerk/agenda-management-portal/ | Council and Planning and Zoning HTML agendas bookmark video by item when available; inspect full meeting chronologically despite bookmarks |

### County & State

| Source | URL | Type |
|--------|-----|------|
| Boulder County Commissioners | https://www.bouldercounty.gov/government/boards-and-commissions/ | Agendas + minutes |
| Boulder County Clerk & Recorder | https://www.bouldercounty.gov/departments/clerk-and-recorder/ | Property, elections |
| Weld County (partial jurisdiction) | https://www.weldgov.com/ | Eastern Longmont parcels |
| Colorado Secretary of State | https://www.sos.state.co.us/ | Business filings, elections |

### School District

| Source | URL | Notes |
|--------|-----|-------|
| St. Vrain Valley School District | https://www.svvsd.org/board-of-education/ | Board meetings, agendas |
| SVVSD YouTube | Search: St Vrain Valley School District | Meeting recordings |

### Special Districts & Agencies

| Source | URL | Notes |
|--------|-----|-------|
| RTD (Regional Transportation) | https://www.rtd-denver.com/board-of-directors | Transit decisions |
| Longmont Power & Communications | https://www.longmontcolorado.gov/departments/longmont-power-communications | Utility/broadband |
| Urban Drainage & Flood Control | https://mhfd.org/ | Flood mitigation |

---

## Tier B — Institutional Sources (Leads Only)

These sources generate leads and context. Trace consequential claims to original evidence before advancing them.

| Source | URL | Notes |
|--------|-----|-------|
| Longmont Times-Call | https://www.timescall.com/ | Primary local newspaper |
| Longmont Leader | https://www.longmontleader.com/ | Community news |
| Daily Camera (Boulder) | https://www.dailycamera.com/ | Regional coverage |
| Colorado Sun | https://coloradosun.com/ | Statewide investigative |
| Longmont Observer | https://longmontobserver.org/ | Community journalism |
| SVVSD Communications | https://www.svvsd.org/news/ | District press releases |
| Longmont Chamber of Commerce | https://www.longmontchamber.org/ | Business community |
| Longmont Economic Development | https://www.longmontcolorado.gov/departments/city-manager/economic-development | Development projects |
| City News & Alerts | https://longmontcolorado.gov/news/ | City announcements and community updates; original evidence of what the City announced, not independent proof of effects |

---

## Tier C — Signal Generators (Never for Publication)

These sources generate SIGNALS that must be verified against original evidence
before any story work begins. Tier C content is never quoted, cited, or
referenced in published reporting.

| Source | Platform | Notes |
|--------|----------|-------|
| r/Longmont | Reddit | [New posts RSS](https://www.reddit.com/r/Longmont/new/.rss) and [subreddit](https://www.reddit.com/r/Longmont/); scan per `reddit-intake.md`, keeping direct post links and dates |
| Longmont Nextdoor groups | Nextdoor | Hyperlocal neighborhood signals |
| Longmont community Facebook groups | Facebook | Events, complaints, rumors |
| YouTube comments on city meetings | YouTube | Public sentiment, questions |
| Twitter/X local hashtags | X | #Longmont, #LongmontCO |

---

## Source Scanning Priority

For **daily-scan** mode, check these mapped sources and identify gaps from the coverage map. Priority order:

1. PrimeGov portal — new agendas or minutes posted?
2. City of Longmont YouTube — new meeting recordings?
3. SVVSD board — new agendas?
4. Boulder County Commissioners — new agendas?
5. Times-Call — new local stories? (Tier B, leads only)
6. r/Longmont — check new posts and targeted subreddit searches for the date window; keep promising Tier C links and verify before use

---

## Meeting Calendar (Check current official schedule)

| Body | Day | Time | Frequency |
|------|-----|------|-----------|
| City Council Regular Session | Tuesday | 7:00 PM | Usually 2nd & 4th; check [2026 City schedule](https://longmontcolorado.gov/government/city-council-meetings/2026-council-meeting-schedule/) and [agenda portal](https://longmontcolorado.gov/city-clerk/agenda-management-portal/) for changes |
| City Council Study Session | Tuesday | 7:00 PM | Often 1st Tuesday, with exceptions; check the official schedule and portal |
| Planning & Zoning Commission | Wednesday | 7:00 PM | As needed |
| SVVSD Board of Education | Wednesday | 6:00 PM | 2nd & 4th |
| Boulder County Commissioners | Tuesday/Thursday | 9:30 AM | Weekly |

---

## Access boundary

Use already published agendas, packets, minutes, recordings, public data, and other accessible primary sources. Do not file or recommend a CORA or other formal records request. If an essential document is not publicly accessible, log the exact gap and keep dependent claims unverified.
