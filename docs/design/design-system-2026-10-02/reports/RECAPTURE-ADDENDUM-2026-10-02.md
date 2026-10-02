# Recapture addendum (2026-10-02)

This covers the 52 recaptured screens: the story tabs at 1024, 1280 and 1440 in light and dark, every desk screen at 1024 in dark, and the story with no draft. All of them are signed in, so they can be judged. The addendum adds to `DESIGN-VS-BUILD-REPORT.md` and `DESIGNER-ANSWERS-2026-10-02.md`.

## Confirmed by the recapture

- **B2, story type:** on every story capture, the headline is at about weight 500 and the story text is set in Bricolage. Fix as written.
- **B3, Opinion:** the rows are still centered at 1024. Failed rows also show raw markdown (`**residents of one city deal with d`) and a cut-off title. Strip the markdown and show the full title.
- **V1, narrow title column:** the problem is the same on Drafts and Published at 1024, where titles wrap to 5–7 lines beside empty space.
- **V2, raw section keys:** they appear on Queue, Drafts, Published and Today at every width.
- **The coder's B3, story Sources tab:** it shows "Your source material / Sources on the lead" and one raw YouTube URL. Build the drawn record rows.

## New problems

**N1 (blocking). Sources & scan at 1024 loses the source names.** Each row shows only a chip, "Checked Sep 30, 2026…", a "Check now" button that wraps onto two lines, and Pause. The **More** button is clipped off the right edge. There is no way to tell which source a row is.

*Fix:* row grid `minmax(0,1fr) auto`. The name and URL go on the first line, the chip and checked time on the second, and the actions stay on one line. Below 1100px the actions drop under the text.

**N2 (blocking). The Models table is clipped at 1024.** The Fallback 2 header shows as "FA", the job column is squeezed to one or two words per line, and the selects have no borders.

*Fix:* below 1280px, each job becomes a card with labelled selects stacked: First choice, Effort, Fallback 1, Fallback 2. Bordered selects at a 44px minimum height.

**N3 (visible). Models → Connections lists are uncapped.** The Ollama card lists every model, more than 25 rows, and long text breaks mid-word ("the s / erver", "gemini / -3.5-flash"). Cap each provider at 5 models with "Show all N". Wrap at word boundaries; only paths may break anywhere.

**N4 (visible). The Reporting tab shows raw data.** The lead title carries `(2026-09-30T05:15:02Z)`, and the agenda items are in ALL CAPS ("SPECIAL REPORTS AND PRESENTATIONS"). Strip the timestamp and convert agenda text to sentence case for display.

**N5 (visible). The story action row wraps unevenly.** At 1024–1280 it splits into two rows of mixed widths. Use one row: Save edits (Primary once the draft is dirty) · Check draft against evidence · Redraft… · More ▾, with "+ Add to story" and "Preview as reader" moved under More.

**N6 (visible). The story with no draft has only one way forward.** It shows Draft with AI and nothing else. Add **Write it myself** and **Paste a story**, as in U5. Every AI step needs a manual path.

**N7 (visible). Chips and times.**
- Drafts shows "READY TO CHECK" in ALL CAPS and in green. Use sentence case in the neutral chip, per answer 5.
- Times read "11:01 PM". Use the paper's style: "11:01 p.m."

**N8 (minor).**
- Stats Saved reports shows about 30 rows with ISO dates. Cap at 5 and write the dates as "Week of Sept. 28".
- Dark Desk's Set aside shows full investigation prose in the rail. Show one line and put the rest behind Read.

## What matches

- **Today at 1024:** the 2×2 step strip and the stacked rail.
- **Server at 1024:** a two-column grid in rows, as now ruled.
- **Published:** capped at 25 with "Show 25 more".
- **Follow-ups:** the empty state is good. Trim its intro to one line.

## Still not captured

- the job card states
- Compare versions
- Release
- the Redraft pop-up
- Follow-ups with items
- a running scan
