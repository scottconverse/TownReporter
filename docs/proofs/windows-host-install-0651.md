# Packaged Windows install on a clean data root (2026-09-17)

**Candidate:** `TownReporter-0.6.51-windows-x64.zip`, built from exact commit `2bd8230315c438bdfce9a55ebd7c5dd5cf8b8c41`, SHA-256 `e19d5b3909d619c183b532ccdd56c45ffeaab022e32dc6cf96853e2424bdf14f`.

**Run:** the candidate ZIP was extracted to a fresh folder and `installer\Install.ps1` was run with a new data root and isolated ports:

- app: `127.0.0.1:4388`
- PostgreSQL: `127.0.0.1:15432`
- data root: `C:\Users\scott\Documents\Codex\2026-09-16\resume-the-directive-from-the-existing\work\host-install\data`

**Result:** installer exit `0`.

The installer downloaded and verified Node.js `22.23.2` and PostgreSQL `17.11`, installed the locked application dependencies, installed browser support, completed the production build, applied the database setup, and reported:

`TownReporter is ready: http://127.0.0.1:4388/desk`

Independent checks after installation:

- `http://127.0.0.1:4388/` returned HTTP `200`, length `12,780`, and contained `0.6.51`.
- `http://127.0.0.1:4388/desk` returned HTTP `200`.
- The data root contained `config.json`, `pgdata`, `initialize.log`, `postgres.log`, `dependencies.log`, `build.log`, `migrate.log`, `app.out.log`, `app.err.log`, `browsers/`, `tools/`, and installation records.
- `installer\Stop.ps1` stopped the installed server and its owned PostgreSQL instance cleanly; persistent data was retained.

**What this proves:** the packaged installer can provision its runtimes, build the application, initialize its isolated database, start the built server, and answer both the public and Desk routes on a clean data root.

**What this does not prove:** a fresh Windows machine or a human first-run editorial walk. The separate Windows Sandbox attempt was blocked by sandbox network isolation before dependency download, so it is recorded as inconclusive rather than as a product failure.
