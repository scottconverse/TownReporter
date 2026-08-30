# UI/UX Deep-Dive — TownReporter 0.5.1

**Audit date:** 2026-08-29
**Role:** Senior UI/UX Designer
**Scope audited:** Full product — public paper (`/`, `/about`, `/how-we-report`, `/corrections`, `/articles/:slug`, topic filters, archive search, `/evidence/*`, `/get-the-code`, 404s, `/feed`, `/sitemap.xml`) and the private editor's desk (`/login`, `/desk`, `/desk/sources`, `/desk/scan`, `/desk/queue`, `/desk/story/:id`, `/desk/published`, `/desk/memory`, `/desk/opinion`, `/desk/ops`, `/desk/dark`). Viewports 320 / 375 / 768 / 1440. Live instance `http://127.0.0.1:3300`, fresh database, unclaimed desk, no model provider configured.
**Auditor posture:** Balanced

---

## TL;DR

TownReporter's public paper is the most confident thing in the build: a genuinely handsome broadsheet with a coherent type system, AA-passing contrast everywhere I sampled, real empty states with real sentences in them, and a corrections loop that works end to end from desk to article to `/corrections`. The desk behind it is a different animal — it is an expert's console handed to a non-technical operator, and it leaks its own internals at exactly the moments a novice is least able to absorb them. The single most damaging pattern is that **the product knows it cannot do its central job and does not say so until the user has already committed**: with no model provider configured (a real first-run state), `/desk` and `/desk/queue` cheerfully invite "run the first scan", and `Draft with AI` spins for 36 seconds before returning a message that tells the only human present that fixing it "is an operator job." Second is raw internals reaching users: a reader-facing URL renders a Postgres error as the page body, and Dark Desk prints unresolved template placeholders as card headlines. Fix those two families and this is a product that punches far above a solo-operator tool.

## Severity roll-up (UX)

| Severity | Count |
|---|---|
| Blocker | 0 |
| Critical | 3 |
| Major | 10 |
| Minor | 13 |
| Nit | 3 |
| **Total** | **29** |

## What's working

- **The delete confirmation is best-in-class.** `/desk/published` → `Delete` expands to: *"This takes it off the paper. Its URL becomes a 404, the feed and the sitemap drop it, and anyone holding a link has a dead link. Its corrections go too. Consider a correction instead — that is what the paper normally does."* with `Yes, take it off` / `Keep it`. It names the consequence, names the blast radius, and recommends the better action. Most products ship "Are you sure?" — this is what good looks like. Evidence: `uiux-screens/desk-published-delete.png`.
- **Empty states are written, not omitted.** Every empty surface I reached has a human sentence: topic filter → *"No council stories yet. That beat is quiet in this edition."* with escape hatches; search miss → *"Nothing matched 'zzzznothing'"*; corrections → *"Nothing to walk back yet… we would rather look careful than look first."* Evidence: `topic-council-1440.png`, `search-noresults.png`, `corrections-1440.png`.
- **Colour contrast passes AA everywhere I measured.** I computed effective foreground/background ratios for every text node on `/`, `/about`, `/desk`, `/desk/scan`, `/desk/ops`, `/desk/dark`, `/desk/sources` in both themes. The **lowest ratio found anywhere was 5.35:1** (rust `rgb(210,118,79)` on Dark Desk brown `rgb(33,24,18)`), against a 4.5:1 requirement. This is unusual and deserves credit. (Script: `uiux-screens/_contrast.mjs`.)
- **Focus is visible and tab order is logical.** Every one of the first 14 tab stops on `/` carries a `2px solid rgb(155,41,21)` outline, and the order runs skip-link → masthead → nav → search → desk → topic chips exactly as read. A skip link (`Skip to stories` / `Skip to desk`) exists on both surfaces.
- **`prefers-reduced-motion` is genuinely honoured** — three separate media blocks in `src/styles.css` (lines 385, 838, 901), including a global animation/transition kill and specific handling for the `.busy-rule` and `.ink-dot` animations.
- **No horizontal overflow at any viewport tested.** `scrollWidth === clientWidth` on all 14 routes at 320, 375, 768 and 1440. Mobile nav wraps into real rows rather than being a squashed desktop bar.
- **The corrections loop actually closes.** Posting a correction from the desk put a dated note on the article *and* on `/corrections` *and* linked both directions. Evidence: `article-with-correction.png`, `corrections-populated.png`.
- **Guardrails on destructive/incomplete submits are real.** `Publish to the paper` is disabled with an empty body; `Publish correction` is disabled with empty correction text; `Add` on reporting notes is disabled when empty. The product does not let you fire an empty action.
- **The voice.** *"We would rather look careful than look first."* *"It digs; it never prints."* *"This is the expensive button, not a loop."* When this product writes prose for humans it is better than almost anything in its category. The findings below are mostly places where that voice stopped and an engineer's voice took over.

## What couldn't be assessed

- **Any AI-dependent output** — scan results, AI-drafted stories, the Opinion desk's editorials. No model provider is configured on this instance (a real first-run state, and itself the subject of UX-002). I audited the *failure* states of these flows thoroughly; I could not audit their success states.
- **The Claude Code CLI Opinion path** — `/desk/opinion` correctly reports the CLI is missing and disables its button. Its populated state is unreachable here.
- **A real screen-reader pass.** I verified programmatic labelling, landmarks, `lang`, heading structure, and accessible names by DOM inspection; I did not drive NVDA or VoiceOver. Findings tagged Accessibility below rest on measured DOM/computed-style evidence, not on listening.
- **Production hosting behaviour.** `/desk/ops` reports on `https://townreporter.org`; per the audit boundary I did not visit it and cannot say whether that panel is accurate — only that this dev instance's Server page reports on an address that is not this instance.

---

## First impressions

Loading `/` cold: this reads as a newspaper, immediately and without trying too hard. The masthead is centred, the display serif is confident at 36px, the cream `#F6F1E7` ground is warm without being twee, and the standfirst — *"The public record is only the beginning"* — tells me what this is in about two seconds. That is faster than most local-news sites manage.

Then my eye goes wrong. The nav rule, the topic chips and the section rules all span ~980px, but the actual story column is capped around 670px and left-aligned inside it, so from 1100px up there is a wide, permanently empty right-hand gutter with hairline rules running out into nothing. It reads less like a deliberate single-column broadsheet and more like a layout that lost its second column.

The top-right control says **CREATE EDITOR** in a black chip — the highest-contrast, most button-like element on a public news page, offering a passing stranger ownership of the newsroom. It is honest about the unclaimed state, and it correctly becomes **SIGN IN** once claimed. But on first run it is the loudest thing on the page, and it is not the thing a reader came for.

The one story on the page is the seeded welcome article, printed in full above `Continue reading`. Its internal section headings — *What we cover*, *What we will not do* — render as bare run-on lines with no weight, size or spacing change, so the front page of every fresh install is a ~300-word grey slab. First impression of the writing: excellent. First impression of the typesetting of that writing: it looks unfinished.

Signing up is clean. Four fields, wrapped labels, a real sentence explaining the stakes (*"First person in owns the newsroom"*), and — a nice touch — *"If you already created an account, submit again with the same email and password — we will sign you in."* Ten seconds later I was on the desk.

## Journey walkthroughs

### Journey A: Reader arrives → reads a story → checks the record

`/` → lead story → `Continue reading` → `/articles/:slug` → `Corrections` → back. This works. The archive search (magnifier in the nav) expands inline, submits on Enter to `?q=`, and returns either results or a written miss state. Topic chips filter and offer their own escape hatches. 404s on both a bad route and a bad article slug are designed pages with copy, not stack traces.

Two things break the reader's trust, both about *sources*. The front page promises **"Sources shown."** in its standing blurb. I published a story whose lead carried a source URL — and the published article shows no sources section at all (UX-005). And `/corrections` instructs readers: *"To flag an error, write the editor from the About page"* — `/about` contains no email address, no form, no contact of any kind (UX-006). The paper's two accountability promises both end in a wall.

Poking one URL further, `/evidence/<any-non-numeric-id>` drops the entire site chrome and renders `invalid input syntax for type integer: "NaN"` as the page body (UX-001).

### Journey B: New operator claims the desk → tries to produce a story

`/login` → create account → `/desk`. The desk index is a three-column command centre with the queue empty, Dark Desk empty, the wire empty, and roughly two-thirds of a 1440×900 screen blank below the fold line. The first-run affordances are `run the first scan` and `file a lead`, both rendered as 12.5px italic inline links.

I clicked **Run scan**. After ~2 seconds:

