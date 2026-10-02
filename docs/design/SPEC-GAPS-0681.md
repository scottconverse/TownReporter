# Spec gaps recorded during 0.6.81 / 0.6.82 (64 entries)

Recovered 2026-10-01 from `Matchup.MD` (branch `claude/halo-scan-fix`, commit `52f842c3`), which copied the
entries word for word from `design/SPEC-GAPS-0681.md` in the previous coordinator's working folder. That folder was
never a git repository, so this list had not reached GitHub before.

**None of these is a bug.** Each entry is a place where the design drawing is silent, or where it conflicts with a
working feature. In each case the build made a choice and wrote it down. Each one waits for an owner ruling: keep the
build's choice, or change it. Do not "fix" an entry without that ruling.

The status on each entry is the previous coordinator's, measured against `main` at `f7479574` on 2026-10-01.
"RECHECK" means the screen changed after 0.6.82 and the sentence must be verified before it is put to the owner.
File and line references inside each entry point to the code as it stood at 0.6.81/0.6.82.


Source file: `townreporter-deepseek-oversight\design\SPEC-GAPS-0681.md`, lines 11-74. Line 75 of that file is a 65th
note, added for 0.6.82: "Published: Beat memory (not drawn) kept, folded into a closed <details> under the list." On
main, that `beat-memory` section is present. The counts match the 0.6.81 release note: CW 20, CX 12, CY 10, CZ 8,
DA 4, CY2 4, CW2 4, DA2 2. The file and line references inside each entry point to the code as it stood at
0.6.81/0.6.82, not to main today.

**Gap 1** (file line 11) — SPOT-CHECKED TRUE on main today

> CW — the drawing's per-row "Retry capture" press (`Desk Story.dc.html:152`, on a "Could not check" row) has nothing behind it: no desk action re-captures a story claim (the only re-capture in the app is the meeting-video `forced_recapture`), so the row carries "Open record" instead.

**Gap 2** (file line 12) — SPOT-CHECKED TRUE on main today

> CW — the drawing's run line says "checked against 3 captures" (`Desk Story.dc.html:36`); no reconcile job result stores a capture count, so the number printed is the count of distinct captured records the review itself cites (`citedCaptureCount`), which is a different number from the one the drawing means.

**Gap 3** (file line 13) — RECHECK (screen changed since 0.6.82)

> CW — the drawing's run line names the model (`Desk Story.dc.html:36`); when no reconcile job is on the books for the lead the model is unknown and the run line omits that piece rather than guessing one.

**Gap 4** (file line 14) — SPOT-CHECKED TRUE on main today

> CW — the drawing's name row carries a "Confirm spelling" press (`Desk Story.dc.html:153`); the name check has no confirm mutation (a name is settled by redrafting, which re-runs the check), so the row carries no press.

**Gap 5** (file line 15) — RECHECK (screen changed since 0.6.82)

> CW — the drawing always draws one name row and one style row (`Desk Story.dc.html:153`); a draft with no recorded name check, or one the audit finds nothing in, omits its row, because the copy for "checked nothing" is not drawn.

**Gap 6** (file line 16) — RECHECK (screen changed since 0.6.82)

> CW — the drawn Checks tab (`Desk Story.dc.html:30-46`) has no link to the full judgment panel; the desk keeps its "Review claims and sources" link inside the stale-evidence notice above the list, since that panel is where a claim is kept or removed.

**Gap 7** (file line 17) — RECHECK (screen changed since 0.6.82)

> CW — the drawn gate sentence is fixed copy (`Desk Story.dc.html:183`, "Review 1 name to publish."); the bar prints the first blocker's own action label from unit CT's list instead, so the sentence and the button underneath it cannot describe two different reasons.

**Gap 8** (file line 18) — RECHECK (screen changed since 0.6.82)

> CW — the drawing always draws the last-draft line (`Desk Story.dc.html:89`); a lead with no draft job has no hour to print, so the line is dropped rather than drawn with an empty clock.

**Gap 9** (file line 19) — RECHECK (screen changed since 0.6.82)

