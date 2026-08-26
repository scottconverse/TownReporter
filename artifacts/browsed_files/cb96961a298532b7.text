# CivicNewspaper V1 Product Requirements Document

Status: draft for v0.3.3 to v1.0.0 planning
Current product version: v0.3.3
Product name: CivicNewspaper
Installed app name: The Civic Desk

## 1. Product Vision

CivicNewspaper should become a local-first desktop newsroom for small towns, community publishers, independent reporters, and civic groups. By v1.0.0, a non-technical publisher should be able to install the app, configure a place, discover useful official and public sources, identify real story leads, draft and revise stories with local AI help, verify claims, publish a static issue, and recover from ordinary failures without developer supervision.

The product's unique advantage is not that it can ask an AI to write an article. Cloud products can already do that. CivicNewspaper's advantage is that it can run a persistent, private, town-specific local intelligence layer across the entire newsroom workflow without sending unfinished reporting, sensitive leads, local source lists, editorial notes, unpublished drafts, or verification concerns to a cloud model.

The local LLM should act as a private newsroom brain: classifying sources, recognizing repeated background material, spotting novelty, suggesting story forms, creating reporter notebooks, extracting claims, suggesting verification tasks, coaching editors, and helping line up an issue. It must not replace the editor or make the editor's news judgment. Deterministic package-integrity checks may still block export until broken public output is repaired.

## 2. Problem Statement

Small local publishers face a practical collapse of reporting capacity. Many towns have public records, agendas, meeting videos, public notices, community posts, and local tips available online, but there are too few people watching them every day. Existing AI tools usually help draft text after a human already knows what the story is. They do not reliably help a local editor answer the harder questions:

- What changed since the last scan?
- Is this actually news or just old background?
- Is this a duplicate of something already found?
- What kind of item is it: article, brief, watch item, public notice, or background?
- What claims need verification?
- Which sources support which claims?
- What should stay in the reporter notebook and not appear in public output?
- How does this connect to prior local entities, addresses, vendors, agencies, or issues?
- What should be published today?

CivicNewspaper v1.0.0 should solve that workflow, not just produce HTML.

## 3. Target Users

### Primary Users

Independent local publisher:
Runs a small-town paper, newsletter, or civic desk. Needs usable leads, drafts, publishing, and a clear issue package.

Reporter/editor:
Uses the app to monitor beats, draft from evidence, revise copy, check risks, and prepare publication-ready stories.

Community civic group:
Publishes a public-interest civic bulletin. Needs watch items, public notices, meeting recaps, and transparent source links.

Solo local resident publisher:
May not have formal journalism training. Needs simple workflows, plain-language guidance, and strong warnings without being blocked by software.

### Secondary Users

Developer/operator:
Maintains connectors, deployment, packaging, tests, and source adapters.

Researcher/auditor:
Reviews evidence, source snapshots, issue output, and how a story was produced.

## 4. Product Principles

Human editor always decides.
The app may warn, suggest, coach, classify, and rank. It must never silently veto the editor's judgment; visible static-package integrity checks may prevent approval/export until broken evidence, empty copy, reporter notes, or unsupported citations are fixed.

Local-first by default.
Unpublished drafts, notes, local source lists, and verification concerns should stay on the user's machine unless the user explicitly publishes or exports them.

Local LLM as newsroom intelligence, not ghostwriter.
The model should improve source understanding, novelty detection, triage, verification, editing, and issue planning. Drafting is only one use.

Evidence before prose.
Every generated story should trace back to sources, snapshots, transcripts, public records, or clearly labeled human notes.

New to the app is not news.
The app must distinguish newly fetched material from genuinely new civic facts.

No public scaffolding leakage.
Public output must never expose reporter notes, prompt artifacts, checklist labels, placeholder tags, or hidden editorial guidance.

Configurable publisher identity.
The app must not assume nonprofit status, no ads, public-record-only mission, AI disclosure language, or a specific publication name.

Warnings, not paternalism.
The app can warn about weak sourcing, legal risk, privacy risk, redaction risk, single-source claims, and unverified social material. It cannot decide for the editor.