> **The desk cannot scan yet.**
> No model is set up yet. Either sign in to Claude Code on this machine, or set ANTHROPIC_API_KEY, or point LLM_BASE_URL at any OpenAI-compatible endpoint — a local model counts. See docs/setup.md. Nothing is spent until one of those answers.
> *AI is not available. Set ANTHROPIC_API_KEY for Claude (default), or XAI_API_KEY for Grok, or LLM_BASE_URL for any OpenAI-compatible gateway (LiteLLM, Bifrost, Helicone, MLflow, Kong, Ollama).*

Three stacked messages saying the same thing, the third of which is a developer's environment-variable dump ending in a list of seven gateway product names. For the stated user — one non-technical local journalist — this is the moment the product becomes opaque.

I filed a lead by hand instead. That works well: the `<details>` disclosure, four sensible fields with real placeholder prompts (*"Why this is news in Longmont today"*), and on submit it lands directly in the story editor at `/desk/story/1`. Good.

In the story editor I clicked **Draft with AI**. It went busy — *"Reporting first — following the trail, then drafting. Stay on this page."* — and stayed busy for **36 seconds**, then returned:

> The writing model is not set up on this machine. Nothing you click will fix it — that is an operator job.

The desk already knew this before the click (the Scan page had said so). It spent 36 seconds of the user's attention to tell them something it could have told them before they clicked, and it told them to escalate to an operator who is the person reading the sentence (UX-002).

I typed the story myself, saved (`Saved.` — good), and published. **Publishing to a public website took one click with no confirmation** — in a product whose entire premise is that a human deliberately decides what prints, and whose Delete button gives a model paragraph of consequence (UX-008).

Post-publish confirmation is excellent: *"On the paper. See it under Published · Read it on the paper"* with both links live.

### Journey C: The investigative lane

`/desk/dark` is the most ambitious screen in the product and the one furthest from ready for a lay reader. The framing is strong — three piles, "It digs; it never prints", a settings panel with `DIG` / `NERVE` sliders and four named presets whose explanations are genuinely delightful (*"Black Sky — Follows a trail until it dies, anywhere in the region."*).

Then it fills with placeholder text. After clicking `Check r/longmont`, the "To look at" pile held 11 cards. Card titles included **"linked from"** and **"Discovered this hop — fetch next"** — verbatim internal template strings used as headlines. Every card's two summary lines read **"Why it matters — linked from"** and **"What changed — linked from"**: label, em-dash, placeholder. Several cards were exact duplicates, and one is titled *"Test utility 2023 annual reliability benchmarking report"* (UX-003).

### Journey D: The operator keeps the lights on

`/desk/ops` is a strong idea — a plain-language health panel with named actions, each carrying a consequence sentence and a duration estimate, and an explicit note that the two interrupting actions "ask twice". The honesty is exemplary (*"Read from this machine, so it can tell you the tunnel is routing but not that a reader in another town can reach you"*).

Two cracks. The watchdog row reads **"ran 3s ago · exit 267009"** with the status chip `CHECK` — a raw process exit code and no indication of what a non-technical operator should do (UX-019). And **"Recently deleted — Anything deleted from the desk waits here for 30 days"** said *"Nothing deleted."* immediately after I had dropped a source from the watch list, which vanished with a single unconfirmed click and no undo (UX-007).

---

## Findings

> **Finding ID prefix:** `UX-`

### [UX-001] — Critical — State — A reader-facing URL renders a raw Postgres error as the page

**Evidence**
`http://127.0.0.1:3300/evidence/00000000-0000-0000-0000-000000000000`, 1440×900. HTTP 500. The site chrome is gone entirely; the page is a centred block reading `TOWNREPORTER` / **Something went wrong** / `invalid input syntax for type integer: "NaN"` / `Back to the paper`. Console also logs the same message as an uncaught `Error`. Screenshot: `uiux-screens/evidence-bad-1440.png`. Compare `/evidence/compare`, which handles its own empty case gracefully (*"Nothing to compare — version comparison is only available for records cited in a published story."*), and `/articles/no-such-article`, which returns a designed 404.

**Why this matters**
Evidence URLs are the public proof surface of a paper whose entire pitch is *"we show the exact documents we used."* Any reader who follows a stale, truncated, or mistyped evidence link — or any crawler, or anyone pasting a link into a chat app that mangles it — lands on a database internals message. For a civic-accountability outlet, "the receipts page threw a SQL error" is a credibility event, not a cosmetic one. It also discloses the storage type of an internal identifier to anyone probing.

**Blast radius**
- Adjacent code: `src/routes/evidence.$versionId.tsx` parses the route param into an integer without validating it. `src/routes/desk.story.$leadId.tsx` and `src/routes/desk.story.draft.$draftId.tsx` take the same shape of numeric route param and should be checked in the same pass. The generic error boundary that renders `Something went wrong` passes `error.message` straight through — that boundary is the real fix site, since it will surface *any* server exception verbatim on *any* route.
- Shared state: whatever root `errorComponent` the router mounts; the 404 path already has good copy that this route should reuse.
- User-facing: bad evidence IDs become a designed "that record is not in this edition" page instead of a 500.
- Migration: none.
- Tests to update: none known — there is no test asserting the current message.
- Related findings: UX-014 (raw `Invalid URL` string), UX-019 (raw `exit 267009`). Same root cause: internal strings pass through to users unfiltered.

**Fix path**
Two changes. (1) Validate the route param — if it is not a positive integer, render the existing "not in this edition" 404 component rather than querying. (2) Stop printing `error.message` in the shared error boundary. Replace with a fixed string and log the detail server-side:

> **That record is not in this edition**
> The evidence page you asked for is not something this paper has on file. It may have been part of a story that was taken down, or the address may be wrong.
> [Back to the paper] [Search the archive]

---

### [UX-002] — Critical — Journey — The desk hides its own unconfigured state until after the user commits

**Evidence**
Fresh instance, no model provider (a documented first-run state).
- `/desk` invites *"Queue is empty — run the first scan or file a lead"* and offers a `Run scan` button. No warning of any kind. Screenshot: `uiux-screens/desk-index-1440.png`.
- `/desk/queue` invites *"run the first scan or file a lead"*. No warning.
- `/desk/scan` describes the pass and offers `Run scan` as an active dark primary. No warning until clicked. Screenshot: `uiux-screens/desk-scan-after.png`.
- On click, three stacked messages appear, the third reading verbatim: *"AI is not available. Set ANTHROPIC_API_KEY for Claude (default), or XAI_API_KEY for Grok, or LLM_BASE_URL for any OpenAI-compatible gateway (LiteLLM, Bifrost, Helicone, MLflow, Kong, Ollama)."* The `Run scan` button remains enabled and dark afterwards.
- `/desk/story/1` → `Draft with AI` shows a busy state (*"Reporting first — following the trail, then drafting. Stay on this page."*) for **36 seconds** (measured by polling at 6s intervals: busy at 6/12/18/24/30s, resolved between 30s and 36s) before returning *"The writing model is not set up on this machine. Nothing you click will fix it — that is an operator job."* Screenshots: `desk-story-drafting-30s.png`, `desk-story-draft-resolved.png`.

**Why this matters**
Scan → lead → draft → publish is the product's whole reason to exist, and on a fresh install none of it runs. The user is a single non-technical journalist; there is no separate operator to escalate to, so *"that is an operator job"* is a dead end addressed to nobody. The user pays 36 seconds of attention plus a spinner's implied promise to receive information the app held before the click. `See docs/setup.md` is a file path on a machine the user may never have opened a terminal on, and it is not a link. The net effect on a first-run session is: the newsroom looks alive, invites you to start, and then tells you in developer vocabulary that you cannot.

**Blast radius**
- Adjacent code: every AI entry point shares this shape — `/desk/scan` (Run scan), `/desk/story/:id` (Draft with AI, Redraft), `/desk/opinion` (already does this correctly — it disables the button and explains, and should be the template), `/desk/dark` (Keep digging / Write the brief). The provider-availability check exists somewhere already, since the Scan page can report it; it needs to be lifted into a shared, cached readiness state that the desk shell reads on mount.
- Shared state: whatever resolves `ANTHROPIC_API_KEY` / `XAI_API_KEY` / `LLM_BASE_URL` / Claude Code CLI presence. The three redundant messages suggest at least two layers each produce their own copy — collapse to one.
- User-facing: the desk gains a first-run banner; AI buttons become disabled-with-reason instead of enabled-then-failing; the 36-second wait disappears.
- Migration: none.
- Tests to update: none known — I found no test asserting the current behaviour.
- Related findings: UX-012 (desk hierarchy generally), UX-017 (disabled without a reason), UX-013 (first-run content).