> CW — the drawing writes the last-draft clock with no date (`Desk Story.dc.html:89`, "7:48 a.m."); a draft from an earlier day carries its date ("Sep 26, 7:48 a.m."), because "7:48 a.m." on a stale draft reads as this morning's work.

**Gap 10** (file line 20) — RECHECK (screen changed since 0.6.82)

> CW — the drawing draws the writer as two selects reading "Automatic ▾" and "Effort: standard ▾" (`Desk Story.dc.html:86-87`); both values are owned by the existing model picker (the effort list depends on the resolved model id), so the row keeps that picker's own words — "Model & research · <model>" — and offers "Effort…" as a second way into the same panel, rather than re-rendering a value it does not own.

**Gap 11** (file line 21) — RECHECK (screen changed since 0.6.82)

> CW — the drawing has no no-draft story screen at all (`Desk Story.dc.html` is the only story drawing and contains no empty state; "Draft with AI" appears nowhere in the handoff); the desk keeps its own empty state — the Writer card, "No draft yet. Draft with AI writes a first pass from the lead and its sources; you edit, then publish.", the solid "Draft with AI" press in the drawn action row, and the "Evidence check" / "Names and spellings" blocks that say checks appear after the first draft.

**Gap 12** (file line 22) — RECHECK (screen changed since 0.6.82)

> CW — the drawn action row's five presses (`Desk Story.dc.html:112`) do not all exist on the lead-less screen: an editorial gathers no captures, has no lead to add itself to, and is written in one pass, so "Check draft against evidence", "+ Add to story" and "Redraft…" are omitted from `/desk/story/draft/<id>` rather than drawn as presses that do nothing; the row keeps the drawn "Save edits" and "Preview as reader".

**Gap 13** (file line 23) — RECHECK (screen changed since 0.6.82)

> CW — the drawing draws no Writer row for a piece whose writer nobody chose: the editorial screen never picks the model, so it draws no "● Ready" dot rather than a dot about a choice that screen cannot make.

**Gap 14** (file line 24) — RECHECK (screen changed since 0.6.82)

> CW — the drawing draws no way to delete a story (`Desk Story.dc.html` contains no "More" menu of any kind); `/desk/story/draft/<id>` keeps its Delete press in the action row, because a written piece has to stay removable.

**Gap 15** (file line 25) — RECHECK (screen changed since 0.6.82)

> CW — the drawing draws no read-only panels on the story screen; the editorial keeps its "Editor's fact sheet" and "Social image prompt" boxes below the action row, because neither prints and both are what the piece is checked against.

**Gap 16** (file line 26) — RECHECK (screen changed since 0.6.82)