## 5. Current Baseline

As of v0.3.0, the app already has:

- Tauri 2 desktop shell.
- React/TypeScript frontend.
- Rust backend.
- Local SQLite database through `rusqlite`.
- Local model flow through Ollama-compatible local AI.
- Daily Scan, Story Queue, Dark Signals, Verification Queue, and Workbench.
- Static issue compiler.
- ZIP export.
- here.now quick publishing.
- Connector work for GitHub Pages, Cloudflare Pages, Netlify, WordPress, and assisted publishing.
- Browser-extension pairing.
- Local settings, publisher identity, guardrails, and press-freedom/legal-risk advisor.

The main gap is not mechanics. The main gap is newsroom quality: novelty detection, source quality, story form selection, editor workflow, verification task depth, and public output quality.

## 6. V1 Product Goals

By v1.0.0, CivicNewspaper should:

1. Produce a real issue from a clean install.
2. Discover and review official, social, and local sources.
3. Use Big Local News civic-scraper for major civic platforms.
4. Maintain source snapshots and beat memory.
5. Detect duplicates and stale evergreen/background material.
6. Separate leads into article, brief, watch item, public notice, meeting item, alert, investigation lead, and background.
7. Use local LLMs throughout the workflow to improve classification, triage, novelty, verification, editing, and issue planning.
8. Allow editor actions: draft, revise, send back, hold, cut, restore, approve, publish-ready, publish.
9. Generate verification tasks from claims.
10. Check PDFs for redaction risk.
11. Support local transcription and transcript review for public meetings if meeting workflow is included in the release claim.
12. Publish professional static output with clean article pages, RSS, share package, ZIP, and here.now URL.
13. Survive restart, failed scans, failed model setup, failed publish, and failed imports.
14. Provide complete non-technical documentation.

## 7. Non-Goals For V1

The following are not required for v1.0.0 unless explicitly added later:

- Multi-user newsroom server.
- Cloud-hosted SaaS dashboard.
- Fully autonomous publication without editor review.
- Legal advice.
- Code-signed installers, using the available Windows signing certificate.
- Advanced speaker recognition.
- Full DocumentCloud hosting/self-hosting.
- Full courts beat.
- Full FOIA case management.
- Full GraphRAG document-intelligence system.
- Guaranteed complete source discovery for every town.

## 8. Local LLM Strategy

The local LLM should be available as a reusable backend service, not a one-off drafting helper. The Rust backend should expose structured operations that call the configured local model with typed inputs and typed outputs.

### Model Runtime

Primary runtime:

- Ollama-compatible local model runtime already used by CivicNewspaper.

Future-compatible runtimes:

- LM Studio OpenAI-compatible local server.
- llama.cpp server.
- vLLM where appropriate.
- Cloud fallback only if explicitly configured by the publisher.

### Local LLM Requirements

The model layer must support:

- Hardware-based model recommendation.
- Download progress.
- Timeout handling.
- Retry and cancellation.
- Degraded mode when no model is available.
- JSON-first structured outputs where possible.
- Prompt versioning.
- Prompt/template configuration by publisher.
- Audit trail of local model task type, input source IDs, output summary, and timestamp.
- No hidden cloud calls for draft/review work unless user explicitly enables cloud fallback.

### Local LLM Injection Points

Source intake:

- Classify source type.
- Detect official vs social vs local media vs vendor/PR vs background.
- Suggest source labels.
- Identify duplicate sources.
- Summarize why a source may matter.

Source discovery:

- Generate search queries for missing beats.
- Suggest official/social/local-media source candidates.
- Explain why a candidate should be reviewed.
- Cross-reference single-source leads with search expansion.

Snapshot and novelty:

- Compare current source text to prior snapshots.
- Identify new facts.
- Identify unchanged background.
- Detect date-only changes.
- Detect recurring notices.
- Suggest "not news yet" disposition.

Lead triage:

- Recommend article, brief, watch item, public notice, alert, meeting preview, meeting recap, investigation lead, or background.
- Explain why.
- Identify missing evidence.
- Detect duplicates.