**Fix path**
1. Add a persistent first-run banner at the top of the desk shell whenever no provider resolves, above the fold on every desk route:

> **The desk can watch, but it cannot write yet.**
> Filing leads, publishing, corrections and Dark Desk all work now. Scanning and AI drafting need a writing model. Setting one up is a one-time job and takes about five minutes. **[Show me how →]**

2. Disable `Run scan`, `Draft with AI` and `Redraft` while no provider resolves, each with the same one-line reason on hover/inline — never a spinner that resolves into a refusal.
3. Make `Show me how` a real in-app page, not `docs/setup.md`. Written for the journalist, one option at a time, no gateway product list:

> **Three ways, pick one.**
> **Easiest —** if you have Claude Code on this computer, sign in to it. The desk will find it.
> **A key —** paste an Anthropic API key into `.env` as `ANTHROPIC_API_KEY=…` and restart the paper from Server → Restart the paper.
> **Your own model —** if you run a model on this machine or your network, put its address in `.env` as `LLM_BASE_URL=…`.
> Nothing is spent until one of these answers.

4. Delete the third message entirely. Never show two error strings for one condition.

---

### [UX-003] — Critical — Copy — Dark Desk prints unresolved template placeholders as user-facing headlines

**Evidence**
`/desk/dark`, 1440×900, after using the page's own `Check r/longmont` and `Start digging` controls. Screenshots: `uiux-screens/desk-dark-after-Checkrlongmont.png`, `desk-dark-populated.png`. Card contents dumped from the DOM (11 cards in "To look at"):

- Card 1 title: `Appa Public Power Affordability Agenda July document`
- Card 2 title: **`linked from`**
- Card 5 title: **`linked from`**
- Card 11 title: **`Discovered this hop — fetch next`**
- Every card, both summary lines: **`Why it matters — linked from`** and **`What changed — linked from`** (cards 8–11: `Why it matters — Discovered this hop — fetch next`)
- Cards 1 and 8 are the same title; cards 4 and 9 are the same title
- Card 4 title: `Test utility 2023 annual reliability benchmarking report`

The open file on the desk is headed *"Dark Desk encountered this again while reviewing a Publicpower page"* — a sentence template with a capitalised domain fragment dropped into it.

**Why this matters**
Dark Desk is presented as the paper's investigative conscience, the lane that decides what is worth a human's time. Its primary reading surface is a stack of cards whose titles and rationale fields are internal placeholder strings. A card titled *"linked from"* whose reason for existing is *"Why it matters — linked from"* teaches the operator that this screen is noise, and the fastest way to kill an investigative tool is to make its recommendations unreadable. The duplicate cards compound it: the pile says 11 and contains perhaps 7 distinct things. And a card literally titled *"Test utility …"* appearing in a production build is the kind of thing a reader will screenshot if it ever reaches the paper.

**Blast radius**
- Adjacent code: the Dark Desk card renderer and whatever produces `whyItMatters` / `whatChanged` / `title` for a discovered node. The strings `linked from` and `Discovered this hop — fetch next` are provenance/state markers being written into content fields — the same values are used correctly elsewhere as edge labels, so the bug is a field-mapping one, not a copy one.
- Shared state: the same node records feed `/desk` (the Dark Desk panel on the command centre shows the same titles, verified at 1440 and 375) and the `Send to the queue` action, so a placeholder-titled node can become a queue lead and, in principle, a story headline. That is the path that must be closed first.
- User-facing: cards get real titles or are suppressed; pile counts become truthful.
- Migration: existing rows in this state will need backfill or suppression — a fresh DB reached this state within one session, so it is not a legacy-data problem.
- Tests to update: none known.
- Related findings: UX-026 (12 identical accessible names on the same screen), UX-022 (Beat memory duplicate rows — also a field-mapping symptom).

**Fix path**
1. Never render a node whose title is one of the known provenance markers. If a real title cannot be derived, fall back to the source document name or the URL's last path segment.
2. Treat `whyItMatters` / `whatChanged` as optional. If empty, omit the whole line rather than printing `Label — placeholder`. An honest card with one line beats a padded card with three.
3. De-duplicate the pile by resolved URL before rendering, and make the count match what is displayed.
4. Suggested empty-ish card copy when only a source is known:
   > **Appa Public Power Affordability Agenda, July 2026**
   > Found while following: Publicpower — affordability agenda
   > *Not read yet.* [Start digging]

---

### [UX-004] — Major — Journey — The source-download page's download button links to itself

**Evidence**
`/get-the-code`, 1440×900. Screenshot: `uiux-screens/get-the-code-1440.png`. The page's three links, read from the DOM:

```
'Download TownReporter.zip -> /get-the-code'
'Backup link              -> /get-the-code'
'Back to the paper        -> /'
```

Both download affordances point at the page the user is already on; the real URL is only reachable by manually copying the plain-text `https://github.com/scottconverse/TownReporter/archive/refs/tags/v0.5.1.zip` shown below the button. `src/components/source-zip.tsx` confirms the `href` is a deliberate decoy overridden by an `onClick` → `window.open`, with the comment *"href stays on-origin so this preview never navigates to a zip (gray sad face)."* `/TownReporter.zip` returns a 307 to `/get-the-code`, so the tidy URL also lands on the self-linking page. The page body reads: *"This copy is TownReporter 0.5.1. The black button opens a real browser tab. This preview cannot save files itself."* No page in the site nav links to `/get-the-code` — grep across `src/` finds references only in `source-zip.tsx` and the `.zip` redirect.

**Why this matters**
Three failures stack. (1) The page speaks in the voice of a sandboxed preview environment ("this preview") to someone running a self-hosted newspaper on their own machine — it describes a constraint that does not exist for them and reads like the page is broken. (2) Right-click → Copy link address, middle-click, "open in new tab", and any JS-off or popup-blocked context all yield the wrong destination; the popup-blocked fallback is a `window.prompt` asking the user to copy a URL, which is a 2004 pattern. (3) The page is an orphan — nothing links to it, so the only people who find it are people who guessed the URL.
**Blast radius**
- Adjacent code: `src/components/source-zip.tsx` (`SourceZipButton`, `SourceZipBackupLink`), `src/routes/get-the-code.tsx`, `src/routes/TownReporter[.]zip.tsx`.
- Shared state: `src/lib/source-zip-url.ts` holds `SOURCE_ZIP_URL` / `SOURCE_ZIP_BACKUP` — these are already the correct values, they are simply not used as `href`.
- User-facing: the button becomes a real link that behaves like a link everywhere.
- Migration: none.
- Tests to update: none known.
- Related findings: UX-013 (other seeded/preview-era copy shipping to real users).

**Fix path**
Set `href={SOURCE_ZIP_URL}` with `target="_blank" rel="noopener noreferrer"` and drop the `preventDefault` entirely — a link to a zip is exactly what an `<a>` is for. Then rewrite the page for a self-hosting reader and link it from the footer:

> **Get the source**
> This paper is running TownReporter 0.5.1. The whole thing is open — take a copy, read it, run your own.
> **[Download TownReporter 0.5.1 (.zip)]**
> Or clone it: `https://github.com/scottconverse/TownReporter`

---

### [UX-005] — Major — Journey — Published stories show no sources, while the paper's standing promise is "Sources shown."

**Evidence**
The front page blurb, present on `/` at every viewport: *"TownReporter follows Longmont's meetings, money, contracts and public records — then keeps digging when something changes, disappears or doesn't add up. Human-edited. **Sources shown.**"* `/how-we-report` reinforces it: *"Every material claim should be checkable against a document we show."*

I filed a lead carrying the source URL `https://longmont.primegov.com/public/portal` (visible on `/desk/story/1` under **SOURCES ON THE LEAD**), drafted a body, and published. The resulting article at `/articles/council-packet-posted-late-for-august-25-session` contains: kicker, headline, dek, body, corrections block, reprint notice, "Also in the paper". **No sources section, and no link to the source that was attached to the lead.** Screenshot: `uiux-screens/article-with-correction.png`. The seeded welcome article likewise shows none.

**Why this matters**
This is the paper's central differentiating claim and its ethical footing. A reader who takes the front page at its word, clicks a story, and finds no documents has been told something untrue on the front page. It is also a silent data loss from the operator's perspective: they attached a source and the product quietly did not carry it through to print, with no warning at publish time.

