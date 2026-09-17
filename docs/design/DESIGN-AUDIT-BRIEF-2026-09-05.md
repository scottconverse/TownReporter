# TownReporter editor's desk — design audit package

> **Historical design snapshot, reconciled 2026-09-07.** The “as built” descriptions and known problems below record the 0.6.19-era audit, not the current interface. The five readability/control defects were addressed in 0.6.20; Direction A's Command Center and story workbench followed in 0.6.21–0.6.22. Preserve this document as the design rationale. Use the [current handoff](../../HANDOFF-NEXT-AGENT.md) and [editor guide](../editor.md) for current behavior and verification limits. Paths to `screens/` and `prototype/editors-desk-redesign.html` refer to the original external audit package; the retained repository artboard is [Main.dc.html](prototype/Main.dc.html).

Prepared 2026-09-05 for an outside designer. Everything here is either lifted from the running code (marked *as built*) or the owner's stated rule (marked *rule*). Nothing in this package needs access to the repository or the owner's machine.

## 1. What this is

TownReporter is a self-hosted, non-profit local newspaper for Longmont, Colorado, run by one editor. The public paper is a read-only site. Behind it sits the **editor's desk**: the place where leads arrive, stories are drafted with an AI writing model, checked, and published. There is also a **Dark Desk**, an investigative workspace that reads documents and never prints on its own.

The desk works. The owner's verdict is that it "feels clunky and disjointed" after a fast run of feature work. The audit is about that: one coherent system, a clear reading order, and screens that answer three questions every time — **what am I asking the system to do, what happened, what do I do next.**

## 2. Who uses it (rule)

- One editor. Often late at night. Older eyes.
- Works in **dark mode** almost always.
- Uses a laptop; sometimes a remote machine. No phone use of the desk today, but the desk must not break on a narrow window.
- Treats the desk as a newsroom, not a dashboard. Words like *lead, draft, printed, wire, desk, file* are the vocabulary.

## 3. Rules that are not negotiable (rule)

