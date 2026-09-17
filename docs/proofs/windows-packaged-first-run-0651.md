# Packaged Windows first-run browser walk (2026-09-17)

**Candidate:** the packaged install recorded in [the clean-data-root proof](windows-host-install-0651.md), built from exact commit `2bd8230315c438bdfce9a55ebd7c5dd5cf8b8c41`.

**Environment:** the packaged server and its bundled PostgreSQL were restarted on the clean data root using `installer\Start.ps1 -NoBrowser`:

- app: `127.0.0.1:4388`
- PostgreSQL: `127.0.0.1:15432`
- source package: `TownReporter-0.6.51`
- data root: `C:\Users\scott\Documents\Codex\2026-09-16\resume-the-directive-from-the-existing\work\host-install\data`

**Run:** Playwright opened `/login` on the packaged server, created the first owner account, completed the real first-run paper setup (`Packaged Ledger`, Longmont, Colorado), and landed on `/desk`.

**Result:** `{"ok":true,"url":"http://127.0.0.1:4388/desk","paperNamed":true,"errors":[]}`

The browser walk recorded no page or console errors, and the Desk body contained the configured paper name.

**What this proves:** the packaged Windows installation can start its bundled PostgreSQL and built server, create the first owner, save paper setup, and reach the Editor's Desk on the installed database.

**What this does not prove:** a different physical fresh machine or a human operator's unassisted walk. This is an automated browser walk on the same host, using the packaged installation and a clean data root.