Reporter notebook:

- Produce private notes: what happened, why it may matter, who is affected, what is known, what is unknown, who to call, what documents to request, and prior related items.

Drafting:

- Generate story drafts from selected leads only.
- Use story-type-specific prompts.
- Preserve source references.
- Avoid publishing notebook/checklist/scaffolding text.

Editing:

- Suggest headlines.
- Flag summary-style headlines.
- Flag buried ledes.
- Flag unsupported assertions.
- Suggest plain-language rewrites.
- Apply publisher stylebook.

Verification:

- Extract atomic claims.
- Classify claims by type.
- Link claims to sources.
- Create verification tasks.
- Warn on single-source claims.

Legal and press-freedom advisor:

- Invoke-only.
- Detect risk areas.
- Suggest questions.
- Never block.

Transcripts:

- Segment meeting transcript by topic/agenda item.
- Extract action items.
- Extract votes where possible.
- Suggest quote candidates.
- Compare packet/staff memo to meeting discussion.

Issue planning:

- Recommend homepage lineup.
- Separate articles, briefs, watchlist, notices, and editor notebook.
- Suggest newsletter summary.
- Suggest social/community posts.

## 9. Core Functional Requirements

### 9.1 Source Management

The app must allow publishers to add, discover, import, review, label, trust, pause, and remove sources.

Source records must track:

- URL or local file path.
- Source type.
- Source platform.
- Jurisdiction.
- Official/social/local-media/vendor/unknown classification.
- Confidence.
- Review status.
- Last fetched.
- Last successful fetch.
- Failure count.
- Current snapshot hash.
- Related entities.

Local LLM use:

- Source classification.
- Duplicate detection.
- Source explanation.
- Suggested beat tags.

Relevant external projects:

- Big Local News civic-scraper: https://github.com/biglocalnews/civic-scraper
- Open Civic Data Legistar scraper: https://github.com/opencivicdata/python-legistar-scraper
- Open Civic Data division IDs: https://github.com/opencivicdata/ocd-division-ids
- civic-ai-tools: https://github.com/npstorey/civic-ai-tools

### 9.2 Source Fetching And Scraping

The app must fetch ordinary web pages and support civic platform scraping.

Big Local News civic-scraper should be integrated as a sidecar for:

- CivicClerk.
- CivicPlus.
- Granicus.
- Legistar.
- PrimeGov.

Integration shape:

- Rust task launches controlled Python sidecar command.
- Sidecar returns structured JSON and artifact paths.
- Artifacts are stored in app evidence directory.
- Metadata is normalized into SQLite.
- Failures become retryable task records.

Local LLM use:

- Summarize fetched source context.
- Identify source platform when deterministic detection is uncertain.
- Suggest whether fetched content is evergreen/background/current.

### 9.3 Beat Memory And Novelty Ledger

The app must remember prior source snapshots and prior lead clusters.

The system must detect:

- Same content as prior scan.
- Date-only or boilerplate-only changes.
- New agenda item.
- New vote/action.
- New notice.
- Recurring background page.
- Duplicate of prior lead.
- Follow-up to prior story.

Local LLM use:

- Semantic comparison of prior and current source text.
- Explain what changed.
- Explain why something is or is not newsworthy.
- Suggest lead disposition.

Relevant external project:

- Marshall Project Klaxon: https://github.com/themarshallproject/klaxon

### 9.4 Lead Queue

The lead queue must show both machine signals and editorial state.

Lead fields:

- Title.
- Summary.
- Source IDs.
- Evidence IDs.
- Lead cluster ID.
- Beat.
- Story type recommendation.
- Novelty reason.
- Verification status.
- Editor disposition.
- Last action.
- Local LLM notes.

Required statuses:

- New.
- Changed.
- Duplicate.
- Background.
- Not news yet.
- Needs reporting.
- Needs verification.
- Ready to draft.
- Drafted.
- Held.
- Cut.
- Approved.
- Published.

Local LLM use:

- Story type recommendation.
- Lead-quality explanation.
- Suggested next reporting action.