> CW — the drawing draws no section select on the story screen (the reported screen confirms the lead's own section); a lead-less editorial has no section to inherit, so its existing Topic select stays in the form — and the press that prints is still the press that names the section, "Publish in <Section>".

**Gap 17** (file line 27) — RECHECK (screen changed since 0.6.82)

> CW — the drawing draws no "Names and spellings" panel (the reported screen keeps it on the Checks tab, which a lead-less editorial does not have); `/desk/story/draft/<id>` renders it below the action row so the piece can still be name-checked before it prints.

**Gap 18** (file line 28) — RECHECK (screen changed since 0.6.82)

> CW — the drawing runs STORY straight into the action row (`Desk Story.dc.html:47` then `:112`); the real screen keeps four working panels in the main column between them — the `FORM · REPORTED` chip, `STYLE CHECK`, `RECORDED FINDINGS` and `DRAFT-PASS INVENTORY` / `EDITOR-AUTHORED CLAIMS` — because each is an existing surface with data behind it (the style audit, the findings the draft was written from, the claims the draft pass inventoried) and none of the four is drawn anywhere in the handoff to move to. The drawn regions still render in the drawn order above and below them.

**Gap 19** (file line 29) — RECHECK (screen changed since 0.6.82)

> CW — the Opinion desk keeps its own "Read it" panel, a second editing surface for the same piece (`desk.opinion.tsx`); unit CW unified `/desk/story/draft/<id>` with the drawn screen and left that panel alone, since it is where the desk's row-level Publish lives (unit CA).

**Gap 20** (file line 30) — LIKELY TRUE (article page: 2 takedown commits only)

> DA-article-and-front — the article drawing carries one disclosure sentence, the AI-helped one ("A person reviewed and edited this story. AI tools helped find records and write the first draft.", `Article Daily.dc.html:66`), and draws nothing for a story no AI touched; the paste and import paths keep their own human-only line ("A person wrote this from public records; an editor reviewed it." — `IMPORT_DISCLOSURES.person` in `src/lib/news/import-stories.ts`, the default for a pasted report at `src/lib/news/paste-one-story.ts:49`) rather than print the drawn AI sentence over a story the desk did not use AI on, which would be a false claim about the reporting (`scripts/paste-one-story-e2e.mjs:582` fails if the AI line prints there). AI-helped stories print the drawn sentence verbatim.

**Gap 21** (file line 31) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing draws no "Needs you" panel on Today (`Desk Command.dc.html` has no such block anywhere on the page), so Today no longer renders one; everything the panel linked is still reachable from the screen that owns it — suggested sources to review and sources failing to fetch on Sources & scan, Dark Desk files ready for another round on Dark Desk — and two of the panel's five lines never left Today at all: the suggested and failing source counts still render inside the wire panel's own disclosure, and the stale-scan sentence is still on the page (`/desk`).

**Gap 22** (file line 32) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing's Today rail block is `Open files 2 / Signals to review 5 / Waiting on an AI follow-up 1 / Open Dark Desk →` (`Desk Command.dc.html`), and it is silent on what fills the third line; "Open files" and "Signals to review" are the Dark Desk screen's own two piles counted by that screen's own rule, and "Waiting on an AI follow-up" counts the live AI follow-ups that have not reported yet (`isAgentKind` + `matchesFollowUpFilter(row, "active")` minus `last_state === "found"`), which is the complement of the follow-ups list drawn above it and the only real-data reading of that label.

**Gap 23** (file line 33) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing puts `Open Dark Desk →` inside the rail panel as one full-width door, so Today's pile rows stopped being links (the drawing draws one door, not four); the "Set aside" pile the drawing does not draw is still Dark Desk's own third pile on its own screen (`/desk/dark`).

**Gap 24** (file line 34) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing's lead-row evidence cell reads "3 opened · 1 could not open" (`Desk Command.dc.html:118-121`); no per-lead failure figure exists anywhere in the desk — the Queue's own cell records the same absence — so the row prints the opened count alone rather than a number it would have to invent (`/desk`).

**Gap 25** (file line 35) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing prints a count on Queue / Drafts / Opinion / Follow-ups / Dark Desk and leaves Published blank (`Desk Nav.dc.html:56`); the rail prints exactly those five, each from the rule its own screen already counts by, and Published carries none — so the rail number and the screen's own heading cannot disagree (`src/components/desk-chrome.tsx`).

**Gap 26** (file line 36) — SPOT-CHECKED TRUE on main today

> CY-today-and-rail — the drawing's rail has no `+ New story` and no user block (`Desk Nav.dc.html:23-45`; its only "+ New" is the phone bar's at line 17), so the rail lost both; Today still has its own "+ New story" and the phone bar's "+ New" opens the same three tabs from the shell's one dialog, and Sign out stays reachable on the Server page (`LeaveEditorControl`) and in the public paper's chrome rather than in the rail.

**Gap 27** (file line 37) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing draws Opinion's second entry card as a whole-card link; card two ("File one you wrote") keeps its existing named "Paste a piece I wrote" button, because two CI walks press that exact accessible name (`scripts/opinion-desk-e2e.mjs:104`, `scripts/paste-editorial-e2e.mjs:104`) and this unit's item 8 scoped the collapse to the AI-write card (`/desk/opinion`).

**Gap 28** (file line 38) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing's Effort select offers five levels starting at "high" and its note reads "Set per job in Server → Models" (`Desk Dialogs.dc.html:89-93`); a row left on Automatic sends no effort at all and the desk's own default for the chosen model stands (the same resolution `DarkDialsPanel` uses), because the box is disabled exactly then — so the drawn list is offered in full when a model is named, and an untouched row never spends a level the editor did not choose (`/desk/dark`).

