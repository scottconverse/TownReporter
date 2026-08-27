# Changelog

## 0.3.2 — 2026-08-26

Product documentation. Clone-and-run was not a product.

- Full README: pitch, disclaimer, two rooms, how it works, city swap, FAQ.
- Operator manual: `docs/setup.md` — Node 22, env, Playwright, Postgres, gateways, Vercel limits, second editor, city swap via `paper.ts`.
- Editor manual: `docs/editor.md` — login through publish, meetings/tapes (captions are not minutes), Dark Desk piles, corrections.
- Marketing landing: `docs/index.html` (cream / ink / rust) for GitHub Pages from `/docs`. `docs/.nojekyll`.
- `package.json` `engines.node` `>=22`.

## 0.3.1 — 2026-08-26

Self-host pack. Clone it, run it, point it at Grok or any OpenAI-compatible gateway.

- MIT license. `.env.example`. README is a clone-and-run.
- Grok (`XAI_API_KEY`) is the default model.
- `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` is any `/v1/chat/completions` gateway: LiteLLM, Bifrost, Helicone, MLflow AI Gateway, Kong AI Gateway, Ollama, OpenAI, OpenRouter. No extra package. Bifrost must not bind port 8080 (TownReporter).
- Self-host desk: email + password on `/login`. Grok Google/X buttons only on `*.grok.me`.
- `npx playwright install chromium` for meeting transcripts and JS civic sites.
- `.env` is loaded by the dev wrapper.

## 0.3.0 — 2026-08-26

Meeting records, reporting notes, and Dark Desk actually reading the tape. Draft notebook language stays off the paper.

- **PrimeGov.** `longmont.primegov.com` is a watched official source. Catalog comes from the public JSON API (upcoming + archived), not Crawl4AI. Agenda/packet/minutes PDFs are separate records via `CompiledDocument`. YouTube titles join the matching meeting (206 S. Main ↔ Avis notice; council 08/25/2026 ↔ that packet). Minutes not posted after 36 hours is a catalog note.
- **YouTube meetings.** Channel page is a catalog. Full timestamped transcripts live on each watch URL (Show transcript; no 12k slice). Upcoming livestreams stay listed with no fake transcript and are rechecked every 6 hours. `@LongmontPublicMedia` is the second tape; same-meeting titles are merged; if the city tape has no captions we use theirs.
- **Dark Desk.** Planner no longer feeds the first 1,800 characters of a five-hour tape (hold music). Retrieval picks the vote, the aside, “skip it all.” Captions are a map, not minutes; names may be wrong; quotes need a check.
- **Reporting notes** on the story workbench (designer 2): to-dos strike/restore, human lines tagged “yours,” add-a-line, research memo persists across redrafts and never prints.
- Draft with AI strips reporter-notebook leftovers (`What is solid`, `Next checks are…`) from the story body.
- Playwright civic hosts now include PrimeGov. SSR export patch after build. Site walkthrough script checked in.

## 0.2.5 — 2026-08-26

Playwright render path for JavaScript civic sites. Simple GET remains the default.

- After SSRF checks, HTML that is an app shell (Municode IE9 page, empty `#root`, “enable JavaScript”) is opened in headless Chromium. The captured copy is the rendered text, not the sorry-page.
- Known JS hosts (Municode, eCode360, Granicus, Legistar, CivicClerk, BoardDocs, CivicPlus, American Legal) always try the browser.
- PDFs and ordinary static city pages stay on the existing GET. Playwright is skipped when it is missing or still returns a shell.
- Fetch User-Agent is a current Chrome string plus TownReporter/1.0.

## 0.2.4 — 2026-08-26

Dark Desk open file puts captured records first. Designer brief checked in. Investigative engine unchanged.

- “34 records on file” is no longer a count with nowhere to click. The open file leads with **What to read**: title, excerpt, Open original, Read captured copy.
- Empty “What we know / testing / questions” sections stay hidden.
- Still unopened is labeled as not-yet-fetched, not the reading list.
- Designer handoff: `docs/dark-desk-editor.md`.

## 0.2.3 — 2026-08-26

Dark Desk editor language and desk piles. Investigative engine unchanged.

- A round of research is five short passes, then a stop. Remaining pages, names, and documents stay on the file. That stop is not a failure and not “too many leads.”
- Editor copy no longer uses hop, frontier, or research-budget jargon. Status, progress, findings, and run logs are plain English.
- Dark Desk is three piles: To look at (not opened yet), On the desk (started, including files that stopped with more to read), Set aside (parked or finished, pull back anytime).
- Start digging moves a card off To look at and onto the desk. Close file leaves it on the desk. Set aside files it. Pull back restores it.
- On-desk files show records saved, things still unopened, and last touched. The open file is the work surface.
- Fetch and model errors no longer leak as raw TypeErrors. A hop-budget pause is not overwritten by a later model hiccup.

## 0.2.2 — 2026-08-26

