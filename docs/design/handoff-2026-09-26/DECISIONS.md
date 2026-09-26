# Locked decisions (owner, 2026-09-26)

These are settled. Don’t reopen them without the owner.

## Public paper
- **Direction:** Neighborhood Daily. Rejected: Open Record (ProPublica-like), Ledger (broadsheet) and a Modernist red grid.
- **Layout:**
  - yellow top bar, bold grotesque masthead with a town tag
  - geography pills in the order Longmont · Nearby · Boulder County · Colorado
  - lead + “This week” calendar, a 3-column ruled story grid, Around the region, a yellow Opinion block and a dark footer
- **Article page:**
  - jump links
  - a “Dates in this story” panel
  - “How we reported this” source cards
  - Corrections next to Share
  - Keep reading
- **Type:** Bricolage Grotesque (display/UI) and Literata (body).
- **Accent:** yellow `#ffd23f` in light, `#e6c35c` in dark. Text on yellow is always `#111`. Rejected accents: tomato, sky, mint, lilac.
- **Light ground:** Cream `#fffdf7`. Rejected: white, newsprint, cool gray, butter.
- **Dark ground:** Warm black `#1b1916` (panels `#27231f`, rules `#3b3631`, text `#e8e6e1`, secondary `#bdbab3`). Rejected: charcoal and slate. Never pure black and white.
- Light is the default; dark follows the system setting and the reader toggle.

## Editor’s desk
- Same visual family as the paper; dark is the default.
- **This replaces the repo’s earlier “black background, white text” desk rule.**
- **Operating model:** one human editor. AI does all production work, and the editor is the gate to publication. No human reporters, source calls or FOIA/CORA requests.
- **Structure:** a daily run of Pick leads → Draft → Check → Publish, with Tonight’s edition, Running now, the lead queue and a rail (Follow-ups, Dark Desk, Wire).
- **Every action is a real button.** Primary is yellow, secondary is outlined, danger is a red outline.
- **Every long job shows its progress:** stage, current step, elapsed time and last activity. It flags a stall after 60s of silence, and failures give the real reason.
- **The editor has full control:**
  - edit any AI output directly
  - write or paste a story without AI
  - add a lead from a link or tip
  - add to a story
  - redraft with instructions
  - choose a headline from suggestions, keep yours or type a new one
- **Hold and Kill always ask,** with an optional reason and a “no reason” button. The keyboard shortcuts open the same dialog, and Undo stays on the row.
- **Follow-ups are AI agents** (re-check pages, search records, watch agendas), not a list of people to call.
- **Models page:** a model, effort level and two fallbacks per job, plus a view of every connection (frontier API, subscription sign-in, local LM Studio/Ollama, Ollama Cloud, remote). Grok stays retired.
- **Stats** is aggregate only: no cookies, no browser storage, no stored IPs, no cross-day identifiers. It keeps “Section chosen by hand” and Saved reports, and adds live readers, reading time, scroll depth, sources, city-level location, hour-of-day and trust signals.

## Added in v3 (from the developer review, 2026-09-26)
- **Legal removal (owner, 2026-09-06):** keep a sealed, owner-only copy of the removed text, deleted automatically after 12 months. If the reason is a court order to destroy, keep nothing. The editor picks which rule applies before confirming, and the final button uses the danger style.
- **No human “seek a response” step anywhere.** On Dark Desk it becomes “Start an AI follow-up”, and the pile is “Waiting on an AI follow-up”.
- **Keep the app’s shipped behavior** where 0.6.69 and 0.6.70 already built it: Kill moves the lead to Killed with its reason and link; corrections have Suggest wording, a plain note, and “fix the story text” off by default; the list is called Suggested sources; all 12 Server panels stay; the style check lives under Checks.
- **Text size:** two sizes, Normal and Large, and Large scales headlines and deks too.
- **Selection marker:** ink in light mode and gold in dark (`--sel`), because yellow on cream is only 1.42:1.

## Rules kept from the repo
- WCAG AA in both themes.
- Nothing informational under 14px; 44px tap targets.
- One button, chip and notice family.
- Quiet styling never carries meaning alone.
- “Checked, nothing changed” must look different from “could not check.”
- The editor can pick the model anywhere the AI acts.
- The paper never loads or unloads a local model.
- Redrafts never replace the editor’s headline.

## Explicitly not wanted
- The Modernist design system as a default or global stylesheet.
- Pure black dark mode.
- Keyboard-only destructive actions.
- Tracking individual readers.
