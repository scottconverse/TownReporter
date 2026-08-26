# Civic Newsroom

> **A civic journalism curriculum for anyone with a browser and a question about their city government**

Nine editorial prompts built to newspaper standards — paste into any AI, no software required. Primary-source grounded. Not a community tool — a journalism tool.

---

## Three ways to use the civic editorial system

| | What it is | Best for |
|---|---|---|
| **civic-newsroom** — you are here | Nine editorial prompts you paste into any AI. No software, no setup. Built to newspaper standards. | Journalists, researchers, and anyone who wants newspaper-grade civic coverage from their browser |
| **[civic-transparency-toolkit](https://github.com/scottconverse/civic-transparency-toolkit)** | Desktop app that runs the pipeline automatically | Residents, HOA boards, neighborhood newsletters, and community groups who want to know what's happening at city hall |
| **[civic-scanner](https://github.com/scottconverse/civic-scanner)** | Claude Code workflow with structured reports and hard editorial gates | Newsroom operators and power users who need structured intelligence reports and managing editor review |

---

> **Civic Newsroom is an editorial toolkit, not a news organization.** It provides prompts, protocols, and templates for AI-assisted analysis of public government records. Users are solely responsible for verifying, editing, and publishing any content produced using this system. This toolkit is designed to complement existing local media, not replace it.

> **IMPORTANT DISCLAIMER:** AI-generated content must be independently verified before publication. This tool does NOT perform journalistic fact-checking. AI can and does fabricate facts, misattribute quotes, and produce flawed analysis. Publishing unverified AI output may constitute defamation or spread misinformation. This is not a substitute for professional journalism. You are solely responsible for everything you publish. See the [Terms of Service](docs/terms.html) for complete legal terms.

Since 2005, more than 2,500 U.S. newspapers have closed. Municipal governments continue generating millions of pages of public records — budgets, permits, zoning changes, contracts, council votes — but in most communities, nobody is reading them. Nobody is translating them into stories residents can act on. The information exists. The analysis doesn't.

Civic Newsroom is a complete, free, prompt-based system that lets anyone stand up a functioning civic reporting operation using AI tools they already have access to (Claude, ChatGPT, Gemini, or any capable LLM). No coding required. No server infrastructure. No journalism degree.

This system was developed and refined against live municipal data in Longmont, Colorado. Every safeguard in this toolkit exists because we identified a specific way AI-assisted journalism can fail — and built the architectural fix before it could cause harm.

Now it's yours.

---

## Important: AI-Assisted Journalism Carries Risk

This toolkit uses AI (large language models) to process public records and generate story leads and draft reporting. AI can and does produce errors, including fabricated facts ("hallucinations"), misattributed quotes, incorrect dates, and flawed analysis. **Every output from this system must be independently verified by a human before publication.**

This system is designed to assist civic reporting, not replace human editorial judgment. The prompts include multiple verification layers (adversarial checking, integrity auditing, suppression protocols), but no automated system is foolproof. You are responsible for everything you publish.

The authors of this toolkit accept no liability for errors in AI-generated output. See the [MIT License](LICENSE) for full terms.

---

## What's in This Repo

### The Pipeline

Civic Newsroom is not a single prompt. It's a **nine-agent editorial pipeline** — each agent handles a different stage of the civic reporting process, from raw signal detection through publication-ready copy:

| # | Agent | What It Does |
|---|-------|-------------|
| 1 | **News Aggregator** | Scans your city's public records, agendas, and government portals. Produces 15-25 prioritized story leads daily. Includes source conflict resolution, skip-logic for missing packets, a canonical sources registry, and a Serial Coverage Tracker for multi-week civic stories. |
| 2 | **Story Expansion** | Takes the strongest leads and expands them into 400-800 word publication-ready stories. Includes pre-expansion verification, confidence scale conversion, a checkpoint separating drafting from verification, revision pathways for suppressed stories, and a "Developing Signal" category for slow-burn investigations. |
| 3 | **Black Desk** | Speculative signal radar. Looks for the dog that didn't bark — absences, anomalies, and fiscal stress patterns. Includes cluster-sizing thresholds, scan methodology, and inline source tier definitions. |
| 4 | **Dark Signal Desk** | Structured verification layer with mandatory adversarial four-gate protocol. Includes defined search scope (platforms, time windows, iteration limits), escalation boundaries, a reporting-handoff block for verified signals (destination: Prompt 01 for daily integration or Prompt 09 for standalone story), and a worked example of the meta-cognitive reasoning protocol. |
| 5 | **Integrity Checker** | Post-production audit with publication-readiness thresholds. Distinguishes CRITICAL from MINOR flags, verifies contact attempts for "no response" claims, and provides clear hold/publish/publish-with-corrections guidance. |
| 6 | **First Amendment Counsel** | Legal guidance agent. Threat triage for press freedom issues — defamation, SLAPP suits, source protection, public records access. Includes plain-language legal definitions. |
| 7 | **Plain-Language Translator** | Rewrites complex civic reporting into clear, accessible language without changing the facts. Explains failure-path consequences for conditional policies. |
| 8 | **Civic Grounding Protocol** | Anti-plagiarism safeguards with primary source clarifications (press releases, meeting audio/video, YouTube transcripts from official city channels, public meeting quotes) and a revision pathway for suppressed stories. |
| 9 | **Story Research & Writing** | Standalone research-and-write agent. Five-stage research sequence with attribution templates, source conflict handling, research iteration limits, headline uncertainty guidance, a built-in Civic Grounding Check with mandatory Journalism Credit, and a mandatory final gate requiring Prompt 05 before publication. |

### Templates

Blank, city-agnostic templates you fill in for your town:

- **Canonical Sources Registry** — Your system's "memory." Tracks every information source by reliability tier with check frequency and confidence scoring.
- **Source Tier Reference** — Shared definitions of Tier A/B/C/D sources used across the entire pipeline. Defines what qualifies as a primary record vs. institutional source vs. community anecdote.
- **Story Lead Template** — Standardized format for capturing and prioritizing story leads.
- **Suppression Ledger** — Documents why stories were killed and what would make them publishable. Includes a revision pathway for reopening suppressed stories when new evidence surfaces.
- **Civic Calendar** — Standing meeting schedules for your city's boards and commissions.
- **Corrections Policy** — Post-publication error handling framework with correction/retraction formats, a 6-step process, and a running Corrections Log.

### Reference

- **Pipeline Cheat Sheet** — One-page reference showing the canonical pipeline order, what each prompt expects and produces, a quick decision tree, and a source tier summary.

### Guides

How-to documentation for people new to civic reporting:

- **How to Find Your City's Sources** — Step-by-step guide to building a source registry for any municipality.
- **How to Read a Council Packet** — What to look for in the documents most local governments publish before meetings.
- **Anti-Plagiarism Protocol** — Lessons learned on the line between aggregation and original reporting.
- **Adversarial Verification** — Why the four-gate protocol exists and how it works.
- **Filing Public Records Requests** — FOIA/CORA basics for every state.

### Example

A complete, working configuration for **Longmont, Colorado** — the city where this system was developed. Use it as a reference when building your own.

---

## How It Works

### The 30-Minute Version

1. Pick your city
2. Copy the prompt templates from `/prompts/`
3. Fill in your city's sources using the guide in `/guides/how-to-find-your-sources.md`
4. Paste the News Aggregator prompt into Claude (or GPT, or Gemini)
5. Read the output. Pick the best leads.
6. Paste the Story Expansion prompt with your selected leads
7. Run the Integrity Checker on the output
8. Publish

### The Full Pipeline

For ongoing coverage, run the complete pipeline:

**Daily (30-60 min):** Run the News Aggregator before council meetings or on your chosen schedule. Review leads.

**As needed:** Expand selected leads into full stories. Run Integrity Checker before publishing.

**Weekly:** Run the Black Desk to scan for signals nobody else is watching. Update your Sources Registry with new discoveries.

**When contested:** Run the Dark Signal Desk with its mandatory adversarial verification on any signal involving accusations, reputational claims, or conflicting accounts.

See `/quickstart/QUICKSTART.md` for detailed setup instructions.

---

## Why These Safeguards Exist

AI-assisted journalism can fail in specific, predictable ways. This system was designed to prevent each of them architecturally — not through good intentions, but through mandatory protocols that cannot be bypassed.

**To prevent hallucination from reaching publication,** we built the adversarial verification protocol — a mandatory four-gate system in the Dark Signal Desk that forces counter-narrative searches across a minimum of 3 platforms within a 90-day window, documents every verification attempt, and flags signals about AI itself for extra scrutiny. The Integrity Checker adds a second layer with publication-readiness thresholds that distinguish CRITICAL flags (wrong facts, fabricated data) from MINOR flags (outdated titles, formatting issues) and provide clear hold/publish guidance.

**To prevent inadvertent plagiarism,** we built the Civic Grounding Protocol and Anti-Plagiarism safeguards. AI naturally synthesizes available information — including other journalists' reporting — into coherent narratives. Without architectural guardrails, the result can look like original work but actually be a rewrite of someone else's journalism. This system enforces a hard rule: journalism from other outlets can tell you *what to look for*, but your reporting must be grounded in primary public records, not rewritten from someone else's work. Clear primary source definitions — including press releases, public meeting audio/video, official municipal YouTube channel transcripts, and meeting record quotes — prevent ambiguity about what counts. A mandatory Journalism Credit ensures that when a Tier B outlet's reporting led you to the story, the outlet is credited in the closing paragraph.

**To prevent stories from disappearing without accountability,** we built the Suppression Ledger. Stories get killed — that's not a failure, it's the system working. But every killed story gets a record: why it was killed, what was missing, and what would make it publishable. Nothing disappears silently. A defined revision pathway lets suppressed stories return to publication when the missing evidence surfaces.

**To prevent stories from bypassing verification,** we made Prompt 05 (Integrity Checker) the universal final gate for the entire system. Every publishable story — whether it comes from the daily pipeline (Prompt 02) or from the standalone Research & Writing agent (Prompt 09) — must pass Prompt 05's independent audit before publication. No prompt can self-certify its own output as publication-ready.

**To prevent inconsistency across the pipeline,** we standardized confidence scales with a conversion table (0.0-1.0 lead scores map to 1-10 publication scores), created a shared Source Tier Reference that all nine agents use, and defined attribution templates so sourcing is consistent across every story.

---

## Who This Is For

- **Engaged residents** who want to understand what their city council is doing with public funds
- **Transparency advocates** who believe public records should be genuinely accessible, not just technically available
- **Civic organizations** that need structured analysis of local government decisions
- **Students** learning civic research through real municipal data
- **Community groups** tracking public decisions that affect their members

You don't need a journalism degree. You need to care about your town.

---

## Relationship to Existing Media

Civic Newsroom is designed to complement existing local media, not compete with it. The system focuses on the vast volume of public records that no outlet has the resources to cover — council packets, permit databases, budget documents, and regulatory filings that go unread because there aren't enough reporters to read them.

When existing media covers a topic, this system defers to their reporting. The anti-plagiarism architecture (Prompt 08) enforces a hard rule: other outlets' work can tell you what to look for, but it can never be your source. Every published claim must trace back to a primary government record. When prior coverage did lead to a story, a mandatory credit acknowledges the originating outlet.

The goal is to expand the total amount of civic information available to residents — not to repackage work that journalists are already doing.

---

## Platform Compatibility

The prompts are designed to work with any capable LLM:

- **Claude** (Anthropic) — where this system was primarily developed and tested
- **ChatGPT** (OpenAI) — tested with GPT-4 and later
- **Gemini** (Google) — tested with Gemini Advanced

Each platform has different strengths. See `/quickstart/SETUP-GUIDE.md` for platform-specific notes.

---

## License

MIT License. Use it, fork it, adapt it, improve it, share it.

If you build a civic reporting operation for your town, we'd love to hear about it. Open an issue or submit a PR with your city's configuration to `/examples/`.

---

## Credits

Created by **Scott Converse** — Executive at Paramount Pictures, Motorola and Apple Computer; founder of ClickCaster (early podcasting startup) and Medioh (early TV App developer); founder of TinkerMill, one of the largest makerspaces in the US; co-founder of The Longmont Observer a local non profit newsroom and Longmont Public Media, a local public access TV station and media makerspace, and creator of the Longmont News Network civic intelligence pilot in Longmont, Colorado.

Built with the conviction that the information to hold local government accountable already exists in public records. What's missing is someone reading them.

Now there's a system for that. And it's yours.
