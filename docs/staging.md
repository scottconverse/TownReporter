# Staging: run the new build against real data

Before every promote, the new build gets run against a copy of REAL production
data and the changed screens get walked by a human. `ops\stage.ps1` in this
checkout is the one command that does that.

It never touches the live paper. It only ever restores into `townreporter_dev`
on `127.0.0.1:5433`, builds this checkout, and serves it on a local port
(default 3100). It refuses `-Port 3000` outright and asserts the target
database name before it drops anything. It cannot reach `townreporter` (the
live database) or port 3000 (the live paper) even by mistake in its own
argument list.

## The command

```
cd C:\Users\scott\Desktop\Code\townreporter-dev
powershell -ExecutionPolicy Bypass -File ops\stage.ps1
```

That:

1. Refuses if this checkout has uncommitted tracked changes (pass `-AllowDirty`
   to override).
2. Picks the newest backup in `..\townreporter-backups` (or the one named by
   `-Backup <path>`), prints its name and size, and refuses anything under 1 MB.
3. Terminates connections to `townreporter_dev`, drops and recreates it, and
   restores the dump into it with `psql`. Prints the story count so you can see
   real data landed.
4. Upserts a staging sign-in into `townreporter_dev` via
   `scripts\stage-editor.mjs` (skip with `-StageEditor:$false`). See
   "Signing in on staging" below.
5. Runs `npm run build` (skip with `-NoBuild` to reuse the existing `.output`).
   The build's own `db:migrate` step runs against `townreporter_dev` here --
   this is the point: any migration meets real production data in staging
   first, never for the first time on the live paper. Prints which migrations
   were applied.
6. Starts the built server on `-Port` (default 3100), verifies `/` answers 200,
   the page's own entry script asset serves 200, and the served version asset
   names the version in `package.json`. Records the server's PID to
   `ops\.stage.pid`.

When it finishes it prints:

```
STAGING UP: http://127.0.0.1:3100/desk -- walk the changed screens, then run ops\stage.ps1 -Stop
staging sign-in:  staging@townreporter.test / staging-walk-2026
(exists only in townreporter_dev -- gone on the next restore; see docs\staging.md)
```

## Signing in on staging

The backup restored into `townreporter_dev` is a copy of REAL production
data, and that includes the real owner's account -- but not their password,
which nobody except the operator knows. Without a second account, nobody
else can open the staged desk at all.

`ops\stage.ps1` fixes that automatically (unless run with
`-StageEditor:$false`): right after the restore, it runs
`node scripts\stage-editor.mjs` against `townreporter_dev`, which upserts a
second, disposable editor account:

```
email:    staging@townreporter.test
password: staging-walk-2026
```

That account is a newsroom `editor`, not `owner` -- `newsroom_members` only
ever allows one `owner` row (a unique partial index enforces it, and the
restored backup's real owner already holds it), so a second owner is not
possible here even if it were desirable. An `editor` can open every desk
page, including `/desk/ops` (the Server page): a handful of owner-only
panels there (Writing models sign-in, Paper setup, Invite an editor) simply
do not render for a non-owner, but the page itself, and everything else
under `/desk`, is fully visible.

**These credentials exist ONLY inside `townreporter_dev`.** They are written
directly into that database's own `user` / `account` / `newsroom_members`
tables -- there is no copy anywhere else, not in this repo, not in
production. The next time `ops\stage.ps1` restores a fresh backup, the whole
database (including this account) is dropped and recreated from that backup,
so the staging sign-in is gone until the script's staging-editor step runs
again, which it does by default on every restore.

You can also (re-)run it by hand against a running staging copy:

```
$env:DATABASE_URL = "postgres://postgres@127.0.0.1:5433/townreporter_dev"
node scripts\stage-editor.mjs
```

It refuses to run against any database whose name is not exactly
`townreporter_dev` -- including `townreporter`, the live paper's database --
and it is idempotent: running it again just updates the password in place,
never creates a duplicate account.

## Walk the changed screens

"Walk the changed screens" means: open `http://127.0.0.1:3100/desk` (sign in --
this is a full copy of production, so your production account exists here
too), and click through every screen this change touches, the same way
`docs/manual.md` or a release walkthrough would. Not just the front page
answering 200 -- the actual editor flows: the queue, drafts, publishing,
sources, whatever the diff touches, with real articles, drafts and leads
in front of you instead of an empty database. If a screen depends on data
shape (a migration, a new column, a changed query), this is where that shows
up before it reaches the live paper.

## Other commands

```
powershell -ExecutionPolicy Bypass -File ops\stage.ps1 -Status
powershell -ExecutionPolicy Bypass -File ops\stage.ps1 -Stop
```

`-Status` reports whether staging is up, which version it is serving, and
which backup it was restored from (from `ops\.stage.json`).

`-Stop` tree-kills only the PID recorded in `ops\.stage.pid` -- never by image
name -- removes the pid file, and confirms the port is free.

## What it never does

- Never touches port 3000 or the `townreporter` database. Those are the live
  paper; `ops\stage.ps1` only ever knows about `townreporter_dev` and
  whatever `-Port` you give it (never 3000).
- Never commits, pushes, or tags anything.
- Never stops a process by image name -- only the specific PID it started,
  recorded in `ops\.stage.pid`.
