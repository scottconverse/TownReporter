# Next TownReporter patch — unreleased (Unit BK, redesign phase 4: the editor's dialogs)

**State:** Candidate work in progress. This document does not assert a release, tag,
GitHub publication, production deployment, or a promoted candidate. Phase 4 builds the
nine dialogs the redesign draws for the editor, **and mounts none of them**: each is an
exported component in a new file under `src/components/dialogs/`, and the screens take
them in their own phases. Nothing an editor can reach today changed.

## What an editor sees change

Nothing yet — this phase is the dialogs themselves. When the screens mount them:

### New story — three tabs

The same dialog writes a story with the model (**Write it with AI**), by hand (**Write it
myself**) or from a paste (**Paste it in**), and each tab runs its own press: one
`writeStory` carrying the box and any document the editor attached, or `fileLead` and then
`saveDraft` for the two no-AI tabs. The AI tab draws the model row; the two no-AI tabs do
not, because no model will run.

### Add a lead

A link or a tip, and a **Then** choice: **Research and score it** (the story job's model,
resolved through phase 5), **Draft it**, or **Just file it**. This one dialog does not close
on success — it reports what each step did and leaves the editor with the lead it filed.

### Add sources to watch — four tabs, and a preview table

Paste rows, add one at a time, or ask the model for suggestions, and **the dialog shows what
will be added before it adds it**: one row per source with its kind and a head line like
*"5 new · 1 already watched"*. "Already watched" is decided by host plus path with `www.`
stripped, the same identity the add path refuses duplicates with, so a row marked new is a
row that will be added. If the watch list cannot be read the preview says so rather than
marking every row new.

### Add to this story — two presses, and the first one writes nothing

**AI weaves it in**, **Add as an update at the top**, or **Paste in as-is at the end**. The
first press computes and shows the whole body that would be saved; only the second press
saves it, and it saves exactly the bytes the editor read. The two no-AI modes write in
opposite directions and neither touches a model.

### Start a Dark Desk file

One press, one write: the file is opened with the Limits dial the editor chose, stored as
the engine's own budget in hops. The first round is **not** started here — the drawn foot
note promises a live activity log and a stop, and those live on the file page, which is
handed the material and the pick.

### Hold this lead

A reason the desk learns from — **Waiting on a record or date**, **Waiting on a follow-up**,
**Not now** — or **Hold, no reason**, which is a real record of its own so a later reader can
tell "the editor chose not to say why" from "nobody opened the dialog". Waiting on the
AI follow-up says plainly that nothing will chase it, because the follow-up job is not built.

### Headline

**Keep mine**, a suggestion, or a typed line. The model row is wired: the row the editor
sees is the model that runs. The drawn foot note names an elapsed time the desk does not
return, so the foot keeps the half that is true.

### More ▾ — the lead row's menu

Six rows. **Hold** and **Dark Desk** open this phase's own dialogs. **Edit**, **Merge**,
**Follow-up** and **Kill** belong to other lanes; where the mounting screen passes no handler
for one, the row says so in words instead of closing the menu and doing nothing.

### The kill pattern under a source

One line and its examples: how many leads were killed from this source, how many of those
were killed for a bad-source reason, and the killed leads themselves. **Both numbers are
always printed**, because a source with nine kills and none of them its fault is a source to
keep. It is read-only by construction: `sourceKillPattern` writes nothing at all.

## What changed under it

Six server functions — `addLead`, `holdLead`, `sourceKillPattern`, `findSources`,
`weaveIntoStory`, `chooseHeadline` — each with a schema in `request-input.ts` beside it and a
`perform*` beside that. `weaveIntoStory`'s `mode` is **required**, so a request that forgot to
say "paste in as-is" cannot default into a model call.

Every `perform*` takes its SQL, its chat call and its four writers from one injected
dependencies object, so the decisions can be tested with a fake database and a **counting**
model — which is how "the model is not asked again on the confirm press" is asserted rather
than described, and how "the kill pattern writes nothing" is asserted as zero writes.

The hold reason rides in the lead's existing notes rather than a new column: there is no
hold column today, and adding one would mean touching every hand-built `leads` table in the
suite for a value nothing queries. **No migration.**

Two existing seams moved, both narrowly: opening a Dark Desk file takes a budget instead of
hardcoding 5 (a Limits choice that never reached the file would be a control that does
nothing), and the lead-and-draft insert is exported so "Add a lead" does not become a second
copy of it. Headline suggestions accept the dialog's model pick; absent is still Automatic.

Every model choice resolves the phase 5 way — the dialog's own pick, else
`model_assignments`, else the surface default. Every action reports in the editor's words.
Every AI path has its no-AI path in the same dialog, on a tab or a radio beside it.

## Limits

**No model was called and no model was loaded** while building this. The tests use fake
models and an in-memory database; the browser pass rendered each dialog at 1280 in light and
dark without pressing a button that spends a model.

The design's Dark Desk copy is in records and hours ("up to 100 records, 8 hours"); the
engine's unit is a hop, and there is no records-per-hop conversion in the codebase. The
dialog draws the design's words unchanged and the three dials map to the hop counts whose own
estimate lands closest to the drawn times. The mismatch is recorded rather than papered over
with a number the engine does not honor.

The "Updated \<time\>" line an update writes is a plain first paragraph, not a marker any
renderer expands — a search for such a renderer across the routes, components and libraries
finds none — so it is spelled out in full.

The screens that mount these dialogs are other phases' work. What is proven here is each
dialog's own logic: what it plans, what it refuses with, and that a cancelled dialog leaves
state exactly as it opened.
