# GauntletGate — Walkthrough lane — TownReporter 0.5.1

Date: 2026-08-30. Dev checkout: `C:\Users\scott\Desktop\Code\townreporter-dev`.
Ran against the **existing** build (`.output/`) on a spare port, with every
dependency absent. No rebuild. Production (`:3000`) confirmed 200 before, during,
and after — never touched.

## Environment-provisioning attestation (verified)

| What | State used | How VERIFIED |
|---|---|---|
| Instance / port | throwaway `node .output/server/index.mjs` on `PORT=3199` | boot.log: "Listening on http://localhost:3199/"; not the prod `:3000` |
| Data store | empty in-memory PGLite | `src/lib/db.ts:141` `new PGlite({})` has **no dataDir** → in-memory, resets per boot; the desk showed "Queue is empty", "No scans yet", 0 editorials |
| Dependency: DATABASE_URL (Postgres) | ABSENT | launched with `DATABASE_URL` unset → PGLite path taken |
| Dependency: editorial voice file | ABSENT | `TOWNREPORTER_VOICE_FILE` unset; Opinion desk rendered the "No editorial voice is configured" banner |
| Dependency: model CLI | not invoked | exercised the manual file-lead + publish path instead |
| First-run flags | unset (fresh process, empty DB) | desk offered "Create the desk — first person in owns the newsroom" |
| Network | online (localhost only) | n/a for first-run gates here |

**Isolation verified?** YES — the app provably used empty in-memory state (empty
queue/scans/editorials on screen; no data dir on disk).
**→ First-run coverage: VALID.**

Artifacts (this folder): `boot.log`, `home-empty.html`, `home-first-run.html`,
`opinion-voice-absent.html`, `attestation.txt`.

## First-run verdict: ✅ reaches the core feature

Walked as a brand-new user with everything absent:

1. **Read the paper** (`/`) — renders a coherent "About" front page with empty
   data. No blank screen, no crash. ✅
2. **Create the desk** (`/desk`) — first-run onboarding guides account creation
   in-product; no "go set up X yourself" wall. Created an editor, landed on the
   Command Center. ✅
3. **File a lead** (`/desk/queue` → "File a lead yourself") — filed a lead with no
   model; it opened into the story workbench with manual Headline/Dek/Body,
   **Save edits**, and **Publish to the paper**. The operator can write and publish
   with no model at all. ✅
4. **Voice absent (Opinion)** — the desk says up front, before any submit: "This
   desk cannot write yet. No editorial voice is configured. Set
   TOWNREPORTER_VOICE_FILE in .env…" **and** offers a degraded path ("Or file one
   you wrote — paste a finished piece"). Guided, not dead-ended. ✅ (confirms the
   UIUX-05 fix live).

## Provisioning matrix covered

- first-run × dependency-ABSENT × data-empty × online — **covered** (the mandatory
  dependency-absent row).
- Not covered here: returning-user, dependency-present, populated-data, offline —
  these are exercised by the CI `lifecycle`/`desk-flows`/`smoke-built` jobs and are
  out of scope for the first-run question.

## Findings

- **0 Blocker, 0 Critical.** No first-run dead-end on either core feature.
- No Major/Minor surfaced in the first-run walk. (Error-recovery and a11y were
  addressed separately this wave: UIUX-02 ScreenError, UIUX-04 heading order.)

## Gate verdict (standalone): ⚠️ PARTIAL CHECK

The walkthrough passed with first-run coverage VALID and the core feature reachable.
Standalone it is **not** the full advancement gate — the audit-team pass is the
other half owed at wave end.
