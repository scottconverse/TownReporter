# Dark Desk — editor UI brief (for design)

This is the signed-in investigative desk at `/desk/dark`. It is **not** the public paper and **not** the reporting queue.

A designer is coming in because the current page is still not a usable newsroom surface. This note is the contract. Do not treat it as finished UI.

## What Dark Desk is

A recursive research engine. An editor points it at a person, document, URL, rumor, or gap. It searches, fetches, captures copies, and follows names and attachments. **It never publishes.** Publication is a separate human action on `/desk/queue`.

The engine is off-limits for this redesign. Do not add gates, confidence scores, source-quality filters, or “is this worth it?” checks to discovery. Unknown, weak, speculative, and previously-dead trails stay investigable.

## What an editor should be able to do

Open the page and answer, without knowing the implementation:

1. What looks interesting today?
2. Why might it matter?
3. What happens if I click Start digging?
4. Is it running?
5. What has it found so far — **and where do I read those pages?**
6. What is still unopened?
7. What should I do next?

If any of those require database language, the UI is not done.

## Three piles

| Pile | Meaning | Primary action |
|---|---|---|
| **To look at** | New material. Nobody has opened it yet. | Start digging |
| **On the desk** | Started. Includes files that stopped because there is more to read. | Open file / Keep digging / Set aside |
| **Set aside** | Parked or finished. Nothing is deleted. | Pull back / Read |

Start digging **moves** a card from To look at onto the desk. Close file leaves it on the desk. Set aside files it. Pull back restores it.

A research round is a short batch, then a stop. Remaining pages stay on the file. That stop is not a failure and not “too many leads.” Keep digging reads the next batch.

## Open file

The open file is the work surface. The reading list comes first.

**What to read** = pages and documents Dark Desk already captured. Each item needs a human title, a short excerpt, Open original, and Read captured copy.

**Still unopened** = names and links mentioned in those records that have not been fetched yet. That is not the reading list.

Empty editorial sections (What we know, What we’re testing, Open questions) stay hidden until they have content.

Do not send an editor to the public `/evidence/...` routes for unpublished captures. Those pages only show records cited in a printed story.

## Language

Plain English everywhere. Banned in the UI:

- hop / hops
- frontier
- research budget
- artifact (say record / page / document)
- heuristic
- synthesis
- raw URLs as headlines
- raw TypeError / API dumps

Copy lives in `src/lib/news/desk-copy.ts`. Keep engine strings out of the DOM.

## Files

| File | Role |
|---|---|
| `src/routes/desk.dark.tsx` | The page |
| `src/lib/news/desk-copy.ts` | Editor-facing words |
| `src/lib/news/dark.ts` | Server functions (list, open, continue, park, pull back) |
| `src/lib/news/investigate.ts` | The engine. Do not redesign. |
| `src/components/desk-chrome.tsx` | Desk shell, night theme, buttons |
| `src/styles.css` | Tokens (paper, ink, rust, blush) |
| `screenshots/dark-desk-qa.png` | Recent capture of the page |

Visual language already on the product: letterpress / newsprint. Cream paper `#F6F1E7`, ink `#1C1410`, rust `#9B2915`. Dark Desk uses the inverted night desk (ink ground, paper type). One accent. No emoji. No second brand.

## Known pain (why a designer is here)

- Counts without a reading list (“34 records on file” with nothing to click).
- Cards that used to stay in the inbox after work started.
- Status that sounded like a crash when the round simply ended.
- Empty sections crowding the file.
- Debug-shaped copy leaking through (URLs, hop dumps, “REOPENED”).
- The page still feels like an inspector with buttons, not a desk.

Harden the path **evidence → reading → next action**. Do not hide curiosity. Do not overclaim in public.
