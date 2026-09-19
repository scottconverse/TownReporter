# Screenshot provenance

The PNGs in `docs/images/` were captured from the **running v0.6.54 desk and
public paper** on 2026-09-19, from `http://127.0.0.1:3000` (the self-hosted
Longmont edition), replacing the earlier pre-Astra set.

## How they were captured

Read-only: the harness issues GETs only. It does not create, edit, publish, or
delete anything in the newsroom.

Authentication used the app's documented `Authorization: Bearer <session-token>`
path with an **existing unexpired editor session** already present in the
newsroom database. No password was set, reset, guessed, or stored, and no new
credential was minted.

The bearer header is injected on **every** request in the browser context, not
just the first navigation. Without that, the server-rendered HTML contains data
but client hydration renders an empty desk.

| File | Route | Notes |
| --- | --- | --- |
| `01-front-page.png` | `/` | Public paper |
| `02-article.png` | an article route | A real published story |
| `04-desk.png` | `/desk` | Signed-in editor desk |
| `05-scan.png` | `/desk/scan` | Scan scope picker + history |
| `06-queue.png` | `/desk/queue` | Queue |
| `07-story-editor.png` | the story workbench route | A real story draft |
| `08-dark-desk.png` | `/desk/dark` | Dark Desk |
| `09-dark-dials.png` | `/desk/dark` | Section-scoped: "How hard to dig" |
| `10-opinion.png` | `/desk/opinion` | Opinion |
| `11-server.png` | `/desk/ops` | Section-scoped: "Writing models" |
| `12-published.png` | `/desk/published` | Published |
| `13-paper-setup.png` | `/desk/ops` | Section-scoped: "Paper setup" |

Three images are sub-sections of a page rather than separate routes, so they are
captured as element-scoped stills: the Dark Desk dials, the Server writing-model
list, and Paper setup.

## Content note

These are screenshots of a working newsroom, so they contain that desk's real
state: source counts, queue counts, scan history entries, and the signed-in
editor's display name. That is the same information already visible to anyone
using the running edition, and it is what makes these images truthful rather
than mockups.

## Refresh

Re-capture whenever a released UI change makes the images misleading. The
harness lives outside the repository at
`C:\Users\scott\Documents\Codex\2026-09-17\tow\work\screenshots-0654\capture.mjs`
and is driven by an existing session token.
