# Civic Scanner

> **Advanced civic signal detection and structured reporting for newsroom operators and power users**

Hard editorial gates, JSON report schema, publication-ready audit trails, and managing editor review. Runs inside Claude Code. Built for people who know what they're doing.

**v2.3** — Adversarial hardening: Grounding Delta, falsification search, steel-manning, SLAPP detection, state-drift linter, stress tests, Receipts.

---

## Three ways to use the civic editorial system

| | What it is | Best for |
|---|---|---|
| **[civic-newsroom](https://github.com/scottconverse/civic-newsroom)** | Nine editorial prompts you paste into any AI. No software, no setup. Built to newspaper standards. | Journalists, researchers, and anyone who wants newspaper-grade civic coverage from their browser |
| **[civic-transparency-toolkit](https://github.com/scottconverse/civic-transparency-toolkit)** | Desktop app that runs the pipeline automatically | Residents, HOA boards, neighborhood newsletters, and community groups who want to know what's happening at city hall |
| **civic-scanner** — you are here | Claude Code workflow with structured reports and hard editorial gates | Newsroom operators and power users who need structured intelligence reports and managing editor review |

---

## Installation

Copy the skill file to your Claude Code skills directory:

```bash
# From the project root
cp MasterSkills/civic-scanner/SKILL.md ~/.claude/skills/civic-scanner/SKILL.md
```

Or if you're cloning from the repo:

```bash
mkdir -p ~/.claude/skills/civic-scanner
cp civic-scanner/SKILL.md ~/.claude/skills/civic-scanner/SKILL.md
```

The `docx` npm package is required for report generation:

```bash
cd ~/Desktop/Claude  # or your working directory
npm install docx
```

For fixture-only validation or operator dry runs, you can validate report JSON without generating a `.docx`:

```bash
node build-report.js --validate-only tests/fixtures/pipeline-data-valid.json
```

Claude Code will auto-detect the skill on next launch.

**First run:** Just type `/civic-scanner` — it will prompt you to pick a mode. For a new city, start with `discover` to build your source registry.

---

## What It Does

The Civic Source Scanner replaces 4-10 hours of morning newsroom work — scanning government portals, reading agendas, checking meeting minutes, monitoring community forums, and triaging which stories are worth pursuing — with a structured pipeline that produces verified leads, scored stories, reporter task memos, and distribution-ready content.

**What it produces:**
- Prioritized lead lists with source tier classification (A/B/C)
- 400-800 word research scaffolding per story (not publishable copy — reporter adds quotes, scene, voice)
- Newsworthiness scores (Immediacy, Impact, Conflict, Novelty) that can kill editorially thin stories
- Reporter Task Memos: what's confirmed, what's missing, who to call, what to file, what would kill the story
- 4-gate adversarial verification with full counter-narratives
- Plain-language summaries for newsletters and social media
- Distribution packages (SEO, social headlines, newsletter briefs, email subjects)
- Visual direction briefs with AI generation prompts
- Persistent beat memory across runs (thread tracking, score trends, suppression triggers)
- Community engagement outputs (tip prompts, correction tracking, trust dashboard)

**What it will NOT do:**
- Publish anything without Tier A (official government record) grounding
- Quote or cite Tier C sources (Reddit, Nextdoor, Facebook) in any output
- Present AI-generated content as photojournalism
- Replace the reporter's phone calls, meeting attendance, or editorial judgment

---

## Quick Start

```bash
# First time — discover sources for your city
/civic-scanner discover Boulder, Colorado

# Morning scan — what's new today?
/civic-scanner daily-scan --city boulder

# Full pipeline — complete story packages with verification
/civic-scanner full-pipeline --city boulder

# Verify a specific claim
/civic-scanner verify-only "Boulder city council approved the 2026 budget"

# Deep-dive research
/civic-scanner research "Boulder water infrastructure"

# Legal threat triage
/civic-scanner legal-threat "CORA request denied by city clerk"
```

---

## 6 Modes

| Mode | Command | What It Produces |
|------|---------|-----------------|
| **Daily Scan** | `daily-scan` | Scored morning briefing: 200-300 word expansions, newsworthiness scores, plain-language summaries (Agents 1→2→2.5→7) |
| **Full Pipeline** | `full-pipeline` | Complete story packages through all 11 agents with .docx report |
| **Verify Only** | `verify-only {claim}` | 4-gate adversarial verification of a specific claim |
| **Research** | `research {topic}` | Deep-dive research brief with CORA targets |
| **Legal Threat** | `legal-threat {situation}` | First Amendment counsel triage |
| **Discover** | `discover {city}, {state}` | Auto-build source registry for any US municipality |

---

## Architecture

### Pipeline Flow

```
Sources (Tier A/B/C)
       |
  [Agent 1: News Aggregator]
  Scan → classify → extract leads
       |
  [Agent 2: Story Expansion]
  Draft 400-800 word research scaffolding
       |
  [Agent 2.5: Newsworthiness Gate] ←── Can KILL or DEMOTE
  Score: Immediacy / Impact / Conflict / Novelty
  Threshold: 10/20 to advance
  Produces: Reporter Task Memo + Visual Direction Brief
       |
  [Agent 3: Black Desk]
  Speculative signals (low confidence OK)
  NEVER publishable — feeds Agent 4
       |
  [Agent 4: Adversarial Challenge] ←── Can SUPPRESS
  4-gate verification: Contestation → Adverse Search →
  Counter-Narrative → Self-Referential Warning
  Kill condition: counter-narrative more compelling
       |
  [Agent 5: Completeness Auditor] ←── Can KILL
  Attribution completeness, balance, harm, legal flag
  Kill condition: unattributable factual claim
       |
  [Agent 6: First Amendment Counsel]
  Legal risk assessment (honest, not rubber-stamped)
       |
  [Agent 7: Plain-Language Translator]
  8th grade reading level summaries
       |
  [Agent 7.5: Distribution Packager]
  SEO, social media, newsletter, email subjects
       |
  [Agent 8: Source Hygiene + Headline Audit + Originality] ←── Can KILL/HOLD
  Tier C contamination check | Headline status-verb audit |
  3-layer originality verification
  Kill condition: Tier C in attribution
  Hold condition: originality FAIL
       |
  [Agent 9: Story Research & Writing]
  Additional deep-dive if needed
       |
  [Beat Memory Update]
  Write thread tracking to {city}-beat-memory.json
       |
  [Report Generation]
  Section A: Editorial Dashboard (2-3 pages)
  Section B: Verification Appendix (full agent output)
  Output: .docx file
```

### Kill Gates

Three agents can kill or hold stories. Every pipeline run reports its kill count.

| Agent | Kill Condition | Action |
|-------|---------------|--------|
| Agent 2.5 | Score < 10/20 | HOLD (7-9) or DEMOTE (≤6) |
| Agent 4 | Grounding Delta negative (counter has more Tier A) | SUPPRESS (red) — automatic |
| Agent 4 | Steel-man defense compelling + unaccounted for | SUPPRESS (red) |
| Agent 4 | Falsification search finds official denial/retraction | SUPPRESS (red) |
| Agent 5 | Unattributable factual claim | KILL (red) |
| Agent 6 | Fair Report Privilege chain broken on defamatory claim | AMBER — mandatory rewrite |
| Agent 8 | Tier C in attribution (including laundered) | KILL (red) |
| Agent 8 | State-drift: forbidden verb for source type | REJECT headline |
| Agent 8 | Originality FAIL | HOLD for rewrite |

### Severity Coding

Every story gets a severity color that travels through the pipeline:

| Color | Meaning | Example |
|-------|---------|---------|
| **GREEN** | Clean pass, no caveats | Factual reporting of a public record with no contestation |
| **AMBER** | Passed with caveats — both sides required | RCV story with 17/20 support but state rejection context |
| **RED** | Killed or suppressed | Counter-narrative won, or unattributable claim |
| **GRAY** | Held — awaiting documents or below threshold | Building code story scoring 8/20 |

---

## Mandatory Controls

### 1. Hard-No-Bluff Rule
**No Tier A source = no publication.** No exceptions. No "likely true." No "sources suggest." Either you have an official government record or the story goes to the suppression ledger.

### 2. Source Tier Classification

| Tier | What | Use |
|------|------|-----|
| **A** | Government agendas, minutes, budgets, permits, court filings, CORA responses, official YouTube transcripts | **Only tier that supports publication** |
| **B** | Newspapers, school district communications, institutional press releases | Leads only — must be corroborated by Tier A |
| **C** | Reddit, Nextdoor, Facebook, YouTube comments, Twitter/X | Signals only — never quoted, cited, or referenced in published output |

### 3. Adversarial Verification (4 Gates + Grounding Delta)
1. **Contestation** — Is anyone disagreeing?
2. **Adverse Search + Falsification** — Search for evidence AGAINST + mandatory exculpatory search ("denied" OR "retracted" OR "dismissed")
3. **Counter-Narrative + Grounding Delta** — Write strongest opposing argument; count Tier A citations in lead vs. counter. If counter has more Tier A sources → auto-SUPPRESS (RED).
4. **Steel-Manning + Self-Referential** — Generate subject's best legal/procedural defense before GREEN. Extra scrutiny for AI/journalism/tech/media stories.

### 4. De-Escalation Controls
- "scheduled to" not "will"
- Fact / interpretation / allegation separated
- No ALL CAPS, no exclamation marks, no editorial adjectives
- Attribution to specific documents, not "the city plans to"

### 5. Suppression Ledger
Every killed story gets a ledger entry with a reopen trigger. The ledger is a pipeline, not a graveyard.

### 6. Dynamic Search Filtering
Tier-specific `allowed_domains` and keep/discard criteria for all web searches.

### 7. Blocked Source Intelligence
Blocked search results become leads, not dead ends. Titles and snippets extracted and fed to Black Desk and Adversarial Challenge.

### 8. Beat Memory
Persistent story thread tracking across runs. Score trends, status history, suppression trigger monitoring. 90-day retention with archival.

### 9. Reddit Tiered Access
Reddit is the most valuable Tier C source — community subreddits contain faint signals, hidden stories, and consensus patterns invisible in official records. Access protocol:
1. **Direct** — patched Chrome extension, full thread/comment reading
2. **Google index** — `site:reddit.com/r/{subreddit}` queries via browser
3. **Manual review** — checklist generated for reporter
4. **Reference to fix** — on first blocked access, directs user to Appendix A

Multi-subreddit scanning: city sub + state sub + topic subs discovered through story connections (e.g., r/Teachers for school stories, r/legaladvice for tenant rights).

### 10. Smart Source Lists
Source registries grow organically from domains discovered during scanning. New sources get proposed with tier, relevance, and discovery context. `.gov` domains auto-add; Tier B/C require editor approval. Performance tracking per source (leads generated vs stories advanced). Proposals stored in `{city}-proposed-sources.json`.

### 11. YouTube/Video Discovery
Discover mode searches for ALL video sources: city government channel, public access TV partners (often contracted by city), county channel, boards/commissions channels, school district channel + website video pages. Each recorded with transcript availability and coverage scope.

---

## Reporter Task Memo

The most actionable output. Generated for every advancing story:

```
REPORTER TASK MEMO:
  Confirmed: What Tier A grounding exists (specific documents)
  Missing:   Gaps preventing publication-ready status
  Calls:     Who to call (names, titles, organizations)
  Documents: Specific CORA requests or records to pull
  Falsify:   What evidence would kill this story
```

## Visual Direction Brief

Structured specifications for photographers, designers, and map-makers:

- **MAP**: area, overlays, GIS source, data layers
- **PHOTO**: subject, location, timing, what to convey, backup option
- **CHART**: type, exact data with sources, key comparison
- **INFOGRAPHIC**: concept, elements, data points, target audience
- **DIAGRAM**: process flow, decision tree, key message
- **DOCUMENT**: specific excerpt with source and highlight

Each visual includes AI **generation prompts** (simple + detailed) for Claude Artifacts, DALL-E, matplotlib, Canva AI, etc.

---

## Distribution Packager

Per-story, platform-ready outputs:

| Channel | Format |
|---------|--------|
| **SEO** | Headline (60 chars), meta (155 chars), keywords, URL slug |
| **Twitter/X** | 280 chars + hashtags |
| **Facebook** | 2-3 sentences with CTA |
| **LinkedIn** | Professional/policy framing |
| **Nextdoor** | Neighborhood-level "what this means for you" |
| **Newsletter** | 50-75 word standalone + "What to watch" hook |
| **Email** | 3 subject line variations (informational, curiosity, action) |

---

## Community Engagement

### Reader Tip Intake
Per-story tip prompts generated from Reporter Task Memo gaps. Tells readers exactly what the newsroom still needs — not a generic "send us tips."

### Correction Mechanism
Structured correction log (`{city}-corrections.json`) with beat memory integration. Corrections flagged in subsequent pipeline runs.

### Trust Dashboard
Published in every report: total stories, correction rate, kill count, average newsworthiness score, Tier A coverage percentage.

### Community Pulse Check
What the community discusses vs what the pipeline covers. Prevents becoming an echo chamber of government press releases.

---

## Originality Verification (3 Layers)

| Layer | Method | Catches |
|-------|--------|---------|
| **1** | Structural comparison against source docs | 5+ word verbatim matches, mirrored sentence structure |
| **2** | Web similarity search on lede paragraph | Inadvertent reproduction of Tier B language |
| **3** | External API (Copyscape, Originality.ai, etc.) | Broader similarity detection (when configured) |

Verdicts: ORIGINAL (green) / FLAG (amber, editor review) / FAIL (red, hold for rewrite)

---

## City Configuration

### Auto-Discovery (Recommended)
```bash
/civic-scanner discover Austin, Texas
```
Searches for agenda portals, YouTube channels, school boards, county government, newspapers, community forums, meeting schedules, and open records laws. Outputs a ready-to-scan source registry.

### Pre-Configured Cities
- **Longmont, Colorado** (default — full source registry + beat memory)
- **Boulder, Colorado** (discovered and scanned)

### Manual Setup
Copy `references/source-template.md`, fill in your city's sources, save as `references/{city-name}-sources.md`.

---

## Report Structure

### Full Pipeline Report (.docx)

**Built by a permanent, data-driven script** — not generated ad-hoc each run.

**Script:** `build-report.js` reads a JSON data file containing ALL agent output and generates the .docx. The JSON schema (`report-schema.json`) enforces completeness — the script rejects data with missing fields or content that's too short.

**Safety guardrail:** report JSON must declare `meta.reportPurpose = "editorial-guidance"` and `meta.publicationReady = false`. This keeps the generated artifact framed as internal newsroom guidance, not publication-ready civic reporting. Use `node build-report.js --validate-only <pipeline-data.json>` to check fixtures or pipeline output without creating a document.

**Section A: Editorial Dashboard (2-3 pages)**
- Pipeline stats, beat context, source access limitations
- Publishable stories table with severity, score, beat tracking
- Reporter task memos and visual direction briefs
- Distribution packages
- Community engagement (tip prompts, trust dashboard, pulse check)

**Section B: Verification Appendix**
Full, unabridged agent output:
- Complete 400-800 word story drafts with attribution chains
- Newsworthiness scoring tables with justifications
- Black Desk speculative signals with full reasoning
- 4-gate adversarial verification with full counter-narratives
- Per-story completeness audits
- Per-story First Amendment analysis
- Full plain-language rewrites (150-200 words each)
- Full distribution packages (all platforms)
- Originality verification and source hygiene results

**Output location:** `~/Desktop/CivicScanner/` — created automatically on first run. Works on any machine without hardcoded paths.

**Validation:** After generation, the script checks total content > 15,000 characters and reports the result. No more skeleton reports. In validate-only mode, the script exits after schema and guardrail checks so operators can smoke-test safe fixture data without needing `docx`.

---

## Version History

| Version | Date | Feature |
|---------|------|---------|
| v1.0 | 2026-03-29 | Initial: 5 modes, 9 agents, Hard-No-Bluff, source tiers |
| v1.1 | 2026-03-29 | Dynamic Search Filtering (web_search_20260209) |
| v1.2 | 2026-03-29 | .docx report generation |
| v1.3 | 2026-03-29 | Newsworthiness Gate, Reporter Task Memos, Headline Audit |
| v1.4 | 2026-03-29 | Agent boundary tightening, Section A+B report, severity coding |
| v1.5 | 2026-03-29 | Blocked Source Intelligence, City Discovery Mode |
| v1.6 | 2026-03-29 | Beat Memory across runs |
| v1.7 | 2026-03-29 | Distribution Packager |
| v1.8 | 2026-03-29 | Visual Direction Briefs + AI Generation Prompts |
| v1.9 | 2026-03-29 | Community Engagement Framework |
| v1.10 | 2026-03-29 | 3-Layer Originality Verification |
| v2.0 | 2026-03-29 | Architecture review, documentation package, clean release |
| v2.1 | 2026-03-29 | Reddit tiered access, smart source lists, YouTube/video discovery expansion, appendices A+B |
| v2.2 | 2026-03-30 | Enhanced daily scan (Agents 1→2→2.5→7), permanent data-driven report build script, JSON pipeline data schema |
| v2.3 | 2026-03-30 | Adversarial hardening: Grounding Delta, falsification search, steel-manning, vulnerability classification, SLAPP detection, state-drift linter, stress test suite, Receipts |

---

## Files

```
civic-scanner/
  SKILL.md                              Main skill definition (v2.3)
  build-report.js                       Permanent .docx report builder (DO NOT recreate)
  report-schema.json                    JSON schema for pipeline data validation
  README.md                             This file
  civic-scanner.md                      Quick reference documentation
  RELEASE_NOTES.md                      Detailed version history
  architecture.svg                      Pipeline architecture diagram
  references/
    source-template.md                  Blank template for any city
    fort-collins-sources.md             Fort Collins, CO source registry
    centennial-sources.md               Centennial, CO source registry
    fort-collins-beat-memory.json        Beat memory (Fort Collins)
    {city}-sources.md                   Created by discover mode per city
    {city}-beat-memory.json             Created at runtime per city
    {city}-corrections.json             Corrections log per city
    {city}-config.json                  Optional: plagiarism API config
    {city}-proposed-sources.json        Smart source list proposals (runtime)
  v1.0/ - v2.1/                         Archived versions
  docs/
    CivicScanner-Documentation.docx     Professional formatted documentation
    index.html                          GitHub Pages landing page
```

---

## Key Gotchas

1. **Hard-No-Bluff is absolute** — no Tier A = no publish, period
2. **Adversarial completeness required** — finding evidence AGAINST is the value
3. **Self-referential warning** — AI/journalism/tech stories trigger confirmation bias
4. **YouTube transcripts have errors** — Tier A for content, verify individual quotes
5. **Astroturf detection** — manufactured pressure looks organic at Tier C
6. **SLAPP suit risk** — development/land-use stories may trigger strategic lawsuits
7. **Source laundering** — Tier C through Tier B doesn't become Tier B
8. **Headline state-drift** — packaging can convert "proposed" to "approved"
9. **Newsworthiness ≠ sourcing** — well-sourced can still be editorially thin
10. **Blocked ≠ absent** — blocked search results contain lead intelligence
11. **Discovery ≠ verification** — discovered URLs must be verified as current
12. **Recurring ≠ still newsworthy** — novelty score decays without new facts
13. **Beat memory is context, not commitment** — create new threads rather than false-matching
14. **This is scaffolding, not journalism** — publication requires human reporting on top
15. **Reddit signals are gold** — highest-engagement threads reveal stories invisible in official records
16. **Public access TV** — often has more complete archives than the city's own channel
17. **School district websites** — overlooked Tier A source; board minutes, policy changes, budget data

---

## Built From

- 30+ LNN/civic-newsroom prompt variants
- civic-newsroom open-source project (9-agent pipeline)
- CIOS/SmartNewsNetwork meeting packet processor
- Dark Signal Desk, Dark County Signal Desk variants
- First Amendment counsel module
- Civic Grounding Protocol (anti-plagiarism)
- 4 independent managing editor reviews (v1.2 output)

---

## License

See LICENSE file in the civic-newsroom repository.