**Gap 29** (file line 39) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawing draws every Server card but Writing models as a few read-only rows plus one press each (`Desk Screens.dc.html:351-361`: Health "View logs" / "Restart workers", Paper setup "Edit setup", Recently deleted "Open trash", Sections "Edit sections", Daily scan "Scan settings", Meeting capture "Capture settings", YouTube "Replace key", Routine notices "Notice rules", Named outlets "Edit outlets", Editors & access "Invite an editor", Time budgets "Adjust times"); those panels have no screen to open onto — the card IS the panel — so each card carries its own working controls directly, and the drawn press survives only where something real is behind it: "View logs" and "Restart workers" reveal the log panes and the six machine actions in place, under the button that asked for them (`src/routes/desk.ops.tsx:344-448`). A press that opened an empty drawer would be a control that lies.

**Gap 30** (file line 40) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawn Health card's two presses are the only door the drawing gives the logs and the six restart/repair actions (`Desk Screens.dc.html:351`); both panels stay on the page as disclosures under those buttons (`src/routes/desk.ops.tsx:365`, `:430`) rather than moving to a screen the drawing does not draw, and every control inside works as it did when the panels stood alone — the "Run" buttons in their drawn order, the interrupting pair's "Yes, do it" / "Cancel", the log panes.

**Gap 31** (file line 41) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawing puts "Give up the desk" on the Server title line as if it were this page's action (`Desk Screens.dc.html:364`, `btns.server`); the real control is the one that hands the newsroom to another editor, so the header press jumps to the Editors & access card that holds it (`src/routes/desk.ops.tsx:247-255`) instead of being a second copy of a press nobody can undo.

**Gap 32** (file line 42) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawn Writing-models card wires both of its doors to the same screen (`Desk Screens.dc.html:241`, "Assign models to jobs →" and "All connections" both `goModels`); connections are the Models screen's own second tab, so "All connections" opens `/desk/models?tab=conn`, and the `#custom-ai-connections` bookmark — which used to land on a panel of this page — now lands on the card that carries the door (`src/routes/desk.ops.tsx:147-156`).

**Gap 33** (file line 43) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawn Writing-models card lists MODELS in ladder order (Codex Sol, Claude Sonnet, Local: Qwen 32B, Gemini Pro, Claude Opus — `Desk Screens.dc.html:348`); the real card lists the machine's PROVIDERS with their own sign-in state, because a provider is what this machine can or cannot be signed in to, and the drawn ladder is printed above them as the "Automatic tries them in this order" sentence, with the per-job table behind the drawn door on `/desk/models`.

**Gap 34** (file line 44) — SPOT-CHECKED TRUE on main today

> CX — the drawing's readiness vocabulary is three words (`● Ready`, `! Slow`, `✗ Key rejected` — `Desk Screens.dc.html:348`); the real chip names the thing to fix where the drawing names the symptom — "Sign in needed" for a CLI nobody has signed in, "Not installed" for a tool that is not on the machine, "Turned off" for a provider the operator disabled, "Last test failed" for a rejected key — because "Key rejected" is not what a signed-out subscription CLI reports (`src/routes/desk.ops.tsx:889`, `WritingModelChip`).

**Gap 35** (file line 45) — MOSTLY TRUE (Grok was removed from the model list since)

> CX — the drawing names a model in every cell of the Models job table (`Desk Models.dc.html:43`, "Codex Sol · sign-in", "qwen3 32B · LM Studio"); a job the owner has not decided has no stored model — the desk's own surface default resolves it — so the cell now prints what the desk will actually run, the same `resolveJobModel` answer the chip underneath reads ("Codex Astra" for Document reading and Video transcripts on this machine, "Automatic" where the default is the ladder, `src/routes/desk.models.tsx:638-656`). The stored value stays empty and the chip keeps its own "Default" word, which is unit BG2's fix for a chip that used to claim "✓ Ready" for a choice nobody made.

**Gap 36** (file line 46) — SPOT-CHECKED TRUE on main today

