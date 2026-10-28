# TownReporter — the manual

**Version 0.6.85 · publication and deployment are recorded separately**

[Latest published download](https://github.com/scottconverse/TownReporter/releases/latest) · [0.6.85 release guide and evidence boundaries](releases/0.6.85.md). Source, package metadata, GitHub publication, and running production deployment are separate facts.

**Screenshots:** The screenshots in Parts 1 and 2 were taken from the running 0.6.84 desk and public paper. The [current desk guide](editor-desk.md) is the short written reference and the [editor’s manual](editor.md) is the long one; if a label ever differs from a picture, the words here and on screen are right.

TownReporter is a civic newsroom you run yourself. A public paper on the front,
a signed-in editor's desk behind it. It watches a city's meetings, packets,
minutes, money and contracts, notices when something changes or fails to appear,
and hands an editor a lead. Ordinary reporting reaches the paper after a person
reviews and publishes it; approved sources can produce automatic routine-notice
roundups through fixed templates.

The working edition covers Longmont, Colorado, at
[townreporter.org](https://townreporter.org). The code is MIT licensed. Point it
at your own city.

---

## Contents

**Installing on Windows?** Start with the [Windows installation guide](windows-install.md): download, provider setup, persistent database, start/stop and your first editorial workflow. The source setup remains available for Windows, macOS and Linux.

- [Part 1 — What it is](#part-1--what-it-is)
- [Part 2 — The desk, screen by screen](#part-2--the-desk-screen-by-screen)
- [Part 3 — Running it](#part-3--running-it)
- [Part 4 — How it is built](#part-4--how-it-is-built)
- [Part 5 — Architecture](#part-5--architecture)
- [Part 6 — Reference](#part-6--reference)

---


# Part 1 — What it is

## Public newspaper

The public paper is the front of the house: a front page, a searchable archive, story pages that show their sources, an About page, a How we report page, a public Corrections page and an RSS feed. It needs no sign-in and sets no cookies. The [reader guide](reader.md) covers the front page, search and the archive, section filters, saved stories, reading preferences, evidence, sharing and the correction email. **Editor’s desk** in the page header and footer opens the desk for a signed-in editor and the sign-in flow for everyone else. From the desk, **View the paper ↗** and the **TownReporter** name return to the newspaper.

## Current capabilities and remaining work

**What TownReporter 0.6.85 does.**

- **Watches and scans.** A watch list of civic sources is read on demand or once a day. Each page is compared with the last saved copy and what changed, vanished or failed to appear becomes a lead. Sources the site refuses are tried through a real browser and the site’s public feeds. A newsletter mailbox can feed in email newsletters. The scan says how many sources it read, skipped and why.
- **Files and sorts leads.** The Queue scores leads, spots repeats (“Came back N times”) and possible duplicates, and compares a lead with stories already in print.
- **Writes drafts.** One shared model picker offers the same list of AI models on every screen that uses one, with Automatic as the default. The paper’s default writer is **DeepSeek v4.1 Flash 1017** with thinking off. Automatic tries DeepSeek v4.1 Flash 1017, then a model already loaded on the computer, then Codex Sol 6.1 (balanced), then Claude Sonnet 5.5. Gemini stays a named pick and is not part of Automatic. After each draft the story page names the model that wrote it (“Last draft: <model>, <time>”) and says why if it moved to another one. A drafting scope of **Use only supplied material** tells the writer to search nothing and open no other pages.
- **Checks its own work.** Evidence checks compare a draft with the saved web pages and uploaded documents. Names are checked against written sources. A Style check flags weak writing. **Find evidence** searches saved evidence by exact words and by meaning, and finds past stories close in meaning. Meaning search is on the editor desk only.
- **Never prints for you, except routine notices.** An editor reads each ordinary story and presses **Publish**. The app warns about risks but never blocks you: every warning has an “anyway” button, such as **Publish anyway in <Section>**, and the choice is recorded. Approved routine sources can print fixed-format roundups such as “Today in town” by themselves, if the owner switches that on.
- **Investigates.** Dark Desk takes a question and a tip, searches, keeps copies, argues with itself, and offers a case file. It has no Publish button. Its only way out is **Send to the queue**.
- **Corrects in the open.** A correction is a dated public note above the story, and can fix the printed text in the same act. Headlines can be changed without changing the link.
- **Runs on your own machine.** It runs on a Windows computer (or another system from source) with its own database. The owner invites editors, sets sections, models, the daily scan and routine notices. The code is MIT licensed.

**Remaining limits.** These are plain facts about the software, not promises:

- It cannot fact-check for you. Every draft is a first pass.
- Speech-to-text transcripts and auto-captions are a map of a recording, not the minutes.
- A scanned or cut-off PDF read by OCR can have errors. Dark Desk’s **Read entire PDF** reads a retained PDF in batches of up to 12 pages, saves each batch, and lists exactly which pages are still unread. Compare any transcript with the original.
- Searching by meaning only covers what has been indexed so far. It indexes a little each minute, newest first.
- A scan interrupted midway does not resume; run it again.
- Local readiness is not public access. The Windows package installs no tunnel or watchdog.

The [canonical queue](../TODO.md) records current work. [Release 0.6.85](releases/0.6.85.md) separates what is in the source from what is published and deployed.

## Newspaper sections

The owner manages sections on **Server → Sections** (the **Newspaper sections** panel): names, order, visibility, a reporting brief, scan instructions and the sources each section reads. Keys cannot change after saving. Hiding a section does not delete its stories. A section can be retired into another active reporting section; its leads, drafts and articles move and old links follow. Opinion and About are reserved pages. Editors use the sections when filing and scanning. The full steps, with the review-before-apply screen, are in [The Server page](#the-server-page).

## Two rooms

|                        | What it is                                                                              | Who sees it       |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------- |
| **The paper** (`/`)    | Stories and editorials, plus routine notice roundups from approved sources, with sources shown | Anyone            |
| **The desk** (`/desk`) | Today, Queue, Drafts, Published, Opinion, Follow-ups, Dark Desk, Sources & scan, Models, Server, Stats | Signed-in editors |

There is no automated path to the masthead for ordinary reporting. A machine can find a lead, fetch the document, write a draft and tell you what it thinks; a person reads it and presses Publish. Approved routine sources use a separate fixed-template path.

![The front page of the public paper with the lead story, the Latest stories list and the Opinion panel](images/01-front-page.png)

## The six moves

The paper describes its own method at `/how-we-report`, in a few short paragraphs. This is how the software performs it, in order.

1. **Watch.** A list of civic sources — city site, council, planning, the agenda portal, the school district, the county, the municipal utility, the city’s YouTube channel, public-access television. The list is a starting point, not a fence; newly discovered public records are fair game.
2. **Detect.** A scan fetches those pages, compares each with the last saved copy, and flags three things: what changed, what disappeared, and what failed to appear when it usually does. The third is the one nobody else watches.
3. **Follow.** Before a story is drafted, the desk asks what the announcing source leaves unexplained, then follows attachments, names, companies, contracts, parcels and prior meetings.
4. **Preserve.** Significant captures are stored. If a record later vanishes, the captured version remains and the article says so.
5. **Investigate.** Dark Desk is the open-ended lane: competing explanations, unresolved identities, trails left open until new evidence reopens them. **It never prints.**
6. **Write, then check.** Drafts are reported stories, not recaps. Hold, kill or publish is a person’s decision for ordinary reporting; approved routine formats use fixed templates and approved sources. Every material claim should be checkable against a document the paper shows you.

When a story leans on another newsroom’s reporting, the story names and links that newsroom’s own story so the credit and the traffic go to them.

Corrections are public. A correction runs as a dated note above the story, with the story text fixed in the same act if the words were wrong.

**Kill is not delete.** A killed lead stays under Killed and **Bring back** returns it. **Delete** removes the thing, after one confirmation that says what it costs. Taking a story off the paper (**More ▾ → Take off the paper** on Published) says plainly that its address becomes a 404 and that a correction is what the paper normally does instead.

**Ordinary delete keeps a recoverable copy for 30 days** under **Server → Recently deleted**, and an **Undo** appears where the delete happened. Restoring puts the row back with its original id, so an article’s corrections and an editorial’s fact sheet come back with it. The separate [owner legal-removal workflow](editor.md#legal-removal-owner-workflow) follows its selected retention or destruction policy and has no Undo.

![A published story with its headline, text, Sources band and Corrections section](images/02-article.png)

## What it will not do

- It will not fact-check for you. Models invent facts, misattribute quotes and mangle names, especially names taken from auto-captions.
- It will not treat captions as minutes. Captions are a map of the tape. The packet and the minutes are the record.
- It will not print anything from Dark Desk. That desk has no publish button by design.
- It will not publish an ordinary story without a person pressing Publish. The app warns about risks before you do; it does not hide them.
- It will not tell you it is finished when it has stopped early. A file that stops mid-trail says so, and says how much is left unread.

You are responsible for everything that appears on the paper.

## What the reader gets

- No third-party script and no outside font on the page. `npm run smoke` is the test that loads the front page in a real browser and fails the build if any request leaves the machine.
- Every story has its own title, description, published time and social card, and a canonical address when the paper’s public address is set.
- An RSS feed at `/feed` (the newest 40 stories), a `sitemap.xml`, and a `robots.txt` that points at it.
- The sources under every story, as links, including captured copies when the original has moved. A reader can compare captured versions of a record.
- A public Corrections page, with a form that prepares an email to the editor. The website itself sends nothing.
- No account, no cookie banner, and a visit count that is never tied to a person.
- No mention of AI on a story. The About page says in one sentence that AI helps with research and that a human editor reviews every story.

---

# Part 2 — The desk, screen by screen

This is the tour of every screen an editor can use at 0.6.85, with what to click and the exact words on the buttons. The [editor’s manual](editor.md) arranges the same ground as a working day. The screenshots were taken from the running 0.6.84 desk. If a label ever differs from a picture, the words here and on screen are right.

The steps are written for any signed-in editor. Where only the owner can do something, the text says so.

## Sign in and first run

Anyone can read the paper. Only signed-in editors can open the desk.

**To claim a new desk (the first person in becomes the owner):**

1. Open the public paper. At the bottom of the page, in the **The newsroom** column, press **Create editor**. The button shows only while nobody owns the desk.
2. On the sign-in page, fill in **Name**, **Email**, **Password** (at least 8 characters), **Confirm password** and **Setup code**. The setup code is printed once when TownReporter is installed, in the server log and in the data folder's `logs/SETUP-CODE.txt`.
3. Press **Create editor account**.
4. The desk opens on **Set up the paper** (next section).

If the setup code is wrong, the account is still made and you stay signed in. Fix the code and press the button again. After five wrong codes in 15 minutes the page asks you to wait.

**To sign in later:** press **Editor’s desk** at the top or bottom of the public paper, or go to `/desk`. Enter your email and password and press **Sign in with email**. After ten wrong passwords for one email the account locks for 15 minutes.

**To join as a second editor:** the owner makes a one-time link under **Server → Editors & access → Invite an editor** and sends it to you. Open it, choose a password and you are in. The link works once, only for the invited address, and expires after seven days. Invited people are editors, never owners, and do not need a setup code.

**If you lose your password:** on the sign-in page press **Lost your password? Use a recovery code**, type an unused code and press **Use this code**. You get a one-time temporary password to sign in with. The owner makes recovery codes ahead of time on **Server → Editors & access**. There is no email reset link.

**To sign out,** use **Sign out** in the footer of the public paper, next to your name. The desk itself has no Sign out button, on purpose.

**To hand the desk over:** **Server → Editors & access → Give up the desk**. It asks you to type your email address first. For the owner it frees the newsroom for the next person with the setup code; the paper stays. For an invited editor it removes only that editor’s own seat. You cannot take it back.

## Set up the paper

`/desk/setup` — the first screen after the owner creates a new desk. Only the owner sees it.

![Set up the paper form with fields for the paper's name, city, state, timezone, meeting video channels and a starting watch list](images/13-paper-setup.png)

**To set up the paper:**

1. Fill in **Paper name**, **City**, **State** and **Timezone (IANA)**. These four are required. The timezone box starts with your browser’s zone, for example `America/Denver`.
2. Optional: **Tagline**, **Council votes site** (a link shown in the paper’s navigation; leave it blank rather than point readers at another town), **Editor contact email** (shown on About and Corrections; blank shows no address), **Elected officials and staff** (one name and title per line).
3. **Meeting video channels**: one YouTube channel URL per line. **Meeting title keywords**: the phrases that mark council, board and commission recordings, one per line.
4. **Starting watch list**: add rows of **URL** and **Title** (**Add another**, **Remove**). These become your first sources.
5. Press **Save and open the desk**.

Saving writes the choices to the database, sets the front-page kicker, adds the watch list as sources, rewrites the welcome article for your city and opens the desk. Until the owner saves, the public paper shows “Not yet set up”. Every choice can be changed later on **Server → Paper setup**. No code edit or rebuild is needed. The setup form can only be used once; opening `/desk/setup` on a finished paper sends you back to Today.

If a local model program (LM Studio or Ollama) is running with nothing loaded when you finish, Today shows a **Choose your writing model** card to the owner. See [Models](#models).

## Getting around the desk

Every desk screen has the same frame: a navigation column on the left and the work area on the right.

![The desk: navigation on the left, Today in the middle with the step strip, Tonight's edition and New leads](images/04-desk.png)

### The navigation

Top to bottom: **TownReporter / Editor’s desk** (a link to the public paper), the **Running** box when something is running, then eleven links:

| Link | What it is | Number beside it |
|---|---|---|
| **Today** | The home screen | none |
| **Queue** | Every lead | Open leads |
| **Drafts** | Stories being written or waiting for checks | Rows on the Drafts screen |
| **Published** | What is live, and corrections | none |
| **Opinion** | Editorials | Requests and editorials |
| **Follow-ups** | AI agents watching for answers | Active follow-ups |
| **Dark Desk** | Open-ended investigations | Files on the desk |
| **Sources & scan** | The watch list and the scan | none |
| **Models** | Which AI does which job | none |
| **Server** | Owner settings and health | none |
| **Stats** | Anonymous reader counts | none |

A number shows only once it has loaded, never a made-up zero. The footer has **View the paper ↗**, a **Dark / Light** button, an **Aa Large / Aa Normal** button, and **Press ? for keyboard shortcuts**. A button’s label names what pressing it gives you: it reads **Dark** while the desk is light.

Four screens are not in the navigation but are reachable: **Scan history** (button on Sources & scan), **Import** (see [Import finished stories](#import-finished-stories)), **Beat memory** (the bottom of Published) and **Legal removals** (owner only; linked from Published). All four are also found with search.

**On a phone** the navigation is a drawer. The top bar has **Menu**, the **TownReporter** name (a link to the paper) and **+ New**. The drawer holds the same links and buttons.

### Look and text size

**Dark / Light** and **Aa Large / Aa Normal** are kept in your browser. A browser that never chose starts Dark with normal text. Large text makes everything on the desk 20 percent bigger. The Dark Desk screen follows the same choice. These settings do not follow you to another browser.

### The Running box

While anything is running or waiting, the navigation shows **Running · N** (and **· 3 queued** when jobs are waiting). Each row is a small card: what is running, the model, a clock, **Now:** with the current step, **Last activity** and **Cancel**. Press the heading to go to Today. Scans, drafts, evidence checks, Dark Desk digs, editorials, routine editions and reporting runs all show here.

If a card sees no news from its worker for 60 seconds it says **No activity for m:ss. The model may be slow, or it may have stalled.** and offers **Keep waiting** and, when possible, **Retry on next model**. A stopped card offers **Retry** and **Retry on another model**. A waiting draft offers **Run it on another model**.

### Find a story or screen

Press **Ctrl+K** (**Cmd+K** on a Mac) on any desk screen. The box **Search your newsroom** lists screens, leads (by headline, topic or why-line) and Opinion pieces as you type. Pick one to go there. This search looks only at titles and topics. It does not read story text. Searching by meaning is on the story page; see [Find evidence](#find-evidence). There is no search button on screen, so a phone without a keyboard cannot open this box.

### Keyboard shortcuts

Press **?** (when you are not typing) to open the list. On **Today** and **Queue** these keys work on the highlighted lead: **J / K** next or previous, **S** start a story, **H** hold, **X** kill, **U** undo, **Enter** open. **N** starts a new story. **Ctrl+S** (**⌘S**) saves in the story workbench. **Esc** closes a list or the phone menu. Keys are ignored while you type in a box.

### The app warns; it never blocks

When something looks risky, TownReporter says so and lets you go ahead. The warning appears in one of two ways, and both end with a button that names the action plus the word “anyway”:

- A box titled **Before you continue** with a sentence and two buttons: **Cancel**, and the “anyway” button, for example **Draft this story anyway**, **Run anyway** (for hourly limits and scans), **Check anyway**, or **Stop and restart with <model>**.
- A message at the corner of the screen that stays until you press its button: **Kill anyway**, **Hold anyway**, **Release anyway**, **Reopen anyway**.

Every “anyway” you press is saved in an audit record with your name. Pressing **Cancel** changes nothing. The same rule runs through Publish; see [Publish](#publish).

### Messages and undo

Every press ends with a short message. Successes stay about five seconds, failures twelve, and the Kill strip eight. The fast Kill strip sits at the bottom of the screen and leaves a 16 px gap on each side on a phone. Kill, Hold and Release messages carry **Undo**.

## The desk

`/desk` — **Today**. What to do next, what is running, and the best new leads.

Read it top to bottom:

1. **The greeting.** “Good morning. Here’s today’s paper.” (or afternoon, evening, by the paper’s clock), with the date and city above it. Buttons: **+ Add a lead**, **+ New story**, **+ Opinion** and **Start reporting**.
2. **Choose your writing model** (owner only, first run only). Appears when a local model program answered with nothing loaded. Press **Use <model>** next to a local model or **Keep the Automatic ladder**.
3. **Today’s work.** Four cells: **Pick leads** (new today, button **Review leads**), **Draft** (writing now, **Watch drafts**), **Check** (drafts waiting on you, **Check draft**) and **Publish** (drafts ready, **Review edition**). The numbered square of the next step that has work is yellow.
4. **Running now.** Cards for what is running, each with **Cancel** and an open button such as **Open your story** or **Open the scan**.
5. **Tonight’s edition.** Stories that are through writing. Each row has the section, the headline and one chip: **✓ Ready**, **✓ Verified**, **! N to check**, **! Not checked yet**, **✕ Not ready**, **… Checking facts**, or **Writing · 2:18** / **Queued**. The button changes with the state: **Watch**, **Retry**, **Check**, **Continue**, **Start story**, **Review**. A story prints only when you press Publish on its page; this list prints nothing.
6. **In progress.** Up to five stories you have started, each with **View progress** or **Open draft**. Nothing here prints until you press Publish.
7. **New leads.** The best leads from the last finished scan, best first. Two buttons switch between **Open · N** and **Held · N**. Each row shows a score out of 20, chips, the headline, the why-line, evidence squares, the section and age. Buttons: **Start story** (S), **Hold** (H), **Kill** (X). A **Model for Start story** picker sits above the list. Kill shows one line, **Lead killed.**, with **Undo** for 8 seconds. Hold shows a message with **Undo**. A held lead shows **Release**; a killed lead shows **Undo**. **All leads in the Queue →** goes to the Queue.
8. **The right rail.**
   - **AI follow-ups**: the latest findings, with **Review finding** and **All follow-ups**.
   - **Dark Desk**: counts of **Open files**, **Signals to review** and **Waiting on an AI follow-up**, and **Open Dark Desk →**.
   - **The wire**: one line per watched source (problems first), **Run scan now**, **All sources**, a **Model for this scan** picker, and a **More from the wire** list with the last scan, source health, suggested sources (**Accept** or **Drop**) and recent published stories.

Today has no “Needs you” panel. Look at Tonight’s edition and In progress for work waiting on you.

**Today in town.** Besides stories you write, the paper can print routine roundups on its own. The owner switches this on under **Server → Routine notices**. Each day the desk reads approved public calendars and prints a fixed-format story headed, for example, “Today in town — Sunday, Oct. 25”, with one block per event in time order (and **Morning**, **Afternoon**, **Evening** headings when there are six or more), then a “Source:” link. A Friday “This weekend” and a “Deadlines approaching” edition work the same way. You will see **Filing the routine edition** in the Running box while one is made, and the printed story under **Published**. These roundups come from approved sources through fixed templates, not from a model, so there is nothing to review before they print. If something in a source looks risky (a cancelled event, an unclear date), the desk leaves it out and counts it as needing review; the owner reads the reasons on the Server page.

![The Today in town edition as a reader sees it: events in time order under a dek, ending with a Source link](images/14-today-in-town.png)

## Start a story or add a lead

### New story

`+ New story` on Today, the **N** key, or **+ New** on a phone opens a dialog with three tabs. Nothing prints until you press Publish.

**AI drafts from material** — to have the AI write from your sources:

1. Drop files on **Drop documents here** or press **Choose files**. The desk reads PDF, Word, Excel, PowerPoint, LibreOffice, text, images (with OCR), CSV and subtitle files: up to 20 files, 100 MB each.
2. Paste web, PDF or YouTube addresses into **Links**, or paste text into **Source text**.
3. Say what you want in **Assignment**: the angle, what to find out, what to ignore.
4. Choose **Research scope**: **Research public sources** (follows your links and searches for public evidence) or **Use only supplied material** (reads your text and files only; no searching).
5. Choose a **Model** (see [Models](#models)).
6. Press **Start drafting**. The dialog stays open and says the draft is under **Running now**; it will land in **Drafts**.

**Write it myself** — to write your own: fill in **Headline**, **Summary**, **Story**, **Section** and, if you have them, **Sources**. Press **Save draft**, or **Save & check against evidence** to run the evidence check as well. The section must be chosen (“Section not chosen — pick one”) and you still confirm it at Publish.

**Paste a finished story** — for a story written elsewhere: fill in **Original link**, **Credit line**, **Story text** and **Section**, then choose what the AI should do: **Nothing: keep it exactly as pasted**, **Clean up formatting and suggest a headline**, or **Check it against its sources**. Press **Save as draft**. The credit line and link stay on the published page. If the story looks like one already on the paper or the Queue, the dialog says so and links to it. To bring in a whole report with many stories, use **Import many finished stories →** (see [Import finished stories](#import-finished-stories)).

The **+ New story** buttons on Drafts and Queue open an older form called **Write a story** instead. It has the same material boxes (**Add documents**, **Links or source text**, **What story do you want?**), a **Research & section** disclosure with **Drafting scope** and an optional **Section**, a **Writing model** picker and a **Write draft** button. After **Write draft** it takes you straight to the story page. It also offers **Paste a story I already have** (type or paste the story, press **Add to Queue**; no AI reads it).

### Add a lead

**+ Add a lead** (Today and Queue) is for a link or a tip, not a full story. Paste a URL or describe what you heard in **Link or tip**, optionally add **Why it might matter**, and choose **Then**: **Research and score it**, **Research and draft a story now**, or **Just file it as-is** (no AI). Press **Add lead**. The dialog stays open and tells you the lead’s number and what happened, for example “Filed as lead 41 with a usefulness score of 12.”

### Start reporting

**Start reporting** on Today has four choices: **Report a town**, **Report a beat**, **Report a date** and **Report an issue**. Each opens a dialog. Write **What to report on** (this is the assignment; it is not printed as evidence), add optional **Sources to start from** (one public link per line), choose **Research** (**Public research** or **Supplied material only**) and a model, then press **Start reporting**. The run files a package beside each story it opens. Its progress shows under Running.

## Scan

`/desk/sources` — **Sources & scan**. The watch list, and the expensive button.

One scan reads the pages you chose, compares each with the last copy it saved, and files what changed as leads. It runs when you ask, or once a day if the owner has turned on the daily scan. A scan files leads only. It never drafts or publishes.

The navigation has one item for this area, **Sources & scan**. It opens two pages:

- **Sources & scan** (`/desk/sources`): the watch list, with a right-hand column holding the **Daily scan** panel and **Previous scans**.
- **Scan history** (`/desk/scan`): the **Run a scan** panel with the scope choices, saved packs, previous scans with coverage, and **Captured meetings**. Reach it with **Scan history →** at the top of Sources & scan.

The buttons across the top of Sources & scan are **Scan history →**, **Source inventory →** and **+ Add a source**.

### The watch list

The four buttons **On watch**, **Suggested**, **Rejected** and **Could not check** switch the list, each with a count of all sources, not just the ones on screen. The search box (**Search the watch list**) looks at name, address, kind and tier. Each list shows 25 rows at first: “Showing 25 of 1,588 sources” with **Show 25 more**.

Every source has a **Kind** (what it is: official, news, community, social, YouTube, or unclassified) and a **Tier** (how much weight it gets):

- **Tier A** — official record. A source of fact, still checked.
- **Tier B** — journalism. Attributed, not gospel.
- **Tier C** — community or discovery clue. Never treated as fact.

The desk works out kind and tier from the web address. A page the paper already has, written any way, is never added twice.

**To add sources:** press **+ Add a source**. The box **Add sources to watch** has four tabs:

1. **One link** — a **Link**, an optional **Name**. Press **Add source**.
2. **Paste a list** — one address per line, with an optional name after a comma. A line that starts with **TIER A**, **TIER B** or **TIER C** sets the tier for the addresses below it. A preview shows how many are new and how many are already watched, then **Add N sources**.
3. **Upload a file** — a file of addresses (the desk reads it as plain text, like a pasted list), then the same preview.
4. **Ask AI to find sources** — say what the paper should cover, choose where to search (**Government and public-record sites**, **Local organizations and nonprofits**, or **Everything, including local news and forums**) and a model. Found pages land in **Suggested**, never straight onto the watch list.

**What each row shows:** the name, a link to the page, “Kind: … · Tier: …”, when it was last read, and a status chip with a plain note:

| Chip | Meaning |
|---|---|
| **✓ No change** / **Changed** | Fetched; nothing new, or “2 new items” |
| **Not checked yet** | Added but not fetched |
| **Waiting** | The site asked us to come back later; the row says when |
| **Blocked** | The site refused us; the desk tries again after a longer pause each time |
| **Could not check** | The last read failed, with a plain reason |
| **Keeps failing** | Three scans in a row could not read it, with the reason and the date it began |
| **Paused** | The scanner will not fetch it until you resume |
| **On trial** / **Dormant (checked once a month)** | The desk is trying a new source, or checking a quiet one less often |

When a site refuses a plain read, the desk tries once through a real browser, then looks for the site’s public feeds. The row says “Read through a browser.” or “Read through its feed.” It never submits forms or solves challenges.

**Row buttons:** **Check now** (a read only; it does not draft or file leads; **Retry** on a failed row), **Pause** / **Resume**, and **More ▾ → Remove** (then **Yes, remove**; a message offers **Undo**). A row that keeps failing shows a red **Delete** that asks once. The desk never pauses or drops a failing source by itself. **Scan preferences** sets a purpose, cadence and deadline for when the daily scan should read the source. **Newsletter sender and signup** records the sender address and signup page for a newsletter the paper’s mailbox receives (the owner sets the mailbox up on the Server page). A **Find a replacement** helper appears under a source that keeps failing.

**Suggested sources.** The desk files here what the scan, the research pass and Dark Desk found while they worked. Each row shows why it was suggested and by whom (with a link to the lead). The owner can pick a section for each; any editor can **Accept** or **Reject**, with an optional note. To decide many, tick rows (**Select all N**), then **Accept selected** or **Reject selected**: all or none are saved. A **Rejected** source stays in the Rejected list, where **Accept** brings it back.

**Source inventory** (`/desk/inventory`) shows every source ranked by how much news it produced in the last 90 days, how often it is read, and what the desk did on its own: trial sources it kept or dropped, quiet sources it checks monthly. Every move can be changed with one click.

### Run a scan

![The Scan history screen: previous scans with their status and a Show all button, and the Run a scan panel below](images/05-scan.png)

Three ways to start one:

- **Run scan now** on **Today** (in The wire) or on the **Queue**. These use the shared **Model for this scan** picker.
- On **Sources & scan**, in the **Daily scan** panel: **Run scan now** (owner only; runs the daily plan on demand with the saved daily settings) and **Scan every accepted source (N)** (any editor; a general scan).
- On **Scan history**, **Run a scan**: choose a **Scan scope**, a model and press **Run scan**.

**The three scan scopes:**

- **General Scan** — every accepted source.
- **Section scan** — only the accepted sources assigned to one section (pick the section). A section with no accepted sources cannot start.
- **Custom sources** — exactly the set you pick. Search accepted sources by name or address, filter by **Kind** and **Tier**, tick any number, with a live count. Only accepted sources can be picked. The chosen list is saved into the run before the first fetch.

**Saved source packs.** Press **Save selection as pack** to keep a named set. Pick a pack from **Saved pack** to run it, **Update pack with selection**, **Rename…** or **Delete pack** (with **Undo**). A pack uses its current accepted members when it runs.

The picker on the scan panel is for that press only. If a scan is already running with a different model, the desk warns and offers **Stop and restart with <model>**. If the paper is not set up, or you have started more than 10 scans this hour, it warns too and offers **Run anyway**.

**What the reader does.** It asks for one page at a time from any one site, with a pause between requests. It reads only pages on the watch list. A scan reads sources in batches of 16 within a 90-minute budget. Sources never read come first, then the oldest read. Sources that are waiting, blocked or over the limit are skipped and the scan says so. A scan interrupted midway does not resume; start it again.

**What a finished scan says.** A coverage line such as “Read 180 of 201 · 15 wait their turn · 6 blocked” and, under **Source routes and gaps (N)**, each source that was skipped or blocked and why. A summary says how many sources were selected, fetched, failed and analysed, how many leads were filed and how many batches ran. A scan that finds nothing is shown as a success with zero leads (“Fetched N. Filed nothing.”), not an error. A model failure is shown as a failure. A partial scan says “Scan finished with partial coverage”. A scan row that says **Stalled** most likely lost its worker when the app restarted; nothing was lost, so run it again. If the desk cannot scan at all (no model ready, nothing loaded locally) you get “The desk cannot scan yet.” with the reason and, for a lapsed login, a **Sign in to Claude Code** or **Sign in to Codex** button, before anything is fetched. **Open the queue** shows what was filed.

**Previous scans.** The panel shows the newest five scans with date, fetched count, leads filed and a status (**Complete**, **Running**, **Failed**, **Stalled**, or a note such as “Cancelled after 40 of 201 sources; 2 leads filed before it stopped stay on the Queue”). **Show all 39** loads older ones. Each row has an **Open** that shows whether it was a scheduled or a manual scan and its summary.

**Captured meetings** (bottom of Scan history) lists what meeting capture has saved: the meeting, whether the transcript is from official captions or speech-to-text, whether it was matched to agenda items, and a link **Open the story** when a draft or lead was filed. Setting up capture and **Run meetings now** are on the Server page. A transcript is a map of the tape, not the minutes.

**The daily scan.** The owner sets it up on **Server → Daily scan** (see [The Server page](#the-server-page)). When it is on, the desk reads the owner’s fixed picks first, then every other accepted source oldest-read first, inside the 90-minute budget, once a day at the chosen local time. If the app was off at that time, the next check that same day runs it once; missed days are not replayed. It files leads only.

## The queue

`/desk/queue` — every lead the paper holds, scored and sorted. The scanner files here, Dark Desk files here, imports land here, and so do you. Nothing prints from this list; you open a lead and publish from its story page.

![The Queue: filter tabs, search, sort, and lead rows with score, chips and Start story, Kill and More buttons](images/06-queue.png)

### The top of the page

- **Model for this scan**: a model picker for the next scan only.
- **Run scan now**: starts a scan of the accepted sources. A scan card with its stages and **Cancel** appears under the tabs. The scan files leads a batch at a time, so the list fills while it runs. More than 10 scan starts in an hour asks first (**Run anyway**).
- **Add a lead**: see [Add a lead](#add-a-lead).
- **+ New story**: opens the older Write a story form.

### Find the lead you want

- **Tabs:** **Open** (not held, killed or published), **Held**, **Killed**, **≈ Printed** (leads that match a story already in print; it is not every published story) and **All**. Each shows a count, or the word “loading”. A Held count in the “waiting” style means leads are waiting on you.
- **Search** matches the headline, the why-line and the section key.
- **Sort:** **Best first**, **Newest first**, **Oldest first**. On the Killed tab all three order by when the lead was killed.
- **Section:** **All**, or one of the paper’s sections.
- The list shows 25 rows; **Show 25 more** adds more.
- **J / K / S / H / X / U / Enter** work on the highlighted row.

### What a row shows

| Part | Meaning |
|---|---|
| Tick box | Select the row for the bulk bar |
| Score | Newsworthiness out of 20 (warm at 10, hot at 14) |
| Chips | The section; the status (**New**, **Drafted**, **Held**, **Killed**, **Published**); **Section not chosen — pick one** when the scan guessed the section; **Imported**; **Looks already printed: <headline>**; **Came back N times** |
| Headline | A link to the story page |
| Evidence | One small square per source link and a count such as “3 opened · 1 attached” |
| Filed | How long ago; killed rows add the kill date |

**Row buttons.** A New or Drafted lead has **Start story**, **Kill** and **More ▾**. A Held lead has **Release**, **Kill** and **More ▾**. A Killed lead has **Bring back** and **More ▾**. **Start story** opens the story page and spends no model.

**More ▾ menu:** **Edit the lead**; **Hold with a reason**; **Kill as duplicate** (when the lead matches a printed story); **Send to Dark Desk** (opens a Dark Desk file filled in from this lead); **Start an AI follow-up**; **Kill with a reason**; **Open**; **The piece** (the printed story); **Back**; **Hold (no reason)**; the block **Draft with a chosen model**; and **Delete**.

**To draft a lead from the Queue:** open **More ▾**, find **Draft with a chosen model**, check the model (press “Model: … · change” to pick another), then press **Draft with AI** (**Redraft with AI** if it already has a draft). The row says “Draft queued with <model>. Open the lead to watch it arrive.” Press **Open** or the headline to watch it.

### Kill, hold, release and bring back

- **Kill** is one press. The lead moves to Killed and a small strip at the bottom says **Lead killed.** with **Undo** for 8 seconds. It shows no reason chips and does not move when the mouse is on it. On a phone it leaves a 16 px gap on each side. Kill is not delete: the lead stays under Killed.
- **Kill with a reason** (More ▾) and **Kill this lead** on the story page open the full **Kill this lead** dialog with quick fills (**Not news**, **Already printed**, **Outside our area**, **Bad source or unreadable**), your own words and an optional link. **Kill as duplicate** remains in the More ▾ menu.
- **Hold with a reason** lets you say **Waiting on a record or date**, **Waiting on an AI follow-up** or **Not now, maybe later**, plus a note. A held lead waits under Held until you press **Release**.
- If a lead has a draft or a published story, Kill and Hold warn first with **Kill anyway** or **Hold anyway**. The draft and the story are kept.
- **Bring back** returns a killed lead to the Queue, and a drafted lead comes back as Drafted.
- **Delete** (in More ▾) asks once, in the row: “Deletes this lead and any draft on it.” Press **Yes, delete** or **Keep**. A deleted lead is kept for 30 days under **Server → Recently deleted**, and **Undo** appears where you deleted it. A published story stays on the paper.

### Came back, and possible duplicates

The scanner never throws a lead away. When the word rule finds nothing in a scan batch, the desk makes one extra model call. It compares every new lead with recent desk leads from the last 30 days (at most 300; killed leads are included), printed stories from the last 30 days (at most 150), and earlier leads of the same scan. If the call fails, the scan files leads as before.

- **Same story, no new fact:** the old lead is marked **Came back N times** (with the date), and nothing new is filed. A lead killed as a duplicate stays killed.
- **Same story with a new fact:** the new lead is filed as **Held** and linked to the old lead as **Possible duplicate**.
- **Same as an earlier lead of the same scan:** the new lead is merged into it, and the source links are joined.
- **Matches a printed story:** the new lead is filed as **Held**, not Open.

An AI duplicate never lands in Open. When a linked lead needs your decision, press its **Possible duplicate** chip to open the story page, where **Compare these two leads** shows both side by side. The buttons are **Not a duplicate — move to New**, **Same story — kill this one**, and **Newer facts — reopen the old one**. On the Killed tab a line explains: “the scanner found this story again after you killed it. It was not refiled. Back returns it to New.”

### Select several leads

Tick rows to open the bulk bar: “N selected”, **Model for these stories**, **Start N stories**, **Hold**, **Kill**, **Delete selected (N)** and **Clear**.

- **Start N stories** opens **Draft the selected leads**. A usual batch is one to five leads. Pick a model (Automatic is allowed). **Suggested focus size** (3 to 5) and **Add suggested focus (N)** add a balanced set of the best open leads without replacing the ones you ticked. A bigger batch, or a held, killed or published lead, warns first and offers **Draft this batch anyway**. Each lead keeps its own research scope. After you start, the dialog shows the latest batch: each lead’s status and a link to its story, and **Redraft with <model>** when it finishes. **Dismiss** puts a finished batch away.
- **Kill** on several leads kills at once. It does not ask **Why?** and shows one strip, **Killed N leads.**, with **Undo**.
- **Delete selected** asks first and lists each lead.
- A strip may offer **Hold all anyway** or **Kill all anyway** when some selected leads have drafts or published stories.

### Many drafts at once

You can start as many drafts as you like. Leaving the page does not stop a draft; it runs on the server. Two drafts write at a time, and the rest wait in line oldest first, saying what they are waiting for. A draft that uses the local model waits if another local job is running. Scans and Dark Desk digs have their own lines. A running follow-up check makes new drafts wait. There is one draft per story: pressing Draft again with the same model returns the running one; choosing a different model warns, and **Stop and restart with <model>** replaces it. After 20 draft starts in an hour the desk warns that it may cost more and offers **Run anyway**. Waiting drafts resume after a restart.

### Empty and error states

An empty Queue says “Queue is empty — run the first scan or file a lead” (or, when stories are already on the paper, “Nothing open — N already on the paper. Last scan filed no new leads.”) with a **New story** button and a link to **Import finished stories**. If the Queue cannot load, press **Try again**.

## Drafts

`/desk/drafts` — everything not yet printed, one row per story.

![The Drafts list with filter pills and rows showing a status chip, headline and one button](images/17-drafts.png)

- **Filter pills:** **All**, **Running**, **Needs you**, **Yours** and **Failed**, each with a count that stays blank until it has loaded. **Needs you** means the checks are waiting on you. **Yours** means you wrote or changed the headline.
- **A row** shows a chip (for a finished draft, the readiness chip: **✓ Ready**, **✓ Verified**, **! N to check**, **! Not checked yet**, **✕ Not ready**; for a running one, **Queued · 0:12** or **Writing · 2:18** with a live clock; for a first draft that failed, **Draft failed**), a line such as “Council · AI”, “Council · Written by you” or “Council · Reprint”, the headline, and the model’s name or the time it was saved. A running row carries the full job card with **Cancel**.
- **The button** names the next step: **Watch** (running), **Retry** (failed), **Check** (evidence to check), **Start story** (no draft yet) or **Review** (ready). Every button opens the story page.
- **More ▾:** **Open the story workbench** and **Hold, kill or delete it in the Queue**.
- Only leads that are New, Drafted or Held and have a draft appear here. Killed and published leads do not. The list refreshes itself every few seconds. A row that cannot be shown names the problem and links to the Queue; it does not break the page.

## Import finished stories

`/desk/import` — for stories that are already written: a report from a research tool, a colleague’s piece, your own text from elsewhere. Write a story treats what you paste as source material; Import keeps the words exactly as pasted. You reach it from Ctrl+K (**Import**), the link on the old Write a story form, the Queue’s empty state, and **Import many finished stories →** on the New story dialog’s paste tab. Nothing is saved until you press Import, and nothing is published by an import.

**To import:**

1. Paste the report or story into **Paste the report or the story**, or choose a `.md`, `.txt` or `.html` file. The limit is 400,000 characters.
2. Press **Read the stories**. No model reads it; a report with headings is split by its headings. The notice tells you how many stories and ideas it found.
3. If there are no headings, the desk offers **Read the stories with a model**. The model is asked only where each story starts and ends; every paragraph must be found word for word in your paste. If it cannot, you get one card holding the whole paste, headlined “Imported text — give this a headline” and marked “Could not split this cleanly — check it.”
4. Check every card. Everything on it is yours to change:

| On the card | What it does |
|---|---|
| Tick box | **Import this story**. Sections that are not stories arrive unticked |
| **Import as** | **Finished story** (a draft holding the text) or **Story idea** (a lead with the description as its why) |
| **Headline**, **Dek**, **Section** | The headline (leading numbers taken off), the line under it, and the section. **Section not chosen — pick one** until you choose |
| **The text this story carries** | The story as written, the plain-language brief, or both with the brief first |
| **Sources** | Every link the story cited, each with a tick box. Names the report cited without a link are listed read-only |
| **Who wrote this — the line readers see** | **An outside AI tool** (prints no line), **A person** (“A person wrote this from public records; an editor reviewed it.”) or **Other wording** |
| **Editor notes — never published** | Score, triage, the report’s notes, claims ledger and **Hold this on the desk** |

Cards may carry flags: **Developing — gaps marked** (a report’s Tier 2 story: it imports as a draft but unticked), **Unverified — Black Desk** (Tier 3, or anything under a Black Desk heading: always a story idea, never a draft, with a **Send it to Dark Desk** link), **Hold**, or a note that the story looks like one already printed or already on the desk. If a report’s run stopped early, a banner above the cards says **PARTIAL** and lists what it did not get to.

5. Press **Import N stories to the Queue**. Imported leads land in the Queue marked **Imported**. If a card is not word for word what you pasted, the import stops and **Import anyway** appears.
6. The panel **In the Queue** lists what arrived with **Open the Queue**.

## Follow-ups

`/desk/follow-ups` — AI agents that keep watching for an answer to an open question and add what they find to the story’s reporting notes. They never publish.

- **+ New AI follow-up** opens a dialog: **What to find out**, **Where to look** (up to 8 links), an optional **Story**, **Model for this follow-up**, and **How**: **Re-check these pages on a schedule**, **Search the web and public records**, or **Watch for the next agenda or minutes**. Press **Start follow-up**. With no link on a re-check, the desk warns and offers **Create this follow-up anyway**.
- **Filters:** **Active**, **Found something**, **Could not check**, **Stopped**.
- **A card** shows a state chip (**Running now**, **Waiting**, **Found an answer**, **Checked · no change**, **Could not check**, **Stopping…**, **Stopped**, **Finished**), the question, the schedule, the time of the last and next check, and the result in words.
- **Buttons** depend on the state: **Review finding**, **Add to story**, **Mark done**, **Pause**, **Edit**, **Stop**, **Retry now**, **Run now**, **Resume**.
- You can also start one from a Queue row (**More ▾ → Start an AI follow-up**), from a Dark Desk file, or from the **AI follow-ups** rail on Today.

A follow-up is a source of leads to check, not a proven fact. Read the finding and the page it came from before using it.

## The story workbench

`/desk/story/:id` — where a lead becomes a story. Open it from a Queue row (**Start story**, the headline, or **More ▾ → Open**), from a Drafts row, from Today, or from the link on a running job.

![The story workbench: Checks, Sources and Reporting tabs on the left, the headline, summary and story on the right, and the Publish bar at the bottom](images/07-story-editor.png)

### How the page is laid out

- **Top:** a **← Today** link, “Story from lead · <section>”, a readiness chip, and **Kill this lead** (hidden once a story is on the paper).
- **Left:** three tabs. **Checks** holds the “Before you can publish” list, the evidence check and **Names and spellings**. **Sources** holds **Find evidence**, **Source documents** and **Sources on the lead**. **Reporting** holds **Redraft settings**, the lead, **Reporting notes** and the **Reporting package**. Notes and sources never print.
- **Right:** the writing surface: **Headline · yours**, **Summary** (the line under the headline) and **Story**. A closed **Story details** fold holds **Story direction for AI**, **Topic** (the section), **Geography**, the outlet check and **Pulled notes**.
- **Action row:** **Save edits**, **Check draft against evidence**, **Draft with AI** (or **Redraft…** once there is a draft), **Stop** while a draft runs, and **More ▾**.
- **Bottom:** the Publish bar.

Everything here is open to any signed-in editor. A draft written by the AI is a first pass. Read it against the documents.

### The readiness chip

The chip at the top says where the story stands: **… Checking facts**, **✓ Ready**, **✓ Verified**, **! N to check**, **! Not checked yet**, **✕ Not ready** or **No draft yet**, with a plain sentence beside it. **Not ready** means the desk has a warning on the Publish list. It does not turn Publish off.

### Write a draft

**To draft a lead with the AI:**

1. Open **Reporting → Redraft settings** (or look at the **Writer** bar) and check the model and the research scope. **Change model or research** opens the choices.
2. Choose a **Drafting scope**:
   - **Research public sources** follows your links and searches for public evidence.
   - **Use only supplied material** reads your text and the documents you attached, and opens only the web addresses you filed yourself. It does not search and does not fetch other pages, and it tells the writer so. Use this control instead of writing “do not search” inside pasted text.
3. Press **Draft with AI**. Press **Redraft…** later to ask for a new version: the box **What should change?** takes your note, the choice **My headline and my edits** keeps your headline, and **Start redraft** begins. Your current saved draft stays in place until the new one finishes.

While it runs, a card named **Drafting story** shows the model, a clock, stage chips (**Opening source material**, **Looking for primary sources**, **Planning the reporting**, **Writing the draft**, **Checking the draft against the evidence**, **Connecting the story to saved sources**), a **Now:** line with the writer’s own step, and **Last activity**. You can leave the page: the draft keeps running on the server. **Stop** (or **Cancel** on the card) ends it and no draft is saved. After 60 seconds with no news the card offers **Keep waiting** and **Retry on next model**.

**Which writer runs.** A normal news lead is written first by the research writer, which can search and read for itself. If it cannot finish, the same model writes the story the usual way and the page says so: “The research writer could not finish (…). The story is being written the usual way, on the same model.” A meeting lead uses the meeting writer. The notes panel is headed **Writer’s notes** on a news lead and **Meeting ledger** on a meeting lead.

**What the model line tells you.** After a draft finishes, the Writer bar shows a receipt: **Last draft: <model>, <time>**. If the desk moved to another model, it says why: “You picked Automatic. <Model> wrote this draft because <reason>.” or “You picked A. B wrote this draft because A timed out.” Reasons include a lapsed sign-in, a usage limit, an empty or unreadable reply, and the model being unavailable. A content refusal never moves to another model; it stops the run.

**Warnings when you press Draft.** The desk may open **Before you continue** with a button such as **Draft anyway**: the model is not ready (“If you draft anyway, the desk will use the next ready writing model”), the lead was killed (drafting puts it back on the desk), a draft is already running on another model (**Stop and restart with <model>**), or you have started 20 drafts this hour (**Run anyway**). For a meeting lead you may be told a model has not been tested with the meeting writer; DeepSeek v4.1 Flash 1017 has.

### Choose the model

The model picker is the same on every screen that uses AI. It is labelled **Writing model** (**Digging model** on Dark Desk) with a **Thinking effort** control under it. See [Models](#models) for the full list and what Automatic does.

### Headline, summary and story

- **Headline · yours** is yours to write at any time. A redraft will not replace a headline you have changed.
- **Use the lead’s headline** puts back the line the scan filed the lead under.
- **Suggest headlines** asks the story model for three options. On a draft it opens a **Headline** box: pick one, **Keep mine**, or type your own, then **Use this headline** (**Suggest 3 more** asks again). Nothing changes until you press **Use this headline**.
- **Summary** is the line under the headline. **Story** is the body; the small line above it says **Saved <time>**, **Unsaved changes** or **Published story**.
- **Save edits** (Ctrl+S) keeps your changes without printing. **Preview as reader** (in **More ▾**) shows the story as a reader would see it.
- **Story details → Story direction for AI** names the decision or question you want covered. It steers the draft and is not evidence. **Topic** is the section the story files under.

### Add to a story

**+ Add to story** (in **More ▾**) opens **Add to this story**: drop new documents or paste text, a link or your own paragraph under **New material**, then choose **How**: **AI weaves it in**, **Add as an update at the top** (marked Updated with the time) or **Paste in as-is at the end**. A first press shows **Now** and **After your change** side by side; nothing is saved until you press **Add** again.

### Documents on the story

The **Sources** tab lists **Source documents** with their reading state and counts such as “3/5 parts read”. Buttons: **Download original** and **Download full extracted text**. The desk reads PDF, Word, Excel, PowerPoint, LibreOffice, text, images (with OCR), CSV and subtitle files; Excel, PowerPoint and LibreOffice files are read with LibreOffice, and if that is missing the row offers **Get LibreOffice** and **Try again**. Up to 20 files, 100 MB each, 20 million characters of text per document. If a document was only partly read, a notice says so and **Read the rest** starts a redraft that reads more.

### Reporting notes

The **Reporting** tab’s **Reporting notes** never print. They hold the news and why it matters, **Still to pull** to-dos (yours are tagged “yours”; type one in **Add a reporting note**), **Claims and sources**, **Verify before print**, and **Documents opened for this draft**. Notes survive a redraft.

**To fetch a missing document:** press **Pull** next to a still-to-pull line. It searches and reads without any AI, and drops the excerpt into **Pulled notes** (in **Story details**) for you to cut into the story. **Stop** and **Continue pull** control it. Redraft reads **Pulled notes**; nothing in them prints.

**Draft history and transcript revisions** lists earlier saved drafts with **View saved draft and evidence**.

### Meeting stories

A meeting lead shows **Where this draft came from**: the meeting recording and the exact transcript passages the saved draft used (**Open transcript**, **Watch the video**, timestamps). **Transcript material considered** is a separate list of candidates and is not proof the draft used them. **Transcript the reporter will read** chooses between the Whisper transcript and YouTube captions; a transcript not aligned to the agenda warns before drafting.

If the transcript changed after the draft, a block reads **Newer transcript available — review before publishing**. Compare each cited passage, tick that you did, write what you verified and press **Save review against current transcript**, or press **Redraft from current transcript**. This is a warning at Publish, not a block.

A speaker name the desk cannot confirm is replaced in the saved copy by “an unidentified speaker”, along with a title next to it such as “Mayor Pro Tem”. Names inside direct quotes or links are kept and still need your check. The mask records what could not be verified; it does not verify anything.

**Report this meeting** (or **Develop this lead** if there is already a draft), in **More ▾**, starts a reporting run: write **What to report on**, add optional **Sources to start from**, choose **Public research** or **Supplied material only** and a model, press **Start reporting**. The **Reporting package** then shows what was read, what was established, what still needs checking, the stories the run filed, an **Action ledger** of meeting actions (set each item’s treatment to **Lead**, **Roundup** or **Excluded**), and **Ask for more reporting** for a follow-up run. **Record a correction or disposition** saves a dated, sourced note for later assignments. The package never publishes.

### Names and spellings

On the **Checks** tab. The desk checks names against written sources it opened. A name marked “needs review” is not established. A source match checks spelling only, not attendance or quotes. Captions and OCR do not confirm their own spellings. Edit the text and redraft or re-check to settle a name.

### Style check

A row in **Checks** appears when the code finds shapes that read badly: an unattributed claim (“Experts say…”), filler, a dressed-up verb, repeated phrases, a very long paragraph and the like. Tick the findings you want fixed and press **Fix these with the model**. The model may not change a quotation, a number, a name or a link; a rewrite that does is refused and your text is kept. The result is saved as an ordinary draft revision. Nothing here blocks or publishes anything.

### Check draft against evidence

**Check draft against evidence** compares the exact saved draft with the web pages the desk captured and the documents you attached. Save your edits first. It does not restart discovery or the first writing pass. A card, **Checking the draft against the evidence**, shows the model and the stage.

When it finishes, the checked version is a new saved draft and your original is kept. If you did not type meanwhile it loads automatically. If you did, your edits are kept and **Reload checked draft** replaces them on purpose. **Compare versions** (in **More ▾**, or **Compare checked vs. previous version**) shows a side-by-side with **Keep checked version** and **Restore previous**; restoring loads the old text as unsaved text until you press **Save edits**. If the captures could not support a full pass, the result is marked incomplete and still needs your review. Neither outcome publishes or approves anything.

### The evidence list

The **Evidence check** list on the Checks tab shows one row per recorded claim. A short line says how many claims the AI checked and how many need you. Chips: **✓ Supported**, **! Needs review**, **Checked · not found**, **Could not check**. The rows that need a person come first; the rows the AI supported are folded under **Show the N claims the AI supported**, with **Spot-check** and **Accept the AI’s supported rows**.

Open a row to see the passage, mechanical checks (does the recorded passage appear in the cited saved copy, is a newer copy available), and **View cited captured version** or **Review newer capture**. Then record your own **Editor judgment**: **Supports**, **Does not support**, **Contradicts** or **Needs reporting**, with a reason. For a sentence the AI called not supported you may **Remove this sentence from the draft** or **Mark checked anyway**. A passage match only shows the words occur in that copy; it does not show the claim is true. Save the draft before saving a judgment.

**+ Add a claim** lets you add a fact you put in yourself and tie it to one to six captured records, marked **Corroborating**, **Contrary** or **Context**. These are private review notes.

If you change the story after its evidence was gathered, the page asks you to choose **I checked: keep this evidence** or **Remove old evidence from public story**. Removing clears the old public source list but keeps the original in the private draft archive.

A draft with no recorded claims and a checkable fact in it (a number, a date, a weekday, a vote) shows **! Not checked yet**. Run the evidence check, or read it against your sources and press **I checked this story myself**.

Only the owner sees **Take down this capture** inside an opened captured record. It deletes the excerpt and stored original, keeps the address and history, and cannot be undone.

### Find evidence

![The Find evidence panel on the Sources tab: a search for Oligarchy Ditch with 12 exact-word matches and zero close-in-meaning results, because the meaning index is not built yet](images/15-find-evidence.png)

`Sources` tab. A box labelled **Find evidence** takes up to 200 characters (placeholder “Words from the story or its sources”). Press **Search**. Up to three lists appear:

- **Exact words (N)** — pieces of captured pages and transcripts that contain your words.
- **Close in meaning (N)** — captured pieces, and up to three of your uploaded files (marked “your file”), whose meaning is close to what you typed, even when the words differ.
- **Our past stories close in meaning (N)** — the paper’s own published stories on the same subject.

Each captured piece shows its title, host and capture date, an excerpt, **Open** (the original page) and **Add to this story**, which puts that address on the lead’s source list. A past story shows its headline, “Published <date>” and **Open story**; an uploaded file shows **Open that story**. Nothing from a result is ever added to the story’s text. Small lines say how much of the archive is searchable yet, because the desk indexes a little each minute, newest first. If search by meaning is not ready the page says “Search by meaning is not available now. The exact-words list still works.”

This panel is on the editor desk only. The public paper’s search box looks only at headlines and text and has no meaning search. The writer is also given the five closest past stories as background only, with instructions to mention, quote, cite or link nothing from them.

### Publish

The Publish bar sits at the bottom of the page while a draft exists. Its main button names the section the story will print under: **Publish in <Section>**. Pressing it opens a confirmation, not a separate Confirm step to find first. The confirmation says: “This puts the story on the public paper and in the feed, under your name, now. Corrections are published, not silent edits.” Press **Yes, print it in <Section>** or **Not yet**.

If the desk could not place the story, the button reads **No section chosen. Pick one, or publish in <Section> anyway.** Pressing it opens **Story details** and the section chooser. A second button, **Publish anyway in <Section> (no section was chosen)**, publishes at once. A small **change** (or **pick the section**) link beside the button goes to the chooser.

**The app warns; it does not block.** Above the bar a list called **Before you can publish** shows each warning with a **Warning** chip and a button that clears it. The warnings are:

| Warning | What it means | Button |
|---|---|---|
| This draft looks cut off | The body does not end in a full stop or closing quote | **Read the draft** |
| The dek is empty | No line under the headline | **Write a dek** |
| This story is not ready | The readiness reason | **Review remaining checks** |
| This draft was last written … days ago | Older than 14 days; check dates and “Saturday”-style words | **Read the draft** |
| No section has been chosen | | **Pick a section** |
| The body names <Outlet> and the Sources do not show it | Credit another newsroom | **Override <Outlet>** or **Add a source** |
| A claim of absence has not been confirmed | The story says a document is not there | **Confirm the claim** |
| N claims need review | The evidence check raised claims no one judged | **Review the claims**, or **Publish anyway in <Section> — I accept these claims are unreviewed** (records your acceptance, then opens the confirmation) |
| No claims were recorded, so nothing has been checked | | **Run the evidence check** or **I checked this story myself** |
| The story changed after its evidence was checked | | **I checked: keep this evidence** |
| An evidence check is running on this draft | The answer is not in yet | **Publish anyway in <Section>** |
| This draft is on hold / is killed | Publishing un-holds or restores it | **Publish anyway** |
| The recording this draft quotes has changed | A meeting citation is stale | **Review the citation** |
| The writer asks you to check N things | The writer’s own list (**The meeting writer asks you…** on a meeting story) | **Review the checks** |

Only a few true impossibilities turn the button off: an empty headline, an empty story, a publish already running, an evidence decision still saving, and a lead the desk can no longer find. When you publish over warnings the confirmation lists them, the button reads **Publish anyway in <Section>**, and the desk records which warnings you published over and who you are. After you accept unreviewed claims the button reads **Publish now in <Section>**.

**After you publish,** the bar shows a green **Published** button, with **Read it on the paper** and **See it under Published**. The story leaves Drafts and gets its public address under `/articles/…`. To change a printed story, use **Save headline** (the address never changes, the old headline is kept, and no correction is printed) or **Save changes** for the summary, section or body (each warns first: “This story is live. Your change will show on the public page.”, with **Change it anyway**), and **Re-check live evidence**. To post a correction, go to **Published**.

Before you publish: every material number, name, date and quote has a document you can show; a quote or name taken only from a YouTube caption has been checked against the packet or the minutes; and you are willing to put your name on it. The software will not.

### Kill the lead

**Kill this lead** (top of the page) opens **Kill this lead** with the same quick fills as the Queue. Killing keeps any draft, and **Reopen** brings it back. A reported story has no Delete here; Delete is on the Queue row and on editorial pages.

## Dark Desk

`/desk/dark` — investigations that never print on their own. Its header reads “Investigations · nothing here prints on its own”.

![Dark Desk: files in the left rail, the open file on the right with its activity, case file and Decide buttons](images/08-dark-desk.png)

A Dark Desk **file** starts with a question and a tip: a link, a document, a rumour, a name, a contract number. The desk searches, fetches, keeps copies of what it reads, follows names and writes down what it thinks connects, always labelled and always with what would disprove it. For each odd thing it keeps two explanations alive: a concrete theory of what may be happening underneath, and the strongest ordinary explanation. Missing names, recipients, filings and permits become follow-up work, not reasons to drop the lead. “Not found in the material opened so far” never becomes “does not exist”. Any editor can use every control here. Dark Desk has no Publish button by design; the only way out is **Send to the queue**, which files a lead for a person to review.

Dark Desk searches the city and state saved in Paper setup, plus the county saved there if there is one. It does not carry Longmont’s jurisdictions over to another town.

### The left rail

Piles show five files at a time (**Show all N**):

- **Open files** — files you are working. Each row shows a status line such as “Reading · 3 of 12 records”, “Stopped · 12 records”, “Case file ready · 12 records”, “Found an answer”, or “Sent to the queue”.
- **Signals to review** — things the desk noticed: a missing report, a record that changed, an overdue item, an unverified tip. Pressing a card opens **Start a Dark Desk file** with the card’s text filled in; it does not start digging by itself.
- **Waiting on an AI follow-up** — files that have a follow-up or a page watch attached.
- **Set aside** — files you set aside or closed. Nothing is deleted.

The **Dark Desk** number in the navigation counts open files and files waiting on a follow-up.

At the foot of the rail, **Check r/<name> for signals** reads the paper’s Reddit source (see below).

### Start a file

**To start a file:** press **+ Start a file**.

1. **The question** — what you are trying to find out (at least 8 characters).
2. **The tip or starting point** — a link, document, post or what you heard (at least 8 characters).
3. **The ordinary explanation** (optional) — what would make this a non-story. The file tries to rule it out first.
4. **Limits** — **Quick look** (up to 10 records, 20 minutes), **Standard** (30 records, 2 hours) or **Deep** (100 records, 8 hours). It opens on the saved default.
5. **Digging model** and **Thinking effort**.
6. Press **Open the file**. The first round starts at once. You can stop it any time.

### The open file

Top to bottom:

1. **The question** as a heading, and **More file actions**: **Set aside**, **Pull back** (on a closed file), **Start another AI follow-up**.
2. The **ordinary explanation to rule out**, if you gave one, and the **Digging model for this file**. Changing it affects the next round; the file remembers the last model used.
3. While a round runs, a card with four stages (**Question**, **Gather**, **Case file**, **Challenge**), a **Now:** line, and a red **Stop**. If the round fails you get **Retry** and **Retry on next model**.
4. Notes about the file: a round stopped by an app restart (nothing lost), a mostly-blocked warning (“This dig is mostly hitting walls…”), a batch stop (“Dark Desk opened a batch of records, then stopped so it would not run all night … That is normal — not an error”), or the reason a file is paused.
5. Boxes **Scope**, **Depth** and **Limit**, read-only: the area searched, and the limit chosen at the start.
6. **Activity** (time-stamped plain lines; **Show earlier**) beside the **Case file**: **Findings**, **Contradictions**, **Unanswered** and **AI follow-ups running**. A **More** link shows the brief — **Read this first**, **The hypothesis**, **What points at it**, **The boring explanation that also fits**, **What would settle it**, **Do this next** and a percent supported — with **Rewrite the brief**. **Challenge the case** has the desk argue against its own file; it needs at least one sourced finding.
7. **Decide**:
   - **Keep investigating** — start the next round. Dark Desk works in short batches and then stops. A stop with pages still unread is not a failure and not “too many leads”; press this to read the next batch. Lower-priority trails stay visible as deferred work and are picked up again when the active set is done.
   - **Start an AI follow-up** — an agent keeps looking for an answer and reports on Follow-ups.
   - **Wait and watch** — pick captured public pages to watch; the file moves to Waiting.
   - **Send to the queue** — shows a packet for review (**Suggested headline**, **Evidence**, **Uncertainties**, **Contradictions**, **What would kill the story**); press **Send to the queue** to file a lead. An **Undo** is offered for ten seconds. Publication remains an editorial decision.
   - **Close: no finding** — records a no-finding decision with an optional reason. The file stays readable under Set aside.
8. **The file’s records ▸** (closed at first). **What to read** is every captured page and document: click a title and the captured copy opens below, with **Open original**, **Previous** and **Next**. For a retained PDF, **Read selected pages** and **Read entire PDF** read it in batches of up to 12 pages, save each batch, and list exactly which pages remain unread. **Still to pursue** lists open trails (**Follow this lead** opens a new file from one). Further down: every search the round ran (with whether it hit an official record, local press or community source), dead ends, questions the AI tested, and **What we know**.

Do not send yourself to the public `/evidence/…` pages for unpublished captures; those show only records cited in a printed story. Plain English is the rule on this screen: if you see “hop” or a raw error, that is a bug, not a task for you.

### Models and warnings on Dark Desk

The **Digging model** picker is the shared picker (see [Models](#models)). Automatic here tries DeepSeek v4.1 Flash 1017, then a loaded Local model, then Codex Sol 6.1 (balanced), then Claude Sonnet 5.5; if synthesis times out, only that stage moves on, and completed searches are not repeated. A model you name is tried first; a content refusal stops the run. If no model is ready, the round does not start and nothing is spent.

Warnings arrive as **Before you continue** with an “anyway” button: the paper is not set up (**Open this investigation anyway**), a round is running on another model (**Stop and restart with <model>**), or more than 8 rounds an hour (**Run anyway**). The Reddit check is capped at 6 an hour with no override.

### Dark Desk settings (how hard to dig)

![Dark Desk settings: the Digging model, thinking effort and default depth](images/09-dark-dials.png)

**Settings** (top right) opens **Dark Desk settings**. **How hard to dig** now has three parts: the **Digging model**, **Thinking effort**, and a default depth of **Quick** (10 records · 20 minutes), **Standard** (30 records · 2 hours) or **Deep** (100 records · 8 hours), saved with **Save default** (or **Reset**). Each new file opens on that depth. The older Dig, Nerve and Map sliders, presets and search-window controls are no longer on the screen.

Three rules hold at every setting: the desk never invents a claim that someone was paid; everything it writes is labelled with how mature the evidence is (fact, observation, allegation, inference, hypothesis, unknown); and every theory carries what would kill it. Black Desk signals are speculative and capped at 50 percent confidence in code. A signal marked “protocol complete” means the searches and review questions were done. It is not a verdict. See [the doctrine and its limits](dark-desk.md).

**Watched pages** (also in Settings) lists pages the desk checks daily, with **+ Watch a page**: enter the **Page URL**, a **Watch name**, **Why watch this page?** and optionally an **Investigation**, then **Save watch and capture page**. A first capture, “no text change”, “text changed”, “page moved” and “check failed” are kept as separate outcomes; a failed check never replaces the last readable copy. **Stop watching** keeps the history. Daily checks need the local scheduler running.

**Reddit check.** The button **Check r/<name> for signals** reads the paper’s one Reddit source from Sources through four feeds, then up to three full threads through a local Redlib. It needs exactly one clear subreddit among the accepted sources; otherwise the button says **Reddit unavailable** and links to **Review Sources**. No subreddit is guessed from a town name. Posts are unverified tips. A post that scores high enough and is dated within 30 days is filed as a tip automatically; you can file any listed post by hand with **File as tip**. Each result says whether the full thread or only the RSS excerpt was read.

If you have no files yet, the screen offers **+ Start a file** and the Reddit check. If it cannot load, press **Try again**.

## Opinion

`/desk/opinion` — the paper’s own position.

![Opinion: the AI and file-your-own cards above the Requests and editorials list](images/10-opinion.png)

An editorial is an unsigned draft of the paper’s position until you publish it. “OPINION” goes at the front of the headline and there is no byline. Claims and sources run in an appendix at the end for readers who disagree. An editor’s fact sheet and an image prompt are kept for you and never print.

### Write an editorial with the AI

**To write one:**

1. Press **+ New editorial**, or the card **Have the AI write an editorial →**.
2. Give it a position in **Subject, source text, or links**, and/or add documents (**Add documents**, up to 20; PDF, Word, Excel, PowerPoint, text, images with OCR). Keep the writing instruction separate from the evidence. **Anything you want it to know (optional)** is for the angle.
3. Choose **Drafting scope**: **Research public sources** or **Use only supplied material**.
4. Choose the **Writing model**. Opinion opens on **Automatic**. Opinion’s own Automatic tries **DeepSeek v4.1 Flash 1017**, then **Codex Sol 6.1**, then **Claude Sonnet 5.5**. It has no Local model rung. A named choice is tried first; a technical failure can move only the unfinished call; a refusal is final.
5. Press **Write an editorial**.

The desk writes with the paper’s **editorial voice**, a text file that also holds the research protocol. If none is saved, the page says “The paper’s editorial voice has not been saved.” The owner sets it in the **Paper’s editorial voice** panel on this page (paste it or **Load voice from a text file**, at least 500 characters, then **Save paper’s voice**). An editor can press **Write anyway** to use a neutral house voice.

Claude and Codex research and write in one run with the voice in hand. DeepSeek, Local model and saved connections have no web tools, so the desk does their searching and reading first, local record first: the city’s PrimeGov agendas, packets and minutes, the meeting transcripts the desk captured, and pages it already holds. It stops when its protocol is satisfied or at a safety ceiling of 30 minutes and 80 pages. An editorial is the most expensive thing the newsroom does and can take 10 to 40 minutes. The row shows a running clock and the page re-checks every 20 seconds. **Cancel** stops it before anything is written.

The desk checks that the result is really an editorial. A provider refusal, a limitation note, an implausible headline or an incomplete body makes the row **Failed** and files no draft; there is then no Read, Edit or Publish button to mistake for success. A failed row offers **Restore saved material**, which puts your subject and instruction back in the form (press **Have the AI write an editorial →** to see them).

Three things warn first and offer a **Write anyway** button: the paper is not fully set up, more than 20 documents, or material over 20 million characters.

### File one you wrote

**Paste a piece I wrote** takes the piece with the headline on the first line. **CLAIMS AND SOURCES**, **EDITOR’S FACT SHEET** and an image prompt are picked up if they are there. Press **File it as a draft**. It lands as the editor’s own words, exactly like one written here. Machine citation markers are removed and you are told to re-add real source links.

### The list

**Requests & editorials** lists every request and piece. A chip says **Writing m:ss**, **Stalled**, **Failed**, **Published**, or **! Claims missing**. Buttons: **Read it** / **Close**, **Edit** (opens the draft workbench at `/desk/story/draft/:id`), **Publish** or **Publish anyway**, **View**, **Repair claims**, and **Delete**. Delete asks in the row (**Yes, delete** / **Keep**), keeps a copy for 30 days and offers **Undo**. A stalled row says the app likely restarted and nothing was lost.

**Read it** opens the piece with its claims, name check, fact sheet and image prompt (each with a copy button). **Publish to the paper** publishes from there.

### Publish an editorial

Publish warns, never blocks. One box lists every warning with one button, **Publish anyway**:

- No dek yet.
- The evidence needs review before publishing an edited editorial.
- **Claims and sources are incomplete.** Every op-ed needs a sourced appendix with a link or a document filename and a page or section locator. The button then reads **Publish anyway — I accept these claims are unreviewed**.
- Choose the section the editorial files under.

The only refusals are a missing headline or body. On the draft workbench the button is **Publish in <Section>** and opens a confirmation: “This puts the piece on the public paper and in the feed, as the paper’s own position. Corrections are published, not silent edits.” The public paper shows no AI line on the editorial or on any story.

## Models

`/desk/models` — which AI does which job, and whether it is actually connected. Any editor can read this screen; only the owner can change it.

Behind every AI button on the desk is the same **model picker**. It is labelled **Writing model** (**Digging model** on Dark Desk), with a **Thinking effort** control under it. The list is the same everywhere:

![The model picker with Automatic expanded to show its ladder](images/16-model-picker.png)

| Choice | What it is |
|---|---|
| **Automatic — Recommended ladder** | The desk tries models in a fixed order (below) |
| **Codex Astra 6**, **Codex Sol 6.1**, **Codex Luna 6** | OpenAI models, through the Codex program signed in on this machine |
| **Gemini 3.8 Flash (Pro plan)**, **Gemini 3.1 Pro (Pro plan)** | Google models, through the Gemini program signed in to your Google Pro plan. A named pick only; never part of Automatic |
| **Claude Fable 5.1**, **Claude Opus 5.5**, **Claude Sonnet 5.5**, **Claude Haiku 5.5** | Anthropic models, through the Claude Code program signed in on this machine |
| **Local model** | A model already loaded in LM Studio, Ollama or llama.cpp on this computer |
| **DeepSeek v4.1 Flash 1017** | The paper’s default writer, run through Ollama and the Claude Code program, with thinking off |
| **<name> (key)** | A saved API connection you added yourself |

A model that is not ready shows the reason after its name.

**What Automatic does.** It tries, in order: **DeepSeek v4.1 Flash 1017**, then **Local model** (only if one is already loaded; TownReporter never loads one for you), then **Codex Sol 6.1 (balanced)**, then **Claude Sonnet 5.5**. If the first reaches a usage limit, becomes unavailable, loses its login or runs out of time, the unfinished call moves to the next one that is ready, once, and the desk shows the move. A content refusal stops the run. Gemini is never on the ladder. Opus is never picked by Automatic.

**Opinion has its own shorter Automatic:** DeepSeek v4.1 Flash 1017, then Codex Sol 6.1, then Claude Sonnet 5.5. See [Opinion](#opinion).

**A model you name** is tried first. A technical failure can move only the unfinished call to the next ready model; a content refusal is final.

**Thinking effort** is the choice of how hard the model thinks: **None — fastest**, **Low — faster**, **Medium — balanced**, **High — deeper**, **Extra high — longest** or **Maximum — hardest work**. Each model offers only the levels it supports. DeepSeek v4.1 Flash 1017 always starts at None.

**To choose the Local model:** the owner opens **Models → Connections → Local & self-hosted**, finds **The desk’s local model**, and chooses **Use whatever model is loaded (recommended)** or **Always use one model**. Editors see the choice read-only.

**Set up a writing model,** under every picker, explains how to install and sign in to the Codex, Claude Code and Gemini programs and how to add your own API. TownReporter does not install software or sign you in from that box.

### Who does what

The first tab lists nine jobs. For each, the owner picks a **First choice**, an **Effort**, and up to two fallbacks:

1. **Daily scan & lead filing**
2. **Lead scoring & duplicates**
3. **Story drafting**
4. **Opinion writing**
5. **Evidence check**
6. **Headline suggestions**
7. **Dark Desk research**
8. **AI follow-ups**
9. **Document reading & OCR**

Press **Save assignments** (or **Reset**). Whatever is saved here is what runs: every picker on the desk starts on the job’s saved first choice, and an editor’s pick for one run beats it. A fallback is used only after a technical failure. A small chip under a job says whether its model is **Ready**, **Sign in needed**, **Turned off**, **Not installed**, **Last test failed** or has a **Warning**. A job left on Automatic shows no chip. Above the table, **Models on this computer** lists what LM Studio or Ollama reports, with **Refresh**. Speech-to-text for recordings uses TextFlowKit (Whisper); the chat picker does not apply to it.

### Connections

The second tab, **Connections**, has three groups.

- **Frontier · API key.** Your saved API connections. Each card has **Test**, **Settings** and **Remove**. **+ Add a connection** (owner) opens **Add a connection**: a name, a **Base URL**, an optional **API key** (stored encrypted on the server, never shown again) and a model id. A **Set up Gemini** button fills in the Gemini preset. Each saved connection can be edited, have models discovered, tested (**Test connection**; this may cost a small charge), disabled and deleted (permanent).
- **Subscription sign-ins (OAuth).** Cards for **Claude Code** and **Codex** show whether the program is installed and signed in, with **Sign in to Claude Code** / **Sign in to Codex** and **Test**. A sign-in shows a link to open and, for Codex, a one-time code; the card turns to **Signed in** by itself. **Test** asks the model for one word and says how long it took: the only button that proves it can write. There is no Sign out, on purpose. Being signed in to claude.ai in a browser is a different login and does not count. A **Gemini (Pro plan)** card shows **Ready** or **Not ready** only; install the Gemini program and sign in with Google on that machine.
- **Local & self-hosted.** One card per local server (LM Studio, Ollama, llama.cpp), showing its models, which is in memory and which the desk uses, and **Use this one** for the owner. **Test all connections** (top of the page) re-reads every sign-in and looks for servers; it asks no model a question.

When a draft fails because a login lapsed, the error carries a **Sign in to Claude Code** or **Sign in to Codex** button that takes you to the sign-in with the link ready.

## The Server page

`/desk/ops` — this machine’s health and the owner’s settings.

![The Server page: twelve cards for Writing models, Health, Paper setup, Recently deleted, Sections, Daily scan, Meeting capture, YouTube, Routine notices, Named outlets, Editors & access and Time budgets](images/11-server.png)

The page is a grid of twelve cards. Each shows a few numbers and has a button that opens that card’s own screen (with a **← Server** link back). Most cards are for the owner only; an editor sees the title and one sentence saying so. A line at the top says whether LibreOffice is found (Excel and PowerPoint files are skipped without it). At the bottom, **Dark Desk run history** lists recent runs with their model and usage.

| Card | What it is | Who |
|---|---|---|
| **Writing models** | The Automatic ladder, numbered. **Assign models to jobs →** and **All connections** | Everyone sees the ladder |
| **Health** | Database, disk, last backup, errors in 24 hours. **View logs**, **Restart workers** | Owner |
| **Paper setup** | The paper’s name, town and watch list; **Edit setup**, **Invite an editor** | Owner |
| **Recently deleted** | The 30-day trash. **Open trash** | Any editor |
| **Sections** | The paper’s sections. **Edit sections** | Owner |
| **Daily scan** | The scheduled scan. **Scan settings** | Owner |
| **Meeting capture** | Public meeting recordings and transcripts. **Capture settings** | Owner |
| **YouTube** | The YouTube key. **Replace key** | Any editor |
| **Routine notices** | What the desk may print on its own. **Notice rules** | Owner |
| **Named outlets** | Outlets a story must credit. **Edit outlets** | Owner |
| **Editors & access** | Invites, recovery codes, Give up the desk | Owner; everyone for Give up the desk |
| **Time budgets** | How long one answer from each model may take. **Adjust times** | Owner |

### Health

The screen lists the checks (Paper, Running for, Public site, Database, Work queue, Disk, Last backup, errors in 24 hours) and refreshes every 30 seconds. **Check now** re-reads them. The Last backup row shows the age of the last good backup, and the note counts the backups kept on the backup drive (three days). **View logs** shows the last lines of each log. **Restart workers** reveals six actions, each with a **Run** button and a line saying what it does first: **Run health check now**, **Restart the tunnel**, **Restart the paper**, **Apply database migrations**, **Re-download the fonts** and **Rotate the logs**. The two that interrupt the paper ask again with **Yes, do it**. On the Windows package, the health check is read-only and no tunnel or watchdog exists, so those actions show “Unavailable”; use **Start TownReporter** and **Stop TownReporter** if the desk cannot be reached. Local readiness does not prove a reader in another town can reach the paper.

### Paper setup

The same fields as first-run setup, with **Save**. It also holds the **County** (Dark Desk searches the city and the county; blank searches the city only) and **The paper’s newsletter mailbox**: a mailbox the paper owns (address, IMAP host, port, SSL, password) that is subscribed to newsletters from your sources. The desk checks it about every 30 minutes, reads only senders you allowed on a source, and lists newsletters that still need a confirmation click under **Waiting for you**. **Test connection** checks the saved mailbox.

### Recently deleted

Everything deleted from the desk waits here for 30 days. **Restore** puts it back where it was, with its original address and corrections. **Delete for good** asks again (**Yes, for good**) and then nothing is left to restore. It does not erase old database backups; legal removal is a separate owner process.

### Sections

`Server → Sections` — **Newspaper sections**. Add a name and permanent key, rename the display label, move sections up or down, hide them from the section navigation, write a reporting brief and scan instructions, and choose the accepted sources each section reads. Keys cannot change after saving. Hiding does not delete stories. A section with no sources says so and opens its list; **Add a new source to this section** takes a URL and optional label and puts the page on the watch list at once (the section’s use of it is saved at **Confirm and apply**). Retire a section only into another active reporting section (**Retire into**): its leads, drafts and articles move, and old links follow. Opinion and About are reserved pages and cannot retire.

Nothing is saved until you press **Review changes**, check the summary (names, order, visibility, replacement, brief, instructions and sources), and press **Confirm and apply** (**Confirm retirement and apply** when retiring). **Back to editing** keeps your draft, **Cancel changes** discards it, and **Reload saved configuration** replaces it with what is saved. While you have unsaved changes a bar at the bottom says **You have unsaved section changes**, and leaving the page asks first (**Stay on this page**).

### Daily scan

Owner only. Turn on **Run once each day**, set the **Local time**, choose the **Writing model** (Automatic by default) and effort, set **Daily priority set** and **Read every day**, and tick the accepted sources you want read first. Every other accepted source is still read by age, never-read first, inside a 90-minute budget. Values outside the usual range warn and offer **Save this schedule anyway**. **Save daily scan**, **Pause daily scan** and **Resume daily scan** control it; the status block shows the next run, the last run, and the model asked for and the model that ran. A usage limit does not pause the schedule; the next day runs and the model call can move on. It pauses itself, with the reason shown, if the timezone is invalid, the owner account changed or the chosen model cannot start. It files leads only. **Open scan history** and **Open the queue** are below.

### Meeting capture

Owner only. It shows whether TextFlowKit speech-to-text is installed (“meetings without captions stay audio-only” if not). Settings: turn **Meeting capture** on, list the **Meeting channels** (YouTube channel URLs in priority order), choose the **Storage root**, the **Retention mode** (**Transcript only**, **Audio only**, **Media**) and the capture caps (duration and size; a longer or larger capture is refused with a reason, never cut short). **Run meetings now** starts a pass without using the scheduled run, **Stop** asks it to stop, **Resume stopped captures** continues partial captures, and **Force re-capture and retain revision** re-checks one video. See **Scan history → Captured meetings** for results. Speech-to-text is not the city’s record: names, numbers and ordinance titles are where it is most confident and most wrong.

### YouTube

Paste a YouTube Data API v3 key and press **Save key**, then **Test** (spends one of the day’s 10,000 free units). With a key the desk reads channel videos from Google’s official service; without one, or when Google refuses for quota, it reads the public feed and says so. The key is encrypted and never shown again; **Remove** takes it out. Transcripts and media still come from yt-dlp and TextFlowKit.

### Routine notices

Owner only; three parts.

- **Routine notice permissions** — choose exact accepted source and format pairs: **Library notices**, **Parks and recreation notices**, **Community and arts event logistics**, **Routine registration deadlines**, **Waste and recycling schedules**, **Public meeting logistics** (up to 60 pairs). **Pause routine notice permissions** stops later checks. Permissions alone never publish.
- **Manual notice checks** — **Check captured notices** reads an approved source once and reports what it found structurally. “Parsed” means the fields fit the format; it does not verify the issuer, facts or authority. Checks create no lead, draft or article.
- **Automatic routine editions** — owner only; **starts paused**. Choose up to 12 approved sources and for each the **Authoritative issuer**, **Locality**, **Public attribution URL** and, where needed, the **Area or branch** (never a household address). Choose the **Today section**, **Weekend section** and **Deadlines section** and the local time. **Save paused settings**, or **Save and activate**. After activation the daily scheduler files **Today in town**, a Friday **This weekend** and **Deadlines approaching** (only new or changed deadlines in the next seven days). Anything cancelled, conflicting, risky or unclear stays out and is counted for review. A real source change corrects an edition the automation owns; a story an editor edited, removed or unpublished is left alone. **Recent runs** show counts of eligible, published, corrected and needs-review items, with **Why they need review** and **Review source checks**. Disable it, or pause permissions, to stop later editions.

### Named outlets

Owner only. A published story that names one of these outlets has to show the reader its source; if it does not, the Publish list warns and an editor can add the source or override that outlet for that draft. The panel says which of three states you are in: **Using the built-in list (N outlets)**, **This paper checks N outlets**, or **This paper checks no outlet names** (a decision, with a warning that Publish will no longer flag work from other newsrooms). **Customize** copies the built-in list into a draft. Edit **Outlet name**, **Aliases** and **Domain** per row (**Add outlet**, **Remove outlet**). **Review changes** shows what is added, removed and changed and which published stories stop being checked, then **Confirm and apply** writes it.

### Editors & access

Open to everyone, because it holds your way out.

- **Invite an editor** (owner): enter **Their email**, press **Make the invite link**, copy the link or the ready-made message and send it yourself; TownReporter sends no email. The link works once, for that address only, and expires after seven days. **Pending invites** lists open links with **Cancel invite**. Editors can report, draft and publish; ownership, invitations, legal removals and owner-only settings stay with the owner.
- **Recovery codes** (owner): **Generate recovery codes** makes ten single-use codes, shown once. Tick **I saved these somewhere safe.**, then **Download as .txt** or **Done**. Generating a new set retires the old one.
- **Give up the desk** (anyone): see [Sign in and first run](#sign-in-and-first-run).

### Time budgets

Owner only. **Time per call** is how long the desk waits for one answer from a model before giving up: by default 5 minutes for the Codex, Claude Code and Gemini programs and 10 minutes for local models. Set any value from 10 seconds to 60 minutes and press **Save**; **Reset** returns the shipped value. Raising it does not make a model faster. It only changes how long the desk will wait.

### Legal removals

`/desk/legal-removals` — owner only; reached from **Published** and from search. A separate process for removing a story and its connected application copies, with no Undo. See [Published](#published).

## Stats

`/desk/stats` — any signed-in editor, read-only. Counts of anonymous page loads: no cookies, no accounts, no stored addresses, no identifier that lasts past the day.

- **Range buttons:** **Today**, **7 days**, **30 days**, **12 months**. **Export CSV** downloads the numbers.
- **Reading right now:** readers on the site this minute and the pages they are on, refreshed every 15 seconds. **Arriving from, right now** and **Right now, readers are on** (phone, tablet, computer).
- **Six tiles**, each compared with the period before: **Visits**, **Page loads**, **Avg reading time**, **Total reading**, **Read another story**, **Left without reading**.
- **Stories, by how much they were read:** each published story’s visits, average read, how far readers got, and whether they opened another.
- **Where visits come from**, **Where readers are** (a place is named only on days when at least 25 readers were counted there; everything smaller is **Other places**), **Visitors** (an estimate that can be wrong both ways), **Sections, by reading time**, **When people read** and **Trust signals** (clicks on the paper’s own controls, such as View captured version).
- **Section chosen by hand:** how many stories were printed under a section the scanner did not pick.
- **Saved reports:** **Save latest reports** keeps snapshots of the last completed day, week and month on this installation; **Read report** opens one.

These are page loads, not unique people or completed reads. A view is counted by a small signal sent after the page has loaded, so a counting failure can never slow or break the public page.

## Published

`/desk/published` — what is live, and its corrections.

![Published: filters, search and a row for each printed story with Views, Corrections and the More menu](images/12-published.png)

Filter with **All**, **This week**, **With corrections** and **Opinion**, or search headlines and sections. Each row shows the date printed, section, headline, any corrections as “Correction, <date>: …”, Views and a **Review needed** chip if a transcript review is open. Rows show 25 at a time (**Show 25 more**). **Beat memory** at the bottom lists the people, places and organizations the drafting AI is told the paper has already covered.

### Row actions

- **View** opens the public page.
- **Edit headline** opens a box under the headline. Type the new headline and press **Save the new headline**. The link does not change, no link breaks, the old words and your name are recorded, and no correction is posted. A correction is for a story that was wrong. If the story itself was wrong, post the correction as well.
- **More ▾ → Post correction** opens **Add a correction**:
  1. Fill in **What was wrong** (“The fee was $4,200”) and **What is right** (“The fee is $2,400”).
  2. Press **Suggest wording** (the **Correction wording model** writes a note in the paper’s voice from those two lines; it is put in the box, never posted) or **Use a plain note** (no model: “An earlier version of this story said … In fact, …”). Both need both lines.
  3. Read and change the note in **The correction**. Tick **Also fix the story text** to edit the printed body in the same act; the corrected text and the note go public together, the URL does not change, and the old text is kept with your name and the time.
  4. Check the **Preview**, then press **Publish correction**.
  
  A very short note, or a note that starts with the marker the desk uses for its own automatic corrections, warns first and the button then reads **Publish anyway**. A correction attaches only to a published story in your newsroom. Corrections appear above the story and on the public corrections page, permanently.
- **More ▾ → Take off the paper** (ordinary delete) shows: “This takes it off the paper. Its URL becomes a 404, the feed and the sitemap drop it, and anyone holding a link has a dead link. Its corrections go too. Consider a correction instead.” Press **Yes, take it off** or **Keep it**. It is kept 30 days under **Server → Recently deleted**, and **Undo** appears right away.
- **More ▾ → Go to the evidence review** (only when open) and **Legal removal** (owner only).

### When a meeting transcript changes after publication

A published meeting story shows **Transcript changed — evidence review required**. It compares each cited passage with the current recording. Tick that you checked each citation, add a note, and press **Still accurate — close review**, or press **Needs correction**, which opens the correction dialog tied to that review. Completed review history stays with the story. Nothing edits the printed story silently.

### Legal removal (owner only)

`/desk/legal-removals` and **More ▾ → Legal removal**. A separate process for a legal removal: it skips the trash and has no Undo. Choose the stories and press **Review connected copies**; review the counts and the independent evidence it lists (known copies are listed, not automatically deleted); choose **Keep an owner-only copy for 12 months** or **Keep nothing: a court order requires destruction**; enter a **Reason (required)** that contains no story text, type **REMOVE**, and press **Remove permanently**. The case page then lets the owner open the retained text (audited) and record backup identifiers and operator attestations. An attestation records what an operator reports; it is not proof of erasure. Browser caches, search-engine copies, provider history and old backups are outside the application’s reach, and restoring an older database can bring removed content back. Do not treat this as proof that no copy exists anywhere.


---

# Part 3 — Running it

This part is for the person who installs and runs a paper. You need some
comfort with a terminal. Nothing here changes what an editor sees; it is about
the machine underneath.

## Pick how you will run it

| Way                                  | For whom                                                     | Start here                                              |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------- |
| **Windows Setup.exe**                | A newsroom on one Windows 10/11 x64 computer                 | [windows-install.md](windows-install.md)                |
| **Windows source ZIP**               | Windows, with a download-and-build installer                 | [windows-install.md](windows-install.md#older-source-zip-path-online) |
| **Source checkout**                  | Windows, macOS or Linux; developers; any long-running Node host | [Run from source](#run-from-source-on-your-own-machine) below, and [setup.md](setup.md) |
| **The live paper's own installation** | The one operator of townreporter.org                         | [SELF-HOSTING.md](../SELF-HOSTING.md)                   |

Each release publishes `TownReporter-<version>-windows-x64.zip`, its
`.zip.json` metadata and its `.zip.sha256` sidecar (built by CI with
`scripts/package-windows.mjs`). For 0.6.85 that is
`TownReporter-0.6.85-windows-x64.zip`. `Setup.exe` is built by the separate
"Windows packaged installation" CI workflow into its `windows-setup` Actions
artifact; use a release's Setup.exe only if that release lists one. The 0.6.85
release lists the ZIP, `.zip.json` and `.zip.sha256`.

## What you need

| Need                         | Why                                                                                      | Required?                          |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| Node 22 or newer             | The server and every script                                                              | Yes (Setup.exe bundles it)         |
| PostgreSQL                   | The archive. Without `DATABASE_URL` the app uses embedded PGLite, which loses everything when the process stops | Yes for a real newsroom (Setup.exe bundles it) |
| Chromium (`npx playwright install chromium`) | JavaScript-heavy city sites, YouTube "Show transcript", and the one guarded retry for sites that refuse a plain fetch | Strongly recommended |
| One way to reach a model     | Scan, Draft, Dark Desk and Opinion. See [The model](#the-model)                          | Only for AI-assisted work          |
| LibreOffice                  | Reads Excel, PowerPoint and LibreOffice files (`.xlsx .xls .ods .pptx .ppt .odp .odt`)   | Optional                           |
| Python with `yt-dlp`, and `ffmpeg` | Meeting capture (audio and captions from YouTube)                                  | Optional                           |
| `textflowkit`                | Speech-to-text for meetings that have no captions                                        | Optional                           |
| Redlib                       | A fuller Reddit read for Dark Desk. Without it the desk reads the subreddit's `.rss` and says so | Optional (legacy installation only) |
| An IMAP mailbox              | Capturing subscribed newsletters (set in Paper setup)                                    | Optional                           |

## Run from source on your own machine

You need **Node 22+**. API keys are optional: Story can use an existing Codex
or Claude login. Signed-in Codex and [Claude Code](https://code.claude.com)
command-line programs supply the frontier Story and Opinion choices, and the
signed-in Gemini program (`agy`) supplies the Gemini choices.

```bash
git clone https://github.com/scottconverse/TownReporter.git
cd TownReporter
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```

Open `http://localhost:8080/login` and create an editor account. On an
unclaimed desk, enter the one-time setup code when prompted. The login form
points to `logs/SETUP-CODE.txt` in the server data folder and the server prints
the code once in its log. For a source checkout, that folder is
`TOWNREPORTER_DATA_ROOT` when set, otherwise `.townreporter-data` under the
project directory. The built server generates the code at boot
(`server/plugins/setup-code.ts`); a dev server generates it the first time the
sign-in gate reads it (`ensureOwnerSetupCode`). Sign-in is limited to ten
attempts every five minutes from any one address, and an account locks after
ten failed attempts in fifteen minutes (`ACCOUNT_LOCKOUT_MAX_ATTEMPTS` and
`ACCOUNT_LOCKOUT_WINDOW_SECONDS` change those two numbers; a correct sign-in
clears the lock).

While signed in, generate and securely save owner recovery codes from
**Server → Editors & access → Recovery codes**. If you lose the password, use
**Lost your password? Use a recovery code** on the sign-in screen. A valid
unused code provides a one-time temporary password; sign in with it and then
change your password. TownReporter does not send email password-reset links.
**Give up the desk** unclaims the newsroom; the next owner must enter the setup
code required for an unclaimed desk. It is not password recovery.

After account creation, complete **Set up the paper**. The public paper remains
neutral and empty until that form is saved.

The public paper is `/`. The desk is `/desk`. `npm run dev` listens on
`127.0.0.1:8080` only (the port is fixed in `vite.config.ts`); `npm run
dev:lan` opens it to your network. The **built** server (`npm start`) reads
`PORT` (default 3000) and `HOST`. `.env.example` sets `HOST=127.0.0.1` on
purpose, so the desk does not answer on your local network until you decide it
should.

### What a model command-line call can and cannot do

Read this once before you point the desk at a signed-in `claude`, `codex` or
`agy` program.

Since the D149 change of Oct 18 2026, **every** call to those three programs
runs with the program's **full tool set**, with its permission prompts (Claude
Code, Gemini) or approvals and sandbox (Codex) switched off. There is no tool
allow-list. The reporting prompts ask for research, and the model can use any
tool its program offers: web search and fetch, files, a shell, and any MCP
server that program has configured. Earlier versions of this manual described a
read-only, no-shell mode. That was true of older builds. It is not true of this
one.

What the application does control, and tests pin
(`src/lib/news/ai-claude-code.server.ts`, `ai-codex.server.ts`,
`ai-gemini-cli.server.ts`, `cli-child-env.server.ts`):

- **Your personal setup stays out of the prompt.** Claude Code is started with
  your `CLAUDE.md` files excluded, hooks off, automatic memory off and the
  default output style. Codex is started with project docs, developer
  instructions, personality, hooks and memories turned off and with
  `--ephemeral`. Gemini runs in a fresh empty folder each call. Claude Code
  still loads the settings, plugins and MCP servers that program has
  configured; the DeepSeek road (below) loads no MCP servers.
- **A named, short environment.** The child process gets an allow-list of
  variables (path, home, temp, locale, proxy and certificate settings, the CLI
  path and config-home variables), not a copy of the server's environment. The
  database URL, `BETTER_AUTH_SECRET` and other providers' keys do not reach it.
  `ANTHROPIC_API_KEY` and the other Claude credential names reach the Claude
  child only.
- **A neutral working folder.** Claude Code starts in the system temp folder;
  Codex in a per-call temporary folder; Gemini in an empty folder.
- **The prompt travels on standard input**, never on a command line other
  programs can read. Long system prompts, and the Opinion voice, go through a
  file path.
- **A timeout kills the whole process tree**, by PID, never by program name.

This is not an operating-system sandbox. The process runs as the Windows or
Unix account that runs the server and can reach whatever that account can
reach. Run the paper under an account whose reach you are willing to give a
model, and treat every fetched page, transcript and document as untrusted
evidence. `SECURITY.md` records the project's stated risk position.

## Database

Unset `DATABASE_URL` and it runs on embedded PGLite. **Data dies when the
process stops** — fine for a look, not for a newsroom.

```
DATABASE_URL=postgres://user:pass@host:5432/townreporter
```

Migrations are numbered `.sql` files in `migrations/` (153 files, the newest
`0158_story_meaning_vectors.sql`). `scripts/migrate.mjs` applies each pending
file in one transaction and records it in the `_migrations` table. It runs at
the end of `npm run build`, before `npm run dev`, and alone as `npm run
db:migrate`. PGLite applies the same files itself at start-up.

**The server refuses to serve a database that is behind its migrations.**
`server/middleware/00-schema-current.ts` compares the files with `_migrations`
before the first request is answered. If any file has not been applied, every
request gets a `503` with the plain sentence "Service unavailable: the paper's
database needs an update. The operator has been told what to run.", and the
server log names the missing files and the command. It does not exit; a
database that was briefly unreachable at boot starts serving as soon as it can
be reached. The 503 body never names a host, port, user or table.

After the ledger check, `server/plugins/schema-warmup.ts` runs every module's
`ensure*Schema` batch once, before the first request, and logs one
`[schema-warmup] <module> <ms>ms <status>` line per module (`ran`,
`skipped-by-marker` or `failed`). `scripts/schema-warmup.mjs` runs the same
warm-up on its own.

## The model

Everything a model does on the desk goes through one registry,
`src/lib/news/provider-registry.ts`, and one shared model picker. Every screen
where an AI does work shows the same picker with the full list. Nothing else in
the code names a provider.

### Automatic, and the named picks

**Automatic** is not a model. It is an instruction: use the configured gateway
if there is one, otherwise probe the ladder from the top and pin the first rung
that answers. The ladder is derived from `ladderRank` in the registry:

| Rung | Model                                                  | Notes                                                                                     |
| ---- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1    | **DeepSeek v4.1 Flash 1017** (`deepseek-v4.1-flash:1017-cloud`) | The paper's default. Served through Ollama at `http://127.0.0.1:11434/v1`. Runs at effort **None** unless an editor picks another effort DeepSeek offers. |
| 2    | **Local model**                                        | Whichever model LM Studio has **loaded** right now (`http://127.0.0.1:1234/v1`). With nothing loaded the rung is skipped and the run says "Local model skipped: nothing loaded in LM Studio". The desk never loads or unloads a model. |
| 3    | **Codex Sol 6.1 (balanced)** (`gpt-6.1-sol`)           | The signed-in Codex program                                                               |
| 4    | **Claude Sonnet 5.5** (`claude-sonnet-5-5`)            | The signed-in Claude Code program, or `ANTHROPIC_API_KEY`                                 |

**Gemini is not on the ladder.** PR 331 (merged Oct 27 2026) removed
Gemini's former rung: Automatic, the scheduled scan and every mid-run
failover never move a run to Gemini. Gemini 3.8 Flash and Gemini 3.1 Pro stay
named picks on every screen.

Opinion has its own Automatic order: DeepSeek v4.1 Flash, then Codex Sol 6.1,
then Claude Sonnet 5.5 (`opinionLadderRank`). DeepSeek is the one rung the two
ladders share. Unattended ladders never select Claude Opus.

A rung that is not ready is skipped, and the skip is recorded on the run
("Skipped: …"). If no rung is ready the run says so and names each reason.

The named picks, from `PROVIDER_REGISTRY` (labels are what editors read):

| Pick label                         | Id                | Program          | Model id sent          |
| ---------------------------------- | ----------------- | ---------------- | ---------------------- |
| DeepSeek v4.1 Flash 1017           | `deepseek-flash`  | Claude Code CLI via the DeepSeek relay (HTTP if the CLI is missing or switched off) | `deepseek-v4.1-flash:1017-cloud` |
| Codex Astra 6                      | `codex-astra`     | Codex            | `gpt-6-astra`          |
| Codex Luna 6                       | `codex-luna`      | Codex            | `gpt-6-luna`           |
| Codex Sol 6.1 (balanced)           | `codex-balanced`  | Codex            | `gpt-6.1-sol`          |
| Codex Sol 6.1                      | `codex-frontier`  | Codex            | `gpt-6.1-sol`          |
| Claude Fable 5.1                   | `claude-fable`    | Claude Code      | `claude-fable-5-1`     |
| Claude Opus 5.5                    | `claude-frontier` | Claude Code      | `claude-opus-5-5`      |
| Claude Sonnet 5.5                  | `claude-sonnet`   | Claude Code      | `claude-sonnet-5-5`    |
| Claude Haiku 5.5                   | `claude-haiku`    | Claude Code      | `claude-haiku-5-5`     |
| Gemini 3.8 Flash (Pro plan)        | `gemini-flash`    | Gemini (`agy`)   | `gemini-3.8-flash-medium` (suffix follows effort) |
| Gemini 3.1 Pro (Pro plan)          | `gemini-pro`      | Gemini (`agy`)   | `gemini-3.1-pro-high` (suffix follows effort) |
| Local model                        | `local-model`     | OpenAI-compatible server | the model you choose (**Use whatever is loaded** is the default) |
| A saved Custom AI connection       | `custom:<uuid>`   | OpenAI-compatible endpoint | the model saved with it |

OCR is the one exception: its Automatic order is Codex Sol 6.1 (balanced), then
Claude Sonnet 5.5 (an `ANTHROPIC_API_KEY` if set, otherwise the Claude Code
program), then a local model marked **· vision**. DeepSeek and Gemini are not
offered for OCR.

Where the signed-in program is missing or signed out, the pick stays
selectable and says how to fix it; **Server → Writing models** (and **Models →
Connections**) hold the **Sign in** and **Test** buttons. See
[setup.md](setup.md#claude-code--configured-provider-default-no-key).

### How DeepSeek is run

DeepSeek v4.1 Flash is an Ollama model. The paper runs it **inside the Claude
Code CLI** (D153, `ai.ts` → `ai-claude-code.server.ts` →
`deepseek-relay.server.ts`):

1. The desk starts one lazy loopback relay on `127.0.0.1` with a random port
   and an unguessable route per call.
2. The Claude Code child is pointed at that route (`ANTHROPIC_BASE_URL`), told
   that every model alias is the DeepSeek tag, given `ANTHROPIC_API_KEY=""` and
   a 1,048,576-token context window, and started with **no MCP servers**.
3. The relay rewrites each `/v1/messages` request. At effort **None** it sets
   `thinking: disabled` and removes `output_config.effort`. At Low, High or Max
   (the efforts DeepSeek offers) it enables thinking with a budget and the
   effort. It raises `max_tokens` to 32,768 so thinking and the answer fit, and
   it forwards only the route's own bearer token, never the caller's headers.
4. Only a missing Claude binary, or `TOWNREPORTER_CLAUDE_CODE=0`, sends DeepSeek
   by plain HTTP instead (and then it has no tools).

DeepSeek endpoint and model can be re-pointed with
`TOWNREPORTER_DEEPSEEK_BASE_URL`, `TOWNREPORTER_DEEPSEEK_MODEL` and
`TOWNREPORTER_DEEPSEEK_API_KEY`; `TOWNREPORTER_DEEPSEEK=0` removes the rung. A
**Local model** setting never moves a DeepSeek pick to another server (D240).

### When a model fails

Technical failure moves **only the unfinished call**, to the next ready rung,
once per hop (`automatic-failover.ts`). The reasons it recognises: usage limit
or quota (HTTP 429, "usage limit", exhausted credits — also when a CLI timeout
had already shown a 429), timeout or no output, a lapsed login, an unavailable
or unreachable provider (including LM Studio's "Model unloaded by user or API
request"), a reply that could not be read as JSON, a reply cut off at the
output limit, and an empty draft. A **content refusal is terminal** and
nothing else is tried. An explicit "Local model" pick fails closed: it is not
silently handed to a cloud provider. The switch is written on the job
(`desk_jobs.failover_note`) and shown on the story page: "This draft moved to
<model> because <previous> <reason>".

### Per-job assignments

**Models → Who does what** stores, per newsroom, a first choice and two
fallbacks for nine jobs: Daily scan and lead filing, Lead scoring and
duplicates, Story drafting, Opinion writing, Evidence check, Headline
suggestions, Dark Desk research, AI follow-ups, and Document reading and OCR
(`model_assignments`, migration 0100). The model saved there is the model that
runs. The owner changes it; editors can read it.

### Drafting scope and evidence review

**Write a story** and the story workbench offer **Research public sources** or
**Use only supplied material**. The latter opens only explicitly supplied URLs
and reads the supplied text. In that scope the prompt tells the model to use
only the supplied material and not to search or fetch; its tools are still
attached (G25-LO-4). The scope survives retries and failover, and every Story
model can use it. Instructions pasted inside source material do not replace
this control.

After a body edit, drafts with reporting evidence need an explicit evidence
review before publishing: the publish check warns until one is recorded, and
**Publish anyway** is audited. Keep the evidence only after checking it against the
revised text, or remove the old public evidence. Removal preserves the original
private draft archive and does not remove body links. An evidence-review
decision is refused if its saved draft has changed, and these actions remain
scoped to the editor's newsroom. See [the workbench instructions](editor.md#draft).

Recorded findings have a separate private review list in the workbench. It
shows only findings recorded with the draft, their cited passage and locator,
and mechanical capture facts: availability, passage match in the cited version,
and a newer-capture notice. None of these mechanical facts is a truth judgment.
An editor can record **Supports**, **Does not support**, **Contradicts**, or
**Needs reporting**; contradiction requires a reason and a readable cited
captured version from that finding. The judgment save binds to the exact draft
and cited evidence, so a changed draft, captured record, or concurrent save
requires a reload. This is not a claim-coverage inventory and does not
authorize publication. Captured-text buttons open a private workbench pane.
Saving story edits refreshes the review without a page reload; queued or
running replacements and pending draft-wide evidence decisions temporarily
disable judgment controls. Failed reloads retain unsaved judgment inputs;
explicit successful reloads discard them. Malformed historical structured
findings are disclosed as unreadable and cannot receive judgments; no
historical content is guessed or repaired.

The same pane separately lists **Claims returned by this draft pass**. It
preserves only the structured claims returned when that draft was created; it
does not parse later human edits or claim complete coverage of the body. Each
private row is bound to the exact provenance URL and named captured version or
capture event from that draft. Missing, foreign, repointed, arbitrary same-URL,
and newer captures remain unavailable for that row rather than replacing its
evidence. These use the same human judgment controls and never create an
automatic verdict or publication permission.

Editors can also add a private **Claims added by an editor** row for a body
fact the draft pass did not return. The editor selects one to six already
captured newsroom records, marks each as corroborating, contrary, or context,
and can open only those exact saved versions. The panel never fetches a URL or
silently substitutes a later capture. Record count and host names do not
establish independence, truth, or support. A manual claim text or record change
reopens its judgment; **Supports** needs a readable record the editor
explicitly marked corroborating, while **Contradicts** needs a reason and a
readable record explicitly marked contrary. These private rows do not change
the article, public evidence, or publication permission.

Reporting uses the originating newsroom's paper identity and captured evidence.
Public capture pages, histories and comparisons stay within the public edition:
publishing a source URL does not expose another newsroom's copy. Capture
references pointing into another newsroom or to a different source URL are
excluded; historical rows are not reassigned or rewritten.

### Which feature uses which writer and provider

| Feature                               | What runs                                                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scan                                  | Automatic: the configured gateway when set, otherwise the ladder. A named pick runs first. A recognised technical failure moves only the unfinished call and reuses sources already fetched.                                                                                |
| Draft, normal news lead               | **The `report-local-news` skill** (an agent, one run per lead) on **DeepSeek v4.1 Flash 1017** and on the Claude picks (Fable, Opus, Sonnet, Haiku). Every other pick keeps the four-pass writer on that same pick. If the skill cannot finish, the same model writes the story the usual way and the story page says so. |
| Draft, meeting lead                   | The whole-meeting skill writer. It runs on DeepSeek v4.1 Flash 1017 or on a Claude pick; any other pick runs on DeepSeek and the run record says what was asked for. A lead whose notes name one agenda item stays on the one-item meeting path.                              |
| **Write a story** (desk landing page) | Files the lead, then the Draft rules above                                                                                                                                                                                                                                 |
| Dark Desk synthesis and brief         | The one you pick beside **Keep digging**; Automatic uses the same ladder as Draft (Sonnet 5.5 is its last rung), and a recognised technical failure switches mid-round (`dark.ts`)                                                                                         |
| Dark Desk **planner**                 | A cheaper model from the SAME provider: Haiku on Claude, Codex Sol on any Codex pick, Gemini 3.8 Flash on Gemini; on a gateway, DeepSeek or Local, the model you chose                                                                                                      |
| **Opinion (editorials)**              | Automatic = DeepSeek v4.1 Flash, then Codex Sol 6.1, then Claude Sonnet 5.5, resolved before the run starts. Named picks run first.                                                                                                                                        |
| Routine editions                      | No model. Fixed templates over owner-approved sources.                                                                                                                                                                                                                     |
| Meaning search                        | No chat model. A small embedding model inside the server (see [Search by meaning](#search-by-meaning-desk-only))                                                                                                                                                           |

**Opinion provider behavior.** An editorial uses the paper's configured voice.
Opinion's picker offers Automatic, every named Codex, Claude and Gemini model,
Local model, DeepSeek v4.1 Flash and custom connections. Claude Code receives
the voice through `--system-prompt-file`; Codex through
`model_instructions_file`. The Claude and Codex writer **holds the voice file
and its research tools in one run**, because the voice file carries the
research protocol. Every op-ed requires a claims-and-sources appendix. An
incomplete draft is retained and flagged for completion before publication.
DeepSeek, the explicit Local model path and saved connections have no web
tools; for them **the desk** searches, opens and records the pages — reading
the newsroom's own record first — and the same voice governs the planning and
the reading as well as the writing. The writing pack says how many searches ran
and how many pages were read. A run ends when the protocol's stopping
conditions are met, or at the safety ceiling (30 minutes, 80 pages;
`EDITORIAL_RESEARCH_CEILING_MS`, `EDITORIAL_RESEARCH_PAGE_CEILING`).

**The planner split.** Planning on Haiku costs about a quarter of planning on
Opus for the same output (measured in a September 2026 bake-off recorded in
`ai.ts`), so the desk substitutes it — but only within the same provider. A
gateway, DeepSeek or Local model has no planner entry and is left alone:
pointing `LLM_BASE_URL` at LM Studio does not make the desk ask a local endpoint
for a Claude model. `TOWNREPORTER_PLANNER_MODEL` overrides the planner model on
any provider.

### Effort

Each model offers only the efforts verified for it
(`modelEffortsFor`): Codex 6-series Low, Medium, High, Extra high, Maximum;
Claude Low through Maximum; Gemini Low, Medium, High; **DeepSeek v4.1 Flash
None, Low, High, Max with None as the default**; unmeasured local models get
the server's own default. Automatic has no single effort: each rung runs at its
own default, and the picker says so. The effort that ran is recorded on the
job.

### Time budgets

Each provider ships with a per-call ceiling and a whole-pipeline wall time
(`KIND_BUDGETS`, `PIPELINE_BUDGET` in the registry):

| Provider kind                              | One call | Whole draft pipeline |
| ------------------------------------------ | -------- | -------------------- |
| Claude Code, Codex, Gemini programs        | 300 s    | 900 s                |
| Gemini 3.1 Pro                             | 300 s    | 660 s                |
| A configured gateway (`LLM_BASE_URL`)      | 180 s    | 660 s                |
| Anthropic API, OpenAI-compatible HTTP      | 20 s     | 38 s                 |
| Local model, DeepSeek rung                 | 600 s    | 2,400 s              |

The owner can change the per-call number for any provider on the **Server**
page, under **Time budgets**: **Time per call**, in seconds, with the shipped
default beside it and a **Reset**. Between 10 seconds and 60 minutes. The
answer is stored per paper in `provider_settings`
(`migrations/0029_provider_settings.sql`); Reset clears the row's number rather
than writing today's default into it, so a paper that never made a decision
keeps inheriting improvements to the defaults. Longer ceilings exist for local
models: a 30B model answering a 20,000-character pack on the same machine takes
minutes. Editorial passes use `EDITORIAL_TIMEOUT_MS` (default 45 minutes per
pass).

Pointing `LLM_BASE_URL` at a local model sends Scan, Dark Desk, and Story
Automatic to that gateway. An explicit Story choice still forces its named
provider. What local models cost in quality was measured on this machine:
[local-models.md](local-models.md).

Signed-in CLI paths use the operator's subscription or quota; API-key paths can
incur API charges. A CLI is slower than an HTTP API because it reloads a fixed
preamble on every call, so a draft takes minutes rather than seconds.

### The optional tools

| Tool                  | What uses it                                         | How the desk finds it                                                                                          |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Claude Code CLI       | Claude picks, DeepSeek, the news and meeting skill writers, OCR | `CLAUDE_CLI_PATH`; else `~/.local/bin/claude`, the npm global prefix, `%APPDATA%\npm`, then `PATH` (the native install and npm prefix are checked **before** an `%APPDATA%\npm` hand copy) |
| Codex CLI             | Codex picks, OCR                                     | `CODEX_CLI_PATH` (a wrong path is an error, never a fall-through); else the npm vendor binary or shim under `%APPDATA%\npm`; else `codex` on `PATH` |
| Gemini program `agy`  | Gemini picks                                         | `GEMINI_CLI_PATH`; else `%USERPROFILE%\Tools\agy\bin\agy.exe`; else `agy` on `PATH`                           |
| Ollama                | DeepSeek rung, `:cloud` models, local models         | `http://127.0.0.1:11434/v1`; `TOWNREPORTER_DEEPSEEK_BASE_URL`                                                  |
| LM Studio             | The Local model rung                                 | `http://127.0.0.1:1234/v1`; `TOWNREPORTER_QWEN_BASE_URL`                                                       |
| LibreOffice           | Excel, PowerPoint and LibreOffice files              | `TOWNREPORTER_SOFFICE`, then `Program Files\LibreOffice\program\soffice.exe` (and x86), then `PATH`. One conversion at a time, 2-minute limit, own temp profile with macros off, stuck process stopped by PID only. The Server page shows "LibreOffice: found / not found". |
| `yt-dlp` and `ffmpeg` | Meeting capture                                      | `TOWNREPORTER_PYTHON` names the python that carries yt-dlp; the Control page's **Meeting video tools** row reports both |
| `textflowkit`         | Speech-to-text for captionless meetings              | `TEXTFLOWKIT_CLI_PATH`, else `PATH`; `TEXTFLOWKIT_ENGINE`, `TEXTFLOWKIT_MODEL`, `TEXTFLOWKIT_LANGUAGE`        |

A boot-started server may have no `APPDATA`; the finders derive it from the
profile and look again after a miss (PR 310 and the Oct 16 boot-start work).

## The Opinion voice

The Opinion desk writes in a voice held in a file on disk, named by path:

```
TOWNREPORTER_VOICE_FILE=C:/Users/you/.townreporter/voice/your-voice.md
```

The file is deliberately outside the repository, and the app refuses a path
inside it. On Claude and Codex, only the **path** reaches the program's
arguments; the program opens the complete file. For explicit Local model,
DeepSeek and saved connections, TownReporter reads the validated file and sends
its text as a system message to the model server. The voice is not a
command-line argument. An owner can instead write with a neutral house voice
(`editorial_requests.voice_mode`, migration 0147) when no voice file is set.

## Search by meaning (desk only)

The Story page's **Find evidence** panel has an exact-words list and "close in
meaning" lists. Meaning search exists **on the editor desk only**; the public
paper's search box is unchanged (details in [Part 5](#search-by-meaning-the-index)).

- The embedding model is `Xenova/all-MiniLM-L6-v2` (384 numbers per piece),
  loaded lazily inside the Node process through `@huggingface/transformers`.
  No LM Studio or Ollama is involved.
- Its files are cached under `<TOWNREPORTER_DATA_ROOT>/models` (or
  `TOWNREPORTER_DATA_DIR`, else `~/.townreporter-data/models`). The
  model is not bundled: `scripts/package-windows.mjs` and
  `installer/dependencies.json` name no model files, and
  `evidence-embed.server.ts` sets only the cache folder, so the first load
  fetches the model through the library's default route and needs internet once
  (a source install and the Windows package behave the same).
- A background fill starts 3 minutes after boot, then runs every minute:
  32 evidence pieces and 6 published stories plus 1 uploaded file per tick. An
  hourly prune removes vectors whose text no longer exists.
- `TOWNREPORTER_MEANING_SEARCH=off` turns the fill, the prune and the lists off.
  If the model or the tables are unavailable the exact-words list still works
  and the panel says "Search by meaning is not available now."

## Serving it publicly

The following describes the **legacy Halo installation** (the live paper), not
the Windows installation package. Its local operator must first establish the
[legacy ownership configuration](../SELF-HOSTING.md). The package does not
install these tasks or a tunnel and refuses these legacy operations. The `ops/`
directory holds that installation's scripts:

| Script                         | What it does                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ops/watchdog.ps1`             | Every five minutes: check Postgres, the app, the tunnel and the public URL; restart what is down; nightly backup; alerts; keeps Redlib, Ollama and the test copy up |
| `ops/start-townreporter.ps1`   | Start Postgres, wait for a real query, migrate, serve the paper (and Redlib if installed)                                            |
| `ops/stop-townreporter.ps1`    | Stop the paper and Redlib (`-IncludeDatabase` for Postgres too)                                                                      |
| `ops/run-tunnel.ps1`           | Start `cloudflared` for this hostname                                                                                                |
| `ops/restart-app.ps1`          | Stop and start the paper (run by the "TownReporter Restart" task)                                                                    |
| `ops/restart-tunnel.ps1`       | Stop and start the tunnel                                                                                                            |
| `ops/rotate-logs.ps1`          | Keep `logs/` from growing without bound                                                                                              |
| `ops/status.ps1`               | Is it up? Read-only, and it answers when the paper is down and `/desk/ops` cannot. `-Json` is what the Control page renders           |
| `ops/control.ps1`              | Opens the **Control page** at `http://127.0.0.1:3095` (`ops/control/control-server.mjs`)                                              |
| `ops/TownReporter Control.cmd` | The same, for someone who does not want a terminal. Double-click, pick a number.                                                      |
| `ops/backup.ps1`               | Dump, copy to the second drive, prune, alert. Also run nightly by the watchdog                                                       |
| `ops/promote.ps1`              | Put `origin/main` onto this install, with a database copy and a rollback                                                              |
| `ops/stage.ps1`, `ops/start-stage.ps1` | Restore the newest backup into `townreporter_dev`, build, serve on 3100; start the staged copy again after a reboot       |
| `ops/nightly-proof.ps1`        | Register or run the nightly scan-and-draft proof against the Test server                                                              |
| `ops/redlib.ps1`, `ops/redlib-relocate.ps1` | The local Reddit reader                                                                                                 |
| `ops/run-hidden.vbs`           | Runs the five-minute tasks with no console window                                                                                    |
| `ops/install-tasks.ps1`        | Registers the six app and operations tasks. Idempotent, `-WhatIf` supported, and refuses to repoint another install's tasks. Run it elevated and the paper and tunnel also start at boot, whether or not anyone is signed in |
| `ops/install-shortcut.ps1`     | Builds the Desktop shortcut to the Control page                                                                                      |

Restart and tunnel-restart run as Windows scheduled tasks rather than as child
processes of the app — a restart cannot be performed by the process being
restarted, and a tunnel restart cannot report its result over the tunnel it
just killed.

The watchdog (`ops/watchdog.ps1`) does the following, in order, and logs the
value behind every decision to `logs/watchdog.log`:

1. Checks Postgres first and never touches the app while the database is down.
2. Checks the app port, then a real HTTP 200.
3. **Start guard** (`ops/lib-start-guard.ps1`): a start that is still starting
   is left alone for **600 seconds** (the worst good cold boot is about 520 s);
   a start older than that is stopped by PID and started again.
4. **Two probes before any kill**: a miss with a listener is probed again after
   30 seconds, and only a second miss repairs. A last look comes right before
   the port owner is stopped. Each miss logs the disk queue length.
5. Starts or restarts the tunnel as needed, keeps Redlib and Ollama up (never
   stopping Ollama, never touching LM Studio), and starts the staged test copy
   after a reboot when the paper is healthy.
6. Takes the nightly backup (after 2:00 AM, newest backup older than 20 hours,
   no editor job running) and evaluates alerts.

Deployment notes for other hosts, and the remaining limits of a city setup, are
in [docs/setup.md](setup.md). Never rebuild a checkout while a server is
serving its `.output`.

### Backups

The rule (Oct 25 2026): keep 3 days of backups, on D: not C:. Each backup is a
plain-SQL `pg_dump` written next to the checkout, copied to
`BACKUP_OFFSITE_DIR` (default `D:\TownReporter-backups`), verified by size and
SHA-256, and only then removed from C:. D: keeps the newest backup of each of
the 3 newest days. If D: is missing, unwritable or has less than 100 GB free,
nothing is deleted anywhere and the Control page says why. Big disk jobs pause
between batches while the paper is slow (`ops/lib-disk-guard.ps1`). Details,
restore steps and phone alerts are in [SELF-HOSTING.md](../SELF-HOSTING.md#backups).

### The three places a build lives

| Tier            | Where                                              | Database                                         | Purpose                                                       |
| --------------- | -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| **Production**  | The live checkout, port 3000, behind the tunnel    | `townreporter` on Postgres 5433                  | The paper readers see. Nothing is built here while it serves. |
| **Dev (staging)** | A worker checkout run by `ops/stage.ps1`, port 3100 | `townreporter_dev`, restored from the newest backup | Walk the changed screens against a copy of real data. Never port 3000, never the live database. |
| **Test**        | A fuller throwaway server, port 3400               | `townreporter_test_<yyyyMMdd_HHmmss>` on Postgres 5547, role `tr_test_admin` | Full walks including Publish, and the nightly proof. Created outside this repository's scripts. |

A change reaches production by passing through them in that order, then through
`ops/promote.ps1`. [staging.md](staging.md) and
[Part 5](#releasing-promote-and-rollback) describe the mechanics.

## Point it at another city

Use the owner-only **Paper setup** form. On a fresh install it opens
automatically; later it lives on the Server page.

1. Set the paper name, tagline, city, state, timezone, contact and optional
   council-votes link.
2. Add the official pages worth watching.
3. Add meeting-video channel URLs and the title phrases used by that city.
4. If the city uses PrimeGov, add its public portal to the watch list.
5. Optionally add the paper's newsletter mailbox (an IMAP login, stored
   encrypted) so subscribed newsletters enter the archive and the scan.

The masthead, city copy, local dates, public links, source list and YouTube
meeting discovery all change from the saved database settings. Blank optional
fields remain blank; they do not inherit Longmont's values.

## When something is wrong

| You see                                                              | Look at                                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Every page answers 503 "database needs an update"                    | `npm run db:migrate`, or start through `promote.ps1` / the installer, which migrate first                          |
| Sign-in says "Invalid origin"                                        | `BETTER_AUTH_URL` and `BETTER_AUTH_TRUSTED_ORIGINS` must list every origin the desk is reached from               |
| A pick says the program is not found or signed out                   | **Server → Writing models** Sign in and Test; `CLAUDE_CLI_PATH` / `CODEX_CLI_PATH` / `GEMINI_CLI_PATH`            |
| Automatic always lands on Codex or Claude                            | Ollama is down or has no DeepSeek tag, and nothing is loaded in LM Studio; the run's "Skipped:" note names each   |
| "Local model skipped: nothing loaded in LM Studio"                   | Load a model there. The desk never loads one                                                                      |
| DeepSeek draft ends with the CLI missing                             | The Claude Code CLI is not installed; DeepSeek then runs by HTTP without tools                                    |
| A usage-limit warning from Ollama                                    | Add credit at `ollama.com/settings`, or the desk moves to the next model; a later successful call clears the warning |
| Excel or PowerPoint file skipped                                     | "Install LibreOffice to read Excel and PowerPoint files"                                                          |
| A meeting stays audio-only                                           | No captions and no `textflowkit`; see Server → Meeting capture                                                    |
| The paper is slow while a backup or prune runs                       | `logs/backup.log` and `logs/watchdog.log` name the top disk processes                                             |

---

# Part 4 — How it is built

This part is for the developer or operator who has to find things. Part 5 draws
the data flow. Part 6 lists routes, keys, scripts and tables.

## The stack

| Layer     | What                                                           | Why                                                                                                            |
| --------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Framework | [TanStack Start](https://tanstack.com/start) on Vite, React 19 | File-based routes, typed server functions, SSR without a separate API                                          |
| Server    | Nitro, `node-server` preset                                    | A long-lived process: Chromium stays warm and background jobs are not chopped into request-sized pieces        |
| Database  | PostgreSQL through `pg` (embedded PGLite when `DATABASE_URL` is unset) | Plain SQL; migrations are numbered `.sql` files                                                |
| Auth      | [better-auth](https://better-auth.com)                         | Email and password against the desk's own database; no email service                                           |
| Styling   | Tailwind 4                                                     |                                                                                                                |
| Fetching  | `undici`, with a connect-time SSRF guard                       | The address approved is the address connected to (`src/lib/news/url-guard.ts`, `fetch-url.ts`)                 |
| Rendering | Playwright Chromium                                            | JS-heavy civic portals, YouTube "Show transcript", and the one guarded retry for sites that refuse a plain fetch |
| Documents | `unpdf` for PDFs, `word-extractor` for `.doc`, LibreOffice for Excel and PowerPoint | Text extraction plus bounded vision OCR for supported scan images; unsupported or failed reads remain explicit |
| Meaning   | `@huggingface/transformers` running MiniLM-L6-v2 in process    | Desk-only "close in meaning" search; no separate service                                                       |
| Mail      | `imapflow` and `mailparser`                                    | Optional newsletter intake from the paper's own mailbox                                                        |
| Models    | The Claude Code, Codex and Gemini (`agy`) programs; Ollama; LM Studio; the Anthropic SDK; any OpenAI-compatible URL | One registry (`provider-registry.ts`) decides which, and the choice is stored on every job |

Node 22 or newer is required (`engines` in `package.json`). The version is
locked across `package.json`, `src/lib/version.ts` and the paper's masthead, and
`scripts/versions-agree.test.mjs` fails the suite when documentation calls an
older release current.

## Where things live

| Folder                  | What is in it                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`           | File-based routes: the public paper, `/desk/*`, `/api/*`                                                                            |
| `src/lib/news/`         | Nearly all newsroom logic: scan, drafting, jobs, the model registry and runtimes, Dark Desk, routine editions, evidence, publishing |
| `src/lib/auth/`         | Sessions, same-site guard, account lockout, sign-in throttle                                                                        |
| `src/lib/desk/`         | Desk navigation and the Server page's cards (`ops-cards.ts`)                                                                        |
| `src/lib/db.ts`         | The SQL handle, `ensureSchemaOnce`, transactions, the PGLite fallback                                                               |
| `server/middleware/`    | Nitro middleware: schema ledger check, canonical host, security headers, head chrome                                                |
| `server/plugins/`       | Boot work: auth-secret check, setup code, schema warm-up, the unattended clock                                                      |
| `migrations/`           | The numbered `.sql` schema (153 files); `migrations/auth/` is an opt-in auth schema that the runner does not read                  |
| `scripts/`              | Build helpers, `migrate.mjs`, `package-windows.mjs`, browser walks, tests of the tooling                                            |
| `ops/`                  | The legacy Windows installation's scripts: watchdog, promote, stage, backup, Control page                                           |
| `installer/`            | The Windows package: `Install.ps1`, `Start.ps1`, `Stop.ps1`, `Health.ps1`, `Configure-AI.ps1`, `dependencies.json`, `windows-setup/` |
| `civic-scanner/`, `report-local-news/` | The two reporting skills; `prebuild` packages them into the build (`scripts/package-civic-scanner.mjs`, `package-report-local-news.mjs`) |
| `docs/`                 | This manual, the guides, the diagrams, the release notes; `docs/index.html` is the GitHub Pages landing page                       |

## Server functions and the desk boundary

Every desk action is a `createServerFn` with `deskMiddleware`
(`src/lib/news/desk-auth.ts`), which:

1. asserts the request is same-site (`assertSameSiteRequest`, which accepts only
   `Sec-Fetch-Site: same-origin`),
2. resolves the user from the session (never from anything the client sends),
3. requires that user to be an owner or editor of this newsroom.

The user id is never taken from the client. Owner-only actions call
`assertOwner(role)`. Open signup closes after the owner claims the desk. A second
person joins only through the one-time link created by the owner under **Server
→ Editors & access**. A claimed desk is unclaimed again only by **Give up the
desk**, and the next owner then needs the setup code.

Three server middleware files wrap every request:

- `canonical-host.ts` redirects `www.` to the bare domain with a 308 when
  `PUBLIC_SITE_URL` or `BETTER_AUTH_URL` names a bare domain. The same-site
  guard stays strict; two live origins would break it.
- `security-headers.ts` sets `frame-ancestors 'none'` and `X-Frame-Options:
  DENY`, `nosniff`, a referrer policy and a deliberately narrow
  Content-Security-Policy, plus the document cache rule: `/desk` and everything
  under it is `private, no-store`; every other HTML page is `no-cache`
  (revalidate, so a 304 is still fast). It sets no HSTS, because TLS ends at
  the tunnel.
- `app-chrome.ts` injects the manifest and Open Graph head tags at `</head>`.

`server/plugins/require-auth-secret.ts` refuses to start a real install (a set
`DATABASE_URL`) with no `BETTER_AUTH_SECRET`, so a restart cannot silently sign
everyone out.

## The schema guard and the boot warm-up

Two files make a stale database visible instead of subtle:

- `server/middleware/00-schema-current.ts` awaits `assertMigrationsCurrent()`
  (`src/lib/migration-status.ts`), which compares `migrations/*.sql` with the
  `_migrations` ledger. Behind means a plain 503 on every request and a log line
  naming the missing files.
- `server/plugins/schema-warmup.ts` runs each module's `ensure*Schema` batch
  once before the first request (`src/lib/schema-warmup.ts`), so the first
  editor click does not pay for it. A module can mark its work done and be
  skipped next time.

Most tables are created by numbered migrations. A few modules still create their
own tables lazily with `create table if not exists` when first used (the routine
edition automation, policy and check tables are an example:
`routine-notice-automation.ts`, `routine-notice-policy.ts`,
`routine-notice-checks.server.ts`), and the warm-up runs those batches too.

## Jobs

Anything that can take minutes is a row in `desk_jobs`, not a held-open request.
There are **thirteen kinds** (`JOB_KINDS` in `src/lib/news/jobs.ts`), listed with
their lanes in [Job kinds](#job-kinds). A server function inserts the row and
returns at once; the page polls.

- **Lanes.** `editorial` (Opinion; one at a time), `draft` (story drafts; two)
  and `default` (everything else; two). `laneForKind` is the only place that
  decides, so a scan or a Dark Desk dig cannot take a draft's slot.
  `LANE_CONCURRENCY = { editorial: 1, default: 2, draft: 2 }`.
- **Claim and heartbeat.** A job is claimed with a token and writes a heartbeat
  every 30 seconds while it runs (`HEARTBEAT_MS`). A running job whose heartbeat
  is older than 120 seconds is stale (`STALE_RUNNING_SECONDS`) and can be
  reclaimed. This is not decoration: jobs once ran **twice**, because nothing
  refreshed the liveness stamp mid-run and any job past the stale line was
  re-claimed and run beside the original.
- **One model, one holder.** The queue reason names the other live job holding the
  same model, so an editor sees why a draft waits. Local model admission is
  separate from lane capacity.
- **Cancel.** A stop request is a flag the worker checks; a cancelled row is not
  reclaimed.
- **What the row records.** The requested model choice and its source
  (`model_choice`, `model_choice_source`), the research scope, the stage text
  shown to the editor, the failover note, and the receipt in `result_json` (see
  [The run receipt](#the-run-receipt)).
- **Dispatch.** `realWork` in `jobs.ts` imports and runs the one worker for the
  kind (`performDraftWork`, `performDailyScanWork` or `performScanWork`,
  `performDarkRound`, `performEditorialWork`, `performRoutineNoticeWork`, and so
  on).

### The unattended clock

`server/plugins/unattended-clock.ts` starts one process-wide clock
(`startUnattendedScheduler`, `src/lib/news/unattended-scheduler.ts`) at boot of
the **built** server (`npm run dev` has its own Vite-side cadence). It first
reconciles configured meeting audio storage, then:

| Cadence | First run | Work                                                                                                                                       |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 5 minutes | 45 s after boot | Newsletter mailboxes, YouTube capture retries, due page and source monitors, daily scans (`tickDailyScans`), routine edition runs (`tickRoutineNoticeEditions`), follow-ups |
| 20 seconds | 8 s after boot | Drain queued jobs into their lanes                                                                                                       |
| 1 hour  | 60 s after boot | Stats reports, the daily source-yield refresh, trial and dormant source passes, minutes-vote reads                                          |
| 1 minute | 3 min after boot | Meaning-search fill (unless `TOWNREPORTER_MEANING_SEARCH=off`); an hourly prune beside it                                                  |

A tick is skipped while the previous one is still running. Each hourly task has
its own try/catch so one failing task cannot stop the others. `ops/cron-tick.ps1`
(the legacy "TownReporter Monitors" task) and `GET /api/cron/monitors` with
`CRON_SECRET` poke the same work from outside.

## Sources, scans and the dynamic source pool

The accepted source list is not a fixed dozen. Since 0.6.84 sources move between
three states on their own, and nothing is deleted
(`src/lib/news/source-trials.ts`; migration 0153):

- **Accepted**, **trial** and **dormant** are values of `sources.status`.
  A trial source is read by a light pass (a fetch, a hash and an observation; no
  model; at most 6 per tick, each at most every 4 hours). After 6 trial reads
  with 2 or more changes that hold a dated local item (a place word and a date)
  it becomes accepted; after 6 reads without that it goes dormant. A dormant
  source gets a monthly re-check and returns to trial if it finds such a change.
  An accepted source with no change and no lead for 45 days goes dormant,
  except official and tier-A sources and an editor's daily pick. Every move writes
  an observation with the numbers behind it, and an editor can move any source
  back by hand.
- **Yield** (`source_yield`, `source-yield.ts`): per source over 90 days, scans
  that read it, leads filed from it (`leads.source_id`), how many were
  published or killed, and how many of the kills were for a bad source.
  Recomputed about once a day. The score the scan orders by is
  0.7 x leads per read + 0.3 x 3 x published per read - bad-source kills per
  read, and it stays null under 3 reads.
- **Cadence** (`source-cadence.ts`): `sources.interval_minutes` starts at 1,440,
  shortens after news and lengthens after silence (floor 6 hours for official
  sources, 12 hours for others; ceiling 7 days, 30 days when dormant); a source
  whose changes fall on one weekday, or one week of the month, gets a `rhythm`
  that sets `next_due_at` instead. Failures do not move the cadence; the existing
  `retry_after` backoff handles them.
- **The daily scan** (`daily-scan.ts`, `daily-scan.server.ts`,
  `daily-scan-plan.server.ts`, `scan-supply.ts`): a saved policy per paper with
  a source cap of 1 to 12, an **every-day** count (default 8) and the rest
  filled by a deterministic rotation (`planDailySourceRotation`). The editor's
  picks always run first and in their order; a pick that is parked or blocked
  waits for its retry and is reported, never silently dropped. The remaining
  budget goes to sources that are due, high priority or have waited longest, with
  the yield score as an input. The whole pool is read inside a 90-minute budget
  (`DAILY_SCAN_TIME_BUDGET_MS`) in batches. The saved policy can also carry a cap override above 12
  (`source_cap_override`, migration 0145).
- **Coverage.** Every scan records, per source, `read`, `skipped`, `blocked` or
  `pending`, with a reason code (`time-budget`, `over-cap`, `waiting`,
  `host-cap`, `not-reached`, `fetch-failed`, `blocked-after-render`, `not-due`),
  in `scan_runs` (migration 0132, `scan-source-coverage.ts`). It exists so a thin result is
  never mistaken for a full pass.
- **Refused sources.** A site that refuses a plain fetch is retried once through
  Chromium, and the desk looks for a public feed. The route that worked is kept
  on the source (`last_read_method` is `fetch`, `playwright` or `feed`,
  `last_read_outcome`, `last_read_route_url`; migration 0145). Public means
  public: the desk reads what any visitor can read.
- **Newsletters.** An owner can connect an IMAP mailbox in Paper setup
  (`newsletter_mailboxes`, `newsletter_messages`, `newsletter_attachments`;
  migration 0145; `newsletter-poll.server.ts`, five-minute tick). Messages are
  deduplicated, attachments are kept, and a source can name its sender
  (`sources.newsletter_sender`).

## Evidence maturity

Extracted claims carry evidence-maturity labels, and each label caps the
confidence **in code** (`CONFIDENCE_CEILING`, `src/lib/news/investigate.ts`) —
not by asking a prompt nicely:

| Label       | Ceiling |
| ----------- | ------- |
| FACT        | 1.0     |
| OBSERVATION | 0.9     |
| INFERENCE   | 0.7     |
| ALLEGATION  | 0.6     |
| HYPOTHESIS  | 0.5     |
| UNKNOWN     | 0.3     |

The separate Stage 1 signal confidence is always capped at 0.5, regardless of
the table. A claim labelled FACT with no citation is downgraded rather than
trusted (`claim-hygiene.ts`). Claims about the desk's own digging — "twelve hops
found no contract" — are dropped instead of filed as findings about the world.

## Model routing

`src/lib/news/provider-registry.ts` is the one place that names providers. Each
entry carries its picker id and label, program kind, model id, whether it is on
the Automatic ladder (`ladderRank`) or Opinion's (`opinionLadderRank`), the
efforts it offers, a planner model, and its time budgets. The ladder, the
picker, the readiness probe and the failover order are all derived from it, so
adding a model is one entry.

### Resolving a pick

`probeProvider(choice)` (`src/lib/news/ai.ts`) answers "can this run now, and
on what". For a named pick it probes that provider. For **Automatic** it uses a
configured gateway (`LLM_BASE_URL`) when there is one, otherwise walks the
ladder: DeepSeek v4.1 Flash 1017, the loaded Local model, Codex Sol 6.1
(balanced), Claude Sonnet 5.5. Each skipped rung is recorded with its reason
(`skippedRungs`). The effective provider is **resolved before the job is
enqueued** and stored on the job, so what the editor sees in the queue is what
will run, and a later change to settings cannot change a queued job.

Gemini has no `ladderRank`, so Automatic, the scheduled scan and every failover
skip it; it is a named pick only (PR 331). Opinion has its own order
(`opinionLadderRank`): DeepSeek, Codex Sol 6.1, Claude Sonnet 5.5. Unattended
ladders never select Claude Opus. OCR has `OCR_AUTOMATIC_ORDER`: Codex Sol 6.1
(balanced), then Claude Sonnet 5.5, then a local model marked as a vision model.

### The runtimes

| Runtime       | Module                                   | How it runs                                                                                          |
| ------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Claude Code   | `ai-claude-code.server.ts`               | `claude` print mode, prompt on stdin, full tools, permission prompts off; CLAUDE.md, hooks and auto memory excluded |
| Codex         | `ai-codex.server.ts`                     | `codex exec`, ephemeral, no project docs or personality, approvals and sandbox off, in a per-call temp folder |
| Gemini (`agy`) | `ai-gemini-cli.server.ts`               | `agy` in a fresh empty folder; the model suffix follows the effort                                    |
| DeepSeek      | `ai.ts` into `ai-claude-code.server.ts`, via `deepseek-relay.server.ts` | The Claude Code program pointed at a loopback relay that talks to Ollama                |
| Local model   | `ai.ts`                                  | OpenAI-compatible HTTP to LM Studio; the loaded model only                                            |
| Custom        | `ai.ts`                                  | OpenAI-compatible HTTP to a saved connection (`custom:<uuid>`)                                        |
| Anthropic API | `ai.ts`                                  | The SDK, when `ANTHROPIC_API_KEY` is set                                                              |

`cli-child-env.server.ts` builds the child's environment from an allow-list, so
the database URL, the auth secret and other providers' keys never reach a
model program. Since D149 (Oct 18 2026) the three programs run with their full
tool set and with permission prompts off; see
[What a model command-line call can and cannot do](#what-a-model-command-line-call-can-and-cannot-do).
A timeout kills the process tree by PID.

`deepseek-relay.server.ts` is a loopback relay started lazily on a random port,
with an unguessable route per call. It rewrites `/v1/messages` so that effort
None sends `thinking: disabled`, Low/High/Max enable thinking with a budget,
`max_tokens` is at least 32,768, and only the route's own bearer reaches
Ollama.

### Failover

`automatic-failover.ts` decides whether a failed call moves on and to where
(`planAutomaticFailover`). Quota or usage limit, timeout or no output, a lapsed
login, an unavailable provider, an unreadable reply, a reply cut off at the
output limit and an empty draft are recoverable; a **content refusal is
terminal**. The forced ladder after a failure is `FORCED_FAILOVER_LADDER` (Codex
Sol 6.1 balanced, then Claude Sonnet 5.5). Only the unfinished call is retried,
once per hop, and an explicit Local model pick fails closed rather than going to
a cloud provider. Draft, Dark Desk (`dark.ts`) and scan all use it; Dark Desk can
switch mid-round and says so in the stage text. The result is written as
`failover_note` on the job and shown on the story page.

### The run receipt

`model-runtime-receipt.ts` writes what actually happened into
`desk_jobs.result_json`, so "the model shown is the model that ran" is checkable:

| Field                      | Meaning                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| `requestedRuntime`         | What the editor (or the schedule) asked for                                       |
| `actualRuntime`            | What answered                                                                    |
| `actualModelId`            | The model id sent to the program                                                  |
| `effort`                   | The effort that ran                                                              |
| `skippedRungs`             | Each ladder rung passed over, with the reason                                    |
| `localModel`               | The model LM Studio had loaded, when Local ran                                    |
| `failover_note` (a column) | The sentence shown on the story page when a call moved                            |
| `drafts.model_body`        | The draft body as the model wrote it, kept apart from later human edits           |

### Which writer a draft uses

`performDraftWork` in `desk.ts` chooses the writer after the model is resolved:

- A **news lead** on DeepSeek or a Claude pick runs the `report-local-news` skill
  as an agent (`news-skill-writer.server.ts`, `report-local-news.server.ts`). If
  the skill cannot finish, the same model writes the story the usual way
  (a four-pass writer) and the story page says so. Every other pick uses the
  four-pass writer on that pick.
- A **meeting lead** runs the whole-meeting skill writer
  (`meetingWriterRuntime`, `desk.ts`): DeepSeek, or a Claude pick; any other pick
  runs on DeepSeek and the run record says what was asked. A lead whose notes
  name one agenda item stays on the one-item path.
- **Opinion** (`editorial.server.ts`): Claude and Codex hold the voice file and
  the research tools in one run; DeepSeek, Local and custom connections get a
  desk-run research pass (searching, opening and recording pages, reading the
  newsroom's own record first), and the same voice governs the planning,
  reading and writing.

### Per-job assignments in the code

`model_assignments` (migration 0100, `model-assignments.ts`) stores, per
newsroom and per job, a first choice and two fallbacks. The nine jobs are
`scan`, `lead-score`, `story-draft`, `opinion`, `evidence-check`, `headlines`,
`dark`, `follow-up` and `ocr`. The owner edits them under **Models → Who does
what**. At the end of first-run setup, `first-run-model.ts` stores **Local model > Use
whatever is loaded** for every writing scope when a local server answers with a
model in memory; otherwise it stores nothing and Automatic stands.

### Settings that outlive a restart

`provider_settings` (migration 0029) stores the per-call time and per-provider
choices. `newsroom_local_model_choices_additional` (migration 0129) keeps a separate Local
model choice for the `follow-up` and `ocr` surfaces, so a Local choice made for
one screen does not leak to another. Migration 0152 moves saved picks of the
floating `deepseek-v4.1-flash:cloud` tag to the pinned
`deepseek-v4.1-flash:1017-cloud` tag (D160).

## Search by meaning

Desk only. Details and the data flow are in Part 5. The code:
`evidence-embed.server.ts` (the model), `evidence-vector-fill.server.ts` and
`story-meaning-fill.server.ts` (the background fill and prune),
`evidence-search.server.ts` (the query). Tables `evidence_vectors` (migration
0156) and `story_meaning_vectors` (0158) store a 384-number vector and a pointer
and **never the text or the URL**. Migration 0157 adds `pg_trgm` and two indexes
on `artifact_chunks` for the exact-words list.

## Routine editions

Notices that are routine (library hours, parks programs, arts event logistics,
registration deadlines, waste and recycling schedules, public meeting logistics)
can be published without an editor, but only from sources the owner has
approved, through fixed templates, with no model in the loop.

- **Format keys** (`ROUTINE_NOTICE_FORMAT_KEYS`, `routine-notice-types.ts`):
  `library-notice`, `parks-recreation-notice`, `community-arts-event-logistics`,
  `registration-deadline`, `waste-recycling-schedule`, `public-meeting-logistics`.
- **Channels** (`routine-notice-editions.ts`): **Today in town** (today's
  events, every eligible one, split under Morning, Afternoon and Evening when a
  day has six or more), **This weekend** (Friday to Sunday; published on
  Fridays) and **Deadlines approaching** (registration deadlines in the next
  seven days). The weekend and deadlines channels share a cap of five notices per
  run; the rest are deferred.
- **Owner control.** Policy (`routine_notice_policies`, approvals and policy
  changes), automation settings (`routine_notice_automations`: enabled, local
  time, timezone, one section per channel, at most 12 sources) and per-source
  checks are all owner-only and revision-checked. Pausing the policy stops the
  next run.
- **The tick.** `tickRoutineNoticeEditions` (five-minute clock) queues one
  `routine-notice` job per newsroom per local date once the saved local time has
  passed, inside a transaction that re-checks the revision, the owner role and
  the pause flag. The job runs in the `default` lane with the model choice
  `deterministic`.
- **The worker** (`routine-notice-worker.server.ts`): re-checks authority before
  any source work; captures each approved source; extracts structured fields
  (`routine-notice-extract.ts`, `-feeds.ts`); drops anything high-risk
  (allegation, lawsuit, emergency, medical and similar words), anything whose
  source text contains a web address or markdown, a cancellation or non-scheduled
  status, or an over-long field, and **leaves those for an editor** with a reason
  in plain words; renders fixed templates with all source text stripped of
  markup; publishes each edition to its section with a fingerprint so a rerun
  does not duplicate it; and records the run (`routine_notice_runs`,
  `routine_notice_publications`) with published, corrected, needs-review and
  deferred counts.
- **Safety properties.** Stored on the publication: the source address, the
  policy revision, the capture and artifact version, and the content hash. A
  correction goes through the normal dated-correction path. The Server page has a
  **Routine notices** card (`ops-cards.ts`).

## Publishing: warn, never block

Ordinary stories reach the paper only when an editor presses **Publish**.
Everything before that is advice.

- `publish-blockers.ts` computes the reasons a press might be wrong. Each has a
  stable `key`, a sentence and a button that takes the editor to the fix. There
  are exactly five **hard** keys, the ones the desk itself cannot do anything
  with: `headline`, `body`, `publishing`, `evidence-review-saving` and
  `lead-not-found`. Everything else is a **warning**: an unnamed source for a
  named outlet, an unreviewed or contradicted claim, a stale or live evidence
  check, the readiness verdict, a held or killed draft, a missing dek or section,
  a meeting citation that no longer matches the record
  (`meeting-citation-stale`), and what the writer asked a person to check.
- The confirm dialog draws the warnings and offers **Publish anyway**. The second
  press sends the acknowledged keys back; `editorWarning` (`editor-override.ts`)
  accepts only exact current keys (`overrideIncludes`) and writes an `audit_events`
  row with action `override` for each, inside the publishing transaction
  (`publish-override.server.ts`), so a rollback leaves no decision behind.
- Public pages never mention AI (PR 299). No line is derived for AI work: an
  article page shows only wording an editor typed (an imported story's own line,
  stored in `articles.disclosure_text`; `src/components/ai-disclosure.tsx`), and
  a routine notice carries none. The owner's one About-page line is their own
  text.
- After publishing, a change is a dated correction above the story, never a silent
  edit. Removal for legal reasons and one-capture takedowns are owner-only
  workflows in Part 6.

## Document reading

`ingest.ts` reads PDFs with `unpdf`, falls back to a raw text-object parse, and
marks image-only pages for OCR (`ocr.ts`). OCR uses `OCR_AUTOMATIC_ORDER` or the
model the owner assigned to the `ocr` job. Excel (`.xlsx .xls .ods`), PowerPoint
(`.pptx .ppt .odp`) and `.odt` files go through headless LibreOffice
(`libreoffice.server.ts`): one conversion at a time, a 2-minute limit, a fresh
temporary profile with macros off, the stuck process stopped by PID. Without
LibreOffice the file is skipped with "Install LibreOffice to read Excel and
PowerPoint files". Direct Story and Opinion intake reads up to 20 files of 100 MB
each, uploads large files in 4 MB parts, keeps the original private, and limits
extracted text to 20 million characters per document.

## Tests

```bash
npm test
```

The default run is offline and free — no provider is contacted and nothing is
billed. `scripts/run-tests-safe.mjs` runs one test file at a time, behind an
environment guard that blanks `DATABASE_URL` (so tests use PGLite with every
migration applied) and a model seal that replaces `fetch` with a default-deny
version, so a test that forgot to stub a transport is refused instead of calling
a model server on the machine. It does not accept filter arguments.
`TOWNREPORTER_TEST_SHARD` and `TOWNREPORTER_TEST_SHARD_TOTAL` split the suite
for CI. The tests cover meeting ingest, retrieval, draft stripping, timezone
handling, the SSRF guard, the job lifecycle, the Dark Desk loop, the dials, claim
hygiene, the editorial parser, the ops action allowlist, the provider registry
and failover, the routine edition templates, and the documentation (link
existence in `scripts/docs-links.test.mjs`; versions in
`scripts/versions-agree.test.mjs`).

Two rules the suite enforces that are easy to lose:

- **The dials may never tighten.** A test fails if any notch of Dig or Nerve
  becomes more conservative than it was.
- **The version is locked** across `package.json`, `src/lib/version.ts` and the
  paper's own masthead.

Other checks, each its own script: `npm run typecheck`, `npm run lint`,
`npm run check:auth` (the auth invariant), `npm run check:panels`,
`npm run test:lifecycle`, `npm run smoke` (below), `npm run test:flows`,
`npm run test:sources`, `npm run test:paste`, `npm run test:headers`,
`npm run test:opinion`, `npm run proof:search`. `npm run test:live-model` is an
opt-in evaluation against a real model (`RUN_LIVE_MODEL_TESTS=1`).

`npm run smoke` is a browser-driven check: it loads the front page in a real
browser, counts every request the page makes, and fails if any of them leaves
this machine.

### CI

`.github/workflows/ci.yml` runs on pull requests, on pushes to `main`, nightly
(09:17 UTC) and by hand. **No check is required**; a `changes` job picks which of
the jobs run, so a change pays only for what it touches:

- Typecheck and lint, and the unit suite in **6 shards** (a `test` job gathers
  them into one result).
- Real Postgres integration in **4 parts**, a built-server boot-and-serve job
  (30 minutes), the lifecycle test and the documented dev path in a browser.
- The browser walks (desk flows, Scan, Sources, delete and corrections, provider
  sign-in, Automatic's failover, the Dark Desk picker, importing and pasting
  stories, the watchdog recovery test, and more) run **nightly or by hand**, and
  on a pull request only when their own script changed.

`.github/workflows/windows-install.yml` classifies the change (a docs-only change
skips the heavy jobs), packages the exact source candidate
(`scripts/package-windows.mjs`), builds the self-contained `Setup.exe`, and
installs it on a fresh Windows runner, then drives the first-run and health
checks. A manual run can instead install a published release tag.

---

# Part 5 — Architecture

Twelve diagrams. Each is a Mermaid block in this file; the rendered copy beside
it is generated by `docs/diagrams/render.sh` (see
[diagrams/README.md](diagrams/README.md)). If a diagram and the text disagree,
the code is the authority.

## System context

This diagram shows the legacy Halo topology (the live paper); the Windows
package has no tunnel or watchdog, and Reddit checks use the configured accepted
subreddit rather than a fixed town.

```mermaid
flowchart TB
    subgraph outside["The city, on the public web"]
        CITY["City site · council · planning"]
        PORTAL["Agenda portal<br/>(PrimeGov JSON API)"]
        TAPE["YouTube · public-access TV"]
        COUNTY["County · schools · utility"]
        REDDIT["r/longmont"]
        MAIL["Newsletter mailbox<br/>(IMAP, optional)"]
    end

    subgraph machine["One machine you own"]
        APP["TownReporter<br/>Nitro node-server + job clock"]
        DB[("PostgreSQL")]
        PW["Playwright Chromium"]
        EMB["MiniLM meaning model<br/>(in process, desk only)"]
        LO["LibreOffice<br/>(optional)"]
        WD["Watchdog every 5 min<br/>(legacy install only)"]
    end

    subgraph models["Whichever model you point it at"]
        CC["Claude Code CLI<br/>(also runs DeepSeek)"]
        CX["Codex CLI<br/>(OAuth, full tools)"]
        GM["Gemini (agy)<br/>named pick only"]
        OL["Ollama<br/>DeepSeek v4.1 Flash 1017"]
        LM["LM Studio<br/>the loaded local model"]
        API["Anthropic API"]
        OAI["Any OpenAI-compatible URL"]
    end

    READER(["Reader"])
    EDITOR(["Editor"])

    outside --> APP
    APP <--> DB
    APP --> PW
    PW --> outside
    APP --> EMB
    APP --> LO
    APP --> models
    CC -.relay.-> OL
    WD -.watches, restarts.-> APP
    APP --> TUNNEL["Cloudflare Tunnel"]
    TUNNEL --> READER
    TUNNEL --> EDITOR
```

![System context: what the newsroom talks to](diagrams/system-context.svg)

## The pipeline: source to printed page

```mermaid
flowchart LR
    S["Watch list<br/>sources"] --> SC["Scan<br/>fetch + hash"]
    SC --> D{"Compared to<br/>last snapshot"}
    D -->|changed| L["Lead"]
    D -->|disappeared| L
    D -->|failed to appear| L
    D -->|same| X["Nothing"]
    L --> Q["Queue<br/>scored"]
    Q --> DR["Draft<br/>+ reporting notes"]
    DR --> W["Workbench<br/>redraft · PULL · edit"]
    W --> G{"Editor"}
    G -->|publish| P["The paper"]
    G -->|hold| Q
    G -->|kill| X
    P --> C["Corrections<br/>dated, above the story"]

    style G fill:#7a2d2d,color:#fff
    style P fill:#1c1a17,color:#fff
```

![Pipeline: from watched source to printed page](diagrams/pipeline-source-to-page.svg)

The red box is the only way to the paper for an ordinary story. Everything
upstream of it is assistance; everything downstream of it is a correction, never
a silent edit. The one path that does not pass through it is a routine
notice roundup, drawn separately in
[Routine editions, drawn](#routine-editions-drawn) below.

## A job, end to end

```mermaid
sequenceDiagram
    participant E as Editor
    participant C as Clock (5 min and 20 s)
    participant F as Server function
    participant J as desk_jobs
    participant W as Worker (one per lane slot)
    participant M as Model
    participant DB as Database

    E->>F: Run scan / Draft / Keep digging / Write an editorial
    F->>F: resolve the model now (Automatic becomes the first ready rung)
    F->>J: insert (kind, lane, model choice, queued)
    F-->>E: returns at once, nothing waits on the model
    C->>J: scheduled scans, routine editions and follow-ups insert rows
    C->>W: every 20 s, drain queued rows into their lanes
    W->>J: claim with a token
    loop while running
        W->>J: heartbeat every 30 s
    end
    W->>M: call (budget from the provider)
    alt recoverable failure
        M-->>W: quota, timeout, login lapse or unavailable
        W->>M: retry only the unfinished call on the next ready rung
        W->>J: write failover_note
    else answered
        M-->>W: result
    end
    W->>DB: file leads / draft / signals / editorial
    W->>J: finished, with the run receipt in result_json
    E->>F: page polls
    F-->>E: the work, when it lands
```

![Lifecycle of one job, end to end](diagrams/job-end-to-end.svg)

## Dark Desk, one round

The model names in this diagram illustrate the Claude path; other selected
providers use their own planner and writer models as described in
[Model routing](#model-routing).

```mermaid
flowchart TB
    OPEN["Open a file<br/>URL · person · LLC · rumour"] --> PLAN
    DIALS[/"Dig · Nerve · Map"/] -.sets hops, floor, scope.-> PLAN
    PLAN["Plan the hop<br/>(Haiku)"] --> SEARCH["Search + fetch"]
    SEARCH --> CAP["Capture a copy"]
    CAP --> EXTRACT["Entities · relationships<br/>signals · dead ends"]
    EXTRACT --> HYG{"Claim hygiene"}
    HYG -->|operational model narration| DROP["Filtered from signals"]
    HYG -->|FACT with no citation| DOWN["Downgraded"]
    HYG -->|lead| CLAMP["Confidence capped<br/>by label"]
    CLAMP --> SYN["Synthesise<br/>(Opus)"]
    SYN --> BRIEF["Brief:<br/>connections · hypothesis · strength<br/>supports · benign · what kills it"]
    BRIEF --> STOP{"Budget spent?"}
    STOP -->|no| PLAN
    STOP -->|yes| PARK["Stop, say what is unread"]
    PARK --> KEEP["Keep digging"] --> PLAN
    BRIEF --> SPEC["Black Desk signal<br/>confidence at most 0.5"]
    SPEC --> ADV["App adversarial searches<br/>four kinds, three source tiers"]
    ADV --> VER["Dark Signal gate answers<br/>disproof, independence, context, self-reference"]
    VER --> STATE["Record protocol state,<br/>missing context and opposing account"]
    STATE --> WATCH["Keep investigating or watch"]
    STATE --> QUEUE["Editor sends lead to queue"]
    WATCH --> QUEUE

    style DROP fill:#3a2a2a,color:#fff
    style QUEUE fill:#7a2d2d,color:#fff
```

![One round of Dark Desk](diagrams/dark-desk-one-round.svg)

Note what is missing from that diagram: any edge to the paper. The only way out
of Dark Desk is **Send to the queue**, which files a lead a human then has to
work.

## The Opinion desk and its voice handoff

```mermaid
flowchart LR
    subgraph repo["This repository — public"]
        UI["/desk/opinion"]
        PACK["Pack builder<br/>subject · pointers · our story"]
        RES["Desk-run research<br/>search · open · record pages"]
        PARSE["Parser<br/>headline · body · appendix<br/>fact sheet · image prompt"]
        DRAFTS[("drafts +<br/>editorial_extras")]
    end

    subgraph private["Outside the repository"]
        VOICE["The voice file<br/>TOWNREPORTER_VOICE_FILE"]
    end

    CLI["Claude or Codex CLI<br/>voice file and research tools,<br/>one run"]
    HTTP["DeepSeek · Local model · saved connection<br/>no web tools of their own"]

    UI --> PACK
    PACK -->|"over stdin"| CLI
    VOICE -.->|"path only"| CLI
    PACK --> RES
    VOICE -.->|"governs what it looks for"| RES
    RES --> HTTP
    VOICE -.->|"text, as a system message"| HTTP
    CLI --> PARSE
    HTTP --> PARSE
    PARSE --> DRAFTS --> UI

    style private fill:#2a2320,color:#fff
    style VOICE fill:#7a2d2d,color:#fff
```

![The Opinion desk and its voice handoff](diagrams/opinion-voice-handoff.svg)

Two kinds of writer. Claude and Codex receive the complete voice through their
native instruction-file options (`--system-prompt-file`,
`model_instructions_file`) and hold the voice and the research tools **in one
run**, because the voice file carries the research protocol. DeepSeek, the
explicit Local model and saved connections have no web tools: **the desk** does
the searching, opening and recording of pages, reading the newsroom's own record
first, the same voice governs what it looks for, and the validated voice text
goes to the model server as a system message. The pack tells the writer how many
searches ran and how many pages were read. None of these paths places the voice
text in a command line. A relative path, or any path inside the public
repository, is rejected.

## Keeping it online

This diagram describes the separately configured legacy watchdog, not the
Windows installation package, which has no automatic repair task.

```mermaid
flowchart TB
    T["Scheduled task<br/>every 5 minutes"] --> WD["watchdog.ps1"]
    WD --> PG{"Postgres<br/>answering?"}
    PG -->|no| RPG["Start Postgres,<br/>touch nothing else"]
    PG -->|yes| C1{"App answering<br/>HTTP 200 on PORT?"}
    C1 -->|yes| C2
    C1 -->|no| GUARD{"A start still<br/>under 600 s old?"}
    GUARD -->|yes| LEAVE["Leave it starting"]
    GUARD -->|no| AGAIN["Probe again after 30 s"]
    AGAIN --> SECOND{"Down a second time?"}
    SECOND -->|no| C2
    SECOND -->|yes| R1["Stop the port owner by PID,<br/>start the app"]
    R1 --> C2
    LEAVE --> C2
    C2{"cloudflared running and<br/>public URL answers 200?"} -->|no| R2["Start or restart the tunnel"]
    C2 -->|yes| NIGHT
    R2 --> NIGHT
    NIGHT["After 2 AM, newest backup over 20 h old,<br/>no editor job running: take the backup"] --> OK["Write the check and stop"]

    OPS["/desk/ops"] -.reads.-> LOG[("logs/watchdog.log")]
    OK --> LOG
```

![Keeping a deployment online](diagrams/keeping-it-online.svg)

## Data model, the shape of it

```mermaid
erDiagram
    NEWSROOMS ||--o{ SOURCES : watches
    NEWSROOMS ||--o{ LEADS : holds
    NEWSROOMS ||--o{ ARTICLES : prints
    SOURCES ||--o{ SNAPSHOTS : "hashed each scan"
    SOURCES ||--o{ SOURCE_MONITORS : "expected cadence"
    SOURCES ||--o| SOURCE_YIELD : "90-day news score"
    SOURCES ||--o{ LEADS : "source_id"
    SNAPSHOTS ||--o{ ANOMALIES : "changed · gone · missing"
    ANOMALIES ||--o{ LEADS : becomes
    LEADS ||--o{ DRAFTS : "drafted into"
    DRAFTS ||--o| ARTICLES : "published as"
    ARTICLES ||--o{ CORRECTIONS : "dated, above"
    INVESTIGATIONS ||--o{ FRONTIER_ITEMS : "still unopened"
    INVESTIGATIONS ||--o{ ARTIFACTS : captured
    INVESTIGATIONS ||--o{ ENTITIES : found
    INVESTIGATIONS ||--o{ CLAIMS : "labelled + capped"
    INVESTIGATIONS ||--o{ HYPOTHESES : "with what kills it"
    INVESTIGATIONS ||--o{ DEAD_ENDS : "kept, reopenable"
    INVESTIGATIONS ||--o{ INVESTIGATION_BRIEFS : "read this first"
    INVESTIGATIONS ||--o{ INVESTIGATION_CHALLENGES : "challenge runs"
    EDITORIAL_REQUESTS ||--o| DRAFTS : "written into"
    DRAFTS ||--o| EDITORIAL_EXTRAS : "fact sheet, not printed"
    ARTIFACTS ||--o{ ARTIFACT_CHUNKS : "passages"
    ARTIFACT_CHUNKS }o--o| EVIDENCE_VECTORS : "excerpt md5 only"
    ARTICLES }o--o{ STORY_MEANING_VECTORS : "owner id only"
    NEWSLETTER_MAILBOXES ||--o{ NEWSLETTER_MESSAGES : polled
    NEWSLETTER_MESSAGES ||--o{ NEWSLETTER_ATTACHMENTS : carries
    NEWSROOMS ||--o| ROUTINE_NOTICE_AUTOMATIONS : "owner schedule"
    ROUTINE_NOTICE_AUTOMATIONS ||--o{ ROUTINE_NOTICE_RUNS : "one per local date"
    ROUTINE_NOTICE_RUNS ||--o{ ROUTINE_NOTICE_PUBLICATIONS : "editions printed"
    ROUTINE_NOTICE_PUBLICATIONS }o--o| ARTICLES : "as"
    NEWSROOMS ||--o{ MODEL_ASSIGNMENTS : "who does what"
    DESK_JOBS }o--|| NEWSROOMS : "thirteen kinds"
    DELETED_ITEMS }o--|| NEWSROOMS : "a copy, for 30 days"
    AUDIT_EVENTS }o--|| NEWSROOMS : "overrides, takedowns, removals"
```

![Data model: the shape of the database](diagrams/data-model.svg)

This is the shape, not the schema: the schema is `migrations/*.sql` and the
modules' own `ensure*Schema` batches. The two vector tables hold no text and no
URL by design, so a takedown or a legal removal never has a second copy to chase.

## Choosing a provider, at call time

```mermaid
flowchart TB
    CALL["A model-backed desk action"] --> KIND{"Story / Scan / Dark picker?"}
    KIND -->|yes: Automatic| Q1{"LLM_BASE_URL configured?"}
    Q1 -->|yes| OAI["Try that gateway first"]
    Q1 -->|no| READY["First ready rung<br/>DeepSeek v4.1 Flash 1017<br/>then the loaded Local model<br/>then Codex Sol 6.1 balanced<br/>then Claude Sonnet 5.5"]
    KIND -->|yes: named choice| ONE["Try that recorded provider first<br/>(Gemini is only ever a named choice)"]
    OAI --> SAVE["Persist the effective provider on the job"]
    READY --> SAVE
    ONE --> SAVE
    SAVE --> RUN["Selected run uses that provider"]
    RUN -->|"quota, unavailable, login lapse,<br/>timeout, no output or unreadable reply"| NEXT["Retry only the unfinished call<br/>on the next ready rung,<br/>write the failover note"]
    RUN -->|"content refusal or unrecognised error"| SAME["Stop and show the failure"]
    RUN --> REC["Write the run receipt<br/>requested · actual · effort · skipped rungs"]

    style SAVE fill:#1c1a17,color:#fff
```

![Choosing a provider at call time](diagrams/provider-at-call-time.svg)

Opinion walks its own order (DeepSeek, Codex Sol 6.1, Claude Sonnet 5.5), and OCR
its own (Codex Sol 6.1, Claude Sonnet 5.5, then a vision-marked local model).
A forced failover always lands on Codex Sol 6.1 balanced or Claude Sonnet 5.5.

## How a meeting becomes a story

A council meeting arrives as a recording, not as an article. Capture turns it
into a transcript revision and an ordinary lead in the Queue. From there an
editor gives direction, drafts from a bounded slice of the transcript, and
publishes when satisfied with the citations the draft actually used. Nothing on
this path prints on its own, and a stale citation is a warning the editor can
print over, not a block.

```mermaid
flowchart TB
    subgraph where["Where the recording comes from"]
        CH["YouTube channel<br/>public-access TV"]
    end
    PG["PrimeGov portal<br/>agenda and packet"]

    subgraph capturing["Capture · Run meetings now"]
        CAP["Capture the recording"]
        REV["Transcript revision<br/>content-addressed, immutable"]
    end

    subgraph queued["The Queue"]
        LEAD["An ordinary lead<br/>status: new"]
    end

    subgraph writing["The story workspace"]
        DIR["Story direction for AI"]
        DRAFT["Draft with AI<br/>bounded slice of the transcript"]
        USED["Used citations persisted<br/>read off what the draft says"]
        MASK["Name check masks<br/>unverified speaker names"]
        REDRAFT["Redraft and reverify citations"]
    end

    GATE{"Publish check<br/>citations current?"}
    PAPER(["The printed story"])
    REVIEW["One editor review<br/>published article unchanged"]

    CH --> CAP
    PG -.->|"agenda items join the story"| DRAFT
    CAP --> REV
    REV --> LEAD
    LEAD --> DIR
    DIR --> DRAFT
    DRAFT --> USED
    USED --> MASK
    MASK --> GATE
    GATE -->|current| PAPER
    GATE -->|"stale, missing or hash mismatch:<br/>a warning, with Publish anyway"| PAPER
    GATE -->|"or fix first"| REDRAFT
    REDRAFT --> GATE
    REV -.->|"recording revised after publication"| REVIEW
    PAPER -.->|"review only, the printed story is not rewritten"| REVIEW
```

![How a meeting becomes a story](diagrams/meeting-to-story.svg)

Pulled notes are leads, not evidence. A vote tally or a mover can appear with no
citation. A masked name reads stiffly ("an unidentified speaker"). YouTube can
rate-limit a capture (HTTP 429); a later pass picks it up, and captions that fail
get a retry (`meeting_capture_records`, migration 0134). Meeting audio is
write-once (`meeting_audio_captures`, migration 0133). Captions are not minutes.
A person approves every ordinary story; `meeting-citation-stale` is a warning
key in `publish-blockers.ts`, not one of the five hard ones.

## Routine editions, drawn

The one path to the paper that has no editor in it. It exists for logistics a
city already publishes (library hours, parks programs, event times, registration
deadlines, collection schedules, public meeting logistics), and it is bounded at
every step by the owner.

```mermaid
flowchart TB
    OWN["Owner approves sources and a policy<br/>(Server → Routine notices)"] --> AUTO["Automation saved:<br/>local time, one section per channel,<br/>at most 12 sources"]
    CLOCK["5-minute clock"] --> DUE{"Past the local time<br/>and no run today?"}
    AUTO --> DUE
    DUE -->|yes| RUN["Queue one routine-notice job<br/>(default lane, no model)"]
    RUN --> AUTH{"Owner role, automation revision<br/>and policy not paused?"}
    AUTH -->|no| STOPJ["Stop: authority changed"]
    AUTH -->|yes| CAPT["Capture each approved source"]
    CAPT --> EXTR["Extract structured fields<br/>six format keys"]
    EXTR --> SCREEN{"High-risk wording, web address,<br/>cancellation or over-long field?"}
    SCREEN -->|yes| REVIEWQ["Leave for an editor,<br/>with the reason in plain words"]
    SCREEN -->|no| ELIG["Eligible notices by channel"]
    ELIG --> TODAY["Today in town<br/>all of today's events"]
    ELIG --> WEEK["This weekend<br/>Fridays only"]
    ELIG --> DEAD["Deadlines approaching<br/>next 7 days"]
    TODAY --> TPL["Fixed template<br/>source text stripped of markup"]
    WEEK --> TPL
    DEAD --> TPL
    TPL --> PUB["Publish to the channel's section,<br/>once per fingerprint"]
    PUB --> LOGR["Record the run:<br/>published · corrected · needs review · deferred"]

    style REVIEWQ fill:#7a2d2d,color:#fff
```

![Routine editions: from approved source to published notice](diagrams/routine-edition-flow.svg)

The weekend and deadlines channels share a cap of five notices per run; the
rest are deferred to a later run. Defaults: the automation's local time is 06:15 (`routine_notice_automations`),
and the weekend edition is built only when the newsroom's local date is a Friday.
The worker re-checks authority inside a transaction both when it queues and
before it touches a source, so pausing the policy, changing the automation or
removing the owner stops a run in flight. Each published edition keeps its source
addresses, the policy revision, the capture and artifact version, and the content
hash. A routine notice carries no AI line and no AI wording.

## Search by meaning: the index

Desk only. The public paper's search box is unchanged.

```mermaid
flowchart LR
    subgraph write["Background fill (built server, unless TOWNREPORTER_MEANING_SEARCH=off)"]
        CLK["Clock<br/>3 min after boot, then each minute"] --> EF["32 evidence excerpts"]
        CLK --> SF["6 published stories<br/>1 uploaded file"]
        EF --> MODEL["MiniLM-L6-v2<br/>384 numbers, in process"]
        SF --> MODEL
        MODEL --> EV[("evidence_vectors<br/>excerpt md5 → vector")]
        MODEL --> SV[("story_meaning_vectors<br/>kind · owner · part → vector")]
        PR["Hourly prune"] --> EV
        PR --> SV
    end

    subgraph read["Story page → Find evidence"]
        Q["Editor types a few words"] --> EXACT["Exact words<br/>artifact_chunks, trigram index"]
        Q --> QV["Embed the query"]
        QV --> COS["Cosine against stored vectors<br/>minimum score 0.46"]
        EV --> COS
        SV --> COS
        COS --> JOIN["Join each hit back to a live row"]
        JOIN --> LISTS["Close in meaning<br/>Our past stories close in meaning"]
    end

    EXACT --> OUT["Lists on the desk"]
    LISTS --> OUT

    style EV fill:#1c1a17,color:#fff
    style SV fill:#1c1a17,color:#fff
```

![Search by meaning: the index and the query](diagrams/meaning-search-index.svg)

The vector tables hold a vector and a pointer, never a passage and never a URL.
Every hit is joined back to a live row: an evidence excerpt that a takedown
blanked or a legal removal deleted, a story that was unpublished, or a file that
was deleted drops out of the next search by itself, and the hourly prune removes
its row. The query needs at least one piece scoring 0.46 against it (measured
between nonsense strings at 0.42 and real queries at 0.49 on Oct 24 2026), the
past-stories list shows five, the query is limited to 200 characters, and
vectors are held in memory for five minutes. If the model cannot load, the
exact-words list still works and the panel says so. A failed fill backs off for
30 minutes, separately for evidence and for stories.

## Releasing: promote and rollback

This describes the legacy installation's `ops/promote.ps1`. The Windows package
updates by running a newer `Setup.exe` over the same folder (data untouched).

```mermaid
flowchart TB
    GO["promote.ps1"] --> PRE{"Checkout clean?<br/>Nothing mid-run?"}
    PRE -->|no| REF1["Refuse, change nothing"]
    PRE -->|yes| BK["Back up the database,<br/>copy to D:, verify, prune C:"]
    BK --> JOBS{"An editor job<br/>running or queued?"}
    JOBS -->|"yes, no flag"| REF2["Refuse<br/>(-WaitForJobs or -Force)"]
    JOBS -->|no| STOPAPP["Stop this install's server"]
    STOPAPP --> COPY["Wait for connections to close, then copy<br/>townreporter → townreporter_prerollout_stamp"]
    COPY --> FF["Fetch and fast-forward origin/main"]
    FF --> BUILD["Install if the lockfile moved,<br/>build, which also migrates"]
    BUILD -->|"install, fast-forward<br/>or build fails"| AUTO["Automatic: stop, swap the copy back,<br/>keep the failed rollout as townreporter_failed_stamp,<br/>restore the previous build, start it"]
    BUILD -->|ok| START["Start, wait for the port"]
    START -->|"never answers"| AUTO
    START -->|answers| VERIFY{"Local page, public page and<br/>story count all agree?"}
    VERIFY -->|yes| PRUNE["Keep the copy, prune older copies<br/>beyond the newest three"]
    VERIFY -->|no| HAND["Leave the new app serving,<br/>print: promote.ps1 -RollbackDatabase copy<br/>and what it costs"]
    HAND --> RB["Operator decides:<br/>writes since the start are lost"]

    style AUTO fill:#7a2d2d,color:#fff
    style HAND fill:#7a2d2d,color:#fff
```

![Promote and rollback](diagrams/promote-and-rollback.svg)

Every run writes `logs\promote-<stamp>.log`, one line per step. A run that dies
leaves `logs\promote-in-progress`; the next run says which step it reached and
offers `-Resume`. The copy is taken after the app is stopped because PostgreSQL
will not copy a database anyone is connected to; the script waits for sessions to
close and refuses rather than ending one. A swap-back keeps the failed database
under its `_failed_` name; nothing is ever deleted automatically except pruned
older `prerollout` copies after a good promote. Details are in
[SELF-HOSTING.md](../SELF-HOSTING.md#updating-this-installation).

---

# Part 6 — Reference

## Routes

| Path                                         | What                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/`                                          | The paper                                                                                  |
| `/?topic=opinion`                            | Editorials — the Opinion link in the masthead. Same route as the paper, filtered by topic. |
| `/articles/:slug`                            | A story                                                                                    |
| `/about` · `/how-we-report` · `/corrections` | Masthead pages                                                                             |
| `/feed` · `/sitemap.xml` · `/robots.txt`     | Machines                                                                                   |
| `/evidence/:versionId`                       | An excerpt of the captured record a printed story cited — or the notice, if the owner took that excerpt down at a publisher's request |
| `/evidence/compare`                          | Two captures of the same URL, side by side                                                 |
| `/get-the-code` · `/TownReporter.zip`        | Download this newsroom's own source                                                        |
| `/login`                                     | Create an editor account, or sign in                                                       |
| `/desk/setup`                                | First-run paper setup; redirects away after setup is complete                              |
| `/desk`                                      | The desk — what needs you                                                                  |
| `/desk/sources`                              | Watch list, and bulk paste                                                                 |
| `/desk/inventory`                            | The ranked source table: status, news score, reads, last lead, and the move buttons (read-only suggestions; nothing is culled) |
| `/desk/scan`                                 | Fetch and file leads. The expensive button.                                                |
| `/desk/queue`                                | Leads: draft, hold, kill                                                                   |
| `/desk/drafts`                               | Everything not yet printed, one row per story, with its state in words                     |
| `/desk/story/:leadId`                        | The workbench, opened by lead                                                              |
| `/desk/story/draft/:draftId`                 | The editorial workbench, opened by draft — an editorial has no lead                        |
| `/desk/filed-draft/:draftId`                 | The version of a draft that a reporting run filed, kept as filed                           |
| `/desk/import`                               | Import finished stories                                                                    |
| `/desk/published`                            | Live stories and corrections; beat memory (`/desk/memory` redirects here)                  |
| `/desk/dark`                                 | Dark Desk. Investigates, never prints. Manual page watches and capture history are on this page. |
| `/desk/legal-removals`                       | Owner-only legal-removal cases, retained copies and backup attestations                    |
| `/desk/follow-ups`                           | Reporting requests and due dates                                                           |
| `/desk/stats`                                | Newsroom activity and coverage                                                             |
| `/desk/opinion`                              | Opinion. Unsigned editorials.                                                              |
| `/desk/models`                               | **Who does what** (per-job model assignments) and **Connections** (sign-in, test, saved custom connections) |
| `/desk/ops`                                  | Server. Health, Paper setup, editor invites and the few operational buttons worth having.  |
| `/desk/ops/:card`                            | One Server card on its own screen                                                          |
| `/desk/transcript/:artifactId`               | A retained meeting transcript                                                              |
| `/api/auth/*`                                | better-auth                                                                                |
| `/api/view` · `/api/read`                    | Anonymous reader beacons for view and reading counts; a failure can never reach the reader |
| `/api/transcript-file`                       | The retained meeting transcript byte for byte, scoped to the signed-in newsroom            |
| `/api/cron/monitors`                         | Lets an external monitor ping the job runner; disabled unless `CRON_SECRET` is set         |

### The Server page's cards

`src/lib/desk/ops-cards.ts` defines twelve: Writing models, Health, Paper setup,
Recently deleted, Sections, Daily scan, Meeting capture, YouTube, Routine
notices, Named outlets, Editors & access, and Time budgets. Each opens on its own
screen at `/desk/ops/<card>`.

## Environment

The variables an operator most often touches. The complete inventory, with a
comment on each, is [`.env.example`](../.env.example). Values are never shown
here; name a key, set it in your own `.env`. Everything is optional unless marked.

### Core

| Variable                                                          | Effect                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                    | Postgres. Unset means throwaway PGLite.                                                                                               |
| `BETTER_AUTH_SECRET`                                              | Signs sessions. **Required** with a real `DATABASE_URL`; the server refuses to start without it.                                      |
| `BETTER_AUTH_URL`                                                 | The origin the desk is served from; also names the canonical host                                                                     |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                     | Extra origins allowed to sign in, comma-separated                                                                                     |
| `PUBLIC_SITE_URL`                                                 | The paper's own address, for canonical URLs, the sitemap and the feed                                                                 |
| `HOST` · `PORT`                                                   | What the built server binds to. `.env.example` sets `HOST=127.0.0.1`; unset means every interface, LAN included. `npm run dev` ignores both. |
| `VITE_AUTH_ENABLED=false`                                         | No login at all. Local only. Never on a public host.                                                                                  |
| `VITE_TOWNREPORTER_EDITOR_EMAIL`                                  | Public contact address printed on About and Corrections; read at **build** time; a saved Paper setup address wins                      |
| `CRON_SECRET`                                                     | Lets an external monitor ping `/api/cron/monitors`                                                                                    |
| `ACCOUNT_LOCKOUT_MAX_ATTEMPTS` · `ACCOUNT_LOCKOUT_WINDOW_SECONDS` | Account lockout (defaults: 10 failures in 15 minutes)                                                                                 |
| `TOWNREPORTER_DATA_ROOT`                                          | Installer-managed data root. Holds `logs/SETUP-CODE.txt` and the meaning-search model cache.                                           |
| `TOWNREPORTER_DATA_DIR`                                           | Where meeting capture writes downloads and transcripts; set it to a durable drive                                                     |
| `TOWNREPORTER_INSTANCE_ID`                                        | Installer-managed; identifies one packaged installation                                                                                |
| `TOWNREPORTER_CHROMIUM_NO_SANDBOX=1`                              | Skip the failed first attempt where Chromium's sandbox cannot start (containers, root)                                                 |

### Models

| Variable                                                          | Effect                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_MODEL` · `ANTHROPIC_EFFORT`     | Bill Claude to a key instead of the CLI login; which Claude for configured-provider calls; how hard it thinks on that path             |
| `LLM_BASE_URL` · `LLM_API_KEY` · `LLM_MODEL` · `LLM_REASONING_EFFORT` | A configured OpenAI-compatible gateway: first runtime for Scan and Dark Desk, preferred first runtime for Story Automatic. Technical recovery can still retry only the unfinished call. |
| `OPENAI_API_KEY`                                                  | Read only as a fallback for an OpenAI-compatible gateway                                                                               |
| `TOWNREPORTER_DEEPSEEK_BASE_URL` · `_MODEL` · `_API_KEY`          | The DeepSeek rung (Ollama). The model defaults to `deepseek-v4.1-flash:1017-cloud`.                                                    |
| `TOWNREPORTER_QWEN_BASE_URL` · `_API_KEY` · `_MODEL`              | The Local model rung (LM Studio). Setting the model **pins** it: the rung is skipped unless LM Studio reports that exact model loaded. |
| `TOWNREPORTER_DEEPSEEK=0` · `TOWNREPORTER_QWEN=0`                 | Take that rung out of Automatic                                                                                                        |
| `TOWNREPORTER_LOCAL=0`                                            | Take the Local model out of the pickers without unsetting `LLM_BASE_URL`                                                               |
| `TOWNREPORTER_LOCAL_DISCOVERY=0`                                  | Stop probing the two default local ports (`LLM_BASE_URL`, if set, is still tried)                                                      |
| `TOWNREPORTER_CLAUDE_CODE=0` · `TOWNREPORTER_CODEX=0`             | Take the Claude Code or Codex program out of the runtime chain. With Claude Code off, DeepSeek falls back to plain HTTP.               |
| `TOWNREPORTER_CODEX_SOL_MODEL` · `TOWNREPORTER_CODEX_TERRA_MODEL` | Model id overrides for **Codex Sol 6.1** and for **Codex Sol 6.1 (balanced)** respectively (the second name is historical)               |
| `TOWNREPORTER_CODEX_REASONING_EFFORT`                             | Optional per-launch CLI override; unset preserves native config. `high` is the only value verified here; invalid values fail clearly. |
| `TOWNREPORTER_CODEX_DIAGNOSTICS=1`                                | Transport diagnostics (duration, byte counts, exit status; never prompt or response text)                                              |
| `CODEX_CLI_PATH` · `CODEX_HOME`                                   | Unusual Codex binary or login-state locations; normal discovery needs neither. A wrong `CODEX_CLI_PATH` is an error, not a fall-through. |
| `CLAUDE_CLI_PATH`                                                 | Unusual Claude Code binary location                                                                                                   |
| `GEMINI_CLI_PATH`                                                 | Gemini (Pro plan) program location; otherwise `%USERPROFILE%\Tools\agy\bin\agy.exe`, then `agy` on PATH                                  |
| `TOWNREPORTER_PLANNER_MODEL`                                      | Override the Dark Desk planner model on any provider                                                                                   |
| `TOWNREPORTER_GATEWAY_MCP_URL`                                    | Optional localhost MCP search provider; unset keeps the built-in search fallback chain                                                 |
| `TOWNREPORTER_VOICE_FILE`                                         | Absolute path to the Opinion voice, outside the repo                                                                                  |
| `EDITORIAL_TIMEOUT_MS` · `EDITORIAL_RESEARCH_CEILING_MS` · `EDITORIAL_RESEARCH_PAGE_CEILING` | Per-pass editorial timeout (45 minutes); the desk-run research safety ceilings (30 minutes, 80 pages) |

Gemini (Pro plan) uses the signed-in Google account in the Gemini command-line
program (`agy`), with no API key or API credit. Open a terminal on the server,
run `agy`, and sign in with your Google account. The desk offers Gemini 3.8 Flash
and Gemini 3.1 Pro for writing; it keeps the separate API-key Gemini connection
unchanged. Thinking effort selects the model suffix: Flash has low, medium, and
high; Pro has low and high, with medium using high.

Automatic tries DeepSeek v4.1 Flash 1017, the loaded Local model, Codex Sol 6.1
(balanced), then Claude Sonnet 5.5. Automatic and every failover never move a
run to Gemini; pick Gemini by name to use it. Unavailable models remain
selectable and explain how to fix the connection. A remembered Ollama Cloud
usage-limit response appears as a warning with Ollama's own words until a later
call or a connection test succeeds. Add credit at `ollama.com/settings`, or the
desk moves to the next model.

### Search, documents and tools

| Variable                                                          | Effect                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TOWNREPORTER_MEANING_SEARCH=off`                                 | Turn off the meaning-search fill, prune and lists (exact-words search keeps working)                                                   |
| `TOWNREPORTER_SOFFICE`                                            | Path to LibreOffice's `soffice.exe` when it is not in a standard location                                                              |
| `TOWNREPORTER_PYTHON`                                             | The python that carries `yt-dlp` for meeting capture                                                                                   |
| `TEXTFLOWKIT_CLI_PATH` · `TEXTFLOWKIT_ENGINE` · `TEXTFLOWKIT_MODEL` · `TEXTFLOWKIT_LANGUAGE` | Speech-to-text for captionless meetings                                                                          |
| `YOUTUBE_API_KEY`                                                 | Optional YouTube Data API key for meeting discovery                                                                                    |
| `REDDIT_REDLIB_BASE_URL`                                          | Optional Redlib reader for Dark Desk's Reddit check (`off` disables it)                                                                |

### Legacy installation, backups and tests

| Variable                                                          | Effect                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TOWNREPORTER_LEGACY_OPS=1` · `TOWNREPORTER_LEGACY_ROOT` · `TOWNREPORTER_PG_BIN` · `TOWNREPORTER_PG_DATA` | Declare that this checkout owns the legacy `ops/` scripts. Not for a packaged install. `PORT` and a loopback `DATABASE_URL` must match. |
| `TOWNREPORTER_TUNNEL=1`                                           | Set only in the install that owns the Cloudflare Tunnel; others report "not managed by this install" and refuse the restart            |
| `PROMOTE_ADMIN_DATABASE_URL`                                      | Admin connection used only by `ops\promote.ps1` for the pre-rollout copy                                                                |
| `BACKUP_OFFSITE_DIR`                                              | Where verified backups are kept (default `D:\TownReporter-backups`)                                                                    |
| `ALERT_NTFY_TOPIC`                                                | Phone alerts through ntfy                                                                                                              |
| `RUN_LIVE_MODEL_TESTS=1`                                          | Opt in to `npm run test:live-model`                                                                                                    |
| `TEST_POSTGRES_ADMIN_URL` · `PG_TEST_SERVER_LOGS`                 | Scratch-database admin connection for the Postgres integration tests; stream a test server's output into the test log                  |
| `TOWNREPORTER_TEST_SHARD` · `TOWNREPORTER_TEST_SHARD_TOTAL`       | Run one slice of the unit suite (CI uses 6)                                                                                            |

`.env.example` still lists an unused `VITE_STUN_URLS`, and its Automatic
paragraph and example DeepSeek tag predate PR 331 and the 1017 pin; this table
and the registry are the authority.

## Job kinds

Thirteen, from `JOB_KINDS` in `src/lib/news/jobs.ts`.

| Kind               | Lane      | Started by                                                    | Typical length                                                       |
| ------------------ | --------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `scan`             | default   | Scan page, or the daily scan on the clock                     | minutes                                                              |
| `draft`            | draft     | Queue, workbench, **Write a story**                           | minutes                                                              |
| `dark`             | default   | Dark Desk — start, or Keep digging                            | minutes per round                                                    |
| `brief`            | default   | Refresh the investigation brief                               | a model call to update the file's read-me-first summary              |
| `challenge`        | default   | Dark Desk — **Challenge** a case                              | a model call or a few; result kept in `investigation_challenges`     |
| `editorial`        | editorial | Opinion desk                                                  | Historical runs: 10–40 minutes; up to 45 minutes per pass by default |
| `reconcile`        | default   | Story workspace — **Check draft against evidence**            | a model call, or a few                                               |
| `pull`             | default   | Reporting item — **Pull**                                     | mechanical web search and document extraction; no writing model      |
| `artifact-ocr`     | default   | Dark Desk — reading a retained PDF                            | page batches; a vision model call per batch                          |
| `audio-transcribe` | default   | Meeting capture of captionless audio                          | minutes of CPU (textflowkit), one run at a time                      |
| `routine-notice`   | default   | Clock tick on a saved routine-edition schedule                | deterministic; no model                                              |
| `follow-up`        | default   | An AI follow-up: `recheck`, `search` or `agenda`              | a few calls                                                          |
| `reporting`        | default   | **Report this meeting** / **Develop this lead**               | a full civic-scanner method run; files a package an editor reads     |

Lane capacity: `editorial` 1, `draft` 2, `default` 2. The queue explains
why a job waits, including when another running job holds the same model.

## Commands

```bash
npm run dev          # http://localhost:8080 (127.0.0.1 only; dev:lan opens it)
npm run build        # build, then migrate, then package the two skills
npm start            # run the built server (reads PORT and HOST)
npm test             # deterministic, offline, free
npm run test:live-model  # opt-in live evaluation (RUN_LIVE_MODEL_TESTS=1)
npm run typecheck    # npm run typecheck:test for the test tsconfig
npm run lint
npm run db:migrate
npm run smoke        # built server: every page request stays on this machine
npm run test:lifecycle  # npm run test:flows, test:sources, test:paste, test:headers, test:opinion
npm run check:auth   # npm run check:panels
npm run proof:search # search index proof against a database
npx playwright install chromium
```

### Scripts that matter

| Script                                                  | What                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `scripts/migrate.mjs`                                   | Apply pending `migrations/*.sql`, each in one transaction, recording `_migrations`                     |
| `scripts/schema-warmup.mjs`                             | Run the module schema warm-up on its own                                                               |
| `scripts/with-app-env.mjs`                              | Load the app's environment around any command                                                          |
| `scripts/package-windows.mjs`                           | Build the Windows ZIP, `.zip.json` and `.zip.sha256` (CI and release)                                  |
| `scripts/package-civic-scanner.mjs` · `package-report-local-news.mjs` | Package the two reporting skills into the build                                          |
| `scripts/run-tests-safe.mjs`                            | The `npm test` runner and its environment guard                                                        |
| `scripts/evidence-meaning-smoke.mjs`                    | Smoke check of the meaning-search path                                                                 |
| `scripts/nightly-proof-config.mjs` · `nightly-proof-draft.mjs` | The nightly proof's guards and draft step ([nightly-proof.md](nightly-proof.md))               |
| `scripts/stage-editor.mjs`                              | Create the editor account on a staged copy ([staging.md](staging.md))                                  |
| `ops/*.ps1`                                             | The legacy installation; see [Serving it publicly](#serving-it-publicly)                               |
| `installer/*.ps1`                                       | The Windows package: `Install`, `FirstRun`, `Start`, `Stop`, `Restart`, `Health`, `Configure-AI`       |

## Tables added since 0.6.83

For the shape of the whole database see the
[data model](#data-model-the-shape-of-it); the schema is `migrations/*.sql`.

| Migration | Adds                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0129      | `newsroom_local_model_choices_additional` (Local model choice per `follow-up` / `ocr` surface)                            |
| 0130-0131 | `daily_scan_policies.every_day_source_count` (default 8); `source_scan_preferences`                                         |
| 0132      | Per-source coverage on `scan_runs`                                                                                         |
| 0133-0134 | `meeting_audio_captures` (write-once audio); YouTube retry fields on `meeting_capture_records`                             |
| 0140-0143 | Investigation file fields (ordinary explanation, scope, limits), `follow_ups.investigation_id`, `investigation_challenges`, disposition (`closed_kind`, `close_note`) |
| 0145      | `daily_scan_policies.source_cap_override`; `newsletter_mailboxes`, `newsletter_messages`, `newsletter_attachments`; `sources.last_read_*` and `newsletter_url` |
| 0146-0148 | Queued drafts moved to the `draft` lane; `editorial_requests.voice_mode`; editorial research scope                         |
| 0149-0151 | Lead kill remembers its prior status and reason; clears daily-scan pauses left by the old usage-limit rule (D157)         |
| 0152      | Move saved DeepSeek picks to the pinned 1017 tag                                                                           |
| 0153-0154 | Dynamic sources: `source_yield`, `leads.source_id`, trial and cadence columns on `sources`, `proposed_count`               |
| 0155      | `drafts.editor_checks`                                                                                                     |
| 0156-0158 | `evidence_vectors`; trigram indexes on `artifact_chunks` (`pg_trgm`); `story_meaning_vectors`                              |

## Manual investigative page watches

Dark Desk's **Watched pages** panel records a named public URL and the editor's reason for watching it. It uses the existing source-monitor scheduler, guarded capture engine and dated capture versions, independently of accepted-source scanning. See [the editor workflow](editor.md#watch-a-specific-page-in-dark-desk) for first captures, readable differences, failed checks, OCR selection, explicit lead/record actions and pause/stop behavior.

Migration 0046 adds watch state, a per-check lease and action history to the existing monitor/capture system. A transaction locks and verifies the lease before capture, history, baseline and optional file attachment writes. Failed checks keep the last readable baseline. Scheduler and manual checks share this path; an expired worker cannot overwrite a newer lease's result. The editor chooses an active configured reporting section when explicitly creating a lead. Stored captures and action targets remain newsroom scoped. Capture history and complete stored-text downloads preserve evidence; they are not legal-removal or backup-management features.

**Stopping a re-check follow-up leaves its page watch switched on.** A *Re-check pages* follow-up does its work by creating a watched page, so a URL it checked stays on the monitor schedule after the agent is stopped — the watch is a monitor, not part of the agent. Stop cannot switch it off on your behalf, because the same watch row is shared: it is the one watch for that URL, whether the agent made it or you did, and turning it off would also stop anything else watching that page. So the stopped follow-up card says which page is still being checked and links to **Dark Desk → Watch a page / view watches**, where you pause or stop that watch by hand. Nothing else about a stop is left behind: the run in flight is cancelled, and the agent is never picked again until you resume it.

## Legal removal: owner workflow

Open **Published → Legal removal** beside a story, or **Published → Legal removal cases** to revisit a case. Editors cannot use this process. Ordinary Delete still uses 30-day trash; legal removal has no Undo.

1. Select the affected stories and **Review connected copies**. All stories sharing a lead must be selected before its reporting records can be removed. Review the counts and historical candidates. Old drafts, memory, audit labels and trash do not always carry article IDs; select only the records in scope. Selected entries remain visible and can be unchecked. Mixed trash requires explicit whole-snapshot selection. Changed records require a fresh preview.
2. Review independent evidence. Known same-paper URL copies and references in captures, chunks, original blobs, source snapshots, search results, associated frontier records, source/monitor descriptors and watch history are listed but **not automatically deleted**. These known copies block court destruction even with the evidence checkbox checked. Retained application removal may proceed with review explicitly pending. A local operator must resolve unsupported captured-copy cleanup; a checkbox does not establish erasure.
3. Choose the policy. **Keep an owner-only copy for 12 calendar months** uses the calendar anniversary, with February 29 clamped to February 28 in a non-leap year. This is owner access control, not encryption. The existing scheduled tick and case-list reads purge expired copies. Expired text cannot be opened even if cleanup has failed. **Explicit court destruction** never inserts removed text into the retained-copy table and requires the historical/evidence scope to be resolved first.
4. Enter a case identifier without story text, type **REMOVE**, and confirm. The transaction removes selected application copies, scrubs exact linked editorial source descriptors and blocks stale filing/restoration. Independent editorial drafts remain for review; interrupted writing must be restarted with reviewed sources. Foreign-newsroom relationships refuse removal rather than cascading into another paper. Matching automatic watches are paused and ordinary sources are excluded from scans, preserving their evidence for review. Stop remains available; resuming a removed article's watch is refused.
5. The result opens its case. **Open owner-only retained text (audited)** is available until expiry under the retention policy. There is no restore button. Record affected backup identifiers and operator cleanup attestations here. An attestation records what an operator reports; it is not independently verified erasure.

Fresh public article/feed/sitemap reads stop returning removed stories. Existing browser caches, downloads, external search caches, provider history, database logs and backups are outside the application's erasure proof. An older database restore can reintroduce removed content; the local operator must reconcile removal cases before serving restored data. Exact known URL checks include query/fragment/trailing-slash and percent-encoded slug aliases. Unlinked prose, malformed historical records, old deployment origins and unknown external copies still need owner/operator review. Do not treat this workflow as proof that no copy exists anywhere.

## Taking down one captured excerpt (owner workflow)

When a publisher objects to one captured page rather than to a story, the owner takes that capture down alone. This is not the legal-removal process: no story, lead, draft or watch is touched, and nothing else in the edition changes.

1. Open the story in the desk, **Checks** tab, and find the finding or claim that cited the capture. Press **View cited captured version** — the pane shows the stored text that is about to come down.
2. Press **Take down this capture**. Editors do not see this press, and the server refuses any role but the owner.
3. Give a short reason. Tick **Remove the link to the original too** only if the publisher asked for that as well; left unticked, the public notice keeps the link. Press **Take down this capture** to confirm. The confirm says, in the desk, that there is no restore. The reason is stored in the audit trail, is shown back to the owner in the capture pane, and is never shown to a reader.
4. Everything below is deleted in one transaction, with one audit row recording who, when, the reason and the capture id.

**Deleted, by this action**, for the capture taken down:

- the capture's stored text (`artifact_versions.full_text`), which is what the evidence page excerpts;
- its extracted passages (`artifact_chunks`), including any the desk read out of a PDF;
- the original file bytes we stored for it (`artifact_blobs`);
- the Dark Desk's own copy of the same fetch (`artifacts.full_text`);
- the passage recorded from it on a Dark Desk claim or relationship (`claims.excerpt`, `relationships.excerpt`).

**Not deleted, and why**: source snapshots (keyed to a source, a separate record); `claims.evidence` and `relationships.evidence` (the desk's own note of what the record says, which may quote it — a working note, not the stored capture); search results and provider history; database backups and copies outside this database. These are outside this action's proof exactly as they are for the legal-removal workflow above; resolving a whole URL's copies is what that workflow lists for an operator.

**Kept, on purpose**: the page's title, its address, when we captured it, the byte length and a fingerprint (hash) of what we captured — so a published story that cited the capture still prints its citation and that citation still resolves. The address stays visible as text on the evidence page and on the story card even when the link to the original was removed.

What changes for a reader: `/evidence/:versionId` prints "This excerpt was removed at the publisher's request" instead of an excerpt and, unless the box was ticked, the link to the original. On a story page, a citation whose link was removed renders as the address in text rather than a link, and its captured-version link is labelled as removed. A comparison that involves a taken-down capture says the excerpt was removed instead of printing a one-sided diff.

Judgments in the desk that bound to the captured text are no longer current and read as **unreviewed**: a judgment binds to `md5(full_text)` of the versions it cited (`finding-evidence-review.ts`, `findingReferenceBinding` and the `judgment.evidenceBinding !== currentBinding` reset in `resolveFinding`), and the purge changes that fingerprint. The judgment is not deleted and not silently kept — the editor re-reviews the capture, which now reads as removed.

There is no restore, and re-capturing the page does not undo the takedown. Identical content resolves to the same capture — the row is unique on newsroom, address and hash — and its text stays deleted; a later fetch of a page that has not changed writes no text back onto it (`rememberCapture` in `investigate.ts` checks the marker). Only a page whose content actually changed mints a new hash, and so a new record, which is a different capture that this takedown never covered. The audit row stands.



---

## Import a transcript or document packet

Open **Desk → Write a story**. Use **Add documents** to select one or several Markdown/text, Word (.doc/.docx), PDF, PNG/JPEG/WebP, CSV/TSV or subtitle (.srt/.vtt) files. Add the story assignment in **What story do you want?**, select the writing model, and click **Write draft**. Website, PDF and YouTube video URLs go in **Links or source text**; accessible video captions are retained as a transcript. Excel and PowerPoint files are read when LibreOffice is installed.

Up to 20 files, 100 MB each. Large files upload in 4 MB parts. The full original remains private in the story; the reader extracts PDF pages, uses OCR for scanned pages/images, and processes long text in sections. The story lists reading progress and downloads of the original and full extracted text. Extracted text is limited to 20 million characters per document; larger text must be split into volumes. Reading errors are shown and originals are kept. Review OCR, names and quotations before publishing. A file an editor uploads is also given meaning vectors, so it can appear in **Find evidence** on later stories ("your file"); deleting the file drops it from the next search.

**Import finished stories** (`/desk/import`) files stories written outside the desk as ordinary drafts, one card per story, with a disclosure choice on each card. Any disclosure line an editor types for an imported story is stored on the article (`articles.disclosure_text`) and is the only AI-related wording the public page can show; the story still waits for an editor to publish it.

## Current Opinion document and review workflow

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Opinion's picker opens on Automatic, which tries DeepSeek v4.1 Flash, then Codex Sol 6.1, then Claude Sonnet 5.5, and DeepSeek is offered in Opinion's picker by name too. Stories, scans and Dark Desk walk the desk's own Automatic ladder — DeepSeek v4.1 Flash 1017, then the local model on this computer when one is loaded, then Codex Sol 6.1 (balanced), then Claude Sonnet 5.5 — and Gemini is a hand pick everywhere. Claude and Codex read the complete configured voice using native instruction-file options and research with it in hand, since the voice file carries the research protocol; DeepSeek, the local model and saved connections have no web tools of their own, so the desk does the searching and reading for them and the same voice governs what it looks for. Research runs to the protocol's stopping conditions or the safety ceiling (30 minutes, 80 pages, configurable), not to a fixed search count. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review (`drafts.integrity_notes` says why) and is flagged for completion before publication. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](editor-desk.md) for the complete editor flow.

## Release notes in the manual

Each release has its own guide in [releases/](releases/README.md), listing the tag, the expected assets and the evidence boundaries. Version history is in [CHANGELOG.md](../CHANGELOG.md). Two older notes still explain behavior the code keeps:

- **0.6.52** added model-specific Codex/Claude effort control, technical-failure recovery with an explicit runtime switch, and terminal handling for provider refusals. A named runtime or Automatic stays the recorded first choice; technical recovery retries only the unfinished call and records requested and actual model and effort. Unattended ladders never select Opus. Neither a refusal nor an invalid provider response is a successful draft. Queue batches can be redrafted with another selected runtime and remain review-only. Direct Story/Opinion document intake reads all readable PDF pages subject to the 20-million-character retained text limit; generic captures and Dark Desk's image-PDF OCR use bounded 12-page calls, and **Read entire PDF** checkpoints those calls and resumes only unread pages. See [the 0.6.52 release guide](releases/0.6.52.md).
- **The daily scan panel** is owner-editable for schedule time, runtime, supported effort, accepted sources, and a source cap of 1–12 (with the every-day count described in Part 4). Its result is leads for the Queue, never direct publication. The Server health queue separates retained failures from current queued/running work and the latest terminal workflow result.

## Documents

| Audience                                            | Document                                                  |
| --------------------------------------------------- | --------------------------------------------------------- |
| Readers, with screenshots and no code               | [docs/reader.md](reader.md)                               |
| Editors, with screenshots and no code               | [docs/editor.md](editor.md) · [docs/editor-desk.md](editor-desk.md) |
| Dark Desk                                           | [docs/dark-desk.md](dark-desk.md) · [docs/dark-desk-editor.md](dark-desk-editor.md) |
| Operators — Windows install                         | [docs/windows-install.md](windows-install.md)             |
| Operators — clone, env, Postgres, models, city swap | [docs/setup.md](setup.md)                                 |
| Local models — what was measured, and why mostly no | [docs/local-models.md](local-models.md)                   |
| Saved custom AI connections                         | [docs/custom-ai-connections.md](custom-ai-connections.md) |
| Stats reports                                       | [docs/stats-reports.md](stats-reports.md)                 |
| Development copy and the Test server                | [docs/staging.md](staging.md)                             |
| The nightly scan-and-draft proof                    | [docs/nightly-proof.md](nightly-proof.md)                 |
| Reading PDF pages                                   | [docs/pdf-page-reading.md](pdf-page-reading.md)           |
| Postgres integration tests                          | [docs/postgres-integration-testing.md](postgres-integration-testing.md) |
| Why DeepSeek runs inside Claude Code                | [docs/D153-deepseek-claude-code.md](D153-deepseek-claude-code.md) |
| Diagram sources and rendering                       | [docs/diagrams/README.md](diagrams/README.md)             |
| Self-hosting this exact deployment                  | [SELF-HOSTING.md](../SELF-HOSTING.md)                     |
| What changed, release by release                    | [CHANGELOG.md](../CHANGELOG.md) · [releases/](releases/README.md) |

---

MIT licensed. Copyright (c) 2026 Scott Converse.