**Blast radius**
- Adjacent code: the article renderer (`src/routes/articles.$slug.tsx`) and whatever maps a lead's sources onto the published article record at publish time. The `/evidence/*` routes exist and `/evidence/compare` says *"Version comparison is only available for records cited in a published story"* — so a citation model exists and is simply not being populated or rendered.
- Shared state: lead → article publish transform; the RSS feed and sitemap presumably serialise the same record.
- User-facing: readers get the documents; the front-page promise becomes true.
- Migration: already-published articles would need their lead's sources carried over, or the section simply omits when empty.
- Tests to update: none known.
- Related findings: UX-006 (the other broken accountability promise), UX-008 (publish has no review step where this would have been caught).

**Fix path**
Carry the lead's sources onto the article at publish and render them as a standing section beneath the body — this is the single highest-value addition to the reading experience in the product:

> **What we read**
> Longmont PrimeGov — agenda packet, August 25 session · [document](…) · [saved copy](…)

If an article genuinely has no sources, either omit the section *and* soften the front-page claim, or — better — surface it at publish time: *"This story has no sources attached. Publish anyway?"*

---

### [UX-006] — Major — Journey — "Write the editor from the About page" is a dead end; there is no contact anywhere

**Evidence**
`/corrections`, all viewports, body copy: *"To flag an error, **write the editor from the About page** or post a correction from Published on the desk."* Screenshot: `uiux-screens/corrections-1440.png`.

`/about` in full contains no email address, no `mailto:`, no form, no social handle, no phone. Its complete link set, read from the DOM, is the site nav plus the RSS feed and the editor desk — the identical link set as every other public page. Screenshot: `uiux-screens/about-1440.png`. Searching all seven public routes for a contact affordance found none.

**Why this matters**
The corrections page is where a reader goes when they believe the paper got something wrong. It gives them one instruction, and following it leads to a page that cannot do what was promised. For a publication whose masthead value is *"we would rather look careful than look first"*, the tip-and-correction inbox being unreachable is the most consequential dead end on the public site. It also means the paper has no inbound tip channel at all — for a one-person civic newsroom, that is a missing feature as much as a missing link.

**Blast radius**
- Adjacent code: `src/routes/about.tsx`, `src/routes/corrections.tsx`, the shared footer component.
- Shared state: none technically, but this needs a product decision — a mail address the operator is willing to publish, or an on-site form, which is a build.
- User-facing: readers gain a way to reach the desk; Dark Desk gains a tip inbox.
- Migration: none.
- Tests to update: none known.
- Related findings: UX-005 (the other unkept public promise).

**Fix path**
Shortest path: add a contact block to `/about` and link it from `/corrections`, the article footer, and the site footer. The address should be configurable, since the operator's email is per-install.

> **Write the desk**
> Corrections, tips, documents, and complaints all go to the same place: **editor@…**
> We read everything. We do not publish anything from a tip without finding the record behind it.

Then change the corrections line to: *"To flag an error, **write the desk** — one editor reads it."* If no address is configured, that sentence must not be printed at all.

---

### [UX-007] — Major — State — Dropping a watch source is one unconfirmed, unrecoverable click, and the Server page promises otherwise

**Evidence**
`/desk/sources`, 1440×900. Each of the 11 seeded rows carries a `Drop` button. I clicked one: the count went **10 → 9** immediately, no confirmation dialog, no inline confirm, no undo, no toast. Screenshots: `uiux-screens/desk-sources-1440.png`, `desk-sources-after-drop.png`.

`/desk/ops` states, under **Recently deleted**: *"Anything deleted from the desk waits here for 30 days, then goes for good. Restoring puts it back where it was."* Immediately after the drop, that panel read **"Nothing deleted."** Screenshot: `uiux-screens/desk-ops-1440.png`.

**Why this matters**
The watch list is the substrate of the entire product — everything the scanner ever sees comes from it, and a seeded entry like *Longmont PrimeGov (agendas, packets, minutes)* is not something a non-technical operator can reconstruct from memory. `Drop` sits in a dense table where it is easy to hit the wrong row, and the label is soft enough ("Drop", not "Remove from the watch list") that its permanence is not signalled. Worse, the operator has been told elsewhere in the same product that deletions are recoverable for 30 days; that belief makes them *more* willing to click. A safety promise that does not cover the thing you just did is worse than no promise.

**Blast radius**
- Adjacent code: `src/routes/desk.sources.tsx` drop handler; the soft-delete/restore mechanism backing `/desk/ops` → Recently deleted (which does cover published articles — the Delete confirm explicitly says corrections go too). Audit every other one-click removal for the same gap: the `Delete` on queue lead cards, and `Set aside` / `Close file` on Dark Desk.
- Shared state: whatever table backs Recently deleted. Either sources join it, or the Ops copy must be scoped.
- User-facing: dropping a source becomes recoverable, or at minimum confirmed.
- Migration: if sources join the soft-delete table, existing hard-deleted rows are already gone — accept and move on.
- Tests to update: none known.
- Related findings: UX-008 (publish also unconfirmed), UX-012 (Leave as editor). Same root: the product's excellent confirmation pattern is applied to exactly one action.

**Fix path**
Route source removal through the same soft-delete used for articles so Recently deleted is telling the truth, and add an inline confirm in the row matching the Delete pattern:

> Drop **Longmont PrimeGov** from the watch list? The scanner stops reading it. Nothing already captured is lost, and you can restore it from Server → Recently deleted for 30 days.
> [Yes, drop it] [Keep watching]

If soft-delete is out of scope this sprint, then the Ops copy must be narrowed in the same PR — *"Deleted stories wait here for 30 days"* — rather than left over-promising.

---

### [UX-008] — Major — Journey — Publishing to the public paper takes one click with no confirmation

**Evidence**
`/desk/story/1`, 1440×900. With a body present, `Publish to the paper` enables and a single click publishes: the story went live at `/articles/council-packet-posted-late-for-august-25-session`, entered the RSS feed and the sitemap, and appeared on the front page. No confirmation step, no preview, no diff, no "this goes public" interstitial. Screenshots: `uiux-screens/desk-story-1440.png`, `desk-story-published.png`.

Contrast, in the same product: `Delete` on `/desk/published` expands into a full consequence paragraph with `Yes, take it off` / `Keep it`; `Leave as editor` asks *"Really leave?"*; `/desk/ops` states that its two interrupting actions "ask twice". Screenshot: `uiux-screens/desk-published-delete.png`.

**Why this matters**
The product's founding claim — repeated on `/`, `/about` and `/how-we-report` — is that a human deliberately decides what prints: *"Hold, kill, or publish is a person."* The interface makes that decision the cheapest click on the page, cheaper than removing a source. Publishing is also the only irreversible-in-public action here: once it is in the feed, in the sitemap, and in someone's reader, unpublishing leaves a dead link (the Delete copy says so itself). For a solo operator working fast at 11pm, one mis-aimed click puts an unfinished story on a public civic-news site under their name. There is also no preview — the operator has never seen how the body renders before readers do, which is precisely how UX-013's formatting problem stays invisible.

**Blast radius**
- Adjacent code: `src/routes/desk.story.$leadId.tsx` publish handler; `src/routes/desk.story.draft.$draftId.tsx` if it has its own; the Opinion desk's publish path.
- Shared state: the same inline-confirm component already used by Delete and Leave as editor — reuse, do not rebuild.
- User-facing: one extra deliberate step before anything becomes public.
- Migration: none.
- Tests to update: any e2e that publishes will need to click through the confirm — expect the lifecycle e2e (`scripts/lifecycle-e2e.mjs`) to need one added step.
- Related findings: UX-005 (a publish-time review is where missing sources would be caught), UX-007, UX-017.

**Fix path**
Reuse the Delete confirmation pattern, and fold the missing-sources check into it:

> **Publish to the paper?**
> This puts the story on the front page, in the RSS feed and in the sitemap, at a public address anyone can link to. Taking it down later leaves a dead link.
> ⚠ This story has no sources attached.
> [Yes, print it] [Not yet]

And add a **Preview** control beside `Save edits` that renders the story exactly as `/articles/:slug` will.

---

### [UX-009] — Major — Accessibility — Front-page heading levels are inconsistent between stories and collide with story-body headings

**Evidence**
`/`, 1440×900, with two published stories. Heading outline read from the DOM in document order:

```
H1: TownReporter
H2: Council packet posted late for August 25 session   ← story 1 headline
H2: What the record shows                              ← a heading INSIDE story 1's body
H3: A civic paper for Longmont, edited by a human      ← story 2 headline
H2: The paper is this site
```

