# Sprint punchlist — TownReporter 0.5.1 audit — 2026-08-30

Every item that had to land before promotion. All are DONE and committed.

| ID | Title | Sev | Role | Status | Commit | Size |
|---|---|---|---|---|---|---|
| ENG-201 | Render-path DNS-rebinding SSRF: pin Chromium DNS via guarded loopback proxy | Critical | Eng | DONE | 2727bf6 | M |
| ENG-205 | Connect-time SSRF test for the render path (mutation-proven) | Minor | Eng | DONE | 2727bf6 | S |
| UX-001 | Fold both navs behind a mobile disclosure (<640px) | Critical | UX | DONE | 5596d55 | M |
| UX-003 | Quiet the mobile Create-editor CTA below `sm` | Major | UX | DONE | 5596d55 | S |
| UX-002 | Beat-memory empty states (command center + /desk/published) | Major | UX | DONE | 5596d55 | S |
| ENG-202 | Unattended monitor/job drain in the built server (Nitro plugin twin) | Major | Eng | DONE | 19fb54c | M |
| DOC-002 | Mermaid watchdog diagram: "PORT (3000)" → "PORT from .env" | Minor | Docs | DONE | (docs commit) | S |
| DOC-003 | Env table now points at `.env.example` as the full inventory | Minor | Docs | DONE | (docs commit) | S |

Accepted without change:
- UX-005 — topic chips wrap to 3 rows on mobile; the wrap-don't-hide trade-off
  is deliberately recorded in styles.css and stands.
- DOC-001 — no CONTRIBUTING.md; README's disclaimer of AGENTS.md is deliberate.
