# Appendix: how the editor reaches Dark Desk, and where it leads

## Ways in

| # | Where | Control | What it does |
|---|---|---|---|
| 1 | **Side menu** (every desk page) | "Dark Desk", with a count on the right | Opens `/desk/dark`. The count is the number of open files plus signals to review. On phone it is in the **Menu**. |
| 2 | **Today → right rail** | The Dark Desk panel: the piles with counts (Open files, Signals to review, Waiting on an AI follow-up), then **Open Dark Desk** | Opens `/desk/dark` with the most recent file open. This is the only Dark Desk door on Today (spec gap 23). |
| 3 | **A lead's More ▾** (Today, Queue, story page) | **Send to Dark Desk** | Opens the "Start a Dark Desk file" pop-up, with the lead's title as the question and its link as the starting point. The lead leaves the open list. |
| 4 | **Today's wire / signals** (build: `desk.index.tsx`) | **Start from a tip** → `/desk/dark`; **Start digging** on a suggested item | Opens the pop-up with the tip filled in. |
| 5 | **Legal removals** (owner) | **Open Dark Desk to review these files** | Opens `/desk/dark` filtered to files that reference the removed story, so they can be closed or cleaned. |
| 6 | **Running now / job card** (Today and the rail's Running box) | **Open file** on a finished Dark Desk run | Opens `/desk/dark` with that file selected. |
| 7 | **Command bar** (⌘K) and **keyboard** | Type "Dark Desk", or "Start a Dark Desk file" | Goes to the page, or opens the pop-up. |

## Ways out

| From Dark Desk | Goes to | Notes |
|---|---|---|
| **Send to the queue** | `/desk/queue` (new lead) | Toast: "Filed to the Queue · Open the lead →". The lead links back to its file. |
| **Start an AI follow-up** | The New AI follow-up pop-up, then `/desk/follow-ups` | The question is filled in from the file. The file moves to "Waiting on an AI follow-up". |
| **Open the lead →** (on a file already queued) | `/desk/story/<leadId>` | |
| **Review Sources** (from a signal) | `/desk/sources` | |
| **Settings → Dark Desk research model** | `/desk/models` | Changes which model runs Dark Desk. The default is the "Dark Desk research" row. |
| **Open original** (in the record reader) | The source URL, in a new tab | |

## Related settings elsewhere

- **Models → Who does what → "Dark Desk research"** sets the first choice, the effort and two fallbacks. The design defaults to Claude Opus · max, then Codex, then the Claude API.
- **Server → Time budgets** sets the per-call time limits that apply to Dark Desk runs.

## Never

- **No path from Dark Desk to Publish.** A Dark Desk result reaches readers only as a queued lead that the editor drafts, checks and publishes like any other story.
