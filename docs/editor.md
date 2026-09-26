# TownReporter — editor’s manual

Dark Desk uses the city and state saved in Paper setup, plus its configured county. It does not inherit Longmont jurisdictions for another town. The Reddit check requires one unambiguous subreddit among this newsroom's accepted Sources; otherwise it is unavailable and links to Sources. No subreddit is guessed from a town name. Reddit RSS finds candidates; when a local Redlib is running, the strongest candidates are read in full. The result panel says whether each card contains a full post or only an RSS excerpt. A Redlib failure never discards the RSS results.

**Current software version: [0.6.71](releases/0.6.71.md).** The release guide separates source, package metadata, GitHub publication, deployment, and provider-run evidence. Operators should start at [setup](setup.md). This guide covers a running newsroom with an editor account.

**Screenshot scope:** Embedded screenshots were captured from the running v0.6.54 desk and public paper, so they show the current Astra navigation and document workflow. The [current desk guide](editor-desk.md) remains the written reference; if a label moves again, the text here takes precedence over the image.

Dark Desk’s UI contract (for design and for anyone rewriting that page) is [dark-desk-editor.md](dark-desk-editor.md). The whole system, including how it is built, is [manual.md](manual.md). This page is the newsroom, in the order you use it.

---

## Names and spellings

New drafts run a separate name check after writing and editing. The story editor shows unresolved people above the draft and provides a written-source link and passage for each matched or corrected spelling. Transcripts, captions and OCR do not confirm their own name spellings. A source match checks spelling, not attendance, quotes or other claims. Missing evidence, incomplete checks and changes after checking stay visible. The editor retains the publishing decision. Saved-evidence checks use only the retained sources; public research during drafting can search written rosters and official records.

## Starting and finding a story

Open **Desk → Write a story**. Click **Add documents** or drop files into the document area. Paste URLs or transcripts in **Links or source text**, and put the angle in **What story do you want?** Choose the writing model and click **Write draft**.

The story editor opens when the job is created. A banner at its top shows progress. If you leave, the Desk has **Open your story** for running jobs and **Your recent drafts** for drafts you can reopen and edit. Research scope and section are in **Research & section**. Drafts are not published until you publish them.

## Current capabilities and remaining work

The Astra desk uses persistent navigation, recent drafts and shared document
intake. The story workspace places the writing surface beside Checks, Sources
and Reporting tabs and adapts to narrow screens. Follow-ups record who was
asked, what is due and when; replies can be added to story reporting notes.
Historical screenshots illustrate workflows, not the current layout.

Dark Desk now separates speculative Black Desk signals (confidence ≤0.5) from
structured Dark Signal verification. See [the doctrine and its limits](dark-desk.md).
The verified label is a completed software protocol, not a substitute for
checking sources. The travel-local five-topic exercise was executed in the
isolated 0.6.52+ candidate: eight bounded runs, including the September 3-8
replay. The records and limits are in
[the run-budget proof](proofs/dark-desk-run-budget-0651.md). This does not
close a Halo-local or production acceptance exercise.

Models can be discovered through LM Studio, Ollama or llama.cpp and selected
individually. **Captured-PDF OCR:** scanned PDF OCR renders the
actual pages in document order, so new page-aware captures can cite the real
PDF page number. Initial capture attempts the first 12 pages, with a 2 MiB
rendered-image limit per page and a cooperative 10-minute batch budget. In the
opened record, **Read entire PDF** continues through every unread page in
durable 12-page batches and saves each batch before continuing. Each click has
a shared 10-minute and 48-transcription-attempt ceiling; it pauses with saved
progress when either is reached. A running page render cannot be forcibly
interrupted by that budget. Omitted or failed pages
are explicitly listed and can be retried; a partial packet is not a complete read.
Older extracted-image OCR records remain labeled as unordered images and need
re-ingestion before their image numbers can be treated as PDF page numbers.
This reader can still leave individually failed pages unread; it does not establish transcript accuracy.
The separate retained-PDF page reader has one bounded built-UI proof: an
explicit request read real page 13 of a 44-page PDF and saved a page-numbered
transcript without changing the 16,254,338-byte original or its hash. Direct
comparison matched the main table rows and key dates, but omitted color-only
RAG status and had a minor verb error. Full-packet and table-perfect quality
remain unproven; compare every transcript with the original. See
[Read selected PDF pages](pdf-page-reading.md).

Configurable sections are available in Paper setup (see Newspaper sections below).
Manual investigative page watching is available in Dark Desk; see the workflow below. The owner-only legal-removal workflow is documented below; ordinary Delete does not implement it. [The canonical queue](../TODO.md) records current work.

## Newspaper sections

The owner manages sections in **Server → Sections** (**Newspaper sections** panel), below Paper setup. Add a name and permanent key, rename a display label, move sections up or down, or hide them from the newspaper's section navigation. Keys cannot change after saving: existing story and section links stay valid. Hiding does not delete stories or prevent filing.

For reporting sections, enter a reporting brief and scan instructions, then select accepted Sources. **Scan → Scan scope** offers General or a section. A section run uses only its assigned accepted sources and saves the guidance and source IDs with the queued run. Later configuration edits do not change that run; a source dropped before execution is excluded. A section without accepted sources cannot start. General retains all accepted sources.

A section with no sources says so and opens its list by itself: **Sources this section reads (0) — choose or add below**. **Add a new source to this section** takes a URL and an optional label without leaving the page. It is the same add the Sources page runs — the same checks, the same duplicate detection — so the page goes on the watch list straight away; the section's use of it belongs to the section draft, and lands when you **Confirm and apply**. The panel says which half is which, and says so plainly. A URL already on watch is ticked rather than added twice, and the message tells you that instead of claiming a new source. Once a section reads sources, its list goes back to collapsed and its summary line names the first few.

Choose **Review changes** before saving, or **Preview changes** when retiring a section. The unsaved review shows every changed section's name, section order, visibility, replacement, reporting brief, scan instructions, and accepted sources with both names and URLs. **Back to editing** preserves the draft, and **Cancel changes** discards it. Only **Confirm and apply** or **Confirm retirement and apply** writes the reviewed configuration. A failed or stale save keeps the draft available for correction; **Reload saved configuration** explicitly replaces it with the saved version.

While the draft differs from the saved configuration, a bar sits at the bottom of the window: **You have unsaved section changes**, with **Review changes** (and **Confirm and apply** once the preview is open) and **Cancel changes**. Navigating away with a draft — a desk link or closing the tab — asks first; **Stay on this page** keeps both the page and the draft. The older buttons above still work.

Retire a section only into an active reporting section. Review the count of affected leads, drafts and articles, then use **Confirm retirement and apply**. Their section changes; their identities, article URLs and text remain. Old section links follow the replacement, including later retirements. Opinion and About remain reserved page routes: they cannot retire and do not run section scans. Their section-list labels and visibility do not remove the permanent page links.

Editors can use configured sections when filing and scanning; only the owner changes their configuration. Existing legacy topic keys are preserved during migration. These changes require a normal release and local-operator promotion; this repository does not establish the deployed version.

## Named outlets

The owner manages the outlets this paper checks by name in **Server → Named outlets**, below Sections. A published story that names one of these outlets has to show the reader where it came from; if it does not, printing stops until an editor adds the source or overrides that outlet for that one draft. Editors can read the list there; only the owner changes it, and anyone else is told so instead of being shown a form.

The panel always says which of three states the paper is in. **Using the built-in list (7 outlets)** means nothing has been stored: the paper checks the outlets it shipped with. Their names, aliases and websites are readable, and **Customize** copies them into an editable draft. **This paper checks no outlet names** means the owner has decided to check none; it is shown as a decision, with a warning that printing no longer stops when a story names another newsroom's work and does not show the reader that source. A count — **This paper checks 9 outlets** — means the paper checks the owner's own list.

Editing works like the sections panel: rows you can rename, give aliases and a website domain, remove, and add. Aliases are the other ways a story may write the outlet's name, separated by commas. A domain decides only what counts as showing the reader the source, so changing one never stops the paper checking a story. A refusal appears beside the field it is about, in words: an empty name, a name or alias another row already answers to (capitals, and a doubled hyphen or punctuation between the words, do not hide a clash), or a domain written as a web address. **Review changes** will not run while a row is refused.

**Review changes** reads the published paper before anything is written: what is added, what is removed, what changed, and — for every removal and every alias dropped — the published stories whose credit stops being checked, by headline and link, newest first, up to 20 with "and N more". That sentence is the point of the screen: *3 published stories credit Times-Call. After this change the paper will no longer check that credit.* Only **Confirm and apply** writes the list, and it writes against the version the preview actually read, so a stale preview is refused and the draft stays for correction. A story that already shows the reader the source is never listed: the change costs the paper a check only where a check was still stopping the story.

While a draft differs from what is stored, the same bar as the sections panel sits at the bottom of the window — **You have unsaved outlet list changes** — with **Review changes** (and **Confirm and apply** once the preview is open) and **Cancel changes**. Leaving with a draft, by a desk link or by closing the tab, asks first; **Stay on this page** keeps both the page and the draft. **Reload saved configuration** discards the draft and reads the stored list back. **Use the built-in list** asks for the shipped list again, as its own change to review; **Check no outlet names** is the empty list, and it is the one setting here that can only lose the paper a check.

## Two rooms

The **paper** (`/`) is what the public reads: published stories, About, How we report, Corrections, RSS. Ordinary reporting reaches it through your review and publication; approved sources can produce automatic roundups of routine notices through fixed templates.

The **desk** (`/desk`) is the newsroom: sources, scan, queue, story workbench, published record, Dark Desk. Sign-in required.

![The paper](images/01-front-page.png)

![The desk](images/04-desk.png)

A draft, a reporting note, a research memo, a Dark Desk file — none of that is the paper. If you can see notebook language on the masthead (“What is solid,” “Next checks are…”), something went wrong; it is supposed to be stripped. Tell the operator.

---

## Reading the desk: Light/Dark and Text size

Top right of every desk page, next to **View paper**: a **Light / Dark** toggle and a **Text: Normal / Large** toggle. Both remember your choice (browser local storage) and default to Light and Normal for a new browser. Dark Desk is always dark and does not offer the Light/Dark toggle, but Text size still applies there.

Large scales body text, meta-lines, chips, labels, headlines and reading panes. The informational-text floor is 14px. The theme-token contrast check in `scripts/contrast-audit.mjs` covers those tokens; it is not certification of every rendered state.

---

## Sign in

1. On a new paper, top right: **Create editor**. That opens `/login`. Email + password. You own the desk. The button is gone after that.
2. The first time, **Set up the paper** opens next. Name the paper and city, choose the timezone, add the starting sources and tell it which YouTube channels and title phrases identify local meetings. Save to open the desk.
3. Later visits: **Editor desk** or **Sign in**. Anyone can still read the paper without an account.
4. **Give up the desk** (Server page, at the bottom) drops the owner. The paper stays, Create editor comes back, and the next person to open the sign-in page owns the desk -- including the archive, the Dark Desk files and the Server controls. You cannot take it back, so it asks you to type your email address first. It used to be a button in the header of every desk page; an audit showed how easily that is mistaken for Sign out.

Notes:

- Self-host uses email + password. Google / X buttons only appear on the grok.me preview.
- The first account is the owner. There is no setup token; it was removed in 0.5.1.
- A second person joins by invite: the owner mints a one-time link under **Invite an editor** on the Server page. See [setup.md](setup.md#a-second-editor).
- If the desk sits on “Opening the desk,” use Sign in again. Session expired.

---

## A working day

This is the loop. Skip steps that have nothing in them.

1. **The desk** — follow any **Needs you** links, then review the queue and Follow-ups. An empty alert strip does not mean all editorial work is finished.
2. **Sources** — is the watch list still the right list?
3. **Scan** — one pass over accepted sources. Files leads. This is the expensive click.
4. **Queue** — read what came in. Hold, kill, or open.
5. **Workbench** — draft, notes, check the documents, publish or don’t.
6. **Dark Desk** — only when something doesn’t add up, disappeared, or was never posted.
7. **Opinion** — when the paper should say what it thinks about something it has reported.
8. **Published** — if you got it wrong, post a correction, and fix the story text too when the words themselves were wrong. Both are public.
9. **Server** — a glance, when something feels slow or the site looks down.

Scan does not publish. Draft does not publish. Dark Desk does not publish. **Publish** on the workbench remains the gate for ordinary reporting; approved routine notices use their separate fixed-template path.

---

## Write a story from a link or your own notes

**Write a story**, on the desk landing page, is the fast path into steps 3–5 above when you already know what the story is: paste URLs or source text into **Links or source text**, add the angle in **What story do you want?**, pick a model, and click **Write draft**. The desk parses whatever you gave it — every link becomes a source, the first line or sentence becomes the headline, and the whole thing you pasted is kept as the lead's Reporting notes, so the draft reads it as evidence the same way it would if you had typed it into the workbench by hand. You land straight on the story page and watch it draft.

**Assignment and section selection:** an optional Section selector uses your newspaper's configured reporting sections. Choose the section before writing to keep the story there through the draft pass. Leaving it blank keeps the existing text-based guess, which can fall back to Council; you can still refile afterward. An explicit opening instruction such as “Write a short local item about…” is retained as the editorial assignment, separately from source evidence. This helps preserve the requested subject and brief form, but does not verify facts. If one editing pass cannot shorten an overlong brief, the draft remains available with a warning rather than being discarded.

The story writer also uses the existing editing pass to compare ordinary drafts with URL-labeled evidence. If that pass fails or runs out of time, the draft is retained with a review warning. This is not an independent fact-check: review dates, practical instructions and exact citations before publishing. Explicitly cited dashboards/watched source pages are retained; an explicitly empty citation list in a new report-backed draft is not filled from discovery URLs during publication. These changes do not retroactively repair older saved drafts.

It fills the same fields **File a lead yourself** (Queue) asks for by hand, so use whichever is faster: this box when you have a link or notes to paste, the Queue form when you are typing a lead from nothing. Either way, nothing publishes until you click **Publish** on the workbench.

---

## Import finished stories

Some stories arrive already written — a report from a research tool, a document a colleague sent, a piece you wrote somewhere else. **Write a story** is not for those: it treats what you paste as source material and has a model write a new draft from it. **Import finished stories** is the other way in. It is on the desk landing page under the paste box, on the Queue's empty state, and at **Import** in the sidebar.

**Paste one story, or a whole report.** You can also choose a saved page (`.md`, `.txt`, `.html`). Nothing is kept in the box; the text you pasted is what gets saved.

**Read the stories.** The desk reads the text and shows you what it found. It does not rewrite anything: every paragraph it shows you is a paragraph of your paste, word for word, and it will not put a sentence in a story that was not in the text you gave it. A report with headings is split by those headings. A report or story with no usable structure is read once by the writing model you have set up, which is asked only where the stories start and end, what each headline is, and which paragraphs are the body — never to write a line. If that pass changes a single paragraph, the desk throws it away and falls back to splitting on blank lines, and the card says **Could not split this cleanly — check it** so you look before importing.

**Check every story.** One card per story, and everything on it is yours to change:

| On the card                          | What it does                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| The tick box                         | Import this one. Sections that are not stories (beat context, watch lists, dates) arrive unticked.                       |
| **Headline**                         | The heading, with any leading number (`7.`) taken off. That heading line is the headline, so the text below never opens by repeating it. |
| **Section**                          | Your newsroom's sections, suggested from the text. **Section not chosen — pick one** until you choose one yourself.      |
| **Dek**                              | The line under the headline.                                                                                            |
| **The text this story carries**      | The body as written, or the report's plain-language brief, or both with the brief first. The text is shown underneath.   |
| **Sources**                          | Every link the story cited, each with its own tick box. Links also stay in the body where they were written.            |
| **Who wrote this**                   | The line readers see. For a report from an outside research tool the default is "An outside AI research tool wrote this from public records; an editor reviewed it." |
| **Editor notes — never published**   | Score, triage and the reporter next step the report carried. On a v2.6 report, also the readiness tier's own qualifier and the claims ledger with its statuses. |
| **Import as**                        | **Finished story** — a draft holding the text it carries, ready to edit and publish. **Story idea** — a lead with the description as its why, for someone to write. |

A **Hold** in the report is shown on the card as a Hold. If a story looks like one already on the desk or already printed, the card says so and links to the printed one — you decide whether to import it anyway.

**Finished story or story idea.** A civic-scanner v2.6 report says how ready each story is, and that statement is read before anything else. **Tier 1, ready for edit** imports as a finished story, ticked. **Tier 2, developing** also imports as a finished story, but arrives unticked and wearing a **Developing — gaps marked** flag, with the gaps the report admits to written into its editor notes. **Tier 3**, anything the report files under a **Black Desk** or **Possible Stories to Investigate (Unverified)** heading, and every row of a held-and-potential table, is a **Story idea** and never a draft — however many words it runs — flagged **Unverified — Black Desk**, and it carries a link that opens the Dark Desk's start box with the hypothesis and its own next check already in it. The desk reads the tier wherever the report states it: in a heading, in a table column, or inline in a paragraph (**Editorial readiness:** **Tier 1, ready for edit** as a service story…), and the sentence it came in is kept as an editor note.

Only when nothing in the report states a tier or a section does the desk fall back to length: a body of two paragraphs or more and 120 words or more is a **Finished story**, and a short block or a single paragraph is a lead to write rather than a draft to edit. That fallback is what a v2.5 or older report gets, and it is why a long paragraph of speculation must never be the thing that decides: on a v2.6 report the tier decides, so a 200-word Black Desk hypothesis stays a story idea and cannot arrive as publication copy. A lead the report itself flagged **DEMOTE** arrives as a story idea rather than a draft, unticked: the desk is not going to file a one-line note as a finished story, and you can tick it either way. **Import as** on the card overrules the desk whenever it guessed wrong.

A paste that is nothing but a list of ideas — bullets or numbered lines shaped **Headline — description**, or **Headline**: description — is read as one card per idea, headline and description, with no model involved.

A v2.6 full-pipeline run pasted as JSON, in the shape of the tool's `report-schema.json`, is read the same way as its markdown: same cards, same tiers, same claims. Fields the desk does not know are ignored rather than refused, so a later version of the tool still imports; a paste that is not a report at all falls back to the ordinary reading of plain text.

**Import.** The ticked stories go to the **Queue**, each as a lead marked **Imported** with a saved draft holding your paste exactly, its sources attached, and a note of who imported it, when, and from which text. A ticked story idea goes to the Queue as a lead marked **Imported** with the description as its why, waiting to be written — there is no draft, because nobody has written it. An unverified lead arrives as that and nothing more: **Unverified — Black Desk** on its card, a story idea, a lead with no draft under it. Copies of the cited pages are fetched in the background; if one will not load, the import still goes through. **Nothing is published by an import.**

**The claims ledger.** A v2.6 report attaches claims to each story, each one **VERIFIED**, **UNVERIFIED** or **CONTESTED**, with the source IDs behind it. The ledger travels with the story into its editor notes — **never into the published text** — and a card carrying a claim the run could not verify raises a warning where you can see it, before you import anything. Read it: it is the report telling you which sentences it stands behind and which it does not.

**A run that stopped early.** A report whose run says **PARTIAL** shows a banner above the cards, quoting the run's own list of what it did not get to. The cards below are the ones it finished. Nothing on that screen says the rest of the period was covered, and if you need the rest you run the scan again rather than reading the finished cards as a full sweep.

From there an imported story is a story like any other: open it, edit it, redraft it if you want to, and **Publish** it when it is right. A well-formed imported story — headline, section, body, at least one source — is not held back by the checks that exist for AI drafts, such as matching passages to cited records. The checks that protect readers still run.

**One story you already have.** When what you have is a single finished story rather than a report full of them, the desk landing page has a shorter way in, under the import panel: **Paste a story I already have**. Paste it, leave the headline empty and its first line becomes the headline, choose the section, and press **Add to Queue**. The line the headline came from is the headline and not the first line of the body: the paste that follows it is the draft, word for word, line for line, and nothing else is moved or trimmed. Type a headline of your own and the whole paste is the body instead. There is no review screen and no model reads it — its links come across as the story's sources, and it lands in the Queue marked **Imported** as a regular news story. **Nothing is published**, and the section you choose there is not the confirmation: that still happens in the story editor, on the ordinary button, before the story can publish.

---

## Sources (`/desk/sources`)

The watch list chosen during Paper setup. The Longmont edition ships with city, council, agendas, PrimeGov, planning, NextLight, St. Vrain Valley Schools, Boulder County, the library, `@CityofLongmont`, and `@LongmontPublicMedia`; a new installation starts with the sources its owner enters.

**Add one:** paste a URL, optional title, add. YouTube URLs are tagged as YouTube; everything else starts as official / tier A. The add form also carries an optional **Assign to sections** list: tick the newspaper sections this source should feed and it is filed under them as it is saved, in the same step. Opinion and About are not on that list — they are reserved pages.

**Accept one:** accepting a suggested source works the same way. Tick sections on its row first, then **Accept**, and it is accepted and filed under them together. A suggested source has to be accepted before a section may read it, so the two happen in that order; if the filing fails you are told so, rather than being left to find out at the next scan.

**Suggested sources.** The third group — **Suggested sources: N** — is everything the desk found while it worked and has not decided yet. It is built for volume: 175 waiting suggestions was normal before this screen existed, and clicking each one to read its page was the only way to decide. Each row now carries the material a decision needs, and several rows can be decided at once.

- **The reason** the pass recorded — what the page offers the paper, in the model's one sentence. A row suggested before this was recorded says *No reason was recorded when this was suggested* rather than showing a blank.
- **Suggested by** — the scan, the research pass, or the Dark Desk — and, when the pass was working on a lead, a link to it. **Anyone / The scan / The research pass / The Dark Desk / Not recorded** filter the list by suggester.
- **Section** — the model's guess, shown as the section picker's starting value. A guess for a section this paper no longer files under starts the picker empty instead, because accepting into it would be refused.
- Per row: **Accept to <section>** (or **Accept** when no section is set), **Reject**, and an optional **Note** saved with either one.
- For several: tick **Select <title>** on each row, or **Select all N**, then **Accept selected** or **Reject selected**. The batch section picker files the whole selection under one section; leave it at **No section** to accept without filing.
- Every press says **Saving…**, then what it did — *Accepted 3 suggestions and filed them under Council* — or **Nothing was changed:** and why. A batch is one transaction: either every row in it is decided, or none is, and the message says which.

Only the owner can file a source under a section — that is newspaper configuration, and **Server → Sections** is the owner's panel. If you are not the owner, the add form simply does not offer the list and the accept path does not offer the picker; adding, accepting and rejecting are still yours to do.


**Add many:** bulk paste. Formats the toolkit already taught people:

```
https://yourcity.gov/news
City Council: https://yourcity.gov/council
TIER B
Local Paper: https://www.localnewspaper.com/
TIER C
Neighborhood group: https://www.facebook.com/groups/…
```

- **Tier A** — official record. Treated as a source of fact, still checked.
- **Tier B** — news. Attributed, not gospel.
- **Tier C** — community. Scanned as a discovery clue, **never treated as fact.**

Suggested sources wait here until you accept or reject them. All three passes file what they find: the **scan** (from `proposed_sources` in its reply), the **research pass** (the public pages it actually read under a lead), and the **Dark Desk** (the pages it read while developing a file). Each one records why it suggested the page, which pass it was, and, when there was one, the lead it was working on. A page this paper already has — same host and path, however it is spelled — is never proposed again, and a search-results page is never proposed at all. A social profile is proposed only to a paper that already watches a social source: this edition ships with the city's and public media's accounts on watch, so a scan finding one is proposing what you asked for, while a paper watching no social sources will not have a Facebook group arrive on its list because a pass opened one on the way to a story. Accepting puts it on the next scan. Rejecting drops it.

Newly discovered public records are fair game even if they were not on this list. Dark Desk does not have to ask the watch list for permission to fetch a public URL.

---

## Scan (`/desk/scan`)

![Scan](images/05-scan.png)

One pass: fetch every **accepted** source, then one model read for leads and proposed sources.

- It runs **only when you click.** It is not a loop and not a cron for writing. (Monitors in the background can still notice a missing packet. They do not draft.)
- Stay on the page while it runs.
- When it files leads, open the queue. When it files nothing, that can be “nothing moved,” not a crash. The page will say which.

Scan has the same **Writing model** picker Story and the queue have, next to
**Run scan**: Automatic (the default), every named Codex and Claude model, or
Local model. Automatic uses the operator's configured gateway when one is set;
otherwise it uses DeepSeek v4.1 Flash first, then the local model this computer
has loaded, if there is one, then Codex Terra. If the first one's login
lapses partway through the run, the scan moves to the next rung once, if it
is ready, reusing the same fetched sources rather than fetching them again.
A named choice is the recorded first provider. A recognized technical failure
can move only the unfinished model call to the next ready runtime; the job shows
the switch. A refusal or unrecognized error remains terminal. The choice is per
click, not remembered between runs.

If no model is ready you get a straight refusal before anything is fetched —
nothing is spent trying. Need to connect a provider? Open **Set up a writing
model** under the picker, or see [setup.md](setup.md). If a scan is already
running on a different model, the desk tells you and points you at that run
instead of starting a second one.

---

## The queue (`/desk/queue`)

![The queue](images/06-queue.png)

Everything that might be news, scored and sorted. The scanner files here. Dark Desk can file here. So can you (“File a lead yourself”).

Statuses you will use:

| Status        | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| **New**       | Not opened yet                                                   |
| **Drafted**   | Workbench has a story in it                                      |
| **Held**      | Not now. Still on the desk.                                      |
| **Killed**    | No. Still listed under Killed if you need to undo.               |
| **Published** | Live on the paper. Lives under Published, not the working queue. |

Every active lead has its own compact **Writing model** picker beside **Draft
with AI** (or **Redraft with AI** after a draft exists). Automatic uses the
operator's configured gateway when one is set; otherwise it uses DeepSeek v4.1
Flash first, then the local model this computer has loaded if there is one, then
Codex Terra. If
the first one's login lapses partway through the
run, the draft moves to the next rung once, if it is ready, and the row shows
which provider took over and why. A named choice is the first recorded provider;
the same technical-only retry rule applies. The result appears on the same
row and names the provider the server actually queued. **Open** takes you to
the workbench to watch the draft land and edit it. Nothing prints from this
list.

### Draft selected leads

The **Draft selected leads** bar prepares up to five eligible Queue leads as
one atomic batch. Tick the leads, then choose exactly one named **Codex**,
**Claude**, **Local model**, or saved **Custom AI** connection,
including Gemini. It deliberately does not offer Automatic. Each lead keeps its
saved research scope. If the named runtime fails technically, only the unfinished
call can move to the next ready cloud runtime; a refusal remains terminal. If no
runtime is ready, or one selected lead cannot be queued, the batch does not start
and the Queue explains why.

Daily Scan offers the same named model choices and saved Custom
AI connections, and also Automatic, which the scheduler resolves to a ready
model before the run is queued. A named model is tried first;
technical preflight or mid-call switches are recorded, and refusals remain
terminal. OCR uses the same technical-only rule and considers only
vision-capable destinations.

The bar also offers an optional **Suggested focus** size of three to five
leads. Suggestions balance existing lead scores and sections. Review the
evidence before drafting. They operate on the currently loaded Queue and do not
claim an actual coverage gap. **Add suggested focus** merges them into your
current selections and never replaces them. The full Queue remains unchanged.

After a batch starts, its saved runtime and each lead's queued, running,
completed, or failed state remain visible with a link to that lead's
workbench. One failed lead does not rewrite the status of the others. Batch
drafting creates editable drafts only; opening, checking, and publishing a
story remain editor actions.

Need to connect a provider? Open **Set up a writing model** under the picker.
The same help is on the workbench and Opinion form. It links installation and
operator instructions, explains signing in on the server's account, and tells
you to reload before retrying. Opinion also explains its required voice file.

A meeting on the calendar is not automatically a story. A five-hour council tape is not automatically a story. Those are records. You decide if there is news.

### Killed — "seen again," and "maybe same as"

The scanner never throws a lead away. If a new lead looks nearly identical to
one already on the desk, the old one is stamped "seen again." If it only
looks similar, the candidate is linked to the earlier lead so you decide.
When that earlier lead was killed, the candidate starts in **Held**, not New.
You can compare it and return it to New if it contains a genuine development.

**Nearly identical — "seen again."** Killing a lead never deletes it and
never hides it. If the scanner comes back across what is confidently the same
story — the same source with a reworded headline, the same source page
pinned down with a specific date or dollar figure the first version only
gestured at, or a different portal notice about the same thing, with almost
nothing else different — it does not refile a duplicate for you to kill
twice. It stamps the existing killed row instead: a **SEEN AGAIN ×N** badge
appears on the row, in the same bordered-pill family as KILLED and ≈
PRINTED (not the muted meta text below the headline), with the date it last
came back, and the Killed tab sorts what keeps resurfacing to the top. The
first time any lead on the Killed tab carries a stamp, a one-line note
appears under the filter row: "Seen again: the scanner found this story
again after you killed it. It was not refiled. Back returns it to New."

An open lead (New, Held, Drafted) that the scanner rematches this confidently
gets the same badge instead of a duplicate row. A story that already
**printed** is never matched this way — a fresh development on a published
story is real news and always files as a new lead.

**Only similar — "maybe same as #N."** Two headlines can share real ground —
a source link, a date, a dollar figure, some of the same wording — without
being confidently the same story: two different agenda items from the same
meeting page often share a date and a figure and nothing else. When the
overlap is real but not that strong, the scanner no longer guesses either
way. It keeps the candidate on the queue (Held when the earlier lead was
killed, otherwise New), and adds a dotted
**Possible duplicate · compare #N** chip pointing at the existing lead it resembles — click
it to open that lead and compare. Nothing is merged, stamped, or hidden;
you make the call.

This matching runs entirely in code against leads already on the desk — it
never sends the AI a list of what you killed, so it costs nothing extra to
scan. When a scan run does stamp a lead as seen again, the scan's own result
summary names the headline that got merged (for example: "1 lead matched a
story you already killed and was stamped, not refiled — e.g. '…'"), and, in
the same sentence, says how many more were filed and tagged maybe-same and
how many were filed as plain new leads — so the whole picture is something
you can glance at and check, never something that happens with no trace at
all.

Nothing about "seen again" or "maybe same as" changes what Kill does: the
lead stays under Killed, and **Back** still returns it to New at any time,
resurfaced or not.

---

## The workbench (`/desk/story/…`)

![The workbench](images/07-story-editor.png)

This is where a lead becomes a story, or doesn’t.

The lead and the notes are on the left and never print. The draft is on the right. **PULL**, next to an unfinished to-do, goes and fetches that one document.

### Draft

Before **Draft with AI**, choose **Drafting scope**. **Research public sources** follows supplied links and searches for relevant public evidence. **Use only supplied material** reads your text and opens only URLs you supply; it does not discover sources or run external searches. Use this control to limit research, rather than writing “do not search” inside pasted material. The choice is saved with the queued job, including retries.

Supplied-only drafting supports every Story model, including Codex. It does not run discovery or external searches. Uploaded originals remain saved; if Automatic changes providers after an eligible technical failure, the provider that takes over rereads the retained material. The draft fills the headline / dek / body fields. You can edit every word. **Save** keeps your edits without printing.

#### The headline

The headline is the first field on the story, inside a box with a visible edge and a small **Edit** hint. That is not decoration: the headline is yours to write, at any point.

**Redraft will not replace a headline you have changed.** The desk keeps the headline the model wrote separately from the one on the page, and remembers which of the two you last decided. Once you have edited the headline — or the words on the page already differ from what the last draft wrote — a redraft keeps your headline and files the model's new attempt beside it rather than over it. If you only rewrote the body, the headline still belongs to the model and a redraft may improve it.

Two buttons sit beside the box:

- **Use the lead's headline** puts back the line the scan filed the lead under, in one press. Redrafts drift; the words the desk first read on the lead are often the ones you want.
- **Suggest headlines** asks the story model for three options and shows them as a list under the box. One click puts one in the box, and nothing is applied without that click. The desk drops anything that could not be printed, rather than offering you a headline the paper would refuse.

A headline you change on a draft is saved with **Save** like any other edit, and redrafts keep it from then on.

#### Rewriting the headline of a story already on the paper

A printed story can still be re-headed — the words were wrong, or the story moved on. Do it on the story page: the headline field loads the words that are actually on the paper, and **Save headline** changes them. The **Published** page offers the same thing: **Edit headline** beside a story opens a box under its headline.

Either way the write changes the words only. **The URL does not change**, so every link anyone holds keeps working, and the search engines keep what they have. The public story page, the front page and the RSS feed all show the new headline on their next render. The desk records what the headline used to say, which account changed it and when, so "when did that change?" has an answer.

No correction notice is published for a headline change. A correction is for a story that was wrong; the paper's correction rules have never applied to headlines. If the story itself was wrong, post the correction as well.

During public-source reporting, a captured recurring record such as an agenda, meeting page, report, packet or RFP can start an automatic background watch for later changes or disappearance. The watch does not draft or publish. This automatic behavior is separate from the editor-created watches under **Dark Desk → Watch a page / view watches**; that manual-watch panel does not currently provide management controls for automatic watches.

Changing the body of a draft with reporting evidence requires a new evidence review before publishing. Check the sources against the revised story, then choose **I checked: keep this evidence** or **Remove old evidence from public story**. Removal clears the old public source list and reporting metadata, while retaining the original in the private draft archive. It does not remove links you have written into the body. A concurrent edit invalidates an older review; reload and review the current draft.

The picker beside it controls this run. **Automatic** uses a configured
`LLM_*` gateway exclusively when present; otherwise it uses DeepSeek v4.1 Flash
first, then the local model this computer has loaded if there is one, then Codex
Terra — choosing the first ready one before enqueueing, and keeping it
for every reporting and writing pass unless it reaches a usage limit, becomes
unavailable, loses its login, or times out. Automatic moves the unfinished work
once to the next ready provider and shows the switch in the workbench. A model
content refusal stops the run. Choose a named model as the first runtime: Codex
Astra, Sol, Terra or Luna; Claude Fable, Opus, Sonnet or Haiku; or Local model.
The technical-only retry rule applies to named choices too. Redraft has the same
picker.

Choose **Local model**, then the individual model found through LM Studio, Ollama or llama.cpp. An Ollama model ending in `:cloud` runs in Ollama Cloud; the local Ollama service routes the request and the picker labels the model **Ollama Cloud** with its reported context window. A configured `LLM_BASE_URL` is also supported. Availability means the route can be reached, not that every model can finish your task. See [local-models.md](local-models.md).

Stay on the page. If the click dies before the reply comes back, the workbench
keeps looking until the draft is on the lead, then fills the form. You should
not need to reload. If a real failure happens, its message survives a reload
and includes the provider's safe diagnostic detail when available. Fix what it
names, then click Draft/Redraft again.

When the reporting hangs on another newsroom, the draft should name them and link the **story URL** so they get the traffic. A homepage or `/local-news` index is not that URL. Their rewrite is not a substitute for the company’s own announcement. If the desk only has a listing, notes ask you to pull the full URL; do not publish a paraphrase of their legal claims as if TownReporter established them.

A second box under the story, **Pulled notes**, does not print. **Pull** next to a still-to-pull line searches that item, opens what it finds, and drops the excerpt there for you to cut into the story. Redraft reads that box. The checkbox only strikes the line.

Draft is allowed to be wrong. Read it against the documents.

### Check a saved draft against its evidence

**Check draft against evidence** applies to the exact draft version currently saved for the story. Save any headline, dek, topic or body edits first, then choose the model in the workbench picker and start the check. The control stays unavailable while edits are unsaved, a save is pending or another check is active. The queued job records the model selection and does not restart discovery or initial writing.

Queued, running and failed states remain visible in a full-width progress card that names the current stage and selected model. A successful job writes a new saved draft version while retaining the original version; it does not publish or approve either one. The workbench opens **Evidence check results**, with the changed fields shown side by side, unresolved verification notes, **Keep checked version**, and **Restore previous version**. Restoring loads the previous version as unsaved text so the editor can review it before clicking **Save edits**. If the saved captures do not provide enough evidence to complete the pass, the result is marked incomplete and still needs editor review rather than being presented as checked.

Typing while the check or its final reload is running does not silently replace the editor's local text. The checked version is loaded automatically only when the fields still match the snapshot taken at the click. Otherwise the workbench preserves the unsaved buffer and offers an explicit **Reload checked draft** action, which intentionally replaces those local edits.

These controls are included in this release. A saved draft or completed check still needs editorial review.

When the writer omits a usable claim ledger, the final reporting pass may run one citation-only repair against saved public captures. It accepts a source only when an exact clause from the finished draft is paired with an exact passage from that retained capture. If none can be proved, the story remains saved and the job says **Draft saved — review required**. Opened-but-uncited pages are never attached automatically.

Reporter-notebook leftovers (`What is solid`, `Next checks are…`) are stripped from the body so they cannot leak onto the paper. If you need that thinking, put it in notes.

### Recorded finding evidence

Draft reporting uses the originating newsroom's paper settings and captured records. Public evidence links and comparisons expose records from the public newspaper's newsroom only; a matching source URL does not authorize access to another newsroom's captures. Historical capture references that point across newsrooms or to a different source URL are excluded rather than guessed or repaired.

When a draft has recorded findings, **Finding evidence review** lists those findings only; it is not an inventory of every claim in the story. Each row shows the recorded passage and locator, its cited captured record, and mechanical checks for whether that record is available, whether the passage appears there, and whether a newer capture is available. Those checks do not decide whether a finding is true: a passage match only confirms that the recorded words occur in the cited version, a missing record is not a contradiction, and a newer capture does not make the older record false.

**Claims returned by this draft pass** is a separate private inventory of only the structured claims returned when that draft was created. It is not a scan of the current body or a complete claim inventory, and later human edits do not add claims to it. A row can use only the exact captured version or capture event named in that draft's provenance for its returned URL. Missing, cross-newsroom, or repointed provenance stays unavailable; a same-URL or newer capture is never substituted. The same editor judgments are available, but no judgment is automatic and none authorizes publication.

For a body fact an editor adds or changes, use **Claims added by an editor** in the same private pane. Write the fact, choose its kind, then explicitly select one to six already captured records in this newsroom and mark each **corroborating**, **contrary**, or **context**. The selector names the exact captured version and date; it does not fetch a URL, choose a newer version, or treat several hosts as independent evidence. A changed fact or selected record reopens its judgment. A support judgment needs a readable record explicitly marked corroborating; a contradiction needs a reason and a readable record explicitly marked contrary. These rows are private review notes: they do not alter the article, public evidence, model work, or publication permission.

Choose an editor judgment of **Supports**, **Does not support**, **Contradicts**, or **Needs reporting**, and optionally record why. **Supports** and **Contradicts** require a readable cited captured version; **Contradicts** also requires a reason. **Does not support** means the cited material is insufficient; it does not assert contrary evidence. Save the draft before saving a judgment. Changes to the draft or cited record can reopen saved judgments. Another editor's save makes an older view refuse; reload the current review before deciding again. This adds no automatic judgment or publication permission, and the existing draft-wide keep/remove decision remains available.

**View cited captured version** opens the stored text privately inside the workbench. **Review newer capture** opens the newer stored version for comparison; it does not automatically change your judgment. A failed reload keeps your unsaved judgment and reason. A successful explicit reload discards those unsaved edits.

After **Save edits**, the review refreshes for the saved draft without reloading the page. Judgment controls remain unavailable while a replacement draft is queued or running, or while a draft-wide evidence decision is saving. When the replacement job completes, the workbench loads its draft and review together.

If an older record contains incomplete or unreadable structured findings, the panel says so and offers no judgment controls. Review the original material or generate a replacement draft; retrying does not repair the saved record.

### Style check

Everything else the desk checks about a draft is about whether it is true. **Style check** is the one panel about whether it reads. It is measured by code, not by a model, and it looks for shapes rather than facts: a claim attributed to nobody (**Experts say…**), a sentence that asserts importance and reports nothing, a participle tail on the end of a sentence, a dressed-up verb where **said** would do, filler, the same phrase cycling through different synonyms, a paste artifact, a tracking parameter or redirect in a link, a paragraph past the length the story form reads best under, a draft whose sentences are all the same length, a draft with no short sentence next to a long one, and the same six words repeated.

The list is at the bottom of the draft. It says how many things to fix, and for each one where it is — paragraph and sentence — what it is, and the sentence it came from. **Review** findings sit under a fold beneath them: those are for you to read, not to fix. The list measures the text on the page, so it stays current as you type. Every line is a suggestion. Nothing there blocks a save or a publish, and nothing there publishes anything.

**Fix these with the model** runs one repair pass, on demand, using the model the picker is set to. The model is given the list and the draft, and returns the draft with those problems fixed. It may not change a quotation, a number, a name or a link: a rewrite that does is refused, your text is kept, and the desk says why. The result is saved as an ordinary draft revision — the same as **Save** — so it is never a publication. The list then shows whatever is left, which may be nothing.

A model never decides what counts as a fault here. The code names the problems, the model repairs only those, and the code checks the repair.

### Reporting notes (do not print)

The notes pane is the notebook:

- What’s the news, why it matters, the angle
- To-dos you can strike and restore. **Pull** searches that line and drops the excerpt under the story. The checkbox only strikes it. Lines you type are tagged **yours**; machine-suggested checks are not. A long to-do the desk wrote itself is shortened the way a sub-editor cuts a line — at a word, without leaving half a word or a dangling comma behind — and a to-do stored by an earlier version can always be saved back, however long it is. A long to-do on the list is never a reason a save or a publish is refused
- If the notes themselves fail to save, the desk says so in one plain sentence and the story still saves and prints. Your notes are never the reason a valid draft stays off the paper
- Claims and sources — load-bearing facts with URLs
- What you found, what still needs a check
- Pages you opened

**Research memo** persists across redrafts. A new Draft with AI will not blow away the memo. The memo never prints.

Write like a reporter talking to yourself. None of this is copy.

### Publish

Claims that a record does not exist have a separate publication safeguard. The
application searches before asking for confirmation; review the actual records
and the visible check rather than confirming an absence because one fetch
failed. Tool-status language is not a report about the town.

**Publish in \<Section\>** saves, then puts the story on the paper. The button names the section the story will print under, because that is the decision the press carries: it records your confirmation of that section for the exact version being printed, and then publishes. There is no separate Confirm button to find first. A small **change** link beside the button puts your cursor in the section chooser if the name is not the one you want — and the button takes the new name as soon as you pick it.

When the desk could not place the story, the section reads **Section not chosen — pick one** and the publish button is disabled, with that reason printed beside it. Pick a section and it lights up. The desk will not print a guess.

The server enforces the same thing, not just the button: it refuses a draft whose section nobody confirmed for the version being printed, and if the section your request carried is not the one on the draft, it says so in plain words instead of printing the wrong section. Every time the section that printed is not the one the scanner chose, the desk records it — the lead, both sections and the time — and Stats counts them under **Section chosen by hand**.

After that it has a public URL under `/articles/…`. Provenance (source title, organization, document date, exact URL, capture time) goes with it when the records resolve.

Before you hit it:

- Every material number, name, date, and quote has a document you can show.
- If the only source is a YouTube caption, you have checked the packet or the minutes, or you have written the story as “on the tape,” not “the minutes say.”
- You are willing to put your name on it. The software will not.

Hold or kill from the queue if it is not ready. There is no shame in a held lead.

---

## Follow-ups

Use the story workbench to record who you asked, what answer is needed and
when it is due. The desk rail shows outstanding requests; **All follow-ups**
opens the full list at `/desk/follow-ups`, with Open, Answered and Dropped
filters. It is reached from the rail and story, not a separate main navigation tab.

**Record reply** keeps the response and adds it to the linked story's reporting
notes. **Nudge** records that you followed up; it does not send an email or
message. **Drop** stops tracking the request without pretending it was answered.
Check the linked story before drafting from a reply; a response is attributed
reporting material, not automatically a proven fact.

## Meetings and tapes

Longmont’s desk watches three kinds of meeting record. They are not interchangeable.

| Record                              | What it is                                        | Treat as                              |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------- |
| **Packet / agenda PDF** (PrimeGov)  | What staff put in front of the body               | Official, still read it               |
| **Minutes** (PrimeGov, when posted) | The official action                               | Official                              |
| **YouTube tape + captions**         | What was said, including asides and “skip it all” | A map of the meeting, **not minutes** |

How they join: a council video titled like `08/25/2026` joins that day’s packet. A planning video about 206 S. Main joins the Avis notice in that packet. Month must match — June’s museum board is not August’s.

**Captions:**

- Auto-captions invent names. “Kimbark” will come out as something else. Do not publish a proper name off a caption without a check.
- Quotes need a check. Play the tape or read the packet.
- Upcoming livestreams have **no transcript yet**. The desk rechecks; you do not invent one.
- Any extra channel listed under **Paper setup → Meeting video channels** is a sister tape. If the first channel has no captions, the desk can use a matching tape from one of those channels. Same rules.

**Minutes not posted** after 36 hours (council / commission / board / authority, skipping cancel / continued / TBD) is a catalog note. It is a reason to look, not a story by itself.

Dark Desk is told: search the whole tape; names may be wrong; quotes need a check. It will still guess. You are the check.

### Meetings with no captions (speech-to-text)

Some tapes have no captions at all, so capture ends at the audio. If the owner
has installed **textflowkit** on this machine and named it, the desk can listen
to that recording and write a transcript from it. The pass you already run —
**Run meetings now**, or the scheduled one — queues that work; there is nothing
extra to press. One recording is transcribed at a time, it can be stopped, and
if the machine restarts mid-run the desk picks the work up again. What the desk
does with it afterwards is the same as for a caption transcript: alignment,
citations with timestamps, drafts, and the publish checks all read it the same
way.

Two things to keep straight.

**It is not the city’s record.** The desk labels these rows, next to the
transcript’s hashes, as *speech-to-text (Whisper via textflowkit), not official
captions*. Everything already said about auto-captions applies, and more
sharply: a machine listened to audio and wrote down what it thought it heard.
Names, numbers, and ordinance titles are exactly where it is most confident and
most wrong. Play the tape before you print a quote or a name from one.

**The desk says whether it is available.** **Server → Meeting capture** shows
one line: *Speech-to-text: textflowkit 0.1.6 (model small, language en)* when it
is there, or *not installed … meetings without captions stay audio-only* when it
is not. If that line says not installed, a captionless meeting staying
audio-only is the honest outcome, not a fault.

A transcription that fails — the tool missing, the audio unreadable, or the run
running past its allowance — leaves a named reason on the meeting row and keeps
the recording exactly where it was. The next pass retries it. Nothing is written
over: the audio is never deleted, and a transcript is never stored unless the
recording it came from still matches the hash the desk recorded for those bytes.

If captions turn up later, they are a new revision like any other, and the
same rules apply — including the review step when a transcript changes after
publication. Speech-to-text never overwrites a caption transcript.

### From a meeting recording to a story

After channels and title keywords are saved in **Paper setup**, an owner can
open **Server → Meeting capture**, enable meeting capture, and choose **Run
meetings now**. This on-demand pass does not consume the scheduled daily run;
you can start another pass when you need one. While it is running, **Stop**
asks the active pass to stop. **Resume stopped captures** continues eligible
partial captures already on disk; the result says how many resumed and how many
had no partial file. **Force re-capture and retain revision** is for one
specified video when you need to check whether its recording changed.

Open **Scan → Captured meetings** to see what the pass found. Each row reports
capture and alignment state. When the system filed a lead, use **Open the
story** from that row: it opens the Queue/story workbench, where the generated
draft can be reviewed, edited, or redrafted. A captured transcript is not a
promise that a story was generated: a failed capture, unaligned agenda, or
lead without a draft is shown as such. Alignment and citations help you locate
the recording; they do not establish that every claim is true.

Use **Story direction for AI** in the story workbench to name the decision or
question you want the draft to cover, then choose **Draft with AI** or
**Redraft**. An exact ordinance or resolution number is matched to the
captured transcript; if that named measure is absent, the draft is refused
instead of switching to a different meeting story. **Pulled notes** can give
the writer leads to check, but they are not independent evidence and do not
print. Review the saved story and its used citations before publication.

In the story workbench, **Where this draft came from** shows the persisted
transcript citations actually used by the current saved draft. **Transcript
material considered** is a separate candidate list and is not proof that the
draft used those passages. Click a timestamp to open the recording at that
point. If a newer transcript exists, the workbench names the old and current
artifacts, compares cited excerpts where a timestamp match is available, and
offers **Redraft and reverify citations**. A missing comparison is labeled
unavailable; it must not be treated as confirmation. Publishing remains
blocked until the current transcript is used and its citations are verified.

A meeting draft is also checked for speaker identity before you see it. A name
the check cannot resolve is replaced in the saved copy with neutral wording —
“an unidentified speaker” — including a two-word office, so “Mayor Pro Tem”
does not survive as a loose title in front of a masked name. That mask records
what the desk could not verify; it does not verify anything. If a name matters,
read the passage and restore it yourself.

Two honest limits on this path. Vote extraction refuses to guess: structured
votes come back **not established** rather than inferred from prose, so a tally
or a mover can appear in a draft with no citation behind it. Check the tape
before you print one. A capture can also fail because YouTube rate-limited it
(HTTP 429); the desk retries that video on a later pass instead of inventing a
transcript.

If a transcript changes after publication, open **Published**. The page puts
pending transcript reviews first, shows the old published evidence beside the
current recording, and requires a note plus checking every cited passage to
mark it still accurate. That records the accepted artifact B evidence without
rewriting the article's original artifact A provenance. If the story needs a
change, choose **Needs correction**, write the correction, and use **Publish
correction**. Completed review history remains with the published article; it
does not silently edit the printed story.

### Finding videos with Google's official YouTube Data API

**Where the key goes:** open **Server → YouTube** (the direct link is
`/desk/ops#youtube-key`). Paste the key, then **Save key**.

**Making the key.** In Google Cloud, create a project, turn on **YouTube Data
API v3** for it, then create an API key and restrict that key to the YouTube
Data API. TownReporter pays nothing for this: the API allows 10,000 units a
day free, and every call this desk makes costs 1 unit. It never uses
`search.list`, which alone would cost 100.

**The key is write-only.** It is encrypted before it is stored and it is never
sent back to the page — the box says *A key is saved* or *No key*, and there is
no control anywhere that shows the key again. If you lose it, make a new one in
Google Cloud and paste that; there is nothing to recover here.

- **Test** spends one unit and asks Google about the first channel the desk
  watches. It answers *Key works. Google answered for the channel …* or
  Google's refusal in plain words, for example *Google says this key is not
  allowed to use the YouTube Data API. Check that the key is right, that the
  YouTube Data API v3 is turned on for its project, and that the key is not
  restricted to another API.* Type a key and press **Test** to check it before
  saving it — a tested key is not stored.
- **Remove** takes the key back out. The desk reads the public feed again from
  the next scan.
- **YouTube units used today: N of 10,000** sits next to the box, so you can
  see a scan eating into the day's allowance before it runs out.

**What changes with a key set.** Channel videos, durations and live/upcoming
state come from Google's documented service instead of the channel page HTML,
the public RSS feed, and the yt-dlp listing. The scan receipt says which reader
actually ran — *Read YouTube with the official API.* or *… Read the public feed
instead.* — and the Meeting capture line names it too, so a short list is never
mistaken for a thin channel when the desk had in fact fallen back.

**What does not change.** Transcripts and media still come from yt-dlp and
textflowkit. The API cannot download captions for videos this desk does not own,
so nothing about caption or audio capture moves.

**When the allowance runs out.** Google resets it at midnight Pacific. On the
day Google refuses for quota the desk stops asking, says so under the key box,
and reads the public feed for the rest of that Pacific day rather than spending
more calls on refusals. It tries the official API again the next day. A key
that is missing, rejected, or unreachable at any moment falls back the same
way: the scan keeps running on the public feed and says so, instead of failing.

An owner can also put `YOUTUBE_API_KEY` in the app's environment. A key set
there is used in place of any saved one, and overrides it — see `.env.example`.

---

## Dark Desk (`/desk/dark`)

The recursive investigative lane. **It never publishes.** Publication is a separate human action on the queue / workbench.

![Dark Desk](images/08-dark-desk.png)

An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. Unknown, weak, speculative, and previously-dead trails stay investigable. That is on purpose. Curiosity is not a gate.

### Three piles

| Pile            | Meaning                                                             | What you do                          |
| --------------- | ------------------------------------------------------------------- | ------------------------------------ |
| **To look at**  | New. Nobody has opened it.                                          | Start digging                        |
| **On the desk** | Started. Includes files that stopped because there is more to read. | Open file / Keep digging / Set aside |
| **Set aside**   | Parked or finished. Nothing is deleted.                             | Pull back / Read                     |

Start digging **moves** a card from To look at onto the desk. The card stays on To look at, with a status line, until the file actually opens. A failed click says so — it does not vanish. Close file leaves it on the desk. Set aside files it. Pull back restores it.

A research round is a short batch, then a stop. Remaining pages stay on the file. That stop is **not a failure** and not “too many leads.” Keep digging reads the next batch.

Keep the file open while its research job is running and Dark Desk refreshes that file through later synthesis, verification and brief writing, even after the round counter has paused. The final brief or a persistent run error appears without a manual reload. This watches only the file currently open; if you switch files, reopen the first one to read its latest saved result.

### Which model digs

Next to **Keep digging** there is a **Digging model** picker, the same one the
queue and the workbench have: Automatic; Codex Astra, Sol, Terra and Luna;
Claude Fable, Opus, Sonnet and Haiku; Local model; and saved custom connections.
Dark Desk Automatic uses a configured gateway when present; otherwise it uses
DeepSeek v4.1 Flash first, then the local model this computer has loaded if
there is one, then Codex Terra. Planning uses Claude Haiku or the cheaper Codex
planning model. If synthesis times out, only synthesis moves to the next model;
completed searches and document reads do not run again. A model you name is the
recorded first choice. A recognized technical failure can move only the failed
model call to the next ready runtime; a content refusal stops the run.

The choice is checked before the round starts. If no model is ready, the desk
says so and nothing is spent.

A file remembers its requested first runtime, so Keep digging starts the next
round with that choice even when an earlier call needed a recorded technical
retry. Change it whenever you like; the next round uses the new first choice.
**What Dark Desk did** — the round history at the bottom of the page —
names the model that dug each round.

While a round runs, the open file names the real stage and shows elapsed time,
model calls, searches and document reads. The saved run keeps those totals and
the per-call provider, model, duration, result and timeout. Token totals appear
only when the provider reports them. A whole-run ceiling applies across every
stage, and the final line says whether the run stopped for sufficient evidence,
repeated sources, diminishing returns, no material new finding, or a resource
limit.

This arrived in 0.6.2. Before that, Dark Desk was the one screen with no
picker: rounds ran on whatever the machine was configured for.

### The open file

The reading list comes first.

- **What to read** — pages and documents already captured. Title, excerpt, Open original, Read captured copy.
- **Still unopened** — names and links mentioned that have not been fetched yet. That is not the reading list.

Empty editorial sections stay hidden until they have content.

Do not send yourself to the public `/evidence/…` routes for unpublished captures. Those pages only show records cited in a **printed** story.

Plain English on this page. If you see “hop,” “frontier,” or a raw TypeError, that is a bug in the UI, not a task for you.

Worth a look ranks missing reports, disappeared records, monitor alerts, reopened trails, open promises, and high-newsworthiness leads. Ranking is not a gate — you can still open anything.

Full UI contract: [dark-desk-editor.md](dark-desk-editor.md).

### How hard to dig — the two dials

![The dials](images/09-dark-dials.png)

Under the piles there is a panel called **How hard to dig**. Press **Change** to
open it.

| Dial                        | What it moves                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Dig — how far it chases** | Hops, searches, whether it may leave the watch list, how far it follows a name into a company, a parcel, a contract |
| **Nerve — how speculative** | How sure it has to be before it writes something down, and whether it may propose a theory or only ask a question   |
| **Map**                     | City · county · region · adjacent — how far out it is allowed to look                                               |

The paragraph above the sliders is not decoration. It is written from the same
rules the run itself uses, in plain words: _"Up to 3 hops, following any public
record it finds, including archived copies. One account is enough to open a
file. No confidence floor at all — it writes the hunch down and labels it a
hunch."_ If the paragraph says it, the run does it.

**Presets** are there for the two ends. A low, careful setting for a file you
intend to publish from. **Black Sky** for the night you want it to go as far as
it can.

Three things never move, at any setting:

1. It will not invent a claim that someone was paid.
2. Everything it writes down is labelled with how mature the evidence is —
   fact, observation, allegation, inference, hypothesis, unknown.
3. Every theory carries what would kill it.

Turning Nerve up does not make it more confident. It makes it willing to write
down a weaker thought — **and say that it is weak**.

---

### Watch a specific page in Dark Desk

Open **Dark Desk → Watch a page / view watches**. Enter a public URL, a name and why it matters. Optionally select an investigation: its readable captures will be attached there automatically. Choose the model used if a scanned PDF needs OCR, then **Save watch and capture page**. The watch is saved before the first check; a pending check is not a captured record. An already-watched URL opens the existing watch without renaming it or moving its investigation.

Daily checks require the existing local scheduler. **Check now** uses the same guarded fetch and capture path. History distinguishes a first capture, unchanged text, changed text, a moved page, source blocking, unavailable pages, failed checks and unreadable or refused files. Redirects show their trail and whether text also changed. A failure never replaces the last readable comparison baseline. The readable diff is a bounded text comparison, not a claim that every visual or structural page change was found. Open the stored text, download its complete current or previous copy, or follow **Open original** to inspect the source.

For a readable capture, choose an active reporting section and **Create unverified lead**, or choose a file and **Attach captured record**. Feedback links to the lead or investigation; the capture's history keeps that outcome after a refresh. **Dismiss change** retains the capture. A removed handoff target is reported as removed instead of being silently recreated. No check automatically creates a lead, drafts or publishes. **Pause**, **Resume** and **Stop watching** retain history; paused and stopped watches do not run checks. An interrupted check can be retried after its 30-minute lease expires. These investigative watches are separate from accepting an ordinary source for story scanning.

### Choose an investigative search window and adversarial-review limit

On Dark Desk, open **How hard to dig → Change**. Choose a lookback of 1–3650 inclusive UTC calendar days (default90; one day means today in UTC) or an inclusive start/end UTC calendar range, then choose 1–24 signals for adversarial review per round (default6). **Save** confirms the stored settings; reload to verify a save whose response failed. A validation error explains the rejected value. A settings-read failure offers **Retry settings** instead of showing invented defaults.

These controls are independent of dig, nerve, map and county. Presets retain your date/count choices. Each new round saves a snapshot before work starts, so a mid-round edit affects later rounds. More attempted signals can cost more model calls and time. The round summary shows protocol-complete signals out of all eligible signals, attempted, protocol-incomplete (including failures), and saved for later review. The questions describe research completeness and never block editor handoff. Search dates guide queries and providers; always check dates in the captured evidence.

## Opinion (`/desk/opinion`)

![Opinion](images/10-opinion.png)

Where the paper says what it thinks.

Use **Add documents** or drop files into **Start with your documents**, paste source text, or supply URLs. Keep the writing instruction separate from the evidence. Then press **Write an editorial**. See the [current desk guide](editor-desk.md) for limits, progress, recovery and where the finished draft appears.

Choose **Automatic**, any named Codex or Claude model, or **Local model**;
saved custom connections are offered too. Codex Sol is selected by default.
**Opinion's own Automatic** tries
Codex Sol, then Claude Sonnet once if Codex is unavailable — that order belongs
to Opinion. Stories, scans and Dark Desk walk the desk's own Automatic ladder:
DeepSeek v4.1 Flash, then the local model on this computer when one is loaded,
then Codex Terra; Claude Sonnet is a hand pick there. An explicit choice
remains the requested first runtime; a recognized technical failure can move
only the unfinished call and records requested and actual model and effort.
A content refusal is terminal. Claude and Codex both read the complete configured voice through their native instruction-file options.
Readiness lists every missing prerequisite — voice file, installation, or
login — before the button is enabled, and the server checks again when you
click. If OAuth expires, open the named provider on this machine and sign in;
nothing is queued or spent until the next readiness check succeeds.

The Codex path uses the signed-in account for authentication, but the reporting
call does not inherit the operator's full Codex setup. TownReporter launches it
ephemerally from the system temporary directory with a read-only sandbox and
disables shell, computer, browser, apps, plugins, multi-agent and hook features.
Native web search is enabled only for an explicitly authorized research call.
Opinion receives its configured voice separately. These are application-level
CLI controls, not an operating-system security sandbox; the process still runs
as the Windows account, and read-only mode alone does not restrict file reads.
Claude Code separately omits the operator's `CLAUDE.md`, skills, plugins and MCP
configuration and runs in restricted safe mode. Research calls allow only
`WebSearch` and `WebFetch`; planning calls hide tools; OCR reads one generated
temporary page. The reporting job has no shell, arbitrary file, browser or
agent tools.

What comes back:

- `OPINION:` at the front of the headline, so it cannot be mistaken for a
  report.
- **No byline.** An unsigned editorial is the paper's position, not one
  writer's. That is the century-old convention and the honest one for a paper
  run by one person.
- **Claims and sources** at the end of the piece. People do not believe an
  op-ed they dislike; the receipts are there for them.
- An editor's fact sheet and an image prompt that **do not print** — they are
  for you.

The desk checks that the delivery is actually an editorial before it files
anything. A provider refusal, limitation note, neutral-summary substitute,
implausible headline, or incomplete body makes the row **Failed** and creates no
draft. There is then no Read, Edit, or Publish action to mistake for success.
Opinion's Automatic can move from Codex Sol to Claude Sonnet once. A named
choice is tried
first and the same technical-only unfinished-call rule applies. A finished row
names the requested and actual model and effort. Opus is never selected by an
unattended ladder, on any surface.

**Edit** opens the piece in its own editor. That is where you change the
headline, fix a line, print it, or throw it away. The fact sheet and the image
prompt sit under the piece there, marked _does not print_.

Earlier measured runs took **ten to forty minutes**; that is an observation,
not a deadline. The current research and writing passes each have a default
45-minute ceiling. The Claude pair can therefore take about 90 minutes.
Explicit Local model makes one writing call using the supplied material; it
does not run the frontier research pass. The row
shows a clock counting up and a moving rule; at 3:40 that is normal, not stuck.
The page rechecks every twenty seconds.

### Add your own AI API

Owner editors can open **Server → Add your own AI API** to save a named
OpenAI-compatible endpoint. Enter its base URL, optionally enter a key for
server-side storage, then discover models or type a model id manually. Save
before discovery, and use **Test connection** when the endpoint is enabled;
the result shows the tested chat-completions capability alongside response and
model-discovery status. These are diagnostics, not a guarantee that a later
run will finish.

Use **Edit** to change the name, URL or model; leave the key blank to retain it
or explicitly remove it. **Disable** keeps the record but removes it from
pickers and actions; **Enable** restores it. **Delete** is permanent. Selecting
the saved name in a Scan, Story, Opinion or Dark Desk picker makes that endpoint
the recorded first runtime. A recognized technical failure can move the
unfinished call to the next ready runtime; a refusal or unrecognized failure is
terminal. The Opinion voice accompanies that authorized retry. This is a supported connection
workflow; see [the detailed connection guide](custom-ai-connections.md).

An editorial is a **draft**. Read it, edit it in the story workbench, and
publish it like any other piece — or don't. It will happily conclude that your
lead was wrong; one real run opened with the discovery that the record it was
sent to attack had never been missing at all.

---

## Server (`/desk/ops`)

![Server](images/11-server.png)

Historical 0.5.1 screen: it illustrates the older operator-managed installation,
not the controls available in a new Windows package.

For the **Windows installation package**, Server reports this installation's
version, work queue, private database and local HTTP readiness. The work queue
separates current queued/running counts and the latest terminal result by
workflow from retained failure history; old failures stay visible without
making an idle queue look currently failed. **Run health
check** is read-only: it does not repair anything. **Restart the paper** asks for
confirmation and restarts only this installation. Local readiness does not prove
that a public address or tunnel works. The package installs no tunnel, watchdog,
scheduled tasks or automatic five-minute repair; unavailable maintenance actions
stay disabled. Use its own Start/Stop launchers if the desk cannot be reached.

For a **separately configured legacy installation**, the Health list can also
report the operator's public URL, Cloudflare tunnel and watchdog task. Those
checks run from the server machine, not from a reader in another town. A missing
or stale watchdog result needs operator investigation; do not assume repair will
happen. Legacy task ownership must be configured as described in
[SELF-HOSTING.md](../SELF-HOSTING.md) before those controls are available.

Every available maintenance action explains its effect before you run it.

The daily scan controls on Server are available to the owner.
They start disabled. The owner chooses a local time in the paper's configured
timezone, selects as many as 12 accepted sources from any reporting beat, and
chooses the model for each scheduled run. **Automatic** is the default for a
newsroom that has never saved the schedule, and works down the same writing
ladder a story uses: DeepSeek v4.1 Flash first, then the local model if one is
already loaded, then Codex Terra. The owner may instead name one explicit
model: Codex Astra, Sol, Terra, or Luna; Claude Fable, Opus, Sonnet, or Haiku;
the already selected local model; or a saved Custom AI connection such as an
OpenAI-compatible Gemini endpoint. A legacy saved
"Claude Code subscription" setting opens as Claude Sonnet. A technical preflight
or model-call failure can switch only unfinished work and records the requested
and actual model and effort. A schedule saved before 0.6.64 keeps the model it
names — nothing rewrites a stored choice on its own; the owner switches it to
Automatic by hand. Because the reservation is written before the run is queued,
Automatic is resolved to a ready model at that point, and the record shows the
requested and the resolved model as a pair. Custom credentials stay encrypted in newsroom
settings and are resolved only when the run starts. It reads bounded excerpts from the selected
sources; it does not claim full-site coverage.

At most one reservation is kept for each local calendar day, and only one
daily run may remain queued or working for a newsroom. If the app was off at
the scheduled time, the next scheduler tick that day runs the missed scan; it
does not replay every missed day. **Pause** and **Resume** retain the settings.
Disabling or pausing the schedule, changing its revision, removing the owner's
role or losing the job lease stops the older run before further external work
or final result writes. A subscription quota error pauses the schedule until
the owner resumes it manually; the desk does not invent a reset time. Use
**Open scan history** to inspect scheduled scan results and **Open the queue**
to review any leads. A daily scan files leads only: it does not draft, publish or send digests.

Routine notice permissions on Server are preparation only. The owner may save exact accepted source-and-format pairs, pause them, and read their recent permission changes. If a source is later rejected, removed, or changes address, its recorded pair stays inactive. Pause keeps that record. The owner must explicitly revoke it, or explicitly select the current accepted address to replace the prior address; a changed address is never selected automatically.

The same panel can manually check all six approved structured formats: Schema.org Event data for library, parks/recreation, and community/arts logistics; explicit Schema.org application deadlines and dated library hours; designated RFC 5545 calendars for deadlines and waste schedules; and PrimeGov meeting logistics. Permission-only Event checks and non-calendar application-deadline checks work without saved automation context. Calendar-based registration deadlines require the saved issuer and locality; waste schedules additionally require the owner-entered collection area; public-meeting logistics require the saved issuer, locality and timezone; and library structured hours require the saved issuer and branch. Save those fields in **Automatic routine editions** before activating dependent formats. A check stores the bounded captured source and reports structurally parsed candidates, refusals, and conflicting entries in the same observation. **Parsed** means the fields fit the selected format; it does not verify the issuer, facts, eligibility, completeness, or authority. Checks do not start a monitor, create a lead or draft, or publish anything. Only the owner can open a check's bound captured source, and a changed or removed capture is refused instead of substituted.

**Automatic routine editions** is a separate, owner-only control and starts paused. Select no more than 12 approved structured sources, enter the authoritative issuer and locality, give each one a public attribution address, choose the Today, Weekend, and Deadlines sections, and review the displayed attribution format before activating. A private or personalized fetch address is never printed in the article. Waste calendars also require an owner-entered collection area; do not use a household address. The daily scheduler creates **Today in town** after the chosen local time, **This weekend** on Friday for Friday through Sunday, and **Deadlines approaching** only for a new or changed deadline in the next seven days; it is not a continuous source watch. An approved source change can correct an automation-owned edition on a same-day rerun. It publishes no empty edition and uses at most five logistics items in a run.

The generated copy is limited to validated dates, times, places and service or program text, plus the configured public source links. Registration URLs are required structured input for deadline eligibility but are not separately rendered in the generated body. Allegation, dispute, investigation, medical, legal, emergency, conflicting, cancelled, recurring, ambiguous, or unsupported material stays out and is counted for review. Changing permissions, activation, ownership, a source address, captured evidence, or the worker lease cancels the old commit. An unchanged retry is idempotent. A changed automation-owned edition gets a visible correction; a manually edited, removed, or unpublished article is left for review. Recent runs show published, corrected, eligible, and review counts with links to published editions. Disable the control to stop later reservations; permissions remain separate and can also be paused.

Owners also have:

- **Paper setup** — change the public identity, timezone, contact links, watch
  list, meeting-video channels and meeting-title keywords. Saving takes effect
  from the database; no rebuild is needed.
- **Invite an editor** — enter the person's email, then copy the one-time link.
  It is valid for that address only, expires after seven days and disappears
  after use. TownReporter does not send it for you: you send the link
  yourself, however you'd normally reach that person. Next to the link is a
  ready-to-send message with the same explanation spelled out (one-time
  link, seven-day expiry, opens "create account" mode, no code to type) --
  **Copy message** puts it on the clipboard so you don't have to compose it.
  What the invited person sees: they open the link, land on the sign-in page
  already in create-account mode with their email filled in, choose a
  password, and they're an editor. There is no code to type anywhere -- the
  link itself is the credential, and it only works once.

---

## Stats (`/desk/stats`)

Read-only, editor-only. Right after Server in the nav.

Shows anonymous page loads, not unique people or completed reads — no cookies,
no fingerprinting, just a count of how many times an instrumented page loaded.
Three things:

- **Site** — all-time total, last 7 calendar dates including today, and last
  30 calendar dates including today, added across the home page and published
  story pages. Other public pages are not included.
- **Stories** — every published story, ranked by all-time story-page loads,
  linking straight to the story.
- **Section chosen by hand** — how many published stories printed under a
  section the scanner did not pick. Not a view count: it is here because this is
  the page that says how the desk is doing, and the number only means something
  next to the story counts. Each one is a decision you made, logged with the
  lead, the section the scanner chose, the section you printed under, and when.
  A story whose model section was never recorded is not counted — an absent
  record is not a disagreement.

A view is counted by a small beacon that fires from the reader's browser
_after_ the page has already loaded, so it can never slow the paper down —
and if counting ever fails for any reason, the public page is completely
unaffected; this page just shows nothing new until it recovers. Views are
scoped to your newsroom.

---

## Signing in to a writing model

The desk writes through one of two programs installed on this machine —
**Claude Code** or **Codex** — using the subscription you already pay for.
When one of those logins runs out, every draft fails with "sign in again". The
**Writing models** panel at the top of the Server page is where you fix that,
without opening a terminal.

Each row tells you three things in words: whether the program is installed,
whether it is signed in (and as whom, where the program will say), and whether
you have turned it off yourself.

- **Sign in** starts the program's own sign-in and shows you what it prints. For
  Claude Code that is a link: open it, finish signing in there, and the row
  turns to "Signed in" by itself within a few seconds. For Codex it is a link
  **and** a one-time code — open the link, type the code, and the row flips the
  same way. There is a countdown, and a **Cancel** if you change your mind.
- **Test** asks the model for one word and tells you how long it took. This is
  the only button that proves the desk can actually write: a login can look
  present and still be refused by the provider, and nothing but a real question
  tells the difference.

There is no **Sign out**, on purpose. Signing out is one mis-click away from
stopping the paper, and nothing here needs it — a stale login is fixed by
signing in again, not by signing out first.

**Being signed in to claude.ai in your browser, or in the Claude desktop app,
is a different login and does not count here.** Those keep their own
credentials. The desk only sees the command-line program's login, which is what
this panel shows and what these buttons change.

When a draft or a scan fails because a login has lapsed, the error itself now
carries a **Sign in to Claude Code** / **Sign in to Codex** button: pressing it
starts the sign-in and takes you straight to this panel with the link waiting.

### How long a model may take

Each model in this panel has a **Time per call** field: _how long the desk
waits for one answer before giving up._ It shows a number of seconds and, next
to it, the number this desk ships with, so a changed value reads as a decision
rather than as the way it has always been. **Save** stores it; **Reset** — which
only appears once you have stored something — puts the shipped number back.

Owner only, like everything else on this page.

Most people never touch it. The reason it exists: a model running on this same
machine can take four minutes to read a long document pack, and the shipped
ceiling of two and a half minutes would report that as a failure every time.
If a provider keeps timing out on long reads and you know it is working, this
is the number to raise. Anything between 10 seconds and 60 minutes; type
something outside that and the field tells you the range rather than quietly
picking a different number for you.

Raising it does not make a model slower or faster. It only changes how long
the desk is willing to wait.

---

## Delete

Every list has a **Delete** button: leads in the queue, editorials on Opinion,
and stories under Published. It asks once, in the row, and says what it costs.

**Kill is not delete.** Kill parks a lead under Killed and you can bring it
back. Delete removes it.

| Delete this       | And this happens                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A lead            | It goes, and any draft on it goes. A story already printed from it **stays on the paper** — that is a separate button.                      |
| An editorial      | The draft goes. If it was printed, the printed piece stays; remove that under Published.                                                    |
| A published story | It comes off the paper. Its URL becomes a 404, the feed and sitemap drop it, its corrections go, and anyone holding a link has a dead link. |

That last one is the loud one. The paper's normal answer to being wrong is a
**correction**, in public, above the story. Delete is for the thing that should
never have existed — the wrong name, the private detail, the piece filed against
someone it should not have been.

### It is not gone yet

Ordinary **Delete** sends work to Trash first. The owner-only legal-removal process below has a separate, irreversible policy.

- An **Undo** link appears right where you deleted it. One click and it is back.
- After that, it waits **30 days** under **Recently deleted** on the Server
  page (`/desk/ops`). **Restore** puts it back exactly where it was — a story
  keeps its URL, its corrections come back with it, an editorial keeps its fact
  sheet.
- **Delete for good** on that list is the one with nothing behind it. It says so.
- After 30 days it goes on its own.

**Delete for good** removes the application's trash copy. It does not scrub existing database backups. Use the separate owner-only legal-removal workflow below for its reviewed scope and retention policy; ordinary deletion is not proof that all retained copies are gone.

---

## Legal removal: owner workflow

Open **Published → Legal removal** beside a story, or **Published → Legal removal cases** to revisit a case. Editors cannot use this process. Ordinary Delete still uses 30-day trash; legal removal has no Undo.

1. Select the affected stories and **Review connected copies**. All stories sharing a lead must be selected before its reporting records can be removed. Review the counts and historical candidates. Old drafts, memory, audit labels and trash do not always carry article IDs; select only the records in scope. Selected entries remain visible and can be unchecked. Mixed trash requires explicit whole-snapshot selection. Changed records require a fresh preview.
2. Review independent evidence. Known same-paper URL copies and references in captures, chunks, original blobs, source snapshots, search results, associated frontier records, source/monitor descriptors and watch history are listed but **not automatically deleted**. These known copies block court destruction even with the evidence checkbox checked. Retained application removal may proceed with review explicitly pending. A local operator must resolve unsupported captured-copy cleanup; a checkbox does not establish erasure.
3. Choose the policy. **Keep an owner-only copy for 12 calendar months** uses the calendar anniversary, with February 29 clamped to February 28 in a non-leap year. This is owner access control, not encryption. The existing scheduled tick and case-list reads purge expired copies. Expired text cannot be opened even if cleanup has failed. **Explicit court destruction** never inserts removed text into the retained-copy table and requires the historical/evidence scope to be resolved first.
4. Enter a case identifier without story text, type **REMOVE**, and confirm. The transaction removes selected application copies, scrubs exact linked editorial source descriptors and blocks stale filing/restoration. Independent editorial drafts remain for review; interrupted writing must be restarted with reviewed sources. Foreign-newsroom relationships refuse removal rather than cascading into another paper. Matching automatic watches are paused and ordinary sources are excluded from scans, preserving their evidence for review. Stop remains available; resuming a removed article's watch is refused.
5. The result opens its case. **Open owner-only retained text (audited)** is available until expiry under the retention policy. There is no restore button. Record affected backup identifiers and operator cleanup attestations here. An attestation records what an operator reports; it is not independently verified erasure.

Fresh public article/feed/sitemap reads stop returning removed stories. Existing browser caches, downloads, external search caches, provider history, database logs and backups are outside the application's erasure proof. An older database restore can reintroduce removed content; the local operator must reconcile removal cases before serving restored data. Exact known URL checks include query/fragment/trailing-slash and percent-encoded slug aliases. Unlinked prose, malformed historical records, old deployment origins and unknown external copies still need owner/operator review. Do not treat this workflow as proof that no copy exists anywhere.

---

## Published and corrections (`/desk/published`)

![Published](images/12-published.png)

What is live on the paper, with its corrections.

**Edit headline** beside a story rewrites the words at the top of it without touching anything else. It opens a box under the headline that is on the paper now, so you are looking at what you are replacing. The URL does not change, no link breaks, and the desk keeps the old headline, your account and the time. This is the one part of a printed story the desk lets you change without a notice, because the words are the story's name rather than its content.

If you got it wrong: open the story here, write the correction in the open, post it. It appears on `/corrections` and with the article. Do not silently rewrite a published piece and hope nobody notices. We would rather look careful than look first.

The correction box no longer starts empty. Above it are two short lines — **What was wrong** and **What is right** — and you type the fact, not the sentence: *the fee was $4,200* / *the fee is $2,400*. Then either button fills the box below.

**Suggest wording** asks the story model to write the note, in the paper's voice, from those two lines and the story it can see. It is asked not to add a fact, a number, a name or a date that is not in your two lines, and the note it writes is put in the box, not published. You read it, change any word of it, and post it yourself. The button says **Suggesting…** while it waits, then **Suggested below. Read it, change any of it, then post it.** If the model cannot be reached, the desk says so and leaves the box exactly as you left it — your typing is never replaced by a partial or guessed note.

**Use a plain note** writes the same note on the desk, with no model and no network: *An earlier version of this story said the fee was $4,200. In fact, the fee is $2,400.* It works when nothing else does, and it is the button to press if you would rather not spend a model call. Both buttons need both lines, because a note built from half a fact reads finished and says nothing.

Nothing posts until you press **Publish correction**, and you can always ignore both buttons and type the note yourself; that path is unchanged.

**Also fix the story text** is the second choice, and it is off unless you turn it on. Left off, the correction is exactly what it has always been: a public note above a story whose words do not change. Turned on, it opens the printed body in a box that already holds the story as it printed, so you are editing the words on the paper rather than retyping them, and you press **Publish correction** once. The corrected text and the note go public together, in one act. The URL does not change and no link breaks. The desk keeps the text the story used to carry, with your account, the time and the correction that justified the change, so the paper can always answer what it printed and who changed it. Readers see the corrected story and the note; the replaced words are never printed again. If the box holds the same text the story already has, or is empty, the desk refuses rather than recording a change that did not happen.

A correction can attach only to a published story in your newsroom. If the selected story is no longer available, the desk refuses the correction instead of saving an unattached note. Return to Published and select the current story before posting again.

---

## What never prints

- Reporting notes and the research memo
- The editorial's fact sheet and image prompt
- Dark Desk files, hypotheses, open questions, dead ends
- Scan summaries and proposed sources
- “What is solid / not solid yet”
- Captions passed off as minutes
- Private-citizen dossiers with no material public-interest trail

If it is not on `/articles/…` with your publish click behind it, it is not the paper.

---

## The public paper, after you publish

Readers get:

- The story
- Provenance — source title, organization, document date, exact URL, capture time
- Compare versions, when more than one capture of a cited record exists
- “What TownReporter found,” only when it resolves to a published source URL and a specific captured version
- Corrections

Homepages are not stand-ins for documents. Disappeared sources say so.

The paper’s clock uses the IANA timezone saved in **Paper setup**. A local Wednesday evening does not print as Thursday UTC just because the host uses UTC.

Overlapping printed headlines collapse; the longer body stays. Quiet-zone ×2 and survey ×2 drop. Distinct sessions (Airport Vision vs the Boulder County joint session) stay side by side. Search and live archive URLs are unchanged.

How we report, in public: `/how-we-report`.

---

## Common trouble

| You see                                           | Likely                                                                                  | What to do                                                                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Automatic says no model is ready                  | Configured gateway failed, or every Automatic provider failed readiness                 | Fix the configured gateway; otherwise sign in to Codex, or sign in/configure Claude ([setup.md](setup.md#per-run-picker))                              |
| Codex is missing or signed out                    | Codex CLI/OAuth is unavailable on the server machine                                    | Install/open Codex, sign in, and try again; check `CODEX_CLI_PATH` / `CODEX_HOME` only for unusual layouts                                             |
| Claude is missing or signed out                   | Claude Code CLI login is unavailable                                                    | Install/open Claude Code and sign in, or configure the Claude API path                                                                                 |
| An Opinion row says Failed with no draft          | The provider errored, declined, or returned something that was not a complete editorial | Read the error on the row. Retry Claude after fixing its error, or explicitly choose Local model; nothing was filed or published                       |
| Scan fetched, filed nothing                       | Nothing new, or the model declined                                                      | Read the summary. Not automatically a bug.                                                                                                             |
| Draft with AI ran, form still empty               | The click died; the writing pass may still be finishing                                 | Stay on the page. It fills when the draft lands. Reload only if you left.                                                                              |
| Redraft shows a sign-in / setCookie error         | Cookie helper threw even though you are signed in                                       | Click Redraft again. Fixed in 0.3.7.                                                                                                                   |
| Start digging does nothing                        | The card was hidden after a failed open (fixed in 0.3.8)                                | Reload. The card should be back. Click again — it stays until the file exists.                                                                         |
| Draft is a rewrite of the Leader                  | The pass never opened the company page                                                  | Pull the still-to-pull line for their press release, then redraft.                                                                                     |
| Meeting has no transcript                         | Livestream hasn’t ended, or Playwright missing                                          | Wait for the 6-hour recheck, or operator installs Chromium                                                                                             |
| Names in a draft are wrong                        | Auto-captions                                                                           | Check the packet. Fix the draft. Do not publish the caption.                                                                                           |
| Dates look a day ahead                            | Paper timezone is wrong or missing                                                      | Owner: open Server → Paper identity (Paper setup panel) and save the correct IANA timezone.                                                                                   |
| Two nearly identical headlines on the paper       | Same news, two drafts published                                                         | The paper collapses overlapping headlines and keeps the longer body.                                                                                   |
| Second person gets 403                            | They signed up without a valid invite, or used the wrong email                          | Owner: create a fresh link under Server → Invite an editor and have them use the exact invited address.                                                |
| Editorial says Failed with a timeout              | The piece ran past the writer's limit                                                   | Ask again. If it repeats, the operator can raise `EDITORIAL_TIMEOUT_MS`. Nothing is lost but the run.                                                  |
| Editorial never starts, says no voice             | `TOWNREPORTER_VOICE_FILE` is unset or points nowhere                                    | Operator: set it to an absolute path outside the repo                                                                                                  |
| A public address is down but the local desk works | Public hosting or routing may have failed                                               | Ask the operator to check the public host/tunnel. The Windows package has no tunnel or automatic repair; legacy controls require configured ownership. |
| An editorial has no Edit button                   | It has not finished, or it failed                                                       | Only a finished piece can be edited. A failed row can still be deleted.                                                                                |
| Desk wants sign-in again                          | Session expired                                                                         | `/login`                                                                                                                                               |
| Notebook language on the paper                    | Strip failed or you pasted it                                                           | Edit the story. Kill if needed. Tell the operator.                                                                                                     |

---

## What this desk will not do for you

- It will not decide if something is worth printing. You will.
- It will not file a CORA request.
- It will not be your lawyer. First Amendment copy in related tools is not legal advice; this desk does not even ship that prompt.
- It will not invent a city's sources. The owner supplies them in Paper setup and can maintain them under Sources.

You are the publisher. The software is the library, the tape machine, and a very fast intern who still has to be edited.


### Import a transcript or document packet

Open **Desk → Write a story**. Use **Add documents** to select one or several Markdown/text, Word (.doc/.docx), PDF, PNG/JPEG/WebP, CSV/TSV or subtitle (.srt/.vtt) files. Add the story assignment in **What story do you want?**, select the writing model, and click **Write draft**. Website, PDF and YouTube video URLs go in **Links or source text**; accessible video captions are retained as a transcript.

Up to 20 files, 100 MB each. Large files upload in 4 MB parts. The full original remains private in the story; the reader extracts PDF pages, uses OCR for scanned pages/images, and processes long text in sections. The story lists reading progress and downloads of the original and full extracted text. Extracted text is limited to 20 million characters per document; larger text must be split into volumes. Reading errors are shown and originals are kept. Review OCR, names and quotations before publishing.

## Astra editor desk (0.6.39)

The sidebar keeps Desk, Sources, Scan, Queue, Published, Opinion, Server and Stats available, with Dark Desk and Follow-ups alongside them. On a phone, use the navigation button in the top bar. Find anything (Ctrl+K) searches newsroom leads and screen names. Appearance is in the top bar; Normal/Large text remains in the sidebar.

**Start a story:** choose New story, then Add documents or drag files into the document area. Paste URLs or source text in the large text area, give the angle, and choose Write it. Existing document limits, OCR, URL/YouTube ingestion, section and research options, and writing models remain available. Recent drafts sit at the top of Desk; opening one shows its progress or saved draft.

**Edit and review:** the story workspace keeps headline, summary and body on the writing surface. Its toolbar has Save, Preview, Redraft, Check draft against evidence and Publish. Checks contains the existing name results and evidence entry points; Sources contains documents and download links; Reporting contains the model/research choices, reporting notes and claim-of-absence controls. The full finding/evidence review remains below the editor. Preview shows the current text without publishing it. Existing evidence and publication checks still apply.

**Manage the newsroom:** Sources has Add a source and Import a source registry controls, followed by On watch, Suggested sources and Dropped groups. Server has twelve panels, in this order: Writing models, Custom connections, Daily scan, Meeting capture, YouTube, Routine notices, Paper identity, Sections, Named outlets, Server health, Recently deleted, and Editors & access. Opening another panel preserves unsaved settings in the current page.


### Recheck a draft against uploaded documents

In the story workspace, use **Check draft against evidence**. The check reads the retained extracted text of every attached document, alongside any saved web captures. Private files are cited by filename and page or character location; they do not need a public URL. Long packets are read in sections, and exact supporting or conflicting passages are checked against the retained text before the editing pass. The progress card remains visible while the job is queued and running. A successful check saves a new draft version, loads it in the editor and opens a before-and-after comparison. Verification findings remain visible even when the reporting memo is already filled. Incomplete reading, excessive relevant evidence for a single edit, or files changed during the check preserve the previous draft and show an explanation. The check does not independently authenticate a document or verify OCR/transcript name spellings.

## Current Opinion document and review workflow

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Opinion defaults to Codex Sol; Automatic tries Codex Sol, then Claude Sonnet. Both subscription writers read the complete configured voice using native instruction-file options and can research while writing. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review and blocked from publication until repaired. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](editor-desk.md) for the complete editor flow.

## 0.6.52: model and document boundaries

The 0.6.52 model picker offers only the reasoning-effort levels supported by the selected Codex or Claude runtime. The selected runtime and effort are retained with the job. A technical failure — unavailable service, sign-in, quota, timeout, network failure, or no output — may move the unfinished call to the next ready runtime and records that move. A content refusal is terminal: it does not route around the refusal or turn into a draft.

After a Queue batch completes, use **Redraft** to select a runtime and produce a new draft for review. The batch remains non-publishing. The Server page lets an owner edit daily time, runtime, effort, selected accepted sources, and a 1–12 source cap; scheduled scans still file leads only.

Story and Opinion intake reads all extractable PDF pages within the 20-million-character document-text cap. Generic captures and Dark Desk scans initially use a bounded OCR batch; **Read entire PDF** checkpoints consecutive 12-page batches until every page is retained or explicitly reported unread. Page-only vision fallback handles pages without a readable text layer. The [0.6.52 release guide](releases/0.6.52.md) lists evidence boundaries.
