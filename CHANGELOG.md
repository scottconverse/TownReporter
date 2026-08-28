# Changelog

Current release: **0.4.1**.

## 0.4.1 — 2026-08-27

Dark hops belong to the file. Jobs finish after the click even if this program goes to sleep.

- After the desk is claimed, `/login` is sign-in only. Paper top-right **Create editor** only while nobody owns the desk. **Leave as editor** on the desk drops the owner, signs them out, and puts Create editor back. The paper stays. Next person in owns it. Signed-in but not the editor sees the desk is taken, not an empty Scan page.
- Dark Desk hops (frontier, captures, search log, claims) are the file's, not whoever opened it. A later editor on the same newsroom continues the trail. Who clicked is still stored.
- Scan, Draft, and Keep digging still write a job and return. A wake-up finishes waiting jobs: the same monitors ping (`GET /api/cron/monitors` with `CRON_SECRET`), and this long-lived process also drains on its own. A frozen serverless host needs that ping. Documented.

Not in 0.4.1: real OCR, city picker, mailer, invite a second editor.

## 0.4.0 — 2026-08-27

Hardening. Trustworthiness and lifecycle, not a redesign.

- One newsroom row; members carry `newsroom_id`. Two concurrent first users can no longer both become owner. Desk and Dark lists are keyed by that id. Investigate hops still write as the editor who opened the file.
- `NEWSROOM_SETUP_TOKEN`: when set, creating an account does not own the desk until the token is presented. Preview with the token unset is still first-account-owns.
- Chromium aborts subrequests to private/LAN/metadata addresses. Cron with no `CRON_SECRET` is disabled.
- Captures store extracted vs raw hashes when bytes exist. Public provenance cannot be minted by the model for a URL we did not fetch.
- Image-only PDFs are unread. JPEG-as-chat is not OCR.
- Scan, Draft/Redraft, and Keep digging enqueue a persisted job and return. The UI watches `desk_jobs` / unfinished `scan_runs` / `investigating`. The drain is in-process — it runs on a long-lived Node host, not on a frozen serverless function.
- Dark Start no longer dumps the last 16 snapshots into the file. Command-center Start digging continues into research. Keep digging / Set aside disabled while a round runs.
- Redraft saves Pulled notes first. Killed has Back. Queue All excludes killed. Send-to-queue is idempotent with a real topic.
- Corrections render on the article, timestamped. Published correction errors are errors.
- Source URLs are links; kind/tier inferred from the host. Nested button-in-link removed. Forced-night Dark Desk hides the Light switch. Newsletter promise removed. GitHub tag is the source download.
- Filing a lead fills the workbench even when the first draft body is empty.
- One Playwright lifecycle path in CI: create the desk → file a lead → publish → correction on the article. `npm run typecheck` and GitHub Actions on test+types.
- Longmont edition. No mailer. No city picker. OCR is still unread-image, not an engine.

## 0.3.9 — 2026-08-26

Designer pass. Paper search and newsletter inputs have borders again. Version leaves the desk masthead. Pulled notes uses the same does-not-print chip as reporting notes. Publish keeps pulled notes. Dark Desk noticed list caps; Start digging errors stay on one surface.

## 0.3.8 — 2026-08-26

Start digging no longer swallows a failed open. The card stays put, says so, and you can click again. A previous click that died on the cookie glitch had hidden the card for the rest of the session.

## 0.3.7 — 2026-08-26

Redraft no longer dies on a sign-in cookie glitch (`Cannot destructure property 'setCookie'`). You stay signed in; the click can finish.

## 0.3.6 — 2026-08-26

Draft with AI actually reports. Still-to-pull lines can be pulled into a paste box.

- Research looks for the named company’s or agency’s own press release / newsroom page before it settles for another paper’s rewrite. A Leader listing is a lead, not the story.
- Every load-bearing number, name, date, and quote is supposed to land as a claim with a URL in notes (primary document, official record, or credited news).
- On the workbench, **Pull** next to a still-to-pull line searches that item and drops the excerpt into **Pulled notes** under the story — cut and paste, does not print. Redraft reads that box.
- A missing company announcement becomes a still-to-pull line instead of a silent hole.

## 0.3.5 — 2026-08-26

Draft with AI paints the workbench when the writing pass finishes, even if the click already died.

- The workbench no longer stops looking after two minutes. It polls until a body is actually on the lead, then fills headline / dek / body without a reload.
- The click returning the finished draft writes it straight into the form. A dropped connection is not treated as "nothing happened."
- The "Drafting…" state stays up and keeps checking. Reload is not required.

## 0.3.4 — 2026-08-26

Draft with AI no longer looks empty when the server already wrote. Credit the originating newsroom with a story URL, not a homepage.

- Workbench polls while Draft with AI is in flight. A gateway timeout no longer leaves a blank form; the draft appears when it lands, without a reload. A real failure says so and asks you to click again — not Dark Desk “Keep digging.”
- One draft click is budgeted so the writing pass usually finishes before the request dies. Extra fetches that would hang are skipped; a matching article URL is still followed.
- A listing page (homepage, `/local-news`) yields article URLs. When a draft hangs on another newsroom, the body names them and links the exact story. A homepage is not a story URL. If only a listing remains, notes ask for the full URL instead of paraphrasing their legal claims as TownReporter’s.
- Printed stories render those markdown links.

## 0.3.3 — 2026-08-26

Longmont edition cleanliness. Dates, cadence, and the printed paper all stay on Mountain Time and stop repeating themselves.

- Masthead, bylines, and desk clocks use `PAPER.timezone` (`America/Denver`). A Wednesday evening in Longmont no longer prints as Thursday UTC.
- Meeting-cadence math (`nthWeekday`, usual weekday) uses Denver, not the host clock.
- The public paper and RSS collapse overlapping printed headlines and keep the longer body. Quiet-zone ×2 and survey ×2 drop; Airport Vision (Sept 26) stays next to the Boulder County joint session (Sept 21). Search is unchanged. Archive URLs stay live.
- Desk sources table no longer forces `display:block` on every table. On a phone the rows stack instead of shoving a 674px THEAD sideways.
- Desk chrome says `Editor's desk — Longmont` from `PAPER.city`.

## 0.3.2 — 2026-08-26

Product documentation. Clone-and-run was not a product.

- Full README: pitch, disclaimer, two rooms, how it works, city swap, FAQ.
- Operator manual: `docs/setup.md` — Node 22, env, Playwright, Postgres, gateways, Vercel limits, second editor, city swap via `paper.ts`.
- Editor manual: `docs/editor.md` — login through publish, meetings/tapes (captions are not minutes), Dark Desk piles, corrections.
- Marketing landing: `docs/index.html` (cream / ink / rust) for GitHub Pages from `/docs`. `docs/.nojekyll`. Enable Pages: Settings → Pages → branch `main` / `/docs`.
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
