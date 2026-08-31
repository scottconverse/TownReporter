# GauntletGate report — TownReporter — v0.5.6 walkthrough confirmation

**Date:** 2026-08-31 · **Build/commit:** 0704e91afcfd2b4510def8faa0aafcf68ed88d80 ("The setup step's fill only counts when it survives a pause.") · **Run by:** Sonnet 5 agent (delegated two-part execution)
**Lanes run:** walkthrough · **Lanes NOT run:** lite, full
**How run / environment:** local build+server on port 3199, isolated in-memory PGLite (no throwaway Postgres needed), Playwright (chromium 1.62.1) driving the real UI as a new operator with city "Kettleford, Vermont".

## Verdict

PARTIAL CHECK — lanes run: walkthrough. This is NOT an advancement gate. Run gauntletgate all for a clear-to-advance decision.

- First-run: reaches core feature YES. First-run coverage: VALID.
- Severity roll-up: Blocker 0, Critical 0, Major 1, Minor 1, Nit 0.
- All 7 requested checks (incl. 5a-5d) PASS under a properly verified isolated environment.

See the full narrative report delivered in chat for the environment attestation table, item-by-item evidence, findings F1/F2, static analysis results, and sign-off checklist. Evidence artifacts (57 files) are in this directory: isolation-verified.txt, build-isolated.log, server-fresh2.log, ports-before.txt/ports-after-iso.txt, pw-setup-field-values.json, pw-desk-setup.png, pw-after-setup-submit.{html,png}, pw-public-home-postsetup.{html,png}, pw-about-postsetup.html, pw-corrections-postsetup.html, pw-how-we-report-postsetup.html, pw-desk-ops-server.{html,png}, pw-welcome-article.html, about/corrections/how-we-report-presetup-iso.html, desk-setup-presetup-iso.html, watch-list-presetup-iso.html, item7-home.html, server-item7.log, typecheck.log, lint.log, plus pw-*.mjs driver scripts.

Findings:
F1 (Major) - scripts/with-app-env.mjs:158-159 silently forwards the real .env DATABASE_URL (port 5433) with no isolation flag; this run's first attempt hit this trap and had to be redone.
F2 (Minor) - scripts/first-run-setup-step.mjs:18 defaults city to "Longmont" in e2e fixtures; explains historical Longmont noise in test artifacts, not a product defect.
