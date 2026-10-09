# TownReporter: Dark Desk design package (2026-10-07)

This package covers one section of the editor's desk: **Dark Desk**, at `/desk/dark`. It is cut from the full v4 design package and brought up to date with the rulings made on 2026-10-02.

- **Repository:** `scottconverse/townreporter`
- **Route file:** `src/routes/desk.dark.tsx`
- **Settings component:** `src/components/dark-dials-panel.tsx`
- **Build reviewed:** `881cbfe8` (0.6.82)

## Read in this order

1. `01-DARK-DESK-SPEC.md`: what Dark Desk is, its layout, every part and button, its states and the rules it must follow.
2. `02-BUILD-GAPS.md`: what the built app does differently today, and the fix for each item.
3. `APPENDIX-ENTRY-POINTS.md`: every place in the app that leads to Dark Desk, and where Dark Desk sends the editor.

## What's included

| Folder | Contents |
|---|---|
| `screens/dark-desk/` | The screen at 1440, 1280, 1024, 900 and 390px, in dark and light, at Normal and Large text (20 images) |
| `screens/settings-panel/` | The Settings panel open, in dark and light |
| `screens/start-a-file-dialog/` | The "Start a Dark Desk file" pop-up at 1440 and 390px, in dark and light |
| `screens/built-app-2026-10-02/` | Design (left) next to the built app (right), from the comparison of Oct. 2 |
| `design/` | The clickable design (see below). `Model Picker.dc.html` is the one model control. |
| `design-system/` | TownReporter's tokens, fonts, components and rules. README section 6 covers buttons. |

## Clickable design

Serve the folder, then open the Dark Desk view:

```
cd design
npx serve .
```

- `http://localhost:3000/Dark Desk.dc.html` opens the desk on Dark Desk. The other desk files are included only so it runs; the side menu still moves between screens.
- `http://localhost:3000/Dark Desk Settings.dc.html` opens Dark Desk with the Settings panel open. Add `#light` to the address for light mode.

## Changed in this package (since v4)

These bring the drawing in line with the 2026-10-02 designer answers (item 6):

- Added a quiet **Settings** button in the header, and the **Settings panel** (How hard to dig, Watched pages).
- Added the fourth rail group, **Set aside**. The rail order is now Open files → Signals to review → Waiting on an AI follow-up → Set aside.
- Each rail group shows at most 5 items, then **Show all N**.
- **Depth** in the file's strip now reads "Standard · up to 30 records", which matches the Start-a-file pop-up; the earlier drawing said 20 records.
- Header buttons stay on one line instead of stacking.
- **One model picker everywhere AI works**, drawn to match the build's `ModelPicker`: on the open file, in Settings (default and watched pages) and in the Start-a-file pop-up. It replaces three different model controls in the earlier drawings. The story page's writer bar and the other pop-ups in `design/` now use it too.
- **Dollar limits removed.** "$3" and "$15" came from the v3 drawing, not the owner, and nothing in the product enforces them. Limits are records and time only.

## Locked rules that apply here

- **Dark Desk never publishes.** "Send to the queue" files a lead for the editor to review. Nothing else leaves Dark Desk.
- **There is no human "seek a response" step.** When outside information is needed, the action is "Start an AI follow-up".
- **Type:** Bricolage Grotesque for display and UI; Literata for the ordinary-explanation line and any prose.
- **Colors:** cream `#fffdf7` and ink `#111` in light; warm black `#1b1916` and text `#e8e6e1` in dark. Yellow `#ffd23f` (light) or `#e6c35c` (dark) marks the next step only.
- **Accessibility:** nothing informational under 14px, 44px tap targets, WCAG AA in both themes, and no horizontal scroll from 390 to 1440px.
- **Modernist design system:** banned. Use only `design-system/`.
