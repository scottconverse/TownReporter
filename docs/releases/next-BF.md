# Next TownReporter patch — unreleased (Unit BF, redesign phase 2a, lane 3)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub
publication, production deployment, or a promoted candidate. It covers lane 3 of redesign phase 2a
only: the desk shell and navigation, **Today**, the **Queue**, and the new **Drafts** list. The public
paper (lane 1) and job progress (lane 2) are separate units; the desk shell is built to take their
parts.

## What an editor sees change

### The desk's left nav is the drawing, with real counts

The nav is now the drawn order — **Today, Queue, Drafts, Published, Opinion, Follow-ups, Dark Desk,
Sources & scan, Models, Server, Stats** — at 44px an item, the active item filled with a 4px yellow
left inset, and a count at the right where a count means something (Queue, Drafts, Published, all read
from leads the page was already fetching). The footer holds **View the paper ↗**, the light/dark
switch, the text-size select and **Press ? for keyboard shortcuts**, in every screen's nav because
there is one nav. On a phone the nav becomes the top bar: wordmark, **Desk** tag, **+ New**, **Menu**.

**Running box.** While any job is running the nav shows the yellow-bordered box with **Running · N**
and each job's title with its elapsed time and its own stage text. It reads the job list the desk
already polls — the shell and the page share one request and one cache entry — so it added no call of
its own.

**Routes that had to stay reachable did:** `/desk/import`, `/desk/memory` and `/desk/legal-removals`
are all still there, and `scripts/docs-routes.test.mjs` still resolves every URL the documentation
names (30 routes, 28 documented paths, 0 unresolved).

### Today is a step strip with numbers that agree with each other

`/desk` opens on the drawn four-step strip — **Pick leads / Draft / Check / Publish** — each cell a
number, a name, a count and one button, the current step's number square in yellow. Below it:
**Running now**, **Tonight's edition** with the three checks that have to be true before the paper
goes out, the start-a-draft composer, import, paste, and **New leads** with the keyboard triage legend
**J/K next · S start story · H hold · X kill · U undo · Enter open**. **?** opens the shortcut list as
the shared `Dialog`, from any desk screen, and is ignored while the editor is typing.

**One defect this unit found and fixed on the way.** A lead filed by hand gets a draft row with an
empty body (`fileLead` writes both), so the row fell through the draft-state rule to its last branch
and announced **"Ready to check"**. Today therefore counted unwritten leads on the **Publish** step and
listed them in **Tonight's edition** under "READY TO CHECK" — while the nav's Drafts count, which
counts leads whose status is `drafted`, said 0. The page said two things at once about the same two
rows, and the loud one was wrong. There is now a fact for it (`has_body`, projected from the draft row
as a boolean, so no prose crosses the wire) and a state: **"Nothing written yet"**, with **Start story**
as its one action. An unwritten lead is on the Drafts list, in no other filter, and on no count that
means "act now".

### The Queue's bulk bar moved to its own row, and a row action finally reaches the form it names

The Queue keeps its Open / Held / Killed / ≈ Printed / All filters, search, sort and section, and the
columns `checkbox | score | lead | evidence | filed | actions`. The **bulk bar now sits on its own row
below the controls** (the v3.1 fix), so selecting rows no longer reflows the filters above them. Each
row's main action is **Start story**, a held lead offers **Release**, and **More ▾** opens the actions
that already exist. Today's **+ Add a lead** links to `/desk/queue#file-lead` — and that hash used to
land on a **shut** `<details>`: a hash on its own scrolls to the label and leaves the form closed. The
Queue now opens whatever `<details>` the hash names.

### Drafts is a screen of its own

`/desk/drafts` — **everything not yet printed** — with **All / Running / Needs you / Yours / Failed**,
each row a state chip, section · origin, headline, the newest thing that happened to it, and the next
action with **More ▾**; a running draft hands its row to the job slot so lane 2's Job card can take the
place without this screen changing. Every row carries a state in words, and a draft that is a paste
says **Imported** and **Reprint** rather than claiming a model wrote it.

### Every press on the desk is 44px tall

`design-system/README.md:120` — "All buttons: at least 44px tall" — was not true of the desk's small
buttons: `.btn.small` was committed at 36px, and 40px below 700px. The desk's row actions (Queue
Delete, Today's Run scan, and the rest) measured 36–38px in a browser. One rule in `desk-astra.css`
raises `.desk-ltr.astra .btn.small` to 44px at every width in both themes. **This is desk-wide by
design** — every desk screen is `.desk-ltr.astra` — so it is a change other lanes' screens inherit.
No test pinned the old height.

## What is not here

The design draws things with no backend behind them. None of them was faked:

- **"Preview viewed"** on the publish bar — no record of a preview being viewed exists.
- **The evidence meter on a lead row** — the Queue row has no evidence detail to draw a meter from.
- **The model-assignment grid** — Models is unchanged and linked.
- **AI follow-ups** and **the stats beacon** — unchanged screens.

Wording kept deliberately against the drawing: **"Ready to check"**, not "Ready to publish" (this row
cannot see the publish gate); **"Draft with AI"** on the Queue row rather than "Start story"; the
Queue's tab set folds New and Drafted into Open. The Today row offers the drawn presses with the
heavier ones (Hold, Kill, More) on the Queue, and `⌘S` is not bound on Today.

## Limits

Measured in a browser at 1280 light, 1280 dark and 390 light over a throwaway in-memory desk with two
leads filed by hand: no horizontal scroll, no text under 14px, every button 44px or taller, 0 console
errors (9 screenshots, `evidence/BF/`). The flow suite that walks these screens passes 32 of 32 steps.
Beyond that this document proves no more than it says: nothing here was run against Postgres, no model
was loaded or called, and no migration is in this unit (lanes 1 and 2 own `0098` and `0099`).
