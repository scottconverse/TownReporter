# TownReporter — editor’s manual

**Current release: [0.5.6](https://github.com/scottconverse/TownReporter/releases/tag/v0.5.6).** How to run the desk. You do not need to clone the repo to read this; you do need a running copy and an editor account. Operators who set the box up should start at [setup.md](setup.md).

Dark Desk’s UI contract (for design and for anyone rewriting that page) is [dark-desk-editor.md](dark-desk-editor.md). The whole system, including how it is built, is [manual.md](manual.md). This page is the newsroom, in the order you use it.

---

## Two rooms

The **paper** (`/`) is what the public reads: published stories, About, How we report, Corrections, RSS. Nothing reaches it except through you.

The **desk** (`/desk`) is the newsroom: sources, scan, queue, story workbench, published record, Dark Desk. Sign-in required.

![The paper](images/01-front-page.png)

![The desk](images/04-desk.png)

A draft, a reporting note, a research memo, a Dark Desk file — none of that is the paper. If you can see notebook language on the masthead (“What is solid,” “Next checks are…”), something went wrong; it is supposed to be stripped. Tell the operator.

---

## Sign in

1. On a new paper, top right: **Create editor**. That opens `/login`. Email + password. You own the desk. The button is gone after that.
2. Later visits: **Editor desk** or **Sign in**. Anyone can still read the paper without an account.
3. **Give up the desk** (Server page, at the bottom) drops the owner. The paper stays, Create editor comes back, and the next person to open the sign-in page owns the desk -- including the archive, the Dark Desk files and the Server controls. You cannot take it back, so it asks you to type your email address first. It used to be a button in the header of every desk page; an audit showed how easily that is mistaken for Sign out.

Notes:

- Self-host uses email + password. Google / X buttons only appear on the grok.me preview.
- The first account is the owner. There is no setup token; it was removed in 0.5.1.
- A second person joins by invite: the owner mints a one-time link under **Invite an editor** on the Server page. See [setup.md](setup.md#a-second-editor).
- If the desk sits on “Opening the desk,” use Sign in again. Session expired.

---

## A working day

This is the loop. Skip steps that have nothing in them.

1. **The desk** — the line under the heading says what needs you. If it is empty, you are done.
2. **Sources** — is the watch list still the right list?
3. **Scan** — one pass over accepted sources. Files leads. This is the expensive click.
4. **Queue** — read what came in. Hold, kill, or open.
5. **Workbench** — draft, notes, check the documents, publish or don’t.
6. **Dark Desk** — only when something doesn’t add up, disappeared, or was never posted.
7. **Opinion** — when the paper should say what it thinks about something it has reported.
8. **Published** — if you got it wrong, post a correction. It is public.
9. **Server** — a glance, when something feels slow or the site looks down.

Scan does not publish. Draft does not publish. Dark Desk does not publish. **Publish** on the workbench is the only gate.

---

## Sources (`/desk/sources`)

The watch list. Longmont ships with city, council, agendas, PrimeGov, planning, NextLight, St. Vrain Valley Schools, Boulder County, the library, `@CityofLongmont`, and `@LongmontPublicMedia`.

**Add one:** paste a URL, optional title, add. YouTube URLs are tagged as YouTube; everything else starts as official / tier A.

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

Proposed sources from a scan wait here until you accept or reject them. Accepting puts them on the next scan. Rejecting drops them.

Newly discovered public records are fair game even if they were not on this list. Dark Desk does not have to ask the watch list for permission to fetch a public URL.

---

## Scan (`/desk/scan`)

![Scan](images/05-scan.png)

One pass: fetch every **accepted** source, then one model read for leads and proposed sources.

- It runs **only when you click.** It is not a loop and not a cron for writing. (Monitors in the background can still notice a missing packet. They do not draft.)
- Stay on the page while it runs.
- When it files leads, open the queue. When it files nothing, that can be “nothing moved,” not a crash. The page will say which.

If AI is unavailable you will get a straight error. Usually that means the Claude Code CLI is not installed or not signed in on the machine running the desk, and no key is set instead. That is an operator problem ([setup.md](setup.md)).

---

## The queue (`/desk/queue`)

![The queue](images/06-queue.png)

Everything that might be news, scored and sorted. The scanner files here. Dark Desk can file here. So can you (“File a lead yourself”).

Statuses you will use:

| Status | Meaning |
|---|---|
| **New** | Not opened yet |
| **Drafted** | Workbench has a story in it |
| **Held** | Not now. Still on the desk. |
| **Killed** | No. Still listed under Killed if you need to undo. |
| **Published** | Live on the paper. Lives under Published, not the working queue. |

Open a lead to go to the workbench. Nothing prints from this list.

A meeting on the calendar is not automatically a story. A five-hour council tape is not automatically a story. Those are records. You decide if there is news.

---

## The workbench (`/desk/story/…`)

![The workbench](images/07-story-editor.png)

This is where a lead becomes a story, or doesn’t.

The lead and the notes are on the left and never print. The draft is on the right. **PULL**, next to an unfinished to-do, goes and fetches that one document.

### Draft

**Draft with AI** runs a research pass first: the company’s or agency’s own press release and records, then stakeholders, history, and competing accounts. It writes a story into the headline / dek / body fields. You can edit every word. **Save** keeps your edits without printing.

Stay on the page. If the click dies before the reply comes back, the workbench keeps looking until the draft is on the lead, then fills the form. You should not need to reload. If a real failure happens, the page says so — click again.

When the reporting hangs on another newsroom, the draft should name them and link the **story URL** so they get the traffic. A homepage or `/local-news` index is not that URL. Their rewrite is not a substitute for the company’s own announcement. If the desk only has a listing, notes ask you to pull the full URL; do not publish a paraphrase of their legal claims as if TownReporter established them.

A second box under the story, **Pulled notes**, does not print. **Pull** next to a still-to-pull line searches that item, opens what it finds, and drops the excerpt there for you to cut into the story. Redraft reads that box. The checkbox only strikes the line.

Draft is allowed to be wrong. Read it against the documents.

Reporter-notebook leftovers (`What is solid`, `Next checks are…`) are stripped from the body so they cannot leak onto the paper. If you need that thinking, put it in notes.

### Reporting notes (do not print)

The notes pane is the notebook:

- What’s the news, why it matters, the angle
- To-dos you can strike and restore. **Pull** searches that line and drops the excerpt under the story. The checkbox only strikes it. Lines you type are tagged **yours**; machine-suggested checks are not
- Claims and sources — load-bearing facts with URLs
- What you found, what still needs a check
- Pages you opened

**Research memo** persists across redrafts. A new Draft with AI will not blow away the memo. The memo never prints.

Write like a reporter talking to yourself. None of this is copy.

### Publish

**Publish** saves, then puts the story on the paper. After that it has a public URL under `/articles/…`. Provenance (source title, organization, document date, exact URL, capture time) goes with it when the records resolve.

Before you hit it:

- Every material number, name, date, and quote has a document you can show.
- If the only source is a YouTube caption, you have checked the packet or the minutes, or you have written the story as “on the tape,” not “the minutes say.”
- You are willing to put your name on it. The software will not.

Hold or kill from the queue if it is not ready. There is no shame in a held lead.

---

## Meetings and tapes

Longmont’s desk watches three kinds of meeting record. They are not interchangeable.

| Record | What it is | Treat as |
|---|---|---|
| **Packet / agenda PDF** (PrimeGov) | What staff put in front of the body | Official, still read it |
| **Minutes** (PrimeGov, when posted) | The official action | Official |
| **YouTube tape + captions** | What was said, including asides and “skip it all” | A map of the meeting, **not minutes** |

How they join: a council video titled like `08/25/2026` joins that day’s packet. A planning video about 206 S. Main joins the Avis notice in that packet. Month must match — June’s museum board is not August’s.

**Captions:**

- Auto-captions invent names. “Kimbark” will come out as something else. Do not publish a proper name off a caption without a check.
- Quotes need a check. Play the tape or read the packet.
- Upcoming livestreams have **no transcript yet**. The desk rechecks; you do not invent one.
- `@LongmontPublicMedia` is the sister tape. If the city channel has no captions, we use theirs. Same rules.

**Minutes not posted** after 36 hours (council / commission / board / authority, skipping cancel / continued / TBD) is a catalog note. It is a reason to look, not a story by itself.

Dark Desk is told: search the whole tape; names may be wrong; quotes need a check. It will still guess. You are the check.

---

## Dark Desk (`/desk/dark`)

The recursive investigative lane. **It never publishes.** Publication is a separate human action on the queue / workbench.

![Dark Desk](images/08-dark-desk.png)

An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. Unknown, weak, speculative, and previously-dead trails stay investigable. That is on purpose. Curiosity is not a gate.

### Three piles

| Pile | Meaning | What you do |
|---|---|---|
| **To look at** | New. Nobody has opened it. | Start digging |
| **On the desk** | Started. Includes files that stopped because there is more to read. | Open file / Keep digging / Set aside |
| **Set aside** | Parked or finished. Nothing is deleted. | Pull back / Read |

Start digging **moves** a card from To look at onto the desk. The card stays on To look at, with a status line, until the file actually opens. A failed click says so — it does not vanish. Close file leaves it on the desk. Set aside files it. Pull back restores it.

A research round is a short batch, then a stop. Remaining pages stay on the file. That stop is **not a failure** and not “too many leads.” Keep digging reads the next batch.

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

| Dial | What it moves |
|---|---|
| **Dig — how far it chases** | Hops, searches, whether it may leave the watch list, how far it follows a name into a company, a parcel, a contract |
| **Nerve — how speculative** | How sure it has to be before it writes something down, and whether it may propose a theory or only ask a question |
| **Map** | City · county · region · adjacent — how far out it is allowed to look |

The paragraph above the sliders is not decoration. It is written from the same
rules the run itself uses, in plain words: *"Up to 3 hops, following any public
record it finds, including archived copies. One account is enough to open a
file. No confidence floor at all — it writes the hunch down and labels it a
hunch."* If the paragraph says it, the run does it.

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

## Opinion (`/desk/opinion`)

![Opinion](images/10-opinion.png)

Where the paper says what it thinks.

Type a subject, a sentence, or paste a URL, and press **Write an editorial**. A
pasted link gets opened and read before anything is written.

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

**Edit** opens the piece in its own editor. That is where you change the
headline, fix a line, print it, or throw it away. The fact sheet and the image
prompt sit under the piece there, marked *does not print*.

It takes **ten to forty minutes**, because it goes and reads the records before
it writes a word. The row shows a clock counting up and a moving rule; at 3:40
that is normal, not stuck. The page rechecks every twenty seconds.

An editorial is a **draft**. Read it, edit it in the story workbench, and
publish it like any other piece — or don't. It will happily conclude that your
lead was wrong; one real run opened with the discovery that the record it was
sent to attack had never been missing at all.

---

## Server (`/desk/ops`)

![Server](images/11-server.png)

Everything this machine is doing to keep the paper online, and the few buttons
worth having.

The **Health** list is read from this machine, so it can tell you the tunnel is
routing — not that a reader in another town can reach you. Rows worth knowing:

| Row | What a bad reading means |
|---|---|
| **Public site** | The paper is not answering. Try Restart the tunnel. |
| **Cloudflare tunnel** | No tunnel process. The watchdog should fix this within five minutes. |
| **Work queue** | Something failed, or one job has been running a long time. |
| **Watchdog** | If it has not run recently, the scheduled task is off. |

Every button says what it will do before it does it. The two that interrupt the
paper ask twice.

---

## Delete

Every list has a **Delete** button: leads in the queue, editorials on Opinion,
and stories under Published. It asks once, in the row, and says what it costs.

**Kill is not delete.** Kill parks a lead under Killed and you can bring it
back. Delete removes it.

| Delete this | And this happens |
|---|---|
| A lead | It goes, and any draft on it goes. A story already printed from it **stays on the paper** — that is a separate button. |
| An editorial | The draft goes. If it was printed, the printed piece stays; remove that under Published. |
| A published story | It comes off the paper. Its URL becomes a 404, the feed and sitemap drop it, its corrections go, and anyone holding a link has a dead link. |

That last one is the loud one. The paper's normal answer to being wrong is a
**correction**, in public, above the story. Delete is for the thing that should
never have existed — the wrong name, the private detail, the piece filed against
someone it should not have been.

### It is not gone yet

Nothing you delete disappears immediately.

- An **Undo** link appears right where you deleted it. One click and it is back.
- After that, it waits **30 days** under **Recently deleted** on the Server
  page (`/desk/ops`). **Restore** puts it back exactly where it was — a story
  keeps its URL, its corrections come back with it, an editorial keeps its fact
  sheet.
- **Delete for good** on that list is the one with nothing behind it. It says so.
- After 30 days it goes on its own.

So the only truly final button in the newsroom is *Delete for good*.

---

## Published and corrections (`/desk/published`)

![Published](images/12-published.png)

What is live on the paper, with its corrections.

If you got it wrong: open the story here, write the correction in the open, post it. It appears on `/corrections` and with the article. Do not silently rewrite a published piece and hope nobody notices. We would rather look careful than look first.

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

The paper’s clock is **Mountain Time** (`America/Denver`). A Wednesday evening does not print as Thursday UTC.

Overlapping printed headlines collapse; the longer body stays. Quiet-zone ×2 and survey ×2 drop. Distinct sessions (Airport Vision vs the Boulder County joint session) stay side by side. Search and live archive URLs are unchanged.

How we report, in public: `/how-we-report`.

---

## Common trouble

| You see | Likely | What to do |
|---|---|---|
| “AI is not available” | No model configured | Operator: sign in to Claude Code on that machine, or set `ANTHROPIC_API_KEY` / `LLM_*` ([setup.md](setup.md)) |
| Scan fetched, filed nothing | Nothing new, or the model declined | Read the summary. Not automatically a bug. |
| Draft with AI ran, form still empty | The click died; the writing pass may still be finishing | Stay on the page. It fills when the draft lands. Reload only if you left. |
| Redraft shows a sign-in / setCookie error | Cookie helper threw even though you are signed in | Click Redraft again. Fixed in 0.3.7. |
| Start digging does nothing | The card was hidden after a failed open (fixed in 0.3.8) | Reload. The card should be back. Click again — it stays until the file exists. |
| Draft is a rewrite of the Leader | The pass never opened the company page | Pull the still-to-pull line for their press release, then redraft. |
| Meeting has no transcript | Livestream hasn’t ended, or Playwright missing | Wait for the 6-hour recheck, or operator installs Chromium |
| Names in a draft are wrong | Auto-captions | Check the packet. Fix the draft. Do not publish the caption. |
| Dates look a day ahead | Host clock in UTC | Masthead uses `PAPER.timezone`. Tell the operator if it is still UTC. |
| Two nearly identical headlines on the paper | Same news, two drafts published | The paper collapses overlapping headlines and keeps the longer body. |
| Second person gets 403 | They are not in `newsroom_members` | Operator adds them. First user is owner. |
| Editorial says Failed with a timeout | The piece ran past the writer's limit | Ask again. If it repeats, the operator can raise `EDITORIAL_TIMEOUT_MS`. Nothing is lost but the run. |
| Editorial never starts, says no voice | `TOWNREPORTER_VOICE_FILE` is unset or points nowhere | Operator: set it to an absolute path outside the repo |
| The paper is down and the desk still works | The tunnel, not the app | Server page → Restart the tunnel. The watchdog also does this within five minutes. |
| An editorial has no Edit button | It has not finished, or it failed | Only a finished piece can be edited. A failed row can still be deleted. |
| Desk wants sign-in again | Session expired | `/login` |
| Notebook language on the paper | Strip failed or you pasted it | Edit the story. Kill if needed. Tell the operator. |

---

## What this desk will not do for you

- It will not decide if something is worth printing. You will.
- It will not file a CORA request.
- It will not be your lawyer. First Amendment copy in related tools is not legal advice; this desk does not even ship that prompt.
- It will not watch a city you did not seed. City swap is an operator edit of `paper.ts`, not a dropdown.

You are the publisher. The software is the library, the tape machine, and a very fast intern who still has to be edited.
