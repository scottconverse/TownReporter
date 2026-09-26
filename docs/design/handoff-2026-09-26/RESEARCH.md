# Research behind the redesign (2026-09-26)

A short summary of what informed the design decisions. Sources are listed so the developer or owner can check them.

## 1. Models for the public paper
- The owner supplied the award signals: the SND 2026 results (NYT named World’s Best-Designed Digital Presence; ProPublica a finalist with two bronzes), the 2026 Webby judges’ award to The Trace, and 2026 OJA General Excellence finalists including Block Club Chicago and Mission Local.
- For a small civic newsroom, the useful models are ProPublica (calm article pages, source-forward) and Block Club Chicago / Mission Local (a neighborhood daily homepage). The locked direction, **Neighborhood Daily**, borrows the latter’s density and usefulness (dates, meetings) and ProPublica’s source transparency on the article page.

## 2. Editor’s-desk software landscape
- **Enterprise newsroom systems** (Atex MyType, Eidosmedia Méthode, Purple, Brightspot, Octopus) are adding AI agents for monitoring, fact-flagging, SEO and multichannel output. They are built for large multi-desk newsrooms, not one editor.
- **AI public-meeting monitors** are the closest match to TownReporter’s lead queue:
  - the Philadelphia Inquirer’s *Scribe* scores and ranks meeting developments with a newsworthiness framework
  - Connecticut Public’s *Public Meeting Monitor* won the 2025 Local Media Association award and is treated as a source of leads, not publishable journalism
  - Chalkbeat uses *LocalLens* for keyword alerts across about 80 districts
  - others include SeeGov, Satchel, Council Watch, Citizen Portal, Civic Sunlight, Agenda Watch, Digital Democracy and LocalMatters
- Small newsrooms increasingly build their own monitors, because government data isn’t standardized.
- **Gap TownReporter fills:** the others stop at alerts. TownReporter runs lead → AI draft → evidence check (including claims that a record doesn’t exist) → publish, with source records attached, for one editor. No comparable product was found.

## 3. Dark mode
- **Reading performance favors light mode** for people with normal vision, and the advantage grows as text gets smaller (Piepenbrock et al., summarized by NN/g). Dark mode helps in dim rooms and for some low-vision readers. Older adults tend to prefer light mode.
- **Preference is high:** many surveys report large dark-mode use on phones, though the survey quality is mixed. Chrome data showed about 22% of web traffic preferring dark in 2021.
- **Platform guidance:**
  - Material Design recommends dark gray `#121212`, not pure black.
  - Apple’s base background is black, with lighter elevated surfaces.
  - White on pure black causes halation for readers with astigmatism.
  - Saturated accents should be muted in dark mode.
- **ProPublica** follows the system setting and uses a dark blue-gray (`#1b2127`) with off-white headlines.
- **Decision:** light is the paper’s default and dark follows the system and a toggle. The dark ground is warm black `#1b1916` with bone `#e8e6e1` text, the yellow is muted to `#e6c35c`, and the 14px floor stays.

## 4. Privacy-first reader analytics
- **Plausible’s model:** measure traffic, not individuals. No cookies and no persistent identifiers; data is isolated to one device, one site and one day.
- **Chartbeat’s editorial metrics:** engaged time (active scroll, click and touch), recirculation, scroll depth, referral categories including “dark social” (links shared privately by email, apps and texts), and real-time concurrents. Visitors who view two pages return at 22% versus 8–9% for one page, which is why “Read another story” is a headline metric.
- Newsroom guidance says to look past pageviews to engagement and loyalty (DCN 2026; Journalism University). Nonprofits often build their own reach metrics (The 19th’s Total Journalism Reach).
- **TownReporter today:** `page_views` counts raw page loads per target per day with no identity.
- **Decision:** keep that counter, and add a reading beacon that is aggregate only, with an in-memory per-pageview token that is never stored. “Returning readers” is openly not measurable.

## Sources
- SND47 results (snd.org/results); ProPublica design awards; FactCheck.org’s Webby post; INN Nonprofit News Awards; 2026 OJA finalists (awards.journalists.org)
- OpenAI, “How news organizations are using AI” (Inquirer Scribe); Local Media Association on Connecticut Public’s Public Meeting Monitor (Jul 2026); Nieman Lab on LocalLens (Mar 2025); Generative AI in the Newsroom on small-newsroom monitors (Sep 2026); CU-CitizenAccess on LocalMatters (Aug 2026); Newsroom Robots on Agenda Watch
- NN/g, “Dark Mode vs. Light Mode”; Dobres et al., *Applied Ergonomics* 2017; the ETRA 2025 eye-tracking study; Material Design dark theme; Apple HIG Dark Mode; ProPublica’s design guide on dark mode (guides.propublica.org/design/dark-mode)
- Plausible (plausible.io/privacy-focused-web-analytics); the Chartbeat real-time glossary; Chartbeat, “Readers who visit 2 pages…”; Digital Content Next, “Beyond pageviews” (Aug 2026)
