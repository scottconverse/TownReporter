# Next TownReporter patch — unreleased (Unit BG, redesign phase 5: Models)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub publication, production deployment, or a promoted candidate. Phase 5 adds one screen — **Models**, at `/desk/models` — and the table behind it. Nothing else on the desk changed.

## What an editor sees change

### There is one screen that answers "which model does what"

Until now the desk could tell you whether a provider was signed in, but not which
model ran the daily scan, or the lead scoring, or a story draft. Those answers
were spread across three pickers that each asked a different question, and the
answer to "what happens when the first one fails" was nowhere at all.

**Models** is that screen. It is reachable from **Server settings** ("Assign
models to jobs →") and, from this phase on, from the new desk navigation. It has
two tabs.

### "Who does what" — ten jobs, three choices each, and a live state

One row per job: the **daily scan & lead filing**, **lead scoring & duplicates**,
**story drafting**, the **opinion**, the **evidence check**, **headline
suggestions**, **Dark Desk research**, **AI follow-ups**, **document reading &
OCR**, and **video & meeting transcripts**. Each row carries a **First choice**
with an **effort** select beside it, then **Fallback 1** and **Fallback 2**.

The desk tries the first choice, then Fallback 1, then Fallback 2, and records
which one actually ran. **A content refusal is final and never falls back** — if
a model reads the request and declines it, asking the next model the same
question would be shopping for a different answer, so the desk stops.

Beside each row is its **live state**: ✓ Ready, ! Slow, Sign-in expired, or Not
built yet. "Slow" means a local model that is not in memory — the first call
loads it, and that can take a minute or more. Hovering the chip says which of
those it is rather than making an expired sign-in out of an unset local server.

Two things about this table are worth knowing:

- **The effort list is the exact model's.** A level the model does not declare is
  never sent; the desk drops it to that model's default. This is what lets an
  assignment survive the model on a local server changing, and it is why the
  effort control is greyed out for a model that declares no levels at all
  ("Provider default").
- **A setting the desk can no longer use says so, in amber, on its row.** If a
  saved model is one this build no longer offers, the run falls back to the
  desk's default *and the row carries a sentence* asking for a replacement —
  rather than quietly running something else.

The footer counts **jobs** with unsaved changes, offers **Reset** and **Save
assignments**, and says "All jobs have a working first choice except where
marked." when there are none. **AI follow-ups** shows its row with "Not built
yet" instead of a picker, because the desk has no follow-up runner: the row is
the plan, not a setting.

### "Connections" — the same actions, in three groups

The tab that used to be "Writing models" on Server settings is now three groups,
as drawn:

- **Frontier · API key** — your own API connections, pay per use, every existing
  action kept (add, edit, enable, remove, discover models, test).
- **Subscription sign-ins (OAuth)** — Claude, Codex and the xAI sign-in, with
  their countdowns and one-time codes. The per-provider **time limits** stay on
  Server settings, and this group links there rather than growing a second copy.
- **Local & self-hosted** — the LM Studio, Ollama, llama.cpp or
  OpenAI-compatible servers this machine can see, what each has, which model is
  in memory, and the effort levels each model takes.

**There is no Load button and no Pull button, anywhere** — TownReporter reads
what a server reports and never tells it to load a model into anyone's GPU
(0.6.71). Each card offers **Open LM Studio ↗** / **Open Ollama ↗**, which is a
hand-off to the server's own console, and **Settings**. The tab is labelled with
a real count of the cards under it.

## What changed under it

A new table, `model_assignments` (migration `0100_model_assignments.sql`), holds
at most three ranks per job per newsroom: rank 0 is the first choice, 1 and 2 are
the fallbacks. It is **additive and optional** — a newsroom with no rows behaves
exactly as the desk did before, on today's surfaces' defaults.

The order a run resolves in is **an explicit per-run pick, then
`model_assignments`, then the surface default and Automatic**, and effort is
validated per exact model every time it is read. Nothing in the screen or the
table names a model: every option comes from the provider registry and the
newsroom's own `custom:<uuid>` connections, so a retired provider cannot be
offered by a picker that was written before it was retired. **Grok is in no
picker** at any rank; its card remains under sign-ins with its actions intact.

## Limits

**No model was called and no model was loaded** while building this. The evidence
for the browser pass is screenshots of the two tabs at 1280 in light and dark,
taken without pressing a Test button.

The migration's parity test (`src/lib/news/schema-parity.test.ts`) builds two real
Postgres databases and diffs their columns; **it skips unless
`TEST_POSTGRES_ADMIN_URL` is set**, so in this environment the `model_assignments`
mirror is asserted by the migration and the `ensure…Schema()` function being read
side by side, not by a run. Phase 5 does not wire the assignments into the run
paths as a whole: what is proven here is the resolution, the fallbacks, the
refusal rule and the effort validation, all as pure functions with tests.

Two things are built as drawn but worth naming. The screen's header buttons sit
one line lower than the design draws them, because the shared desk shell has no
actions slot. And this one view has two yellow buttons ("+ Add a connection" and
"Save assignments") where the design system asks for one primary per view —
following the drawing.
