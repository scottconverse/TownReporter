# Next TownReporter patch — unreleased (Unit BN, redesign lane 3: the dialogs reach the screens)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub
publication, production deployment, or a promoted candidate. Phase 4 built nine dialogs and mounted
none of them; phase 6 built the AI follow-up rail and mounted none of it. This unit mounts them on
Today, the Queue and the nav, and a follow-up unit answers its seven open questions: the row menu's
drawn rows and order, the clipped panel, the dark-file prefill, the rail's own **+ New story**, and
Today's. No migration, no new server function, no model called.

## What an editor sees change

### Today's "+ Add a lead" is the drawn dialog

It was a link to the Queue's legacy `#file-lead` form. It now opens **Add a lead** in place: a link or
a tip, why it might matter, and the **Then** choice. That legacy form still exists at
`/desk/queue#file-lead` and still opens where it did.

Today's **+ New story N** now opens the same drawn **New story** dialog the nav's **+ New** opens —
its first tab, **AI drafts from material**, is the old Write-a-story box's own intake, so the headline
and the why land on the filed lead exactly as they did. Today's **+ Opinion** and **Start story S** are
unchanged, and the old story composer is still reachable where it was (`/desk#story-composer`).

### Hold opens a dialog, from the row and from the H key

**Hold H** on a Today row, and **Hold with a reason** in a Queue row's More menu, both open **Hold
this lead** on that lead — the reason the desk learns from, or **Hold, no reason**. The row leaves the
open list when the dialog is done, without a reload.

### The Follow-ups rail on Today reads the real follow-ups

The rail was drawn and empty. It now lists what the AI follow-ups have found: the question in the
editor's words, the finding sentence, the story it is linked to, and **Review finding**. With nothing
found it says so in a sentence rather than showing an empty panel.

### The Queue's rows carry the drawn menu rows

Each row's **More ▾** now also holds **Hold with a reason**, **Send to Dark Desk**, **Start an AI
follow-up** and **Kill with a reason**, beside the menu's existing **Open**, **Delete** and draft
controls, in that order. **Send to Dark Desk** opens the file and puts the editor on it, where the
round is started and the live log and the stop are. The Queue header's own **Add a lead** opens the
same Add-a-lead dialog as Today's, and an empty queue offers **New story** in its empty state.

### The nav's New control opens the New-story dialog

On the phone the shell's top bar has **+ New**. It used to navigate to Today's composer; it now opens
the drawn **New story** dialog over whatever screen the editor is on — AI drafts from material, write
it myself, paste a finished story. It is mounted once by the shell, so every desk screen has it.

### The left rail has its own "+ New story", at the top of the nav

Above **Today**, **Queue**, **Drafts** and the rest, the rail now carries the same control the phone
bar does, in the same yellow: **+ New story**, opening the same dialog. On the rail the drawer closes
first, so the dialog does not land behind it.

### A row's More ▾ no longer disappears behind its own list

The menu now hangs from the row's top edge when there is less room below it than the menu is tall, so
the last row of a list gets the whole menu on screen instead of its top border. The four lists that
clip — the Queue's leads, the published list, the scan history and the sources section — stop clipping
while one of their menus is open. Measured at 1280×900 on a six-lead list: the first row's panel and
the last row's panel each hit their own row **7 of 7** (it was 0 of 7 for the last row).

## What changed under it

Four screens' worth of mounting and nothing else: `desk.queue.tsx`, `desk.index.tsx`,
`desk-chrome.tsx`, and the row itself in `desk-leads.tsx`. The row's `more` prop was a caller-supplied
list; it is now four named slots — Hold, Send to Dark Desk, an AI follow-up and Kill, each a handler
the screen owns — because the drawn menu puts **Merge with a printed story** between two rows a caller
could not reach into, and that row owns its own press. A screen that passes none of the four renders
the row it rendered before.

`HoldLeadDialog` and `DarkFileDialog` are mounted **once per page** and re-pointed at the lead that was
pressed, so a Queue with 200 rows does not carry 200 shut dialogs. Hold's `onDone` invalidates
`["leads"]`, because `holdLead` writes server-side and returns and the dialog reaches the query cache
nowhere — without it the row a menu just held would sit in the open list until a reload.

`#file-lead` stays on the legacy form. Eleven fixtures and walks build their whole setup through that
exact hash.

## Limits

**Kill does not open a dialog yet.** The drawn **Kill this lead** — quick fills, a reason in your own
words, a link — is phase 2b's, and the brief for this unit defers it. The **Kill X** button and the X
key keep today's immediate write, and the single marker
`// TODO(BN2): mount KillDialog from phase 2b` sits inside `killLead`, where the press lands.

**Edit the lead** is the sixth drawn lead-menu row and is not drawn: nothing in this app edits a lead,
so a row that only said so is left out rather than half-wired.

**Merge with a printed story** is drawn, but only for a lead that has a possible duplicate, and its
press is the desk's own duplicate resolution — the Compare panel's **Same story — kill this one**,
whose server path is `resolveLeadDuplicate` behind `leadDuplicateResolutionInput`. The row is the
drawing's; the button keeps the word the press actually does, because a press called **Merge** that
closed the lead would promise an update to the printed piece and do the opposite.

**A row's More ▾ panel was clipped by its own list** — the panel opened only downward while
`.lead-list` is `overflow: hidden`, so on a short list the lower rows painted past the list's bottom
edge and could not be pressed (six leads: the last row's panel hit its own row **0 of 7**). Fixed in
the follow-up unit: the menu hangs upward when it does not fit below, and the four clipping lists stop
clipping while a menu is open.

**No model was called, and the browser pass pressed no primary that would start one.** Add-a-lead
defaults to **Research and score it** and New story's primary is **Start drafting**, so both were
opened, photographed and closed again unsubmitted. The evidence's leads were filed through the legacy
model-free form.
