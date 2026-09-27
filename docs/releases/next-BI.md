# Next TownReporter patch — unreleased (Unit BI, redesign phase 6: AI follow-ups)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub
publication, production deployment, or a promoted candidate. Phase 6 turns **Follow-ups** from a
list an editor works into a screen of agents that keep working, adds the dialog that starts one,
and wires a real runner behind the **AI follow-ups** row phase 5 left marked "Not built yet".

## What an editor sees change

### A follow-up can now be an agent, not just an ask

Until now every follow-up was the same thing: who was asked, what they owe, when it is due. The
editor drove all of it — nudging, recording the reply, dropping it.

**Follow-ups** (`/desk/follow-ups`) keeps those rows and adds a second kind beside them. A
follow-up started with **+ New AI follow-up** names a question and a method, and from then on the
desk works it on a schedule and reports what it finds:

- **Re-check pages** — watches the pages you name and says when one of them changes. It is the
  existing page-watch engine, not a second crawler: the same capture, the same OCR, the same
  "unchanged / changed / refused" vocabulary.
- **Search public records** — runs the desk's own web search for the question and has a model read
  the hits and decide whether any of them actually answers it.
- **Watch for next agenda** — watches a meeting body's portal and reports when a new agenda is
  posted. PrimeGov portals today, which is what the daily scan's meeting capture reads too.

The card says which of the four filters it belongs to — **Active**, **Found something**, **Could
not check**, **Stopped** — carries a 4px left border in the state's color, the method line ("Re-check
pages · every 2 hours"), the question in the editor's own words, the latest result, the story it is
linked to, and its next check.

### "Nothing changed" and "could not check" are different cards

This is the point of the screen, and it is why the state is five values rather than a boolean
"found something". An agent that got where it was going and found the page unchanged is **healthy**
— "Checked · no change". An agent that could not read the page at all is **not** — "Could not
check", with the real reason on the card ("The page timed out.", "This build can only watch PrimeGov
portals.") and a **Retry now** button. A follow-up that has been quietly failing for a week must not
look like one that has been quietly working.

### A finding goes to the story's reporting notes. It never publishes

When an agent finds something it writes one line into that story's **reporting notes**, through the
same column and the same helpers the notes panel uses, and the card's **Review finding** button goes
there. Nothing in this feature writes an article, a draft or a lead — there is no publish path out
of it at all. The screen says so in its first paragraph, and it is the sentence worth keeping.

### The dialog

**+ New AI follow-up** opens the drawn dialog: the method (three cards), the schedule (which
defaults from the method — 2 hours, daily, posting days), the pages or portal to watch, and the
question. **Save** starts it immediately; it does not wait to be found by the scheduler.

## What changed under it

`follow_ups` grows eight columns (migration `0101_ai_follow_ups.sql`): `agent_kind`, `targets_json`,
`schedule`, `model_choice`, `last_run_at`, `next_run_at`, `last_state`, `finding_json`. It is
**additive and optional**: `agent_kind` is null on every row written before this migration, and
those rows keep rendering exactly as they did, as **Manual asks** under the working filter. The
status check is *widened* to the union of the old vocabulary (`open | answered | dropped`) and the
new one (`active | paused | stopped | done`), never rewritten, so an old row cannot fail its
constraint because a new build shipped. Mirrored by `ensureFollowUpsSchema()` for PGLite.

Runs are **in-app jobs**, not a new service: a `follow-up` job in `desk_jobs` (the kind phase 5
already declared), dispatched by the same `realWork`, reporting progress through phase 3's
`reportProgress` and honoring the editor's Stop at every step. Scheduling is the daily scan's
pattern — `tickFollowUps`, driven by `startUnattendedScheduler()` and the dev Vite plugin. **No
Windows task, no second service, no operator setup.**

Three rules are enforced in one place (`follow-up-scheduler.ts`): follow-ups run **one at a time**,
**never alongside a running draft** (the draft is the editor's foreground work and shares the same
provider budget), and a `running` row whose worker died is put back after twenty minutes — twice the
run's own hard cap, so a slow-but-alive run can never be mistaken for a dead one. **Run now** obeys
the same two fences, and a refusal is *reported* ("A draft is being written right now…") rather than
silently doing nothing.

The model is resolved by phase 5's order: the follow-up's own pick, else the `follow-up` row in
`model_assignments`, else the surface default. The hard cap on a run is
**`createDarkRunBudget`** (`src/lib/news/dark-run-budget.ts`, migration `0059`) — the same budget
mechanism the Dark Desk uses — sized by `followUpRunLimits`: the shorter of ten minutes and the
resolved provider's own wall budget, and 3 model calls / 3 searches / 6 document reads.

## Limits

**No model was called and no model was loaded** while building this. Every agent test drives
`found`, `no-change` and `could-not-check` through fakes — the agent's `deps` object *is* the whole
outside world in this feature, and the defaults are the real engine functions. The browser evidence
is screenshots of the screen and the dialog at 1280 in light and dark, with the card states seeded
directly into the dev database.

The screen is built as drawn with these deviations, all named in the phase 6 report: **+ New AI
follow-up** sits at the right-hand end of the filters row rather than in the page header, because the
shared desk shell has no actions slot there and `desk-chrome.tsx` belongs to another lane; the
dialog's **Story** field is an addition to the drawing (it is what makes "add the finding to the
story's notes" reachable from the dialog); the **stopped** and **done** chips and their button sets
are not drawn; **Add to story** disappears once a story is linked, because the note is written at
that moment and the button must not append it twice; and the **Manual asks** section is not drawn
but is kept, because hiding an editor's own asks behind a redesign would lose them.
