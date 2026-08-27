# TownReporter — editor’s manual

How to run the desk. You do not need to clone the repo to read this; you do need a running copy and an editor account. Operators who set the box up should start at [setup.md](setup.md).

Dark Desk’s UI contract (for design and for anyone rewriting that page) is [dark-desk-editor.md](dark-desk-editor.md). This page is the whole newsroom.

---

## Two rooms

The **paper** (`/`) is what the public reads: published stories, About, How we report, Corrections, RSS. Nothing reaches it except through you.

The **desk** (`/desk`) is the newsroom: sources, scan, queue, story workbench, published record, Dark Desk. Sign-in required.

A draft, a reporting note, a research memo, a Dark Desk file — none of that is the paper. If you can see notebook language on the masthead (“What is solid,” “Next checks are…”), something went wrong; it is supposed to be stripped. Tell the operator.

---

## Sign in

1. Open `/login`.
2. **Create an editor account** (email + password) the first time. That is the owner. Later visits: switch to sign in.
3. You land on `/desk`.

Notes:

- Self-host uses email + password. Google / X buttons only appear on the grok.me preview.
- The first account is owner. A second person who creates an account is **not** an editor until the operator adds them. There is no invite button. See [setup.md](setup.md#a-second-editor).
- If the desk sits on “Opening the desk,” use Sign in again. Session expired.

---

## A working day

This is the loop. Skip steps that have nothing in them.

1. **Sources** — is the watch list still the right list?
2. **Scan** — one pass over accepted sources. Files leads. This is the expensive click.
3. **Queue** — read what came in. Hold, kill, or open.
4. **Workbench** — draft, notes, check the documents, publish or don’t.
5. **Dark Desk** — only when something doesn’t add up, disappeared, or was never posted.
6. **Published** — if you got it wrong, post a correction. It is public.

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

One pass: fetch every **accepted** source, then one model read for leads and proposed sources.

- It runs **only when you click.** It is not a loop and not a cron for writing. (Monitors in the background can still notice a missing packet. They do not draft.)
- Stay on the page while it runs.
- When it files leads, open the queue. When it files nothing, that can be “nothing moved,” not a crash. The page will say which.

If AI is unavailable you will get a straight error: set `XAI_API_KEY` or a gateway. That is an operator problem ([setup.md](setup.md)).

---

## The queue (`/desk/queue`)

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

This is where a lead becomes a story, or doesn’t.

### Draft

**Draft with AI** runs the reporting pass: follows attachments, retrieves from the captured records (including the relevant part of a long tape, not the hold music), and writes a story into the headline / dek / body fields. You can edit every word. **Save** keeps your edits without printing.

Draft is allowed to be wrong. Read it against the documents.

Reporter-notebook leftovers (`What is solid`, `Next checks are…`) are stripped from the body so they cannot leak onto the paper. If you need that thinking, put it in notes.

### Reporting notes (do not print)

The notes pane is the notebook:

- What’s the news, why it matters, the angle
- To-dos you can strike and restore. Lines you type are tagged **yours**; machine-suggested checks are not
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

An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. Unknown, weak, speculative, and previously-dead trails stay investigable. That is on purpose. Curiosity is not a gate.

### Three piles

| Pile | Meaning | What you do |
|---|---|---|
| **To look at** | New. Nobody has opened it. | Start digging |
| **On the desk** | Started. Includes files that stopped because there is more to read. | Open file / Keep digging / Set aside |
| **Set aside** | Parked or finished. Nothing is deleted. | Pull back / Read |

Start digging **moves** a card from To look at onto the desk. Close file leaves it on the desk. Set aside files it. Pull back restores it.

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

---

## Published and corrections (`/desk/published`)

What is live on the paper, with its corrections.

If you got it wrong: open the story here, write the correction in the open, post it. It appears on `/corrections` and with the article. Do not silently rewrite a published piece and hope nobody notices. We would rather look careful than look first.

---

## What never prints

- Reporting notes and the research memo
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

How we report, in public: `/how-we-report`.

---

## Common trouble

| You see | Likely | What to do |
|---|---|---|
| “AI is not available” | No model key | Operator: `XAI_API_KEY` or `LLM_*` ([setup.md](setup.md)) |
| Scan fetched, filed nothing | Nothing new, or the model declined | Read the summary. Not automatically a bug. |
| Meeting has no transcript | Livestream hasn’t ended, or Playwright missing | Wait for the 6-hour recheck, or operator installs Chromium |
| Names in a draft are wrong | Auto-captions | Check the packet. Fix the draft. Do not publish the caption. |
| Second person gets 403 | They are not in `newsroom_members` | Operator adds them. First user is owner. |
| Desk wants sign-in again | Session expired | `/login` |
| Notebook language on the paper | Strip failed or you pasted it | Edit the story. Kill if needed. Tell the operator. |

---

## What this desk will not do for you

- It will not decide if something is worth printing. You will.
- It will not file a CORA request.
- It will not be your lawyer. First Amendment copy in related tools is not legal advice; this desk does not even ship that prompt.
- It will not watch a city you did not seed. City swap is an operator edit of `paper.ts`, not a dropdown.

You are the publisher. The software is the library, the tape machine, and a very fast intern who still has to be edited.