Reporting breadth and evidence chronology. Dark Desk engine unchanged; editor UI rewritten.

- Four reporting lanes are allocated by lane, not array order. A four-search budget is one context, one stakeholder, one contradiction, one gap. Extra budget on explainers and investigations comes after that.
- A prospective brief is challenged once (attachments already followed, one context/contradiction search, beat memory) before the classification sticks. Money, history, a changed timeline, affected people, contradiction or a missing record promote it to reported and the normal lanes run. A genuine small item stays a brief.
- Story form follows the reporting that exists. It does not control what the system is allowed to discover.
- “What TownReporter found” requires a published source URL and a specific captured version or capture event. A URL match alone is not enough. Unbound hypotheses stay in the newsroom.
- Public evidence history is capture chronology (`capture_events.observed_at`), not unique content versions. Repeated observation of the same bytes is kept. A missing check is an event. A revert compares B → A when A is what TownReporter last saw.
- Public evidence is scoped to source URLs cited in a published story, not a door into the evidence store.
- Original-bytes language no longer implies a download the page does not provide.
- Dark Desk editor UI: Worth a Look cards use headlines, not raw URLs. Start digging opens an investigation immediately and shows progress on the card while hops run. Results live in an investigation workspace (what started this / what we know / what Dark Desk found / next leads / evidence). API errors such as 403 are translated. Research log is behind a disclosure. The investigative engine is still non-gating.

## 0.2.1 — 2026-08-26

Evidence hardening on the path from capture → reporting → story → proof. Dark Desk engine unchanged.

- Paragraph collapse requires near-equivalence. A richer paragraph with new numbers, names, dates, quotes or consequences is kept.
- Rewrite detection is near-verbatim n-gram reuse of the announcing source, not bag-of-words overlap with the evidence. Grounded reporting is not auto-downgraded to a brief.
- Reported stories run four research lanes before writing: context/precedent, stakeholders/impact, alternative/contradiction, gap filling. Briefs skip extra lanes.
- The writer is fed retrieved evidence chunks (cost, dates, amendments, contradictions), not only document prefixes. Context limits belong in retrieval.
- Provenance merges field-by-field. Capture timestamps/version IDs win forensically; blank capture rows do not wipe title, organization, date or role.
- Public captured-version and compare-versions routes. Only records already cited in a published story are visible.
- “What TownReporter found” is a structured finding. The public module renders only when source URLs or version IDs resolve against published provenance.
- Worth a Look is open-ended: every open/reopened frontier item is eligible. Known patterns get ranking bonuses. Ranking is not a gate.
- First signed-in user remains owner. A second identity is not auto-granted editor.

## 0.2.0 — 2026-08-26


The public record is only the beginning. Stories are researched before they are written. Dark Desk opens on things worth examining.

- Drafting is a reporting pass, not a rewrite of the announcing source. Research follows attachments, named records, and prior meetings; consecutive restatements and empty AI filler are stripped; a rewrite is cut to a civic brief.
- Reader-facing provenance: source title, organization, document date, exact URL, capture time. Homepages are not stand-ins for documents. Disappeared sources say so. Multiple versions: Compare versions. Distinctive finds: What TownReporter found.
- Paper positioning: independent civic reporting for Longmont; “Civic news, human-edited” is supporting trust language. About and How we report describe watch → detect → follow → preserve → investigate → write, then a human gate.
- Dark Desk is an investigative desk UI. Worth a look ranks missing reports, disappeared records, monitor alerts, reopened trails, open promises, and high-newsworthiness leads. Three starts: Find something to dig into, Investigate a lead, Keep digging. Investigation view: what we know / testing / found / trail / open questions / leads / dead ends / evidence. The investigative engine is unchanged.

## 0.1.0 — 2026-08-26

First tagged release. Civic paper + editor desk for Longmont. Scan up to 200 sources. Dark Desk investigates without using uncertainty as a stop.

- Dark Desk does not gate on unknown classification, unresolved identity, missing provenance, weak sources, contradictions, or low confidence. Those states are recorded; the next hop still runs.
- Exhausted / dead-end frontier items reopen on materially new evidence. Prior status, reason, timestamp, and search history stay on the record.
- One zero-result query is not exhaustion. Remaining strategies continue. Failed providers fall through DuckDuckGo → Bing → Brave → Wikipedia.
- Hop budget pauses remaining work (`paused` + `pause_reason`). Continue digging resumes leftover URLs. Evidence exhaustion closes a path; budget does not.
- Production OCR: native PDF text, then Grok vision on embedded JPEGs, then optional tesseract.js. `needs-ocr` does not defer the lead.
- Original artifact bytes stored (`artifact_blobs`, ≤4MB).
- Source monitors tick in the background (dev interval + `GET /api/cron/monitors`). They do not wait for an editor to open Dark Desk.
- Prompt: coordination is not automatically wrongdoing. Private citizens: no drive-by dossiers; follow material public-interest trails.
- Eight non-gating regression tests plus Bing/Brave parser coverage.