### 9.5 Workbench And Editorial Workflow

The Workbench must support a complete writer/editor loop.

Required actions:

- Generate draft.
- Edit draft.
- Rewrite.
- Send back for more work.
- Hold.
- Cut.
- Restore.
- Mark needs verification.
- Mark ready.
- Approve.
- Unapprove.
- Publish-ready.

The app must make held/cut/send-back drafts easy to find.

Local LLM use:

- Draft generation.
- Rewrite in selected style.
- Headline alternatives.
- Lede critique.
- Editor coaching.
- Verification prompt.
- Plain-language rewrite.

Relevant external projects:

- AP Brainerd: https://github.com/AssociatedPress/local-ai-brainerd-dispatch
- AP KSAT: https://github.com/AssociatedPress/local-ai-ksat
- AP El Vocero: https://github.com/AssociatedPress/local-ai-el-vocero

### 9.6 Story Templates And Prompt Configuration

The app must define story templates.

Minimum templates:

- Hard-news article.
- Brief.
- Watch item.
- Meeting preview.
- Meeting recap.
- Public notice.
- Alert.
- Investigation lead.
- Explainer.
- Service item.

Each template should define:

- When to use it.
- Required evidence.
- Optional evidence.
- Draft structure.
- Headline style.
- Public-output rules.
- Verification checklist.
- Prompt text.
- Local style settings.

Local LLM use:

- Template recommendation.
- Template-specific drafting.
- Template-specific editing.

### 9.7 Verification Queue

The app must generate verification tasks from leads and drafts.

Task fields:

- Claim.
- Claim type.
- Source support.
- Missing support.
- Suggested check.
- Risk type.
- Status.
- Related story.
- Related source.

Local LLM use:

- Atomic claim extraction.
- Claim type classification.
- Evidence matching.
- Task generation.

Relevant external projects:

- OpenFactVerification/Loki: https://github.com/Libr-AI/OpenFactVerification
- Free Law X-Ray: https://github.com/freelawproject/x-ray

### 9.8 Document Safety And PDF Checks

The app should warn about potentially unsafe or misleading documents.

Requirements:

- Detect image-only PDFs and explain OCR limitations.
- Run X-Ray redaction-risk checks where available.
- Warn on hidden text/redaction risk.
- Allow optional external sanitization workflow.

Local LLM use:

- Explain document issues in plain language.
- Suggest verification tasks.

Relevant external projects:

- Free Law X-Ray: https://github.com/freelawproject/x-ray
- Dangerzone: https://github.com/freedomofpress/dangerzone

Dangerzone should be treated as optional/reference unless licensing, container, and distribution implications are resolved.

### 9.9 Meeting Audio/Video And Transcripts

The app should support public meeting audio/video ingestion when this feature is claimed in a release.

Requirements:

- Add meeting media.
- Download or import media where legally/publicly available.
- Transcribe locally.
- Store transcript.
- Review transcript.
- Link transcript segments to stories.
- Publish transcript pages optionally.

Local LLM use:

- Agenda segmentation.
- Topic summaries.
- Vote/action extraction.
- Quote candidate extraction.
- Comparison between staff packet and meeting discussion.

Relevant external projects:

- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- whisper-rs: https://codeberg.org/tazz4843/whisper-rs
- tauri-plugin-whisper-rs: https://crates.io/crates/tauri-plugin-whisper-rs
- Hyperaudio Lite: https://github.com/hyperaudio/hyperaudio-lite
- Council Data Project backend: https://github.com/CouncilDataProject/cdp-backend
- Speakerbox: https://github.com/CouncilDataProject/speakerbox
- OpenCouncil: https://github.com/schemalabz/opencouncil

### 9.10 Publishing

The app must publish clean, professional static output.

Required outputs:

- Homepage.
- Article pages.
- RSS.
- About page.
- Ethics/how-we-report page.
- Corrections page.
- ZIP package.
- Newsletter markdown.
- Substack-ready markdown.
- Social/community post copy.
- Manifest.
- Publish receipt.

Publishing targets:

