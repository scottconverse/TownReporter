# Screenshot provenance

The 27 PNGs in this folder were captured on 2026-11-18 from commit 9d6a5c7e (origin/main). They were captured on a throwaway headless instance with an in-memory PGlite database and made-up test data. Nothing came from the live paper or the Test server.

- The town is "Testerville, Wyoming", the paper is the "Testerville Ledger", and the editor is "Dana Whitaker". All made up. Web addresses and email addresses use example.invalid.
- No model was called. The test environment has no keys and no logins.
- Viewport: 1440 px wide. 20-registry-phone.png is 375 px wide (top 1591 px). Taller viewports: 07 at 1100 px, 14 at 1700 px, 15 at 1400 px, and 21 to 25 at 1000 px. 18 and 19 are full-page. 28 is a crop of the front page.
- Desk shots use the dark desk theme. Public shots use the paper's default reader theme.
- There is no 03 file. The numbering skips it.

**Retaken 2026-11-24:** 18, 20, 29 and 30 show the redesigned Community resources page (PR 435, commit f2f84b3a). They were captured on a throwaway in-memory instance with 12 made-up Testerville services, signed out, in the paper's default light theme. 29 and 30 are new. The other 25 images are from the 2026-11-18 capture. The page's category chips, the 911, 988 and 2-1-1 row and the cards are in 0.7.1.

## Hidden on purpose

These items come from the test environment and were hidden for the capture:

- The orange "Ollama is not running" box on the desk shots.
- The red "This desk cannot write yet" box on 10-opinion.png.
- The red detail line under "Close in meaning" on 15-find-evidence.png (a blocked download of the meaning model). The line above it, "Search by meaning is not available now. The exact-words list still works.", is real and stays.

11-server.png and 16-model-picker.png show models as "Not ready" because the throwaway copy has no keys.

## Repaired

06-queue.png, 26-queue-start-n.png and 24-desk-registry-verification.png had a half-cut line at the top of the page. It was replaced with blank page background. The top of the sidebar in 06 and 26 was restored from 04-desk.png, and in 24 from 21-desk-registry-import.png. The pixels are identical to the originals.

## Images

| File | Route | What it shows |
| --- | --- | --- |
| 01-front-page.png | / | Public front page: the lead council story, two more stories, the top-stories list and the Community resources banner |
| 02-article.png | /articles/water-rates-rise-4-percent-for-east-side-customers-in-january | Top of a published story with the contents list and the dates box |
| 04-desk.png | /desk | Editor desk, Today, with 15 new leads and 5 drafts in Tonight's edition |
| 05-scan.png | /desk/scan | Scan history table (3 runs) and the start of Run a scan |
| 06-queue.png | /desk/queue (scrolled 440 px) | Queue model and effort pickers, filters and the first lead rows |
| 07-story-editor.png | /desk/story/44 | Story workbench: checks tab, writer picker, headline, publish bar |
| 08-dark-desk.png | /desk/dark | Dark Desk open files, signals to review, a set-aside file, and the Decide panel for the selected file |
| 09-dark-dials.png | /desk/dark, Settings open | "How hard to dig": digging model, thinking effort, Quick, Standard and Deep |
| 10-opinion.png | /desk/opinion (scrolled) | Opinion: AI editorial and file-one-you-wrote cards, and Requests & editorials |
| 11-server.png | /desk/ops | Server: Writing models list and Health |
| 12-published.png | /desk/published | Published list with views and corrections, newest first |
| 13-paper-setup.png | /desk/ops/paper-setup | Paper setup form |
| 14-today-in-town.png | /articles/routine-today-2026-11-18-1 | "Today in town" routine edition with the sources panel and corrections |
| 15-find-evidence.png | /desk/story/44, Sources tab, search "Riverside pool" | Find evidence with 3 exact-word hits and 0 close in meaning |
| 16-model-picker.png | /desk/story/45, Model & research open | Redraft settings: model picker on Automatic with the ladder text, thinking effort |
| 17-drafts.png | /desk/drafts | Drafts list: 5 AI drafts, an opinion piece waiting, Publish all drafts |
| 18-registry-search.png | /registry?q=help (signed out) | Public Community resources search with 2 results |
| 19-registry-service.png | /registry/8 (signed out) | Public service page: details, eligibility, hours, places, sources, verified date |
| 20-registry-phone.png | /registry (signed out, 375 px wide, top 1591 px) | Community resources at phone width: the 911, 988 and 2-1-1 row, stacked filters, chips and the top of the first card |
| 21-desk-registry-import.png | /desk/registry (scrolled to Import a directory file) | Import preview: counts for new, unchanged, changed and already waiting, and the list of differences. Nothing imported |
| 22-desk-registry-editor.png | /desk/registry, All details for Weekly grocery pickup | The entry editor: service details and the start of the organization details |
| 23-desk-registry-changes.png | /desk/registry (scrolled to Detected changes) | Detected changes with filter tabs and the Accept and apply, Accept without applying and Reject buttons |
| 24-desk-registry-verification.png | /desk/registry, All details open (scrolled to Verification) | Verification section with the latest and older checks and the Record verification form |
| 25-desk-registry-needs-checking.png | /desk/registry (scrolled to Needs checking) | Needs checking: never verified, older than 180 days, changed since verified |
| 26-queue-start-n.png | /desk/queue, 4 leads ticked (scrolled 440 px) | Queue bulk bar: 4 selected, model pickers, Start 4 stories, Hold, Kill, Delete selected, Clear |
| 29-registry-list.png | /registry (signed out) | Redesigned Community resources page: 911, 988 and 2-1-1 row, search, category chips and 12 service cards |
| 30-registry-phone-search.png | /registry?q=food (signed out, 375 px wide, top 1591 px) | Redesigned page on a phone after a search for food |
| 27-drafts-bulk.png | /desk/drafts, 3 drafts ticked | Drafts with ticked boxes, Publish 3 selected and Kill 3 selected |
| 28-front-around-region.png | / (signed out), crop of the page from y 740 to 1440 | Front page Community resources banner, an Opinion card and the Around the region band |

## Notes

- **Test data in the database:** one imported directory, "Testerville services" (4 organizations, 7 services, 4 places), published. A second import with changed rows left 6 detected changes (2 accepted, 4 waiting). Three checks were recorded, one backdated 200 days, so Needs checking has entries to show. The queue holds 16 leads, with 5 AI drafts.
- **23-desk-registry-changes.png:** the field name "application_process" is the app's own wording.
- **Rows were inserted** through the control SQL or the app's own desk actions.

## Refresh

Re-capture when a released UI change makes an image misleading. Use a throwaway instance on the release commit with made-up data. Never capture from the live paper.