Story 1's headline and story 2's headline sit at different levels; story 1's *internal* section heading sits at the same level as its own headline; and the footer block outranks story 2. On `/articles/:slug` the outline is correct (`H1` headline, `H2 Also in the paper`), so the problem is specific to the list page, which is the site's front door. Additionally, `/articles/no-such-article` and `/evidence/compare` have **no `h1` at all** (measured: `h1` node count 0).

**Why this matters**
Heading navigation is the primary way screen-reader users skim a news list — jump by heading and you should hear the stories in order at a consistent level. Here you hear the site name, a story, a fragment of that story's body presented as a peer of it, then a second story demoted below the first story's subsection. It is not possible to tell where one story ends and the next begins. Because story bodies are author-supplied and may contain any heading level, the collision recurs on every future story that uses a `##` subhead — this gets worse as the paper fills, not better.

**Blast radius**
- Adjacent code: the front-page story-list renderer and the markdown renderer that converts body content to HTML. Any other page that renders article bodies in a list context (topic-filtered `/?topic=…` and `/?q=…` results use the same component) inherits it.
- Shared state: the markdown-to-HTML step is shared between the list teaser and the full article — that is why body headings escape into the list outline.
- User-facing: no visual change if levels are remapped rather than restyled; screen-reader and SEO structure become coherent.
- Migration: none.
- Tests to update: none known.
- Related findings: UX-013 (the same list teaser is where the seeded article's headings render flat).

**Fix path**
1. Render every story headline in a list at the same level — `h2` — regardless of position.
2. When rendering a body inside a list teaser, either truncate before the first block-level heading or demote all body headings by two levels (`h2`→`h4`). Simplest correct fix: show the dek plus the first paragraph, not the full body (see UX-013).
3. Give `/articles/:slug` 404 and `/evidence/compare` an `h1` — they already have the right visual heading, it is just marked up as a `p`/`div`.

---

### [UX-010] — Major — Typography — A large share of the desk's functional copy is set at 10–12.5px

**Evidence**
Computed font sizes sampled across the desk at 1440×900 (from `uiux-screens/_contrast.mjs` output, which reports size alongside colour for every text node):

| Text | Size | Route |
|---|---|---|
| `Nothing open — printed stories are on Published. Run the scan again · Published.` | 12.5px | `/desk` |
| `No scans yet — the watch list is ready.` | 12.5px | `/desk` |
| `All quiet.` / `Aug 29, 2026` | 11.5px | `/desk` |
| `11 sources on watch` | 11.5px | `/desk/scan` |
| `SOURCE` / `TIER` / `KIND` / `LAST FETCHED` (table headers) | 10px | `/desk/sources` |
| `URL` / `NAME` (form labels) | 10px | `/desk/sources` |
| `EDITOR'S DESK — LONGMONT` / `PAPER` / `OK` / `RUNNING FOR` / `CLOUDFLARE TUNNEL` | 11px | `/desk/ops` |
| `INVESTIGATIVE DESK` / `START A FILE` | 10px | `/desk/dark` |
| `AI is not available. Set ANTHROPIC_API_KEY…` | ~11px | `/desk/scan` |

These all *pass* contrast (nothing on the desk measured below 5.35:1), so this is a size finding, not a colour one.

**Why this matters**
The stated user is one local journalist, working alone, likely for long sessions, plausibly over 45. 10px is roughly 7.5pt — smaller than a footnote in print — and it is carrying the desk's *load-bearing* copy: every empty-state instruction, every form label, every table header, every status value on the Server page, and the error text that explains why the AI will not run. The information a novice most needs is set smallest. Browser zoom is a workaround, but it reflows a three-column command centre that already has layout slack (UX-018), so it is not a free one.

**Blast radius**
- Adjacent code: the desk type scale — the recurring 10 / 11 / 11.5 / 12 / 12.5px steps come from a shared set of utility classes in `src/components/desk-chrome.tsx` and `src/styles.css` (`.desk-ltr` rules), not from per-page choices. That means one coordinated change, not thirty.
- Shared state: the same scale is used by the public paper's kickers and footer (11px / 14px) — the public side is more defensible because those are labels, not instructions, but the change should be scoped deliberately.
- User-facing: the desk becomes legible without zoom; some dense screens (`/desk/sources`, `/desk/ops`) will grow taller.
- Migration: none.
- Tests to update: any layout/screenshot assertions on desk pages.
- Related findings: UX-011 (same root — the desk's control scale is sized for a designer's monitor), UX-018.

**Fix path**
Raise the desk's floor. Minimum 13px for anything that is a sentence the user must read to act (empty-state instructions, error and help text, status values); 11px floor for all-caps label/kicker treatments, which are more legible per-pixel due to letterspacing. Keep the visual hierarchy by leaning on weight, letterspacing and colour rather than shrinking below the floor. Concretely: `12.5px → 13.5px` for instructional italics, `10px → 11px` for table headers and form labels, `11px → 12px` for Ops status labels.

---

### [UX-011] — Major — Accessibility / Responsive — Desk controls are ~27px tall at mobile, well under the 44px touch minimum

**Evidence**
Measured bounding boxes at 375×812 with touch emulation on, and at 768×1024:

| Control | Size | Route |
|---|---|---|
| `Start digging` | 94×27 | `/desk/dark`, `/desk` |
| `Keep digging` | 95×27 | `/desk/dark` |
| `Set aside` | 63×27 | `/desk/dark` |
| `Open file` | 73×27 | `/desk/dark` |
| `Drop` | 43×27 | `/desk/sources` |
| `Add source` | 85×27 | `/desk/sources` |
| `Run` (Ops actions) | 45×27 | `/desk/ops` |
| `Check now` | 75×27 | `/desk/ops` |
| `LIGHT` / `DARK` | 63×27 / 59×27 | all desk routes |
| `View paper` | 64×18 | all desk routes |
| `Full queue` / `Published` / `Open the desk` | ~55×17 | `/desk` |
| `← Queue` | 51×16 | `/desk/story/:id` |
| source URL links | ~250×16 | `/desk/sources` |

Counts of sub-32px interactive targets: 30 on `/desk/sources` at 768, 25 on `/desk/dark` at 768, 19 on `/desk` at 768, 15 on `/desk/sources` at 375. The public paper is materially cleaner — 2 at both 375 and 768, and the login form's buttons use a `min-h-11` (44px) class correctly.

**Why this matters**
The desk is fully responsive — it reflows to a single column at 375 with no overflow, which strongly implies phone use is intended (checking the queue from a council meeting is exactly this product's use case). But at that width the controls are half the size a finger needs. `Drop` at 43×27 sitting in a table row is a mis-tap waiting to happen, and per UX-007 that mis-tap is unrecoverable. `Run` at 45×27 on the Ops page sits next to actions labelled INTERRUPTS. The 16–18px text links (`← Queue`, source URLs) are below any reasonable tap target at all.

**Blast radius**
- Adjacent code: the shared desk button primitives (`InkButton`, and the `.btn`, `.btn.small`, `.btn.solid` classes) — the uniform 27px height across seven different routes shows this is one class, not many. The login page's `min-h-11` shows the correct pattern already exists in the codebase.
- Shared state: `src/components/desk-chrome.tsx` (`inkSolid`, `inkGhost`, `inputClass`) and the `.desk-ltr` rules in `src/styles.css`.
- User-facing: bigger, easier controls; desk pages get taller on mobile.
- Migration: none.
- Tests to update: any layout/screenshot assertions.
- Related findings: UX-010 (same scale), UX-007 (mis-tap consequence).

**Fix path**
Add a `min-height: 44px` (and adequate horizontal padding) to desk buttons under a `max-width: 768px` media query — keeping the compact 27px on desktop is a legitimate density choice, so this need not cost desktop information density. For the text links (`← Queue`, `Full queue`, `View paper`, source URLs), give them block padding at mobile so their hit area reaches 44px even though the glyphs stay small.

---

### [UX-012] — Major — Visual hierarchy — The most destructive action in the product is the quietest text on the page

**Evidence**
`/desk` and every desk route, 1440×900. The masthead reads: `TownReporter` (24px bold) · `EDITOR'S DESK — LONGMONT` (11px, `rgb(107,94,82)`) · **`Leave as editor`** (12px, `rgb(107,94,82)`, no border, no icon, no colour distinction). Screenshot: `uiux-screens/desk-index-1440.png`.

Clicking it reveals a good confirm — *"Really leave? The paper stays. Anyone can Create editor and own the desk."* with `Leave` / `Stay`. Screenshot: `uiux-screens/desk-leave-as-editor.png`.

By contrast, on the same masthead: `Sign out` (also 12px, but at the far right in the account cluster where users expect it) and `DARK DESK` (a full black chip in the nav bar).

**Why this matters**
"Leave as editor" relinquishes ownership of the newsroom so that any subsequent visitor to the public site — where a black **CREATE EDITOR** chip is the loudest element on the page (see First impressions) — can claim it. That is the single most consequential action available anywhere in TownReporter, and it is styled as a piece of masthead furniture, adjacent to and typographically identical with the descriptive label `EDITOR'S DESK — LONGMONT`. The label itself reads like a synonym for "sign out" — a user hunting for the exit at the top-left will find this one first, because `Sign out` is at the opposite end of the bar.

The confirm text is good but does not spell out the irreversibility in the way the Delete confirm does: *"Anyone can Create editor and own the desk"* is accurate but reads as informational, not as a warning that you may not get back in.

**Blast radius**
- Adjacent code: the desk masthead component in `src/components/desk-chrome.tsx`.
- Shared state: the desk-claim state (`deskClaimState` / `claimDesk` in `src/lib/news/claim.ts`) also drives the public masthead's CREATE EDITOR/SIGN IN swap — moving the control does not touch that logic.
- User-facing: the action becomes harder to trigger by accident and clearer about what it costs.
- Migration: none.
- Tests to update: any e2e locating the button by position.
- Related findings: UX-002 (the desk's information hierarchy generally puts important state in quiet places), UX-007, UX-008.

**Fix path**
Move it out of the masthead into the account cluster, under the avatar menu beside `Sign out`, and rename it so it does not read as a session action. Then strengthen the confirm:

> **Give up the desk?**
> `Hand the desk to someone else` (menu label)
> Confirm: *"This releases the newsroom. The paper and everything on it stays exactly as it is — but the desk becomes unclaimed, and the next person who visits the site can create an editor account and own it. **That may not be you.** Signing out is what you want if you are just done for the night."*
> [Yes, release the desk] [Cancel]

---

### [UX-013] — Major — Copy — The seeded welcome article, which *is* the front page of every new install, renders as an unformatted slab

**Evidence**
`/` on a fresh database, all viewports. The only story is *"A civic paper for Longmont, edited by a human"*, printed in full above `Continue reading`. Its section headings render as bare run-on lines with no weight, size, or spacing distinction from the body:

> …A human editor still decides what publishes.
> **What we cover**
> City Council and study sessions. Planning, housing, and land use…
> **What we will not do**
> We will not quote neighborhood apps as fact…

Screenshots: `uiux-screens/home-1440.png` (desktop — ~300 unbroken words), `home-320.png` (mobile — the slab occupies about 60% of the total page height). The same flat rendering appears on the article page itself, `article-1440.png`.

I verified this is content, not renderer: a story I wrote with a `##` heading rendered correctly as a styled `h2` on both the front page and the article page (`article-new-1440.png`). The seeded article's headings are plain lines, so nothing formats them.

Separately, the article page prints its final body paragraph — *"Free to reprint in whole or part with credit to TownReporter and a link back. Do not imply endorsement."* — three times: once as body text, once as the article's reprint notice, once in the site footer.

**Why this matters**
This is the first and, for a while, the only thing every operator and every early reader sees. The prose is excellent; the presentation makes the paper look like it cannot typeset. It also silently miscommunicates the product's capability — a new operator reasonably concludes TownReporter renders stories as undifferentiated blocks. And because the front page prints the entire body rather than a teaser, the slab is unavoidable: there is no fold to hide behind.

**Blast radius**
- Adjacent code: the seed content (grep the migrations/seed for `welcome-to-townreporter`); the front-page teaser renderer, which prints full bodies rather than an excerpt; the article renderer's reprint-notice block.
- Shared state: the same seed article is what every fresh install and every demo gets — this is the product's shop window.
- User-facing: a formatted, scannable front page on first run.
- Migration: editing seed content only affects new installs; existing installs keep the old row unless backfilled (acceptable — this is a one-story fix an operator can also make from the desk).
- Tests to update: any test asserting the seeded body text.
- Related findings: UX-009 (the same teaser is where body headings break the outline), UX-004 (other preview-era content shipping as-is).

**Fix path**
1. Rewrite the seed article body with real markdown headings (`## What we cover`, `## What we will not do`) so it renders as intended.
2. Delete the trailing reprint paragraph from the body — it is already printed by the article chrome and again by the footer.
3. Change the front-page teaser to show dek + first paragraph + `Continue reading` rather than the full body. This fixes the slab, fixes UX-009's heading collision, and makes a multi-story front page scannable, which is what a front page is for.

---

### [UX-014] — Minor — Copy — Invalid source URL produces the raw string "Invalid URL"

**Evidence** `/desk/sources`, typing `not a url` into the URL field and pressing `Add source` renders exactly `Invalid URL` — the `URL` constructor / validator message, not written copy. Screenshot: `uiux-screens/desk-sources-invalid.png`.

**Fix path** *"That doesn't look like a web address. Paste the whole thing, starting with `https://` — for example `https://longmont.primegov.com/public/portal`."*

---

### [UX-015] — Minor — Copy — A lead you just filed by hand is told it "was written before notes were kept"

**Evidence** `/desk/story/1`, immediately after filing a brand-new lead through `File a lead yourself`, the REPORTING NOTES panel reads: *"This draft was written before notes were kept. Redraft fills them; lines you add stay."* Screenshot: `uiux-screens/desk-story-1440.png`. The lead is seconds old; there is no "before".

**Fix path** Branch on whether notes were ever possible. For a fresh manual lead: *"No reporting notes yet. Add a line for every call to make and record to pull — these never print."*

---

### [UX-016] — Minor — IA — "DARK" (theme) sits inches from "DARK DESK" (investigative lane), meaning different things

**Evidence** Every desk route's masthead: a `LIGHT`/`DARK` segmented control at 11px, with a black `DARK DESK` chip in the nav bar directly below it. Screenshot: `uiux-screens/desk-index-1440.png`. Making it worse, Dark Desk's *own* page has no theme toggle at all (its button list is `Leave as editor, Sign out, Start digging, Change, Pick one for me, Check r/longmont` — no LIGHT/DARK), so a user who thinks `DARK DESK` is the theme control and clicks it lands on a page where the real theme control has disappeared.

**Fix path** Rename the theme control to `Paper` / `Night`, or replace it with a single sun/moon icon button with an `aria-label`. Restore the theme toggle to Dark Desk for chrome consistency.

---

### [UX-017] — Minor — State — Disabled primary actions never say why

**Evidence** `/desk/story/1` with an empty body: `Publish to the paper` renders grey and disabled (verified `isDisabled() === true`) with no tooltip, no adjacent hint, no `aria-describedby`. Same for `Add` on reporting notes and `Publish correction` on `/desk/published`. Screenshot: `uiux-screens/desk-story-1440.png`. The guardrail itself is correct and welcome (see What's working) — only the explanation is missing.

**Fix path** A short line beneath each: *"Write a body before this can print."* / *"Type the correction first."* Disabled controls with no reason read as bugs.

---

### [UX-018] — Minor — Visual hierarchy — The desk command centre leaves the bottom two-thirds of a 1440×900 screen empty

**Evidence** `/desk` at 1440×900 on first run: three columns of content occupy roughly the top 460px; everything below is empty ground with a hairline column rule running down through nothing. Screenshot: `uiux-screens/desk-index-1440.png`. The same emptiness persists once the queue and Dark Desk have content, because the columns are fixed-height cards.

**Why this matters** The screen reads as "something failed to load" rather than "the desk is quiet", which for a first-run user compounds UX-002. The paper's front page has the mirrored issue at desktop widths — a ~670px content column left-aligned inside a ~980px rule width, leaving a permanent right gutter.

**Fix path** Let the columns grow, and give the first-run desk something to hold: a short "what to do first" card in the empty space (claim done → add sources → set up a model → run a scan), which is also the natural home for UX-002's setup banner.

---

### [UX-019] — Minor — Copy — The Server page reports a raw process exit code

**Evidence** `/desk/ops`, Health panel: **WATCHDOG · `ran 3s ago · exit 267009`** with the status chip `CHECK` and `next run in 5m`. Screenshot: `uiux-screens/desk-ops-1440.png`. Every other row on that page is written in plain language (`274 GB free of 1.9 TB`, `no outside requests`, `answered in 1ms`) — this row is the outlier.

**Fix path** Translate the states the watchdog can actually be in, and never print the number: *"The watchdog ran 3 seconds ago and reported a problem it could not fix. Its log is at the bottom of this page."* Keep the exit code in the log, not in the panel.

---

### [UX-020] — Minor — IA — `/desk/memory` silently rewrites the URL to `/desk/published`, and Beat memory has no nav entry

**Evidence** Navigating to `/desk/memory` returns 200 but `location.href` settles at `http://127.0.0.1:3300/desk/published`, and the page renders the Published list with a **Beat memory** table appended below it. The desk nav (`DESK SOURCES SCAN QUEUE PUBLISHED OPINION SERVER` + `DARK DESK`) has no Memory entry; the only route in is a small link on the desk index reading *"Beat memory · what we already covered"*.

**Why this matters** Bookmarking, back-button behaviour and link-sharing all break when the URL does not match what was requested, and a feature reachable only from one small link on one page will not be found.

**Fix path** Either give Beat memory its own route and a nav entry, or make the desk-index link an anchor (`/desk/published#beat-memory`) that scrolls to it — but stop rewriting the address.

---

### [UX-021] — Minor — State — Archive search loses the query and shows two adjacent dismiss controls

**Evidence** `/`, clicking the magnifier expands an inline field. Typing does nothing until Enter; on Enter it navigates to `/?q=…` and renders results correctly — but the field comes back showing its placeholder rather than the submitted term, so the results header (`Archive search for "civic"`) is the only record of what was searched. The open field also shows **two** dismiss affordances side by side: a `✕` inside the input and a second `✕` immediately to its right. Opening the field reflows the nav from one row to two. Screenshot: `uiux-screens/search-typed.png`.

**Fix path** Repopulate the input from `?q=`. Keep one dismiss control (the in-field one) and drop the outer one. Reserve the field's width in the nav so opening it does not reflow.

---

### [UX-022] — Minor — Copy — Beat memory shows two rows per story, one keyed by topic and one by headline

**Evidence** `/desk/published`, after publishing one story, the Beat memory table reads `2` and contains:

| ENTITY | LAST ANGLE | UPDATED |
|---|---|---|
| `council` | The packet appeared 40 hours before the vote, inside the notice window. | Aug 29, 2026 |
| `Council packet posted late for August 25 session` | The packet appeared 40 hours before the vote, inside the notice window. | Aug 29, 2026 |

One story, two entities, identical angles. The column is headed ENTITY but is being fed both a topic slug and a headline.

**Fix path** Decide what an entity is (a person, an LLC, a contract, a body) and record only those. A topic slug is not an entity; a headline is not an entity. Until extraction exists, show the count of distinct stories rather than a table with a misleading header.

---

### [UX-023] — Minor — Copy — Corrections render below the story; the desk says they run above it

**Evidence** `/desk/opinion` states: *"a published piece is never edited — a correction runs as a dated note **above** it."* On `/articles/council-packet-posted-late-for-august-25-session`, the correction I posted renders in a **Corrections** block *after* the body, above the reprint notice. Screenshot: `uiux-screens/article-with-correction.png`.

**Why this matters** Newspaper convention — and the ethical argument for corrections — puts the note where a reader encounters it before they read the wrong claim. A reader who reads the first three paragraphs and leaves never learns the story was corrected.

**Fix path** Move the correction note above the body, directly beneath the dek, styled as a rule-bounded note. Then the Opinion copy is true and the reader is served.

---

### [UX-024] — Minor — Responsive — Opening the search field reflows the public nav onto two rows

**Evidence** `/` at 1440×900. Closed: one nav row. Open: `CITY COUNCIL VOTES` and `RSS` drop to a second row and the whole nav bar grows ~46px, pushing the page content down. Screenshot: `uiux-screens/search-typed.png` versus `home-1440.png`.

**Fix path** Reserve the search field's width in the closed state (an invisible spacer), or overlay the field above the nav rather than inserting it into the flow.

---

### [UX-025] — Minor — Accessibility — Two routes render no `h1`

**Evidence** Measured `h1` node count of 0 on `/articles/no-such-article` (which visually shows *"That story is not in this edition"*) and `/evidence/compare` (*"Nothing to compare"*). Every other public route has exactly one correct `h1`.

**Fix path** Promote the existing visual heading on each page to an `h1`. No visual change required.

---

### [UX-026] — Minor — Accessibility — Twelve buttons on one screen share the accessible name "Start digging"

**Evidence** `/desk/dark` with a populated pile: a strict-mode locator for `button:has-text("Start digging")` resolved to **12 elements**, each with the identical accessible name and no `aria-label` distinguishing which card it belongs to. The same pattern applies to the repeated `Keep digging`, `Set aside`, `Open file` and `Follow this lead` buttons.

**Why this matters** A screen-reader user navigating by button hears "Start digging" twelve times with no way to tell which lead each one starts. Compounded by UX-003, several of those cards also have placeholder titles, so even reading the surrounding context does not disambiguate them.

**Fix path** `aria-label={`Start digging on ${card.title}`}` on each. Same for the other repeated card actions.

---

### [UX-027] — Nit — The dark theme paints a wrapper, not `body`

**Evidence** With the desk in dark mode, `getComputedStyle(document.body).backgroundColor` is still `rgb(246,241,231)` (cream). The dark ground is painted on an inner container. Visually correct in normal scroll; any overscroll/rubber-band, and the browser UI's inferred page colour, will show cream behind a dark page.

**Fix path** Set the background token on `html`/`body` as well as the wrapper, and add a matching `<meta name="theme-color">` per theme.

---

### [UX-028] — Nit — Dark Desk loses its visual identity in the dark theme

**Evidence** In light mode the Dark Desk panel on `/desk` is a distinct near-black card that reads instantly as "the other lane" — a genuinely good bit of design. In dark mode it is the same colour as everything around it and the distinction evaporates. Screenshots: `desk-index-1440.png` versus `desk-darkmode.png`.

**Fix path** Give the panel a dark-mode treatment that preserves the separation — a lifted surface, or the rust border it already uses for its accents.

---

### [UX-029] — Nit — The Server page reports on an address that is not this instance

**Evidence** `/desk/ops` on this dev instance at `127.0.0.1:3300` reports **PUBLIC SITE — `https://townreporter.org` answered 200 in 131ms — OK**. Per the audit boundary I did not visit that address; I note only that the panel's subject is not the server it is running on. The page's own caveat (*"Read from this machine, so it can tell you the tunnel is routing but not that a reader in another town can reach you"*) is excellent and should be extended to say *which* address it checked and where that came from.

**Fix path** Label the row with the configured public address and its source: `PUBLIC SITE (from PUBLIC_URL) — https://…`.

---

## States audit matrix

| Component / page | Default | Loading | Empty | Error | Partial | Notes |
|---|---|---|---|---|---|---|
| `/` front page | ✓ | — | ✓ (via topic/search) | ✓ 404 | ✓ | Full-body teaser causes UX-009/UX-013 |
| Topic filter `/?topic=` | ✓ | — | ✓ written, with escapes | — | — | Best empty state in the product |
| Archive search `/?q=` | ✓ | ✗ no in-flight state | ✓ written | — | — | UX-021 |
| `/articles/:slug` | ✓ | — | — | ✓ designed 404 (no `h1`) | ✓ correction block | UX-005 no sources; UX-025 |
| `/corrections` | ✓ | — | ✓ written | — | — | UX-006 dead-end instruction |
| `/evidence/:id` | ✓ | — | ✓ (`/compare`) | ✗ **raw SQL error** | — | **UX-001** |
| `/get-the-code` | ✓ | — | — | — | — | UX-004 self-linking button |
| `/login` | ✓ | ✓ `Opening…` + 10s timeout | — | ✓ good, tailored messages | — | Best-handled loading state in the build |
| `/desk` index | ✓ | — | ✓ written but 12.5px | ✗ no provider warning | ✓ | **UX-002**, UX-018 |
| `/desk/sources` | ✓ | — | — | ✗ raw `Invalid URL` | — | UX-007, UX-014 |
| `/desk/scan` | ✓ | ✓ | ✓ written | ✓ but triple-stacked + jargon | — | **UX-002** |
| `/desk/queue` | ✓ | — | ✓ written | — | ✓ status filters | Hold/Kill/Delete all present on cards |
| `/desk/story/:id` | ✓ | ✓ 36s spinner | ✓ | ✓ but only after 36s | — | **UX-002**, UX-008, UX-017 |
| `/desk/published` | ✓ | — | — | — | ✓ corrections | Exemplary delete confirm |
| `/desk/opinion` | ✓ | — | ✓ written | ✓ **pre-flight, button disabled** | — | The correct pattern — UX-002's template |
| `/desk/ops` | ✓ | ✓ `Check now` | ✓ (`Nothing deleted`) | ✓ status chips | ✓ | UX-007 false promise, UX-019 |
| `/desk/dark` | ✓ | ✓ | ✓ written | ✗ `Check r/longmont` gives no distinct feedback | ✓ | **UX-003**, UX-026 |

## Accessibility snapshot

- **Keyboard navigation** — Good. All 14 first tab stops on `/` are reachable and in reading order (skip-link → masthead → nav → search → desk → topic chips). `Esc` closes the search field. Native `required` / `minLength` handle empty submits on `/login`. Form labels wrap their inputs, so association is implicit and correct despite the inputs having no `id`/`name`.
- **Focus visibility** — Good. A `2px solid rgb(155,41,21)` outline on every focusable element sampled, in both themes. Never suppressed.
- **Colour contrast** — **Passes AA everywhere measured.** Lowest ratio found across seven routes in both themes: **5.35:1** (`rgb(210,118,79)` on `rgb(33,24,18)`, Dark Desk accents) against a 4.5:1 requirement. Other sampled pairs: muted body `rgb(107,94,82)` on `rgb(246,241,231)` = **5.57:1**; rust `rgb(155,41,21)` on paper = **6.85:1**; Dark Desk cream on brown = **9.09:1**; ink on paper = **16.12:1**. Contrast is a strength, not a gap — the type-size finding (UX-010) is separate and independent.
- **Screen reader labelling** — Mixed. `lang="en"` set, one `<main>` and one `<nav>` landmark per public page, skip links on both surfaces, the icon-only search button carries `aria-label="Search the archive"`. Against that: heading levels are incoherent on the front page (UX-009), two routes have no `h1` (UX-025), and Dark Desk repeats one accessible name across 12 buttons (UX-026).
- **Reduced motion** — Honoured, and thoroughly: a global animation/transition kill plus two targeted rules in `src/styles.css`.
- **Touch target size** — **The main gap.** The public paper is nearly clean (2 sub-32px targets at both 375 and 768). The desk is not: 27px-tall buttons throughout and 16–18px text links, 15–30 sub-32px targets per desk route, against a 44×44 guideline (UX-011).

## Patterns and systemic observations

**Pattern 1 — Internal strings reach users unfiltered (UX-001, UX-003, UX-014, UX-019, and the third line of UX-002's error stack).** Five findings, one habit: values that exist for the machine — a Postgres message, a graph-edge label, a `URL` constructor throw, a process exit code, an environment-variable list — are rendered directly into surfaces read by a non-technical journalist and, in one case, by the public. The fix is a policy, not five patches: **no value that was not written by a person is ever rendered to a person.** Add an error-boundary rule that prints a fixed string and logs the detail, and audit every place a caught value is interpolated into JSX. This is the highest-leverage single change in the audit.

**Pattern 2 — The excellent confirmation pattern is applied to exactly one action (UX-007, UX-008, UX-012).** The Delete confirm on `/desk/published` is genuinely the best thing in the product: it names the consequence, names the blast radius, and recommends the alternative. Yet publishing to a public site is one unguarded click, dropping a watch source is one unguarded click, and relinquishing the newsroom is styled as masthead furniture. The component exists; it just needs three more consumers. Fix them in one PR and the desk's whole risk posture becomes coherent.

**Pattern 3 — The product knows things it does not say until it is too late (UX-002, UX-017, and UX-005's silent source loss).** In each case the app holds the relevant fact *before* the user acts — no model is configured, the body is empty, the lead has sources that will not be carried through — and surfaces it only after a click, a 36-second wait, or not at all. The correct pattern already exists in this codebase: `/desk/opinion` performs its check up front, disables its button, and explains in plain language. Make that the house style for every gated action.

**Pattern 4 — Two products, two type scales (UX-010, UX-011, UX-018).** The public paper is set generously (16px body, 36px display, 44px+ touch targets on the login form) and is a pleasure to read. The desk is set for a designer's 27-inch monitor (10–12.5px functional copy, 27px controls) and gets harder to use exactly where the user is least expert and most tired. The desk should inherit the paper's generosity, not its own density.

**Pattern 5 — Preview-era scaffolding is shipping as product (UX-004, UX-013, UX-003's "Test utility" card).** Copy addressed to a sandbox preview, seed content that was never typeset, and fixture-shaped data in a live pile. Each is small; together they are what a first-run user actually sees, and they set the perceived finish level of everything else.

**Challenge to the product shape.** The desk is built as a newsroom for a staff — seven top-level sections, a command centre, an ops console, an investigative lane with sliders and presets — and it is being handed to one person who has never run a server. The information architecture is genuinely good *for the domain*; it is heavy *for the operator*. I would not restructure it, but I would add the thing it lacks entirely: a first-run path. There is no onboarding of any kind — no tour, no checklist, no "here is what to do first". The empty desk index has the space for it (UX-018), the setup gap makes it necessary (UX-002), and a four-step checklist (claim the desk → check your sources → set up a writing model → run your first scan) would convert the product's biggest first-run failure into its best first-run moment.

## Appendix: surfaces reviewed

**Public routes** — `/`, `/?topic=council`, `/?topic=opinion`, `/?q=civic`, `/?q=zzzznothing`, `/about`, `/how-we-report`, `/corrections`, `/articles/welcome-to-townreporter`, `/articles/council-packet-posted-late-for-august-25-session`, `/articles/no-such-article`, `/evidence/00000000-…`, `/evidence/compare`, `/get-the-code`, `/TownReporter.zip`, `/feed`, `/sitemap.xml`, `/this-route-does-not-exist`, `/login`

**Desk routes** — `/desk`, `/desk/sources`, `/desk/scan`, `/desk/queue`, `/desk/story/1`, `/desk/published`, `/desk/memory`, `/desk/opinion`, `/desk/ops`, `/desk/dark`

**Interactions exercised** — create editor account (empty submit, filled submit); archive search (open, type, submit hit, submit miss, Esc); topic filtering; file a lead (all fields, submit); save edits; Draft with AI (timed to resolution); publish to the paper; post correction (empty-disabled, filled, published, verified on article + `/corrections`); delete published (confirm dialog read, not confirmed); add source (invalid URL); drop source; Run scan; Write an editorial (disabled); Dark Desk `Change` / `Pick one for me` / `Check r/longmont` / `Start digging`; theme LIGHT/DARK; Leave as editor (confirm read, not confirmed); tab-order and focus traversal; contrast measurement across seven routes.

**Viewports** — 320×720, 375×812 (touch emulation), 768×1024, 1440×900. Chromium 151 via Playwright.

**Screenshots** — all under `artifacts/audit-townreporter-2026-08-29/uiux-screens/`. Key files cited above: `home-1440.png`, `home-320.png`, `about-1440.png`, `corrections-1440.png`, `corrections-populated.png`, `topic-council-1440.png`, `search-typed.png`, `search-noresults.png`, `article-1440.png`, `article-new-1440.png`, `article-with-correction.png`, `evidence-bad-1440.png`, `get-the-code-1440.png`, `notfound-1440.png`, `login-1440.png`, `desk-index-1440.png`, `desk-375.png`, `desk-darkmode.png`, `desk-sources-1440.png`, `desk-sources-invalid.png`, `desk-sources-after-drop.png`, `desk-scan-after.png`, `desk-queue-with-lead.png`, `desk-story-1440.png`, `desk-story-drafting-30s.png`, `desk-story-draft-resolved.png`, `desk-story-published.png`, `desk-published-delete.png`, `desk-correction-published.png`, `desk-opinion-detail.png`, `desk-ops-1440.png`, `desk-dark-1440.png`, `desk-dark-populated.png`, `desk-dark-after-Checkrlongmont.png`, `desk-375-darkbuttons-zoom.png`, `desk-leave-as-editor.png`, `a11y-focus-nav.png`.

**Measurement scripts** (kept alongside the screenshots for reproducibility) — `_walk-public.mjs`, `_walk2.mjs`, `_search-and-a11y.mjs`, `_search2.mjs`, `_desk.mjs`, `_desk2.mjs`, `_interact.mjs`, `_interact3.mjs`, `_lead.mjs`, `_story.mjs`, `_publish.mjs`, `_more.mjs`, `_final.mjs`, `_final2.mjs`, `_contrast.mjs`. Raw captures: `_public-walk.json`, `_walk2.json`, `_desk-walk.json`.

**Note on a claim not made:** an early read of the downscaled `desk-375.png` suggested the Dark Desk `Open file` buttons rendered dark-on-dark at mobile. A 3× device-pixel-ratio capture (`desk-375-darkbuttons-zoom.png`) and the computed styles (`rgb(246,241,231)` text on `rgb(33,24,18)`) show they render correctly. That finding was withdrawn rather than reported.
