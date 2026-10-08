# Dark Desk: design spec

## What it is

Dark Desk is where the editor runs **investigations**: questions that need digging before anyone knows whether there is a story. The AI gathers records, keeps an activity log, writes a case file, and then argues against its own findings. The editor decides what happens next.

**Nothing on Dark Desk prints.** The only way a Dark Desk result reaches readers is "Send to the queue", which files an ordinary lead. That lead then goes through the normal Draft → Check → Publish run.

## Layout

```
┌ Header ──────────────────────────────────────────────────────────┐
│ Investigations · nothing here prints on its own   [Settings] [+ Start a file] │
│ Dark Desk                                                         │
├──────────────┬───────────────────────────────────────────────────┤
│ RAIL (320px) │ OPEN FILE                                          │
│ Open files   │ The question · ordinary explanation                │
│ Signals      │ Scope | Depth | Limit                              │
│ Waiting (AI) │ Activity            │ Case file                    │
│ Set aside    │                     │ [Challenge the case]         │
│ [Check r/…]  │ Decide: Keep · Start an AI follow-up · Wait · Queue · Close │
└──────────────┴───────────────────────────────────────────────────┘
```

- **Grid:** `320px | minmax(0,1fr)`.
- **Below 900px of content width:** one column, with the rail above the file.
- **Below 760px:** Activity and Case file stack.
- **Phone width:** the Scope · Depth · Limit strip stacks to three rows.

## Header

- **Kicker:** "Investigations · nothing here prints on its own" (15/700, `--ink2`).
- **Title:** "Dark Desk" (40/800, letter-spacing −0.03em).
- **Buttons, on one line:**
  - **Settings**: Quiet (1px `--ink2` border). Opens the Settings panel.
  - **+ Start a file**: Primary (yellow, 2px `#111` edge in light). Opens the "Start a Dark Desk file" pop-up.
- A 3px ink rule sits under the header.

## Settings panel

Opens at the top of the work area, above the rail and file, with a 2px ink border on `--panel`. **Close** is on the right.

- **How hard to dig:** the defaults for *new* files. Each file can change its own.
  - **Model picker**, labelled "Digging model", with Thinking effort. Built today inside `dark-dials-panel.tsx`.
  - **Depth**, a segmented control:

  | Level | Limits |
  |---|---|
  | Quick | 10 records · 20 minutes |
  | Standard (default) | 30 records · 2 hours |
  | Deep | 100 records · 8 hours |

  The selected level uses the selection fill (`--sel`: ink in light, gold in dark). **Save default** is Primary; **Reset** is Quiet.
- **Watched pages:** pages Dark Desk re-checks for changes. Each row shows the URL, then "Checked 7:02 a.m. · changed / no change", with **Stop watching** (Quiet) on the right. Below the list is a **model picker** ("Digging model") for reading changed pages, as built in `page-watch-panel.tsx`. **+ Watch a page** is Secondary.

Built today as `dark-dials-panel.tsx` ("How hard to dig"). Move it behind this Settings button.

## The rail

Four groups, always in this order. Each has an uppercase label (14/800, `--ink2`) and a count on the right.

| Group | What's in it | Row meta line |
|---|---|---|
| **Open files** | Investigations in progress | "Reading · 4 of 6 records" / "Waiting on 1 record" |
| **Signals to review** | Things worth a look, from r/longmont and watched pages | "3 posts · unverified" / "2 names removed" |
| **Waiting on an AI follow-up** | Files paused while an AI agent watches for something | "AI watching for a public notice · since Sep 26" |
| **Set aside** | Files the editor parked | "Set aside Sep 24". One line only; the full text is behind the row. |

- **Rows:** title (16/700) and meta line (14, `--ink2`). Each row is a link that opens the file on the right.
- **Selected row:** `--bg` fill and a 4px inset left bar in `--sel`.
- **Cap:** at most 5 rows per group, then **Show all N**, an underlined link.
- **Rail foot:** **Check r/longmont for signals** is Secondary. While it runs it reads "Reading r/longmont…" and is disabled.
- **Empty group:** hide the group. If every group is empty, show the empty state described under States.

## The open file

1. **The question:** an uppercase label "THE QUESTION", then the question (26/800).
2. **The ordinary explanation** to rule out first, in Literata (16, `--ink2`).
3. **Model picker** (see "Model picker" below), labelled "Digging model", with Thinking effort. Keep digging and Challenge the case use it. A file remembers the model that last dug it.
4. **Boundaries strip:** three cells, Scope · Depth · Limit, each a label (14/800, `--ink2`) over a value (16/700). Depth shows this file's own level. Ruled cells on `--line`.
5. **Activity:** the heading (19/800) over a 2px ink rule, then rows of time (tabular, `--ink2`) and event.
   - **Findings** are bold.
   - **Failures** are bold `--danger`, with the reason: "Could not open hosting provider status page (timeout)".