- here.now quick publish.
- Local ZIP.
- GitHub Pages.
- Netlify.
- Cloudflare Pages.
- WordPress if kept.
- Assisted/manual URL recording.

Local LLM use:

- Issue lineup suggestion.
- Headline alternatives.
- Newsletter summary.
- Social package generation.
- Public-output cleanup warnings.

### 9.11 Public Site Customization

The publisher must control identity and language.

Configurable fields:

- Publication name.
- Publisher/editor name.
- Organization type.
- City/state.
- For-profit/nonprofit/individual/community group/private organization.
- Logo.
- Masthead.
- Theme/accent.
- Footer.
- AI disclosure language, if any.
- Ad policy language, if any.
- Editorial mission language.

The app must not invent claims such as:

- No ads.
- Public-record-only.
- All stories are AI-assisted.
- Nonprofit status.
- Specific publisher identity.

Local LLM use:

- Suggest neutral copy based on publisher settings.
- Warn when public copy includes unsupported claims.

### 9.12 Durable Tasks And Recovery

The app must track long-running work as durable tasks.

Task types:

- Source discovery.
- Source fetch.
- Civic-scraper run.
- Import.
- Model setup.
- LLM task.
- Draft generation.
- Verification generation.
- Transcription.
- Export.
- Publish.

Task statuses:

- Queued.
- Running.
- Paused.
- Failed.
- Retryable.
- Completed.
- Canceled.

Local LLM use:

- Summarize task failures in plain language.
- Suggest next recovery step.

Relevant external reference:

- OpenCouncil task architecture: https://github.com/schemalabz/opencouncil

### 9.13 Documentation And Support

The app must include complete documentation for non-technical users.

Required docs:

- Install guide.
- First issue walkthrough.
- Source setup guide.
- Editor workflow guide.
- Local AI/model setup guide.
- Publishing guide.
- here.now guide.
- Troubleshooting.
- Known limitations.
- Press-freedom advisor explanation.
- Bug report instructions.

Local LLM use:

- Optional in-app help explanations.
- Error explanation.
- Support bundle summarization.

Relevant governance reference:

- mySociety AI Framework: https://ai-framework.mysociety.org/

## 10. Technical Architecture

### Existing Core

- Frontend: React and TypeScript.
- Desktop: Tauri 2.
- Backend: Rust.
- Database: SQLite via `rusqlite`.
- Async runtime: Tokio.
- HTTP: reqwest and Axum.
- Publishing: Rust static compiler and ZIP output.
- Local AI: Ollama-compatible runtime.

### Proposed Core Additions

Local intelligence service:

- Rust module: `local_ai`.
- Prompt registry.
- Typed operations.
- Model/runtime health checks.
- Timeout/retry/cancel.
- JSON schema validation.
- Task logging.

Durable task service:

- Rust module: `tasks`.
- SQLite-backed task ledger.
- Frontend progress subscriptions.
- Retry/reprocess APIs.

Source intelligence service:

- Rust module: `source_intake`.
- Platform detection.
- Source labels.
- Big Local News sidecar runner.
- Snapshot store.

Novelty service:

- Rust module: `novelty`.
- Text normalization.
- Hashing.
- Diffing.
- LLM semantic change summary.
- Lead clustering.

Editorial service:

- Rust module: `editorial`.
- Story templates.
- Prompt configuration.
- Draft lifecycle.
- Public-output checks.

Verification service:

- Rust module: `verification`.
- Claim extraction.
- Evidence matching.
- X-Ray integration.
- Advisor task generation.

Meeting media service:

- Rust module: `meetings`.
- Whisper integration.
- Transcript storage.
- Segment linking.
- Public transcript export.

## 11. External Integration Catalog

Direct dependency or sidecar candidates:

