# Next TownReporter patch — unreleased (Unit BW, redesign lane 3: the mounts land on 0.6.76)

**State:** Candidate work in progress. This document does not assert a release, tag, GitHub
publication, production deployment, or a promoted candidate. Unit BN and BN2 built the mounts against
an older tree; 0.6.76 has since shipped phases 2a, 2b and 2c to main. This unit merges the two, so
every mount BN/BN2 built and everything 0.6.76 shipped are both on the branch, and spends the one
`TODO(BN2)` marker the redesign left behind: the drawn **Kill** dialog. No migration, no new server
function, no model called.

## What an editor sees change

### Kill opens the drawn dialog on Today and on the Queue

This is the one press the redesign had left writing a status outright. **Kill X** on a Today row, the
**X** key, and the Queue row menu's **Kill with a reason** all open the same drawn **Kill this lead**
dialog (`dialog-09-kill.png`): four quick fills — **Not news**, **Already printed**, **Outside our
area**, **Bad source or unreadable** — a reason in your own words, and a link. **Kill with this
reason** is refused while the reason box is empty; **Kill, no reason** always works. **Cancel** keeps
the lead and keeps what you typed.

That dialog is the same component the story page (`/desk/story/$leadId`) has mounted since phase 2b,
mounted once per page and re-pointed at the row that was pressed, so a Queue of 200 rows does not
carry 200 shut dialogs. On Today the row still shows **Killed** with its **Undo U** afterwards, which
is what the drawing asks for; **Undo** stays on the row rather than moving into the dialog.

The reason lands in the fields `setLeadStatus` already keeps (`leads.kill_reason`,
`leads.kill_reason_url`, migration 0094) — the same record the Queue's own **Kill as duplicate** has
been writing. A kill from a Today row writes it too now, where before the reason was lost.

### The rest of the mounts are unchanged, and so is everything 0.6.76 shipped

**+ Add a lead** and **+ New story N** on Today, the left rail's own **+ New story**, the H key and
Today's **Hold H**, the Queue row menu's **Hold with a reason** / **Send to Dark Desk** / **Merge with
a printed story**, and the row More ▾ panel that opens upward are all exactly as unit BN/BN2 left
them. So are 0.6.76's own changes: the drawn left nav with live counts, the Queue's
**Open / Held / Killed / ≈ Printed / All** segments and bulk strip, the batch panel with its
**Dismiss**, the story workbench's **Lead / Draft / Check / Publish** stepper with **Redraft** and the
sticky publish bar, and the legal-removal notice. Nothing from either side was dropped.

## What changed under it

`git merge origin/main` (45b8d3ed, live 0.6.76) into the mount branch. Three files conflicted, and all
three resolutions are unions:

- **`editor-dialog-forms.ts`** keeps BN2's `darkFilePrefill` / `darkFileSeed` — a lead row knows its
  headline and where the story came from — and main's `darkFileFromSeed`, which is the paste an
  import's review screen hands over. They are two different callers of the same dialog, so both
  factories stay.
- **`editor-dialogs.tsx`**'s `DarkFileDialog` now takes `prefill` *and* `seed`. A `seed` wins when a
  caller passes both: it already carries a question and the material, which is what a `prefill`
  supplies as two separate fields. The reseed factory is memoized on the seed and on the prefill's two
  strings, so an inline object literal cannot hand the dialog a new factory every render.
- **`dark-file.test.ts`** keeps both suites: BN2's prefill tests and main's seed tests.

`docs/releases/next-BN.md`'s **Limits** paragraph that said kill mounted no dialog is corrected rather
than left to contradict the code.

## Limits

**Kill still has no Undo inside the dialog.** The drawing's footnote says "the X key opens this" and
puts Undo on the row; the keyboard badge is left off the dialog rather than advertised, because a
badge for a key that does nothing is a lie to the reader, and Undo stays where the drawing puts it —
on the row.

**Merge with a printed story is still the Compare panel's duplicate press**, not a merge: the row's
word is the drawing's, the button keeps the word the press actually does. Unchanged by this unit.

**Phase 2c's screen work and the redesign's front page are other units'.** This unit touches no
front-page file (`src/routes/index.tsx`, `src/components/paper-chrome.tsx`); another worker holds
those.