1. WCAG AA contrast in both themes. Every colour pair is measured by a script in the repo; the audit should assume 4.5:1 body, 3:1 large.
2. **Nothing informational under 14px.** Labels, chips, meta lines included. A Normal / Large text control exists and must scale everything a reader needs, including headlines and document text (today it does not — see §7).
3. **Dark mode is black background, white text.** Not brown, not grey. Panels may be a very dark grey (#141414) to separate from the page.
4. Quiet styling never carries meaning alone. If something is disabled, failed, or important, the words say so, not only the colour or the opacity.
5. Every AI surface reads one provider registry: the same model picker appears wherever the desk writes, with the same options and the same states.
6. The desk never claims something exists or does not exist without evidence; the story page shows what was opened and what was not. Design must make "checked, nothing changed" look different from "could not check."
7. UI/UX is co-equal with code. A feature that works but cannot be understood is not done.

## 4. The design system as built (as built)

Lifted from `src/styles.css` and the component source. Values are exact; do not round.

**Type.** Display and headings: Fraunces (weights 500/600/700). Body: Source Serif 4 (400/600 + italic). No sans, no mono loaded. Base desk body 14px × text-scale, line-height 1.5. Buttons and the score badge also use Fraunces 600.

| Role | Size | Notes |
|---|---|---|
| Page h1 | 30px fixed | Fraunces 600, lh 1.05, ls −0.015em — does not scale with Large |
| Section title | 17px fixed | Fraunces 600 |
| Lead headline link | 15.5px fixed (14px×scale in the small variant) | Fraunces 600, lh 1.25 |
| Body, meta, buttons, inputs | 14px × scale | |
| Kickers, chips, field labels | 13px × scale, uppercase, tracked .12–.18em | **Violates rule 2 at Normal size** |
| Dark Desk document reading pane | 15px fixed | does not scale |
| Article body | 15px fixed | does not scale |

**Colour, light.** Paper #f6f1e7 · paper-2 #efe6d6 · ink #1c1410 · ink-2 #3a3129 · muted #6b5e52 · rule #cfc2ac · accent (rust) #9b2915 · deep accent #7a1f10 · danger #8b1e12.

**Colour, dark (as of 0.6.19, per rule 3).** bg #000000 · panel #141414 · text #ffffff · secondary #e0e0e0 · line #444444 · accent #d2764f · warn #e8b4a8. Before 0.6.19 the dark desk was brown (#211812 / #2c221a / #f6f1e7 / #c8b9a6); the "before" screenshots in this package show the brown version if they were taken from the live site before the change — the file names say which.

**Shape.** Square corners everywhere (radius tokens exist but are unused on the desk). No drop shadows; hierarchy comes from rules and type. Avatar is the only circle.

**Controls.** Button: 1px solid ink border, padding 8px 14px, Fraunces 600 14px; *solid* = ink fill, paper text; *quiet* = no border, deep-accent text; *danger* = same shape, warn-coloured text only. Small button: padding 4px 10px, same font size. Inputs: 1px line border, padding 7px 10px, min-height 34px; a second Tailwind-based input family uses min-height 44px. Chip: 13px uppercase, 1px border, padding 2px 7px. Score badge: 26×26, 1px border, tabular numerals; ≥10 gets an ink border, ≥14 fills with accent. Focus: 2px outline in the text colour, offset 2px.

**Layout.** Content max width around 1440 with 60px gutters on the desk; Command Center is a three-column front (queue · Dark Desk · wire); story page is a two-column grid (lead + reporting notes 0.8fr · draft 1.6fr) collapsing at 720px.

**Motion.** Durations 80–400ms, `prefers-reduced-motion` honoured globally.

## 5. The desk, screen by screen (as built)

Screenshots are in `screens/`; each exists in light and dark at 1440px wide, full page.

- **Command Center** (`/desk`, `desk-*.png`). "Needs you" banner, Write-a-story composer with the model picker, then three columns: The queue (top leads: score, headline, why, meta, Open · Hold · Kill, chips NEW / ≈ PRINTED / matches line), Dark Desk (three piles), The wire (Run scan, source health, proposed sources, On the paper, Beat memory).
- **Queue** (`/desk/queue`). Every open lead with status filters.
- **Story** (`/desk/story/<id>`). Left: the lead, sources, Reporting notes (The news · Why it matters · Angle · Still to pull · Verify before print, including the new *Claims of absence* block · Documents opened). Right: model picker, Draft with AI, Save, Publish; draft form.
- **Sources** (`/desk/sources`). Watch list: on watch · proposed · rejected.
- **Scan** (`/desk/scan`). Reporter pass and previous scans.
- **Published** (`/desk/published`). The record, beat memory.
- **Opinion** (`/desk/opinion`). Write one, file one you wrote, editorials.
- **Server** (`/desk/ops`). Writing models (with the local model catalog), health, actions, recently deleted, logs, paper setup, invite, give up the desk.
- **Stats** (`/desk/stats`). Anonymous view counts.
- **Dark Desk** (`/desk/dark`). Start a file, the open file (what to read · still unopened), three piles, Check r/longmont.
- **Model picker open** (`desk-model-picker-open-*.png`). The second "Local model" dropdown.
- **Large text** (`desk-large-text-*.png`). What the Normal/Large control actually changes.

## 6. Nav and structure (as built)

Masthead: brand, "Editor's desk — Longmont", date, View paper, Light/Dark, Text Normal/Large, avatar. Tabs in order: Desk · Sources · Scan · Queue · Published · Opinion · Server · Stats, and **Dark Desk** pinned right as an inverted block. On phones the tabs fold behind a Menu button.

## 7. Known problems — the audit's starting list (as built, from a code read on 2026-09-05)

1. **Two component systems under one roof.** Most desk pages use bespoke theme-variable classes; Server and Stats use raw utility classes. Three different card treatments for the same role.
2. **An undefined button style.** A "btn invert" class is used in one Command Center list but defined nowhere; it renders as a plain outline next to a solid button meant to match it.
3. **Three notice patterns** for the same kind of message (boxed Notice, left-border note, and per-page variants), mixed within single pages.
4. **Two input families** with different minimum heights (34px vs 44px) for the same action.
5. **"Small" buttons are not smaller** at desktop font size, and grow on mobile beyond their desktop size.
6. **A typo'd variable** (`--muted` vs `--mut`) leaves the model-picker label unstyled on every page.
7. **Status chips are incomplete.** *Held* has no style and looks like an undefined state.
8. **Large text does not reach the text that matters.** Headlines, the document reading pane, and article bodies are fixed px; only labels grow.
9. **Three toggle-group patterns** (segmented control, underlined tabs, bordered pills) for one interaction.
10. **Destructive actions look like Cancel.** Kill and "Yes, delete" differ from neutral buttons only by text colour.
11. **Kickers, chips and labels are 13px** at Normal size, under the 14px floor. (Fixed in the prototypes; not yet in the product.)

## 8. The prototype canvas

The proposed direction is a clickable canvas. In this package it is `prototype/editors-desk-redesign.html`; open it in any modern browser (view-only offline). It contains:

- **Page "Desk":** a clickable prototype of the Command Center in direction **A — Front page** (one dominant column, the queue as the lead story, Dark Desk and the wire in a right rail; opens dark; Light/Dark and Normal/Large work; tabs switch; queue actions work; composer files and drafts; the story view is two-column with the claims-of-absence gate). Beside it, static sketches of two rejected-for-now directions: **B — Work list** (left rail, one task list) and **C — Calm desk** (composer then a three-stage pipeline).
- **Page "Workflows":** four clickable scenarios for features that do not exist yet, each with its waiting and failure states: *Watch a page*, *Legal removal*, *Sections*, *Investigation*. Their spec is in §9.

The canvas is the proposal, not the product. Everything on it is up for the audit.

## 9. Four workflows still to be built (owner's spec)

Each must answer, on every screen: what am I asking the system to do, what happened, what do I do next.

**Watch a page.** Say "this page matters; tell me when something meaningful changes." Form (URL, short name, why, optional investigation) → first capture → watch detail with last/next check, current version, previous versions with a readable comparison, and access problems (blocked, moved, unavailable, no readable text) → Pause / Resume / Stop / Open original. A change offers Read · Add to investigation · Create a lead · Dismiss. *"We checked and nothing changed" must look different from "we could not check."* A changed page is evidence, not a story.

**Legal removal.** A removal that bypasses the recoverable trash and shows the remaining cleanup. Separate menu → exact review of what is and is not removed → required reason and explicit confirmation → stepwise removal → a restricted record (who, when, why, what) → the backups that may still hold the content. Result distinguishes public removal · application cleanup · backup cleanup · operator review. *Removing a page does not prove every copy is gone; the record must not preserve the article; the interface records the retain/remove policy rather than implying one button equals compliance.*

**Sections.** Let the paper reflect the community, not a fixed government topic list. Organize: add, rename, describe, order, hide, retire, counts, move articles on retire, reader preview before applying. Direct the reporting: per section, sources, a brief, scanner instructions, examples of useful leads and material to ignore. *Adding "Arts & Culture" to the masthead does not create arts coverage.* The section list itself is still the owner's decision; the prototype uses examples and says so.

**Investigation.** Define the question (tip, why, hypothesis, and the ordinary explanation) → set boundaries (scope, depth, time or spend limit, explained) → investigate with a visible activity log, not a spinner → maintain a case file (findings, records, contradictions, unanswered questions, people who still need to respond) → challenge the case (disprove, check source independence, missing context, assumptions the investigation added) → decide (continue · seek a response · wait and watch · close with no finding · send to the queue). *Deeper research must produce a better-supported explanation or an honest "not established," never more confident prose.*

## 10. Open decisions, marked as the owner's

- The real section list.
- Legal removal policy: does the record keep a sealed copy of the text for defence, or nothing?
- Whether the older investigative methods from the owner's earlier projects are adopted, adapted, or dropped.
- The redesign direction itself: A is the leading candidate, not the decision.

## 11. What we would like back

- A verdict on direction A against B and C, with reasons.
- One component vocabulary: buttons, inputs, chips, notices, cards, toggle groups, with states, at 14px minimum, in both themes.
- A reading-order critique of the Command Center and the story page.
- The four workflow scenarios checked against the three questions and the two "must look different" rules.
- Anything the rules in §3 make harder that we have not seen.