> CX — the drawing's rail carries two items for these screens, "Models" and "Server" (`Desk Nav.dc.html:56`); both open `/desk/ops` — "Models" on the page's `#writing-models` card, "Server" at the top — because the drawn Server card's own door is what opens the Models screen (`/desk/models`) and re-plumbing the rail is outside this unit (`src/components/desk-chrome.tsx`, unit CY's file).

**Gap 37** (file line 47) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawing draws the same twelve named cards for everyone (`Desk Screens.dc.html:350-361`); eight of them read something the server answers only to the owner (this machine's health, the paper's setup, the sections, the daily scan policy, meeting capture, the named outlets, who may invite an editor, the time budgets), so an editor's version of each keeps the drawn card title and carries one plain sentence in place of its body (`src/routes/desk.ops.tsx:630-637`, `ReadOnlyCard`); the ninth, Writing models, keeps its title for everyone already and only its body changes (`src/routes/desk.ops.tsx:825-829`) — an untitled card reads as nobody's card, and a skeleton for a read that was never going to happen reads as a broken page, which is the bug item 4 names.

**Gap 38** (file line 48) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawing's card is named "Sections" (`Desk Screens.dc.html:354`); the desk's own panel for it is titled "Newspaper sections" (`src/components/sections-setup.tsx:174`), and the editor's read-only face carries that same name, so the two roles see one grid of cards rather than two.

**Gap 39** (file line 49) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawn card names are short where the desk's own panel names are not (`Desk Screens.dc.html:357-360`: "YouTube", "Routine notices", "Editors & access"); each card carries the heading its panel has always had — "YouTube key" (`src/components/youtube-key.tsx:116`), "Routine notice permissions" (`src/components/routine-notice-permissions.tsx:217`), "Invite an editor" (`src/routes/desk.ops.tsx:1370`) — the same rule as the Sections card above: a CI walk asserts the panel's own heading by that exact name (`scripts/scan-desk-e2e.mjs:628`), and an editor's read-only face wears the owner's card name so the two roles see one grid.

**Gap 40** (file line 50) — STILL TRUE (desk.ops.tsx unchanged since 0.6.82)

> CX — the drawn Time-budgets card is two plain rows anyone can read ("Local models — 10 min per call", "Subscription CLIs — 150 s per call" — `Desk Screens.dc.html:361`); the server answers those limits only to the owner (`src/lib/news/provider-settings.ts:541-549` refuses a plain editor), so an editor's card carries one plain sentence — the same read-only face its owner-only siblings wear — instead of the drawn rows, and instead of a loading skeleton that can never resolve (`src/routes/desk.ops.tsx:548-558`).

**Gap 41** (file line 51) — RECHECK (screen changed since 0.6.82)

> CZ-long-lists — the handoff draws exactly one list footer — the Queue's own, "Showing 8 of 12 open leads" beside a "Load more" link (`Desk Screens.dc.html:67`, inside the `isQueue` block) — and draws no footer on Sources, Published or Drafts; all four screens carry the same footer now, the press says "Show 25 more" because that is the wording the brief names (the drawn one is a link, not a count of the next page), and both the sentence and the pills count the server's total so the pill and the footer cannot disagree.

**Gap 42** (file line 52) — RECHECK (screen changed since 0.6.82)

> CZ-long-lists — the drawn footer's noun is "open leads"; the real footer prints the noun of whatever pill is on (open, held, killed, all — "leads", "drafts", "published stories", "sources"), because the list under it is the pill's list and "open" would be false on the Held tab.

**Gap 43** (file line 53) — STILL TRUE (Published changed 1 line; list-window.ts unchanged)

> CZ-long-lists — the drawing prints the legal-removal note unconditionally on Published (`Desk Screens.dc.html:225`, "Legal removal is under More ▾. It skips the trash and asks for a reason."); the screen prints it only for the desk's owner, because the More ▾ item it names is itself owner-only (`desk.published.tsx:1006`) and on an editor's desk it would name a door that is not there.

**Gap 44** (file line 54) — STILL TRUE (Published changed 1 line; list-window.ts unchanged)