6. **Case file:** the heading (19/800), then four entries: **Findings**, **Contradictions**, **Unanswered** and **AI follow-ups running**. Each is a label over the text. **Challenge the case** (Secondary) makes the AI argue against its own findings and look for the ordinary explanation.
7. **Decide panel:** `--panel` fill with a 3px yellow top rule.
   - **Start an AI follow-up**: Primary. An agent watches for a public statement or record.
   - **Keep investigating**: Secondary.
   - **Wait and watch**: Secondary.
   - **Send to the queue**: Secondary. Files a lead for review.
   - **Close: no finding**: Quiet.
   - Under the buttons: "Nothing here prints. "Send to the queue" files a lead for you to review." (14, `--ink2`).

## Start a Dark Desk file (pop-up)

Opened from **+ Start a file**, from a lead's **More ▾ → Send to Dark Desk**, and from a signal row.

- **Fields:**
  - **The question** (required): "What are you trying to find out?"
  - **The tip or starting point** (required): a link, document, post or what you heard.
  - **The ordinary explanation** (optional): "What would make this a non-story?"
- **Limits:** Quick look (up to 10 records, 20 minutes) · Standard (up to 30 records, 2 hours) · Deep (up to 100 records, 8 hours). The default comes from Settings.
- **Model picker** ("Digging model", with Thinking effort). It starts on the Dark Desk default from Models.
- **Buttons:** **Open the file** (Primary) and Cancel. The foot reads: "You'll watch its activity log live and can stop it any time."
- **Phone:** the button row wraps; nothing runs off the edge.

## Model picker (one component, everywhere AI works)

The desk has **one** model control: the build's `ModelPicker` (`src/components/model-picker.tsx`), styled by `.model-picker`, `.model-picker-label` and `.model-picker-help` in `src/desk-astra.css`. Every place an AI runs uses it, and no screen draws its own version. In this package it is drawn once, as `design/Model Picker.dc.html`.

**Structure, top to bottom:**
1. **Label** (700, 14px): "Digging model" when `scope="dark"`, otherwise "Writing model".
2. **Select:** 44px tall, 1px `--ink2` border, square corners. The closed text is the option's short line, for example "Automatic — Recommended ladder".
3. **Help line** (500, 14px, line-height 1.6), written by `modelChoiceHelp(value, scope)`. For Dark Desk on Automatic: "Uses your configured gateway when set; otherwise tries [the Dark Desk ladder]. Planning uses the selected provider's faster planning model. If the first provider's login has lapsed or synthesis does not respond in time, only the unfinished stage moves to the next provider."
4. **Thinking effort:** a second select plus its help line, shown when the caller passes `onEffortChange`. Its options come from the chosen model.
5. **"Set up a writing model ▸":** a disclosure linking to Models → Connections.

**Where it appears on Dark Desk:**

| Place | Scope | Effort |
|---|---|---|
| The open file (Keep digging, Challenge the case) | dark | yes |
| Settings → How hard to dig (default for new files) | dark | yes |
| Settings → Watched pages | dark | no |
| Start a Dark Desk file pop-up | dark | yes |

Every picker starts on the job's default from Models → Who does what → "Dark Desk research". Changing it here affects only this run or file.

## Long job progress

A Dark Desk run is a long job and uses the shared job card (`JobCard.tsx`).

- **Stages:** Question → Gather → Case file → Challenge.
- **Current step examples:** "Restating the question", "Opening record 9 of up to 30", "Writing case file", "Looking for the ordinary explanation".
- **Model line:** for example, "Claude Opus · max".
- **Done:** "Case file ready for your decision" → **Open file**.
- **Stalled** after 60 seconds without activity: **Keep waiting** and **Retry on next model**.
- **Failed:** the real reason.
- **Stop:** available at any time.

## States

| State | What shows |
|---|---|
| Files exist | The **most recently touched file opens** automatically. Never show "No file open" while any file exists. |
| No files at all | The rail is hidden. The work area shows "No investigations yet", one line of explanation, **+ Start a file** (Primary) and **Check r/longmont for signals** (Secondary). |
| A file is running | The activity log updates live, the newest row flashes once, and the job card shows on Today under Running now. |
| A file failed | The failure row in the log is bold `--danger` with the reason. Decide still works. |
| Loading | Skeleton rows in the rail; the work area says "Loading the file…". |
| Error | "Could not load Dark Desk", the server's reason, then **Try again** and **Open Server health**. |

## Responsive rules

| Content width | Layout |
|---|---|
| 900px and up | Rail (320px) and file side by side |
| Under 900px | Rail on top, file below |
| Under 760px | Activity and Case file stack |
| Phone (390px) | Single column; Scope · Depth · Limit stacks; Decide buttons wrap; header buttons sit under the title |

There is no horizontal scroll at any width. Large text scales everything through `--ts`, and the layout must still hold.

## Copy rules

- Use short verbs on buttons: "Start an AI follow-up", "Send to the queue", "Close: no finding".
- Write times and dates in paper style: "7:02 a.m.", "Sept. 26". No ISO timestamps.
- Use sentence case on every chip and label except the uppercase group labels.
- Never say "contact", "call" or "ask the source". Any outside question is an AI follow-up.
