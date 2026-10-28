# Dark Desk — the screen contract (0.6.84)

This page is the contract for the Dark Desk screen at `/desk/dark`: what an editor must be able to do there, in what words, and what the page must never do. It is for anyone changing that page and for anyone who wants the screen in a few minutes. How to use it is in [the manual](manual.md#dark-desk). The doctrine behind it (what Dark Desk is allowed to think, and the limits of what it says) is [dark-desk.md](dark-desk.md). The design spec the screen was built from is `docs/design/dark-desk-2026-10-07/01-DARK-DESK-SPEC.md`; the screen was rebuilt to that spec in 0.6.84 and replaced the earlier piles and dials.

The earlier 0.5.1 brief, with its three piles (**To look at**, **On the desk**, **Set aside**) and its Dig and Nerve sliders, no longer describes the screen. Those words are gone from it.

## What Dark Desk is

A place for investigations: questions that need digging before anyone knows whether there is a story. An editor gives it a question and a starting point. It searches, fetches, keeps copies of what it reads, follows names and attachments, writes a case file, and then argues against its own findings. **It never publishes.** The only way a result reaches readers is **Send to the queue**, which files an ordinary lead; that lead goes through the normal draft, check and Publish steps.

Unknown, weak, speculative and previously dead trails stay investigable. Do not add gates, confidence scores, source-quality filters or “is this worth it?” checks to discovery.

## What an editor must be able to do

Open the page and answer, without knowing the implementation:

1. What looks interesting today? (**Signals to review**)
2. What am I already working on? (**Open files**)
3. What happens if I press **Open the file**?
4. Is it running? What is it doing right now?
5. What has it found so far, and where do I read those pages?
6. What is still unread, and what is deferred?
7. What should I do next?

If any answer needs database language, the screen is not done.

## Layout

- **Header:** “Investigations · nothing here prints on its own”, the title **Dark Desk**, and two buttons: **Settings** and **+ Start a file**.
- **Two columns** when the content is 900 px wide or more: a rail on the left, the open file on the right. Narrow screens stack them.
- **The rail** has four piles, always in this order: **Open files**, **Signals to review**, **Waiting on an AI follow-up** and **Set aside**, each with a count. Five rows show at first, then **Show all N**. At the foot is **Check r/<name> for signals**.
- **The open file**, top to bottom: **The question** (and **More file actions**: **Set aside**, **Pull back**, **Start another AI follow-up**); the **ordinary explanation to rule out**; the **Digging model for this file**; a live card while a round runs, with the stages **Question**, **Gather**, **Case file** and **Challenge** and a red **Stop**; the read-only **Scope**, **Depth** and **Limit** boxes; **Activity** beside the **Case file**; the **Decide** buttons; and **The file’s records ▸**.
- **Decide** offers **Keep investigating**, **Start an AI follow-up**, **Wait and watch**, **Send to the queue** and **Close: no finding**. Under them the page says: “Nothing here prints. ‘Send to the queue’ files a lead for you to review.”

## Rules the screen keeps

- **A stop is not a failure.** A research round is a short batch, then a stop. Remaining pages stay on the file. The note says it is normal and not “too many leads”; **Keep investigating** reads the next batch.
- **The reading list comes first.** **What to read** is every captured page, opened in place with **Open original**, **Previous** and **Next**. **Still to pursue** is the open and deferred trails (“Saved for a later run; this lead was not rejected.”), not the reading list. Empty sections stay hidden until they have content.
- **Starting a file starts the first round.** There is no separate start-digging press. A failed start says so on the page.
- **Do not send an editor to the public `/evidence/…` pages** for unpublished captures. Those pages show only records cited in a printed story.
- **Warnings warn.** Starting, continuing, retrying, sending to the queue and checking Reddit open **Before you continue** with one “anyway” button when the paper is not set up, a round is running on another model, or an hourly cap is passed. The one hard stop is the Reddit check’s limit of six an hour.
- **Undo exists** for **Set aside**, **Close: no finding** and **Send to the queue**, for about ten seconds.
- **Appearance follows the desk.** Dark Desk obeys the same **Dark / Light** and **Aa Large** choices as every other desk screen.

## Language

Plain English everywhere. These words must not appear in the screen: “hop”, “frontier”, “research budget”, “artifact” (say record, page or document), “heuristic”, “synthesis”, raw URLs as headlines, and raw error dumps. The screen rewrites “artifact” to “record” and “hop” to “step” on its way out and replaces dollar amounts with “[amount omitted]”. Copy lives in `src/lib/news/desk-copy.ts`; keep engine strings out of the page.

A few older messages still say “Keep digging” where the button now says **Keep investigating**. Treat those as copy to fix, not as a second button.

## Files

| File | Role |
|---|---|
| `src/routes/desk.dark.tsx` | The page |
| `src/lib/news/desk-copy.ts` | Editor-facing words |
| `src/lib/news/dark-screen-copy.ts` | Rewrites engine words on their way to the screen |
| `src/lib/news/dark.ts` | Server functions: list, open, continue, set aside, pull back, send to queue |
| `src/lib/news/investigate.ts` | The engine. Do not redesign it from the page |
| `src/components/dark-dials-panel.tsx` | **Settings → How hard to dig**: Digging model, Thinking effort, default depth |
| `src/components/page-watch-panel.tsx` | **Settings → Watched pages** |
| `src/components/investigation-brief.tsx` | The brief card |
| `src/components/desk-chrome.tsx` | The desk frame |

Visual language: the desk’s Astra look, newsprint cream and ink, one yellow accent, no emoji.

## What was wrong before, and is fixed

- Counts with no reading list (“34 records on file” with nothing to click).
- Cards that stayed in the inbox after work started.
- Status that sounded like a crash when a round simply ended.
- Empty sections crowding the file.
- Debug-shaped copy leaking through: URLs, hop dumps, “REOPENED”.
- A page that felt like an inspector with buttons rather than a desk.

Keep the path **evidence → reading → next action** hardened. Do not hide curiosity. Do not overclaim in public.
