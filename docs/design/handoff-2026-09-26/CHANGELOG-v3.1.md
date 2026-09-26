# v3.1 fixes (on top of v3)

These are the 4 leftovers from the developer's v3 check. Drop these files over the v3 package at the same paths.

| # | Fix | Files |
|---|---|---|
| 1 | The story page’s context line (“Story from lead · Housing · score 14”) now sits on its own row under the top bar, so it’s never cut off. | `design/Desk Story.dc.html`; captures desk-04, desk-05, desk-06 |
| 2 | Queue: the Search, Sort and Section controls stay on one row, and the yellow bulk bar has its own row below them with a 12px gap, so Section is never covered. | `design/Desk Screens.dc.html`; captures desk-07, desk-08 |
| 3 | The Ask-AI footer says results land in **Suggested sources** (it said “Proposed”). KICKOFF says the same. No “Proposed” remains in any prototype or doc. | `design/Desk Dialogs.dc.html` (line 129), `KICKOFF.md` |
| 4 | The correction dialog now shows a **Preview · the note as readers will see it** block before posting, matching the live app. Nothing posts until you press Post. | `design/Desk Dialogs.dc.html`; capture dialog-14 |

All 12 prototypes still load, and the retaken captures were checked by eye.