> CZ-long-lists — the brief asks for "server-side limit/offset"; the window is a slice of the filtered array, not a SQL LIMIT/OFFSET — every page still reads the whole list and then cuts (`desk.ts:311-313` for Sources, the same shape in the Queue, Drafts and Published reads) — because three of the four filters are decisions over row fields rather than columns, and a SQL limit would page the unfiltered list and show rows the tab does not hold.

**Gap 45** (file line 55) — RECHECK (screen changed since 0.6.82)

> CZ-long-lists — the drawing draws the Daily scan panel's "Runs" and "Model" rows but is silent on who may read them; both come from the daily scan policy, which the server answers only to the owner, so an editor sees the drawing's own defaults ("Every day, 6:00 a.m." and "Automatic") rather than rows that would have to be guessed (`desk.sources.tsx:160-180`).

**Gap 46** (file line 56) — RECHECK (screen changed since 0.6.82)

> CZ-long-lists — the drawing draws the Daily scan panel with a time in "Runs" and draws no off or paused schedule; a policy that is off or paused says so in that row instead of a time it would not keep (`desk-copy.ts`, `dailyScheduleLabel`).

**Gap 47** (file line 57) — SPOT-CHECKED TRUE on main today

> CZ-long-lists — the drawing's selection bar is "2 selected / Start 2 stories / Hold / Kill / Clear" (`Desk Screens.dc.html:38-43`) and has no delete; the real bar keeps "Delete selected (n)" (and its confirm), because it is the desk's only way to remove many leads at once, and its "Start N stories" is refused above five leads, which is the batch dialog's own drawn limit ("Choose up to five eligible queue leads", `Desk Screens.dc.html`, `desk.queue.tsx:795`).

**Gap 48** (file line 58) — RECHECK (screen changed since 0.6.82)

> CZ-long-lists — the drawing draws the selection bar as five anchors with no strip around them when nothing is picked; the bar renders only once rows are picked, and the empty amber band is kept off the screen with `:empty` rather than by unmounting the section, so anything that presses the bar finds it in the same place after a selection.

**Gap 49** (file line 59) — RECHECK (screen changed since 0.6.82)

> CW — the drawing has no narrow-width layout: rendered at a 390 viewport it lays out 862px wide and overflows, and its "Summary" label collapses to zero width inside that overflowing row (`Desk Story.dc.html:103`), so its 390 capture reads as six regions with no Summary; the real screen reflows and keeps the dek editor at 390, which is why the 390 rows of `reports/CW-evidence/measurements.json` show one region more than the drawing there.

**Gap 50** (file line 60) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing draws Today's lead rows in three fixed columns at one width and never draws the state where the presses no longer fit beside the title (`Desk Command.dc.html:100-125`); at 1280 the presses still sit on the row, and at 1100, 1024 and 900 the row wraps them onto their own line at the title's left instead of squeezing the title to 40px, 0px and 0px — measured at each width in `reports/CY-today-and-rail-evidence/item5-widths.json`, because a third fixed grid column cannot wrap and the drawing is silent on what should happen below its own width (`src/desk-astra.css`, `.desk-ltr.astra .today-lead`).

**Gap 51** (file line 61) — RECHECK (screen changed since 0.6.82)

> CY-today-and-rail — the drawing's phone frame (`phone="true"`, `Desk Command.dc.html`) redraws the nav as a top bar with "+ New / Menu" but keeps the desk laid out at its own canvas width, so its 390 render clips everything right of the first column and never draws where the three create buttons go at phone width; the real screen stacks them one per line at the headline's left, which is the same left-aligned stack the drawing draws at 1440 and the only reading of the drawn row that fits a 390 viewport (`reports/CY-today-and-rail-evidence/today-side-by-side-390-light-normal.png`).

**Gap 52** (file line 62) — RECHECK (screen changed since 0.6.82)

> CW2 — CW's line above about the four panels between STORY and the action row is superseded for the reported screen (`/desk/story/<leadId>`): the drawing's page ends at the action row (`Desk Story.dc.html:47` then `:112`), so STYLE CHECK is the style row's own disclosure body in the Evidence check list, RECORDED FINDINGS' per-finding judgment forms are the same list's row disclosures, and DRAFT-PASS INVENTORY / EDITOR-AUTHORED CLAIMS are the two shut disclosures the list ends with ("All claims and records ▸", "+ Add a claim ▸"), all on the Checks tab where the drawing puts the list. Nothing was dropped: every control is reachable from its new place, and the lead-less editorial (CW's line 29's screen) is untouched.

