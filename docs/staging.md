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
4. Runs `npm run build` (skip with `-NoBuild` to reuse the existing `.output`).
   The build's own `db:migrate` step runs against `townreporter_dev` here --
   this is the point: any migration meets real production data in staging
   first, never for the first time on the live paper. Prints which migrations
   were applied.
5. Starts the built server on `-Port` (default 3100), verifies `/` answers 200,
   the page's own entry script asset serves 200, and the served version asset
   names the version in `package.json`. Records the server's PID to
   `ops\.stage.pid`.

When it finishes it prints:

```
STAGING UP: http://127.0.0.1:3100/desk -- walk the changed screens, then run ops\stage.ps1 -Stop
```

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
