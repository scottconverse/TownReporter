# Next TownReporter patch — unreleased (Unit BN, redesign lane 3: the dialogs reach the screens)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub
publication, production deployment, or a promoted candidate. Phase 4 built nine dialogs and mounted
none of them; phase 6 built the AI follow-up rail and mounted none of it. This unit mounts them on
Today, the Queue and the nav. No migration, no new server function, no model called.

## What an editor sees change

### Today's "+ Add a lead" is the drawn dialog

It was a link to the Queue's legacy `#file-lead` form. It now opens **Add a lead** in place: a link or
a tip, why it might matter, and the **Then** choice. That legacy form still exists at
`/desk/queue#file-lead` and still opens where it did.

Today's own **+ New story N**, **+ Opinion** and **Start story S** are unchanged, and the story
composer behind **+ New story** is still where it was (`/desk#story-composer`).

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

## What changed under it

Four screens' worth of mounting and nothing else: `desk.queue.tsx`, `desk.index.tsx`,
`desk-chrome.tsx`, and eight lines in `desk-leads.tsx` that widen the row's `more` prop from
`{label, onSelect}` to the menu's own item type, so a screen can add a row that owns its own dialog
(the AI follow-up button does). Widening is additive; every existing caller passes the same two fields
it passed before.

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

**Edit the lead** and **Merge with a printed story**, the drawing's other two lead-menu rows, are not
built anywhere in the app: no dialog exports them and no screen reaches them. They are named as open
questions rather than half-wired.

**A row's More ▾ panel is clipped by its own list.** Measured on the running app: the panel is 414 px
of seven rows opening downward (`top: calc(100% + 6px)`), while `.lead-list` is `overflow: hidden`, so
on a short list the lower rows paint below the list's bottom edge and cannot be pressed. With six leads
in the list the first row's panel is complete and all seven rows are clickable, and the last row's
panel opens with only its top border inside the clip. The defect is older than this unit — the draft
block it also cuts was already past the edge — and this unit's two added rows are two more rows that a
short list loses. The fix is one line of shared CSS and belongs to whoever owns the list rule.

**No model was called, and the browser pass pressed no primary that would start one.** Add-a-lead
defaults to **Research and score it** and New story's primary is **Start drafting**, so both were
opened, photographed and closed again unsubmitted. The evidence's leads were filed through the legacy
model-free form.