**Gap 53** (file line 63) — RECHECK (screen changed since 0.6.82)

> CW2 — the drawing draws neither the judgment controls nor anything they open: its Checks-tab rows are a chip, a sentence, a line and one press (`Desk Story.dc.html:30-46`), so a row that opens into a form is not drawn anywhere. The rows open anyway — `Record checks and judgment` under each claim row, the page's own Style check section under the style row — because the forms exist, the page's main column is where the drawing does not draw them, and a control with no home is worse than a disclosure the drawing is silent about.

**Gap 54** (file line 64) — SPOT-CHECKED TRUE on main today

> CW2 — the drawing draws no Topic, no Geography, no Pulled notes and no named-outlet record on the story screen (`Desk Story.dc.html` has no such field; the sticky bar's "Publish in <Section>" is the only place a section is named, `:183`); all four live in one shut "Story details ▸" disclosure directly under the action row, opened by any press that needs a field in it (the sticky bar's section press, the Checks tab's section/outlet blockers), because Publish still has to carry a person-confirmed section and these fields are what the desk already stores.

**Gap 55** (file line 65) — RECHECK (screen changed since 0.6.82)

> CW2 — the drawing draws no evidence-check comparison panel on the story screen, and the desk's own before/after panel under the heading "Evidence check results" is the same two decisions ("Keep checked version" / "Restore previous version") as the Compare-versions dialog the Checks tab's compare press opens, on the same two functions; so the main column no longer draws a second copy of it, and the check's own state under the action row (progress, the dirty note, the finished notice, "Reload checked draft") stays.

**Gap 56** (file line 66) — STILL TRUE (front page index.tsx unchanged)

> DA-article-and-front — the article drawing carries a text-size control in its chrome and the article page honours it, but the front drawing carries no such prop (`Front Daily.dc.html` has no `textSize` prop at all; `Article Daily.dc.html` has one), and the real front page is byte-identical at Standard and Large while the article page changes — because `var(--reading)` (the reader's chosen size, `src/reader-astra.css:38`) is used only by article surfaces (`.reader .articlebody`, `.reader .reading-sample`, `.reader .infopage > h1`) and by nothing on the front page. Measured in `reports/DA-article-and-front-evidence/` (front shots byte-identical at 1440 and 390; article shots differ).

**Gap 57** (file line 67) — STILL TRUE (front page index.tsx unchanged)

> DA-article-and-front — the front drawing names a sample newsroom's sections in its nav and kickers (Council / Schools / Housing / Growth & planning / Utilities / Arts / Community / Opinion, with no "Front page"), while the real front nav prints the install's own visible sections from `usePublicSections()` (`src/routes/index.tsx:230-231`), so the drawn names are not a spec for this install's section list and were not copied.

**Gap 58** (file line 68) — STILL TRUE (front page index.tsx unchanged)

> DA-article-and-front — the front drawing's "Around the region" band draws four rows with Nearby twice; the real band reads one story per non-home ground (`readRegion`, `src/routes/index.tsx:193-204`, one row per `STORY_AREAS` ground that is not the home town), so the real band draws three rows where the drawing draws four, and the drawing is silent on the rule that picked its fourth.

**Gap 59** (file line 69) — LIKELY TRUE (article page: 2 takedown commits only)

> DA2-article-bands — the drawing's article page has no "What TownReporter found" block (`Article Daily.dc.html` draws the story body, then the disclosure line, then the evidence band and nothing else), while the real page printed one finding's text, the record's URL and its "Captured record" press under that band — every one of which is already a card in the band itself (`SourceCard` prints "Current source" and "View captured version" from the same row's `source_urls[0]` and `artifact_version_ids[0]`), so per the brief's first branch the block and its `found_note` printing were **removed**, not folded in; `publicArticle().findings` is still computed and still excluded from the public serialization (`src/lib/news/public-evidence-boundary.test.ts:34`, `:43`), and the named-not-linked case is still the test at `:64`, so the record the report named and did not link still reaches the reader, in the band the drawing draws it in.

**Gap 60** (file line 70) — LIKELY TRUE (article page: 2 takedown commits only)

> DA2-article-bands — the drawing paints its 3px band rules with `var(--ink)` (`Article Daily.dc.html`: five `border-top:3px solid var(--ink)`), and the real page paints all five of its own 3px rules with `var(--grid)` (`src/reader-astra.css:2787, :3027, :3152, :3174, :3256`): the same colour in light (`#111111` both) and a dimmer one in dark (`#3b3631` against the drawing's `#e8e6e1`). The two bands DA2 added took the page's existing colour rather than changing five pre-existing rules page-wide, so at dark the drawn sheets show the band rules brighter than the real ones; at light, the mode the audit image is in, they are identical.

**Gap 61** (file line 71) — RECHECK (screen changed since 0.6.82)

> CY2-today-mid-width — the drawing's own new laptop layout scrolls sideways at 900, and the real screen does not. v3.2 lays the rail under the work column below 1320 (`Desk Command.dc.html`, the `mid` branch of the render), which widens the drawn main column at 900 to 654px and lays the lead cards in it three fixed columns of 188.65px (`--draftCols: repeat(3,minmax(0,1fr))`), and the drawn card's interior — a headline, a why line and an "Open" press with `padding: 0 14px` — measures 250px, so the press paints 60px past its own card (card right 843, press right 920) and the document is 920 wide in a 900 viewport, in both themes. The real page has no horizontal scroll at any of the seven widths (1440/1319/1280/1100/1024/900/390, light and dark), because CY part 9's wrapping flex row and this unit's two-per-row strip both reflow rather than spill; the offender is the drawing's card interior, which v3.2 did not redraw when it widened the column. Measured per width in `reports/CY2-evidence/mid-widths.json` (the `drawing.hScroll` / `real.hScroll` pair of every row) and traced to the element in `scratch/CY2/logs/overflow-chain.txt`.

**Gap 62** (file line 72) — RECHECK (screen changed since 0.6.82)

> CY2-today-mid-width — the drawing carries its own rail pad at the laptop width (`--railPad: 0 32px 40px`, applied to the root-level `<aside style="grid-area:rail">`) and the real rail carries none. In the real page the rail is not a root grid child: it is inside `.deskmain`, whose own padding is what insets the work column above it, so the drawn pad is satisfied in effect rather than repeated — repeating it would inset the rail 32px deeper than the column it sits under, which is the one thing that pad exists to prevent. The alignment is measured rather than argued: at 1319/1280/1100/1024/900/390 the real rail's left and right edges equal the work column's to the pixel (`railAlignedLeft`/`railAlignedRight` true in every mid-width row of `reports/CY2-evidence/mid-widths.json`), and at 1440 both are false because the rail is beside the column again.

**Gap 63** (file line 73) — RECHECK (screen changed since 0.6.82)

> CY2-today-mid-width — the drawing's phone frame draws the step strip two cards per row (`--stepCols: repeat(2,minmax(0,1fr))` is the phone default) and the real screen stacks one per row at 700px and below; the real strip measures `356x875` with one column at 390. The brief scopes this unit to "below 1320px and above the phone breakpoint", so the phone shape was left as CY drew it and the divergence is recorded rather than closed here.

**Gap 64** (file line 74) — TRUE unless the handoff README was edited

> CY2-today-mid-width — the handoff README's own step list is still v3.1's: it names Draft's press "Watch progress" and Publish's "Tonight's edition" (`docs/design/handoff-2026-09-26/README.md`, the "Four-step strip" bullets), while the drawing that README describes says "Watch drafts" and "Review edition" and the real screen now matches the drawing at every width. The README arrived with the accepted package in one bulk commit (`26f35b32`) and is the owner's description of the package, so this unit did not rewrite it; the draw's own labels are the spec, and the drift is recorded here and in `reports/CY2-today-mid-width.md`.