- Big Local News civic-scraper: https://github.com/biglocalnews/civic-scraper
- Open Civic Data Legistar scraper: https://github.com/opencivicdata/python-legistar-scraper
- Open Civic Data division IDs: https://github.com/opencivicdata/ocd-division-ids
- Free Law X-Ray: https://github.com/freelawproject/x-ray
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- whisper-rs: https://codeberg.org/tazz4843/whisper-rs
- tauri-plugin-whisper-rs: https://crates.io/crates/tauri-plugin-whisper-rs
- Hyperaudio Lite: https://github.com/hyperaudio/hyperaudio-lite
- Datasette: https://github.com/simonw/datasette
- sqlite-utils: https://github.com/simonw/sqlite-utils

Pattern/reference only unless licensing is resolved:

- AP Brainerd: https://github.com/AssociatedPress/local-ai-brainerd-dispatch
- AP KSAT: https://github.com/AssociatedPress/local-ai-ksat
- AP El Vocero: https://github.com/AssociatedPress/local-ai-el-vocero
- Dangerzone: https://github.com/freedomofpress/dangerzone
- DocumentCloud: https://github.com/MuckRock/documentcloud
- OpenFOIA: https://github.com/JordanCoin/openfoia
- BBC Citron: https://github.com/bbc/citron

Architecture/study references:

- OpenCouncil: https://github.com/schemalabz/opencouncil
- Council Data Project backend: https://github.com/CouncilDataProject/cdp-backend
- Speakerbox: https://github.com/CouncilDataProject/speakerbox
- OpenFactVerification/Loki: https://github.com/Libr-AI/OpenFactVerification
- JournalismAI quote extraction: https://github.com/JournalismAI-2021-Quotes/quote-extraction
- DocMind AI: https://github.com/BjornMelin/docmind-ai-llm
- civic-ai-tools: https://github.com/npstorey/civic-ai-tools
- Querido Diario: https://github.com/okfn-brasil/querido-diario
- CourtListener: https://github.com/freelawproject/courtlistener
- Juriscraper: https://github.com/freelawproject/juriscraper

## 12. V1 Success Metrics

Product quality:

- A clean machine can produce a complete local issue.
- At least 5 usable reader-facing items are produced in a realistic city test with human review.
- Duplicate/stale story rate is low enough that the editor is not fighting the tool.
- Public output contains no scaffolding artifacts.

Workflow quality:

- Editor can recover held, cut, and send-back drafts.
- Verification tasks are understandable.
- Source review is clear.
- Long-running tasks report progress.

Technical quality:

- Local AI works or degrades clearly.
- Big Local News integration is tested.
- Backup/restore works.
- Upgrade from older beta DBs works.
- here.now and ZIP publishing work.

Trust quality:

- No AI or advisory warning vetoes publication; visible deterministic package-integrity blockers can stop export until broken public output is repaired.
- AI/editorial warnings are advisory.
- Publisher identity and disclosure language are configurable.
- Docs are honest about limitations.

## 13. Major Risks

Story quality risk:

Adding more source volume before story-quality gates will produce more weak stories faster.

Mitigation:

Build novelty, clustering, story templates, and editor workflow before Big Local News expansion.

Licensing risk:

Some high-value references are GPL or AGPL.

Mitigation:

Use them as patterns unless project licensing strategy changes.

Local model quality risk:

Small local models may produce weak prose or weak analysis.

Mitigation:

Use deterministic preprocessing, structured prompts, story templates, verification tasks, and editor review. Do not rely on the model alone.

Installer risk:

Unverified installer provenance will scare some users.

Mitigation:

Explain the public-beta status clearly and verify installer signing before release.

Source reliability risk:

Public sites change.

Mitigation:

Use sidecar scrapers where available, durable task failures, source review, and clear degraded modes.

## 14. Open Questions

- Which local model should be default for v1.0.0 on 8 GB, 16 GB, and 32 GB machines?
- Should Big Local News sidecar be bundled, downloaded during setup, or installed as a managed Python environment?
- Which platforms are officially claimed at v1.0.0: Windows only, Windows plus macOS, or Windows/macOS/Linux?
- Should transcript workflow be required for v1.0.0 or allowed as a post-1.0 feature?
- Should Datasette-style public evidence archive be included in v1.0.0 or kept as a later transparency feature?
- What publisher identity defaults should setup provide without making editorial claims for the user?
