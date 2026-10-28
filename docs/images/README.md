# Screenshot provenance

The 16 PNGs in this folder were captured on 2026-10-27 for release 0.6.84, from the throwaway Test server (a copy of the production paper with its own database) running commit d5a9ca04. They were not captured from the live paper.

- Viewport: 1440 px wide.
- Captured with headless Chromium via Playwright scripts kept outside the repo at `C:\Users\scott\Desktop\Code\townreporter-test\walks\docs-shots\`.
- Signed in as the Test copy's editor account through the normal sign-in page. The Test server's orange "test copy" bar was hidden in the shots so they show the app as an operator sees it.

| File | Route | What it shows |
| --- | --- | --- |
| 01-front-page.png | / | Public front page, lead story is the "Today in town" edition |
| 02-article.png | /articles/longmont-water-meets-all-federal-and-state-standards-in-2025-city-report | Top of a published story |
| 04-desk.png | /desk | Editor desk, Today, with 3 drafts in Tonight's edition |
| 05-scan.png | /desk/scan | Scan history table and Run a scan |
| 06-queue.png | /desk/queue (scrolled 440px) | Queue filters and lead rows |
| 07-story-editor.png | /desk/story/441 | Story workbench: checks warnings, writer picker (DeepSeek), headline, publish bar |
| 08-dark-desk.png | /desk/dark | Dark Desk open files and a selected file (Pizza Festival) |
| 09-dark-dials.png | /desk/dark, Settings open | "How hard to dig": digging model, effort, Quick/Standard/Deep |
| 10-opinion.png | /desk/opinion (scrolled) | Opinion: AI editorial, file one you wrote, Requests & editorials |
| 11-server.png | /desk/ops | Server: Writing models ladder (no Gemini in Automatic order) and Health |
| 12-published.png | /desk/published | Published list, newest is Today in town |
| 13-paper-setup.png | /desk/ops/paper-setup | Paper setup form |
| 14-today-in-town.png | /articles/routine-today-2026-10-27-1 | "Today in town" routine edition, cropped above the footer |
| 15-find-evidence.png | /desk/story/441, Sources tab | Find evidence panel, search "Oligarchy Ditch" |
| 16-model-picker.png | /desk/story/468, Model & research open | Shared picker, Automatic selected, ladder text shown |
| 17-drafts.png | /desk/drafts | Drafts list, 3 AI drafts |

## Notes

- **08-dark-desk.png**: one Dark Desk file title was pixelated because it named a real local candidate.
- **14-today-in-town.png**: the Test copy had no Today in town edition, so routine editions were switched on for the Library source on `/desk/ops/routine-notices` and one queued run was inserted (the Test server's scheduler is off); the normal job runner then built the edition. Test database only. The events are real library events for Oct 27.
- The AI drafts in 04, 07 and 17 were written by DeepSeek v4.1 Flash (1017) on the Test copy.
- **15-find-evidence.png** shows "Close in meaning (0)" because the Test copy's background clock was off, so no meaning vectors had been built. On a running paper that column fills once the meaning index is built.
- **16-model-picker.png** shows the shared picker set to Automatic, with the ladder text.
- **11-server.png** shows rank numbers 1, 2, 3, 5 in the Writing models list; the gap at 4 is a known cosmetic bug (findings row G27-DOC-4).

## Refresh

Re-capture when a released UI change makes an image misleading. Run the scripts against a Test server refreshed to the release commit. Never capture from the live paper.
