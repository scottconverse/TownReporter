# TownReporter — how this is actually running

Repository documentation version: **0.6.82**

Repository baseline reviewed 2026-09-30: **0.6.82**, whose release commit is `7cff3d6c`; GitHub published v0.6.82 on 2026-09-28, and `main` is now ahead of that release. See the [0.6.82 release guide](docs/releases/0.6.82.md) for its recorded source and package evidence. Publication does not establish production deployment.

**New installations:** use the [Windows installation guide](docs/windows-install.md), not the machine-specific scripts described below.

**Legacy operator migration for 0.6.27:** maintenance scripts now refuse guessed machine ownership. Before using an existing Halo-style installation's scripts, its local operator must configure `TOWNREPORTER_LEGACY_OPS=1`, `TOWNREPORTER_LEGACY_ROOT` as that checkout's absolute path, its actual `PORT` and loopback `DATABASE_URL`, and absolute `TOWNREPORTER_PG_BIN` / `TOWNREPORTER_PG_DATA` paths for the database it owns. Verify those paths locally; do not copy values from another machine. Packaged installations use their own launcher and refuse the legacy path even if that flag is set. This document is not an instruction for the remote developer to access Halo.

These are **Halo-local operator deployment notes**, not instructions to treat a
remote development machine as production. The paper is hosted at
**https://townreporter.org** on the Halo box in Longmont, through a Cloudflare
Tunnel. “This machine” below refers to Halo.

Production was independently checked on 2026-09-13 at source `c926fc48e8e11ebce437a47bc0fd3c990671ecb8` before packaging 0.6.44. The local and public app answered, the served version matched the build, and published articles were preserved. The [current release record](docs/releases/0.6.82.md) covers the reviewed baseline and records its evidence boundaries; it does not rewrite the dated deployment evidence. A repository version, GitHub tag or release does not establish production version. Earlier machine inventories and receipts below describe their observation dates.

Current development boundaries and queue: [handoff](HANDOFF-NEXT-AGENT.md),
[TODO](TODO.md). Staging and promotion below require a Halo-local operator.

---

## The shape of it

```
visitor -> Cloudflare edge -> tunnel -> 127.0.0.1:3000 (this box)
                                            |
                                            +-- Postgres on 127.0.0.1:5433
                                            +-- Claude Code CLI (your login)
```

The same Node process can also use the signed-in Codex CLI, or a configured
OpenAI-compatible gateway, according to the editor's per-run choice. No new
listener or public port is added.

Nothing listens on a port the internet can reach. The machine dials **out** to
Cloudflare and holds that connection open, so the home IP never appears in DNS
and the router has no port forwarded.

The local network used to be a different story: the server bound `0.0.0.0:3000`
and answered on the LAN, so any device on this Wi-Fi reached the paper and the
desk without passing Cloudflare. `HOST=127.0.0.1` in `.env` closes that, and it
is set. Measured after the change: `netstat` shows `127.0.0.1:3000` and nothing
else, the LAN address refuses the connection, and the public site still answers
200 — which is the point, because the tunnel dials out from this machine and
reaches the server over loopback like anything else here.

If you ever need the LAN back (testing on a phone, say), remove that line and
restart.

---

## Seven scheduled tasks

| Task                          | When        | Does                                                                                                                                |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TownReporter`                | at logon    | starts Postgres, waits for a real query, applies migrations, serves the app; exits non-zero if it cannot |
| `TownReporter Tunnel`         | at logon    | connects the Cloudflare Tunnel                                                                                                      |
| `TownReporter Monitors`       | every 5 min | rechecks watched sources, drains desk jobs                                                                                          |
| `TownReporter Watchdog`       | every 5 min | checks the app, the tunnel and the public URL; restarts what is down; runs the logon task itself if it failed at boot; appends to `logs/watchdog.log` when there is something to say |
| `TownReporter Restart`        | on demand   | stops and starts the paper                                                                                                          |
| `TownReporter Nightly Proof`  | daily 03:30 | runs a real Scan and Draft against `townreporter_dev`; never publishes ([nightly proof](docs/nightly-proof.md))                      |
| `TownReporter Tunnel Restart` | on demand   | stops and starts the tunnel                                                                                                         |
| (Postgres)                    | —           | started by the first task, not separately registered                                                                                |

### Registering them

```
powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1
```

Idempotent — safe to run again after a path change or a rename. Add `-WhatIf`
to see what it would do first.

`ops\install-tasks.ps1` registers the six app and operations tasks above.
**TownReporter Nightly Proof** is registered separately by
`ops\nightly-proof.ps1`; see [the nightly proof guide](docs/nightly-proof.md).

It refuses if the tasks already point at a different checkout, because this
machine has both a production install and a development one and running it
from the wrong folder would silently repoint the live paper at the dev copy.

The two five-minute tasks are launched through `ops/run-hidden.vbs` rather than
`powershell.exe` directly. `-WindowStyle Hidden` does not stop the flash:
Task Scheduler creates the console host in the interactive session and shows it
before the script's own window style applies, so twice every five minutes a
window appeared, took focus, and interrupted whatever was being typed.
`wscript.exe` has no console of its own and starts the child hidden from the
first instant. The security context is unchanged, which matters because the
desk reads the operator's Claude Code and Codex logins out of their own profile.

The last two are tasks rather than child processes of the app for two reasons
learned the hard way: a process cannot restart itself, and a tunnel restart
cannot deliver its own result over the tunnel it has just killed. The Server
page at `/desk/ops` triggers them and reads the watchdog log.

**After a reboot it comes back when you log in, not before.** Both start
triggers are _at logon_ for HALO\scott, and the two five-minute tasks are
interactive as well, so a machine sitting at the lock screen runs nothing. Log
in and everything starts on its own. Tested by stopping the lot and letting the
tasks restart it.

If the paper ever needs to survive a reboot with nobody logging in, the tasks
have to run as S4U ("whether user is logged on or not") — which is a real
change, not a checkbox, because the desk shells out to the Claude Code and
Codex CLIs and those read the operator's login out of their profile.

### What starts after a reboot

In order, once you log in. Nothing here runs before the logon.

| What                             | Started by                                   | When                          |
| -------------------------------- | -------------------------------------------- | ----------------------------- |
| Postgres on 5433                 | the `TownReporter` task (`ops/start-townreporter.ps1`) | logon, first                  |
| The paper                        | the same task, after Postgres **answers a query** | logon, a few seconds later    |
| The Reddit reader (Redlib)       | the same task, detached, then the watchdog   | logon, in the background      |
| Ollama                           | your own Startup shortcut (`Ollama.lnk`)     | logon, by Windows, not by us  |
| The Cloudflare Tunnel            | the `TownReporter Tunnel` task               | logon                         |
| Whatever has stopped since       | the `TownReporter Watchdog` task             | every 5 minutes               |
| A logon start that failed        | the `TownReporter Watchdog` task, by running `\TownReporter` again | 3 minutes after the failure |
| LM Studio                        | nothing here                                 | not started or touched at all |

Three of these are optional and their absence is a supported state, not a
fault. The paper serves either way.

**The wait is for a query, not a port.** Postgres opens the TCP port before it
will accept a query, so a start that only checked the port could sail past a
database still in crash recovery and die on the first thing `migrate` said.
The logon start now asks `select 1` for up to three minutes with backoff, and
writes what Postgres said while it was not ready into `logs/townreporter.log`.
Migrations then run through `cmd.exe`, which owns the redirection, so a child
process's stderr can never terminate the script; each of three attempts and its
exit code is in the log. If the schema is still not current, the start says so
in plain words and **exits non-zero** rather than appearing to have served the
paper — and the watchdog, after a three-minute grace, acts on that by running
the `\TownReporter` task itself. It runs that one registered task, never a
second copy of the start script.

- **Redlib** is the only way the desk reads a Reddit thread in full — post
  body, scores, replies. Without it the desk reads the subreddit through
  Reddit's `.rss` and says so in the source text rather than pretending it read
  the thread. Install or repair it with `ops/redlib.ps1 setup`; check it with
  `ops/redlib.ps1 status`; stop it with `ops/redlib.ps1 stop`. It is stopped
  through the pid file the installation wrote, never by image name. Set
  `TOWNREPORTER_REDLIB=0` in `.env` to leave it alone entirely.
  - **Where it lives matters.** An install made from inside the app sandbox is
    redirected by Windows into
    `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\…`. A scheduled
    task is not a packaged process, so it does not see that merged view: it
    looked at the real path, found nothing, and reported "not installed here"
    while the reader was on disk. The install root is therefore a setting:
    `REDLIB_INSTALL_ROOT` in the app's `.env`, which the tasks can read because
    it is outside AppData. An environment variable with that name wins over the
    `.env` value, and the old AppData path is only the last resort when neither
    is set. Point it at `C:\Users\scott\TownReporterTools\Redlib` and run
    `ops\redlib.ps1 setup` there.
  - **Moving an existing install:** `powershell -ExecutionPolicy Bypass -File
    ops\redlib-relocate.ps1 -To C:\Users\scott\TownReporterTools\Redlib`. It
    copies rather than moves, rewrites the absolute paths inside `install.json`,
    refuses to copy out from under a live reader, and prints the `.env` line to
    add — it never edits `.env` itself. `-DryRun` prints what it would do.
    When the reader is absent but a copy is sitting under a
    `Packages\*\LocalCache` path, `ops/status.ps1` and the Control page say
    exactly that instead of "not installed".
- **Ollama** serves the first rung of the *Automatic* model ladder (DeepSeek
  v4.1 Flash). With it down, *Automatic* walks to the next rung and the paper
  keeps drafting. The watchdog starts it by reading your `Ollama.lnk` target,
  **never stops it** — a model may be mid-draft — and never touches LM Studio or
  its models. Set `TOWNREPORTER_OLLAMA=0` to leave it alone.
- **LM Studio** owns its own models and memory. Nothing in `ops/` starts,
  probes or unloads it.

### Without a terminal

`ops/control.ps1` opens the **Control page** at `http://127.0.0.1:3095` — a page
served by this checkout, on this computer, that says whether the machine is
healthy and puts the menu's actions behind buttons. One large line reads
**Everything is up** or **N things need attention**; under it each check is one
card with a plain verdict and, when it is down, the single button that fixes it.
The rows are the database, the paper, the public site, the Redlib reader,
Ollama, the last backup, the copy of the backups on D:, the last scan, the
**Attention** card and the test copy, and the rows that do not matter — Redlib
and Ollama — are marked optional and never inflate the count. **Attention** says
in the owner's words what is currently wrong, or that nothing is.

The buttons carry the menu's own wording: check, restart the paper, restart the
tunnel, start everything, stop everything, restart the Reddit reader — plus
**Back up now**, which takes a backup and copies it to D: without waiting for
the night.
Pressing one streams its output into the page and refreshes the status when it
finishes. **Stop everything** opens a dialog naming what it will stop and does
nothing if you cancel. The page also links to the public paper, the desk and the
test copy.

Three things about it are deliberate and worth knowing before changing them:

- **It answers on loopback only, and only to itself.** It binds `127.0.0.1` and
  refuses any Host header that is not this server, so nothing on the LAN, the
  tunnel or the internet reaches it. Every button press must also carry a token
  the page holds plus a matching Origin, so another page in the same browser
  cannot press one. It leaves by itself after an hour with no requests.
- **It cannot publish, edit or delete anything.** The six actions are a fixed
  list, each an absolute System32 executable with a fixed argument array and no
  shell, so nothing typed anywhere becomes a command. Ollama is only asked
  whether a model is ready — never loaded or unloaded.
- **The status is one source of truth.** The page renders `ops/status.ps1
  -Json`, so the console and the page cannot disagree about a row they both
  show.

The numbered menu is still there as the fallback, because the page needs the
checkout and Node while the `.cmd` needs nothing but Windows:

`ops/TownReporter Control.cmd`. Double-click, pick a number: check, restart the
paper, restart the tunnel, start everything, stop everything, restart the
Reddit reader — and entry 7, which opens the Control page. It cannot publish or
delete anything either.

For a Desktop icon, run this once:

```powershell
powershell -ExecutionPolicy Bypass -File ops\install-shortcut.ps1
```

By default the shortcut runs `ops/control.ps1` through `ops/run-hidden.vbs`, so
the page opens with no console window behind it. `-Fallback` builds the older
console shortcut instead, as `cmd /k` — deliberately, because a shortcut
pointing straight at the `.cmd` lets the console close the instant the batch
file ends, which is how the answer you asked for disappears before you can read
it. `ops/status.ps1` is the read-only check on its own, and it works when
the paper is down — which is exactly when `/desk/ops` cannot answer.

Manual control:

```bash
powershell -File ops/stop-townreporter.ps1
```

```bash
powershell -Command "Start-ScheduledTask -TaskName 'TownReporter'"
```

---

## Postgres is on 5433, not 5432

**Another Postgres that does not belong to this project already owns 5432 on
this machine.** Its command line is not readable from this account — a
different user or a sandbox. It was left alone.

Ours runs on **5433** so there is no chance the paper writes to the wrong
cluster. Do not "tidy" this back to 5432.

```
DATABASE_URL=postgres://townreporter:...@127.0.0.1:5433/townreporter
```

---

## Signing in from other machines

Yes, from anywhere. It is a normal website.

**Use `https://townreporter.org` — not the LAN address (`192.168.0.x:3000`).**

The session cookie is `__Host-` prefixed, so it is `Secure` and browsers only
store it over HTTPS. On a plain-HTTP LAN address the login appears to work and
then instantly forgets you. The tunnel gives HTTPS everywhere, including inside
the house.

### If sign-in says "Invalid origin"

Every origin the desk is reached from must be listed, or Better Auth rejects
the login while every page still loads normally — which looks like a wrong
password rather than config.

```
BETTER_AUTH_URL=https://townreporter.org
BETTER_AUTH_TRUSTED_ORIGINS=https://www.townreporter.org,http://localhost:3000
```

Add any new origin to that second line and rebuild. `localhost:<PORT>` is
trusted automatically.

---

## The AI

### Claude Code, no key

No API key. When an editor selects a Claude model, or Opinion's Automatic
reaches its final Claude Sonnet rung, the desk shells out to the local **Claude
Code** login, so the subscription powers it. Claude Sonnet is on Opinion's
ladder only; stories, scans and Dark Desk walk DeepSeek v4.1 Flash, then the
local model this computer has loaded if there is one, then Codex Terra, and do not select
Claude on their own. No automatic ladder selects Opus; Opus is an
explicit editor choice. The CLI may also make a small internal Haiku call that
cannot be turned off from here.

The harness is stripped on every call — importantly `--setting-sources ""`,
which keeps your personal `CLAUDE.md` and skills **out** of the newsroom's
prompts. Without it your developer instructions get prepended to every story.

```
# ANTHROPIC_MODEL=claude-sonnet-4-5 # optional configured-Claude override; Automatic never selects Opus
# TOWNREPORTER_CLAUDE_CODE=0        # take the CLI out of the chain entirely
```

If quota bites, restore the Claude login/quota, or pick another provider for
the run.

### Provider rules, per desk action

| Desk work           | Provider rule                                                                                                | Recovery                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Scan and Dark Desk  | per-run picker; Automatic uses a configured gateway first or the shared ladder — DeepSeek v4.1 Flash, then the local model (whichever one LM Studio has loaded), then Codex Terra; named choices are tried first   | technical recovery retries only the unfinished call and records requested/actual model and effort             |
| Daily scan          | one named Codex or Claude model, Local model, or saved Custom AI connection is tried first; technical switches are recorded | repair provider credentials when no ready fallback exists and resume the schedule |
| Story — Automatic   | configured `LLM_*` first when present; otherwise the shared readiness ladder — DeepSeek v4.1 Flash, then the local model (whichever one LM Studio has loaded), then Codex Terra | recognized technical failures retry only the unfinished call and record requested/actual model and effort; refusals stop |
| Story — named       | Codex Astra, Sol, Terra, or Luna; Claude Fable, Opus, Sonnet, or Haiku; Local model; or a saved custom connection is tried first | the job records requested/actual model and effort, any technical switch, and preserved checkpoints |
| Opinion             | Automatic starts Codex Sol → Claude Sonnet; named choices are tried first; technical retry is per unfinished call | the completed row records the provider that delivered; refusals stop |

For ordinary Story calls, Codex uses the signed-in account only to authenticate
its CLI requests; the call does not inherit the operator's full Codex setup.
Each call ignores Codex user configuration, starts from the system temporary
directory, runs ephemerally with a read-only sandbox, and disables shell,
computer, browser, apps, plugins, multi-agent and hook features. Built-in web
search is added only when the application's trusted caller requests research.
That is an application-level tool boundary, not an operating-system security
sandbox: the reporting process still runs as the Windows account, and the
read-only setting does not by itself restrict which files that account can read.
Assignments travel over stdin; Opinion loads the complete voice through the native instruction-file setting. Timeout cleanup targets only
the spawned PID tree. If OAuth expires, open Codex and sign in again; the app
does not read or store the token.

Opinion rejects provider refusals, assistant notes, implausible headlines, and
incomplete bodies before draft storage. The Opinion picker offers Automatic,
Codex Astra, Sol, Terra, and Luna; Claude Fable, Opus, Sonnet, and Haiku; Local model; and custom connections;
Opinion's Automatic can move from Codex Sol to Claude Sonnet once when Codex is unavailable. A failed request has no draft
or Publish action.

`npm test` makes no model call and costs nothing: it runs the whole suite with
no provider contacted. Its fail-closed launcher removes any inherited
`DATABASE_URL`, `VERCEL`, and `VERCEL_ENV` before startup so table-wide fixture
cleanup cannot reach the live database. Tests that require Postgres create and
opt into their own disposable database after that guard. The src group runs one
file at a time on purpose — several tests each stand up an embedded database,
and running them at once exhausts memory on a smaller machine — so it is
thorough rather than fast.

The live model path has its own opt-in script, so nobody spends quota by
running the ordinary suite:

```bash
RUN_LIVE_MODEL_TESTS=1 npm run test:live-model
```

That opt-in example is for a POSIX shell. In PowerShell, set
`$env:RUN_LIVE_MODEL_TESTS = '1'` before running `npm run test:live-model`.
Without the flag, the live evaluation is skipped.

---

## Email

`tips@townreporter.org` forwards to the Gmail on the Cloudflare account, via
Cloudflare Email Routing. Free. **Receive only** — replies come from Gmail, not
from `tips@`.

Verified by sending a real message and receiving it.

DNS in place: 3 MX records, DKIM, SPF, DMARC.

**SPF is `~all`, not `-all`.** Cloudflare's routing record replaced a stricter
one, because two SPF records break SPF entirely — mail servers treat a
duplicate as a permanent error and stop checking. Enforcement comes from DMARC
`p=reject`, which is unchanged, so spoofed mail is still rejected.

**No catch-all.** Only `tips@` exists; anything else bounces. Add more
addresses as routing rules.

If you ever want to _send_ from `tips@`, the SPF record must be widened to
permit the sending provider, or your own mail will be rejected.

---

## Routine jobs

```
GET /api/cron/monitors
Authorization: Bearer <CRON_SECRET>
```

Runs every 5 minutes via `ops/cron-tick.ps1`, which reads the secret from
`.env`. Without the header: 403. With `CRON_SECRET` unset: 503 and does
nothing — deliberate, so an unconfigured box cannot be poked into working.

---

## Backups

### Where they live, and how many

| Where | What is kept | Set by |
| --- | --- | --- |
| `..\townreporter-backups` — the folder beside this checkout | the newest **3** | `ops\lib-backup.ps1` |
| `D:\TownReporter-backups` | **everything**, while there is room | `BACKUP_OFFSITE_DIR` in `.env` |

Each file is `<database>_YYYY-MM-DD_HHmm.sql` — a plain-SQL `pg_dump` of the
whole database, about 700 MB for the working edition. The local folder is a
sibling of the app directory on purpose: it is outside every build, promotion
and rollback path, so none of those can take a backup with it.

The local folder is pruned to the newest three **only after every local file has
been proved to be on D:** — same size, same SHA-256, checked on every run. If D:
is missing, will not take a write, has less than 100 GB free, or a copy fails
its check, **nothing local is deleted** and the Control page's **Attention** card
says why. Nothing ever deletes from D:; a full D: stops the copies and alerts,
and the drive is emptied by a person.

### One-off items: anything else left in the backups folder

The newest-three rule above only ever looks at the dated `<database>_YYYY-MM-DD_HHmm.sql`
series. Anything else sitting in that folder — a hand-named `.sql` export, an
old pg_dump `.dump`, or a whole folder someone left there before an upgrade
(a pre-migration snapshot, a recovery copy, and so on) — is a **one-off item**,
and every run copies those to D: too, verified the same careful way: a file is
proved by size and SHA-256, a folder by file count, total bytes, and a SHA-256
of every file inside it. They land in `D:\TownReporter-backups\other-safety-copies\`,
never mixed in with the dated series.

One-off items are never touched by the newest-three rule, and they are not
kept on C: forever either: once a one-off item is **verified on D: and at
least 14 days old**, it is removed from the local folder — never from D:,
which keeps everything. An item that is too young, or that has not verified
yet, is left alone and the log says which. Something that looks like it might
still be being written — a `.incomplete` or `.partial` file, or anything
touched in the last 10 minutes — is skipped for that run and picked up again
once it has settled, rather than copied half-finished.

A backup is taken **once a night** by the five-minute watchdog: after 2:00 AM
local, when the newest backup is older than 20 hours, and not while an editor
job is running. A lock file means two never run at once. There is no separate
backup task to register.

To take one by hand at any time — safe while the paper is running — use the
Control page's **Back up now** button, or:

```powershell
pwsh -NoProfile -File ops\backup.ps1            # dump, copy to D:, prune, alert
pwsh -NoProfile -File ops\backup.ps1 -Offsite   # copy what is already here; no dump
pwsh -NoProfile -File ops\backup.ps1 -Keep 5    # keep more than 3 locally
```

The log is `logs\backup.log`, and the report the Control page reads is
`logs\backup-state.json`. Moving the sixty-odd backups an older installation
already has is one run of `-Offsite`; it is a person's one-time step, not
anything the machine does by itself.

### Restoring

Stop the paper first (`Stop everything` on the Control page, or
`ops\stop-townreporter.ps1`), so nothing writes while the database is replaced.
Take the newest file from either folder and load it into a **new, empty**
database — do not restore over the live one, and do not let a restore be the
thing that loses the data you were trying to save:

```powershell
$pg = "$env:USERPROFILE\scoop\apps\postgresql\current\bin"
& "$pg\createdb.exe" -p 5433 -U postgres townreporter_restored
& "$pg\psql.exe" -p 5433 -U postgres -d townreporter_restored -v ON_ERROR_STOP=1 `
    -f "D:\TownReporter-backups\townreporter_2026-09-26_0215.sql"
```

Point `DATABASE_URL` in `.env` at `townreporter_restored`, start the paper, and
check it. If the restore is good, either keep serving from it or rename the two
databases; the old one is still on disk either way. The dumps are plain SQL, so
a partial or hand-edited restore is possible with the same `psql` — but a
truncated dump is a failed backup here, not a short one, so if the file was cut
short, use the previous night's.

### Turning on phone alerts

Alerts reach the Control page and a Windows notification with no setup. The
phone push is opt-in and **off by default** — nothing leaves this machine until
you set it:

1. Install the [ntfy](https://ntfy.sh) app, or open `https://ntfy.sh/` in a
   browser, and subscribe to a topic whose name nobody can guess — the topic
   name is the whole secret, and anyone who knows it can read the alerts and
   send to them.
2. Put that topic in `.env` on the machine that runs the paper:

   ```
   ALERT_NTFY_TOPIC=your-long-unguessable-topic
   ```

3. That is all — the watchdog picks it up on its next run. To stop the push,
   remove the line or leave it empty.

What is sent is the alert's own sentence — "The paper is not answering on this
machine", or "No backup has been taken in over a day" — and, when it clears,
that same sentence with "-- this has cleared" after it. Nothing else goes: no
story text, no database contents, no editor's work. It goes to
`https://ntfy.sh`, which is a public service; a self-hosted ntfy is a one-line
change to `Send-TownReporterAlertPush` in `ops\lib-alert.ps1` if that matters to
you. Each alert pushes once when it starts and once when it clears, so a phone
does not buzz every five minutes.

---

## Updating this installation

**Never build beneath a running server.** Replacing a served `.output` can leave
the page answering 200 while its scripts and editor controls fail. This applies
even when no database migration is needed.

**The server refuses to start when migrations are behind.** It compares
`migrations\*.sql` with the database's `_migrations` ledger before it serves its
first request; if any file has not been applied it logs the missing file names
and answers 503 instead of serving a half-migrated desk. Apply them and start it
again: `npm run db:migrate` (or
`node scripts\with-app-env.mjs node scripts\migrate.mjs`). `ops\promote.ps1` and
the installer already migrate before they start the app, so this only fires on a
start that skipped that step.

**Stage first:** `ops\stage.ps1` in the dev checkout runs the new build
against a copy of real production data and serves it locally so the changed
screens can be walked before anything is promoted. See `docs/staging.md`.

1. Make and verify changes in
   `C:\Users\scott\Desktop\Code\townreporter-dev`, with the development or a
   disposable database. Before building there, confirm no process is serving
   that checkout's `.output`. Do not build in the running production checkout.
2. Obtain approval for the exact release candidate and its tag/promotion. A
   push or merge is not a production deployment. The promotion script follows
   `origin/main`, not a tag, so verify that `origin/main` is the exact approved
   commit before starting it.
3. In Task Scheduler, disable **TownReporter Watchdog** for the promotion. Use
   `C:\Users\scott\Desktop\Code\townreporter-web\ops\promote.ps1` from the
   production installation, not a sequence of hand-typed build/restart steps.
   The script refuses tracked uncommitted changes and checks fast-forward
   conflicts before stopping the app.
4. The script backs up the database, copies it, stops only this
   installation's server, updates its checkout, builds while that server is
   down, and starts it again.
   It leaves the shared Postgres cluster running. Its promotion marker also
   tells the watchdog to stand down; it does not build in the development
   checkout on your behalf.
   Before it stops the server, it also refuses to promote while an editor has
   a desk job (a draft, a scan, a Dark Desk round, an Opinion piece) running
   or queued -- restarting under one orphans it, and while the 120-second
   stale-reclaim always recovers it automatically, there is no reason to make
   an editor watch that happen. It prints the open job(s) and stops. Pass
   `-WaitForJobs` to have it poll every 15 seconds, up to 15 minutes, for them
   to clear on their own, or `-Force` to proceed anyway with a loud warning.
   **Boot-time schema warm-up (0.6.80):** before the restarted server accepts
   its first request, it runs every module's `ensure*Schema` DDL once (the
   same batches that used to run lazily on whatever request happened to touch
   them first). Watch for one `[schema-warmup] <module> <ms>ms <status>` line
   per module in `logs\` right after start -- `status` is `ran` (it issued
   DDL, expected right after a release that added or changed a table),
   `skipped-by-marker` (nothing to do, the normal case), or `failed` (that one
   module is logged and left for its own first request; it does not stop the
   server). This is what step 4's stop-the-app window exists to protect
   against in the first place: a module's first use meeting the nightly
   backup's lock. `scripts\schema-warmup.mjs` runs the same warm-up standalone
   (`node scripts\with-app-env.mjs node scripts\schema-warmup.mjs`), for
   example right after a manual `db:migrate`, without starting the server.
5. Require the local page, public page, a script named by the served HTML, and
   the published-story count to pass the script's checks. Verify the served
   version matches the approved release. A homepage 200 alone is not proof.
6. Re-enable **TownReporter Watchdog** after the promotion has finished, or a
   failed promotion has been deliberately stopped and no build is still
   running. Keep the named backup and inspect the reported failure before
   deciding how to recover. A promotion that fails before the new build is
   serving puts the database copy back by itself (see "The database copy taken
   before every promotion" below); one that fails after it does not, and prints
   the command that does.

### The database copy taken before every promotion

`npm run build` ends in the database migration, so a promotion that dies
half way through one leaves the database moved on and the previous build
unable to serve it -- a page reading a table or column a migration changed
answers wrongly rather than failing. The previous-build fallback does not
cover that; a copy of the database does.

So the promotion copies the database before it builds:

- **The name.** The copy is `<database>_prerollout_<yyyyMMddHHmmss>`, named
  after the second the run started, where `<database>` is the last path
  segment of `DATABASE_URL` in `.env` -- normally `townreporter`. If the
  rollout fails, the database it was serving becomes
  `<database>_failed_<same stamp>` and the copy takes its name back, so the
  paper is serving exactly the data it had before the promotion started.
  **Nothing is ever deleted**, by the promotion or by anything in this
  repository. Old copies and `_failed_` databases are the owner's to remove
  by hand; until they are, they take disk.
- **When.** After the app is stopped and everybody has finished connecting to
  the database, because PostgreSQL will not copy a database anybody is
  connected to. The script waits up to 30 seconds for the connections to
  close and then **refuses** -- it never ends another session. On a shared
  server those sessions belong to the live paper, the development copy and
  other people's tests.
- **What it checks first**, all before the paper is stopped: that the name
  starts with `townreporter` (so a typo cannot rename somebody else's
  database on this machine), that neither the copy's name nor the failed
  name is already taken, that the role it connects as may create databases
  (`CREATEDB` or superuser -- an install whose app role is not allowed to can
  set `PROMOTE_ADMIN_DATABASE_URL` in `.env` to a connection that is), and
  that the drive holding PostgreSQL's data directory has room for the
  database **plus a quarter of its size or 2 GB, whichever is larger**. When
  PostgreSQL is on another machine and that drive cannot be read, the check
  refuses with a sentence rather than skipping.
- **The disk it needs.** The copy is a second database of the same size, and
  the check asks for that plus a margin of a quarter of the database or 2 GB,
  whichever is larger. For a 570 MB paper that is about 2.6 GB free (570 MB
  for the copy itself, 2 GB of margin). A failed rollout uses no more: the
  database that was live is renamed, not duplicated. Copies are never removed
  automatically, so the free space they take is the owner's to reclaim.
- **What it costs the machine.** `CREATE DATABASE ... TEMPLATE` forces a
  checkpoint on the whole Postgres cluster, so every other database on the
  box waits for it. Measured on a throwaway Postgres 18.6 with nobody
  connected: 4.4 seconds to copy a 545 MB database and 0.47 seconds for the
  two renames of a swap-back. **Expect more on a busy server** -- that is what
  the step's ten-minute limit is for, not a budget.

The step is not allowed to run forever. The copy and the swap-back each get
ten minutes and the database checks two; past its limit the step is stopped
the same way the npm steps are, by PID and never by name.

**Nothing but the promotion can reach the paper's database.** The database
work runs in `ops\lib-promote-db.mjs`, and every one of its commands refuses a
connection string pointing at **port 5433** -- the port the live Postgres uses
on the machine that runs it -- unless the call carries the flag that only
`ops\promote.ps1` sets when it runs for real. The connection string lives in
`.env`, which is exactly what a test or a hand-typed command on that machine
inherits, so the port itself is what is guarded.

Two things follow that an operator will notice on that machine:

- `node ops\lib-promote-db.mjs ...` run by hand against 5433 is refused with a
  sentence saying what to run instead. That is the point of it.
- a `-WhatIf` promotion does NOT carry the flag -- a dry run renames nothing --
  so **on an install whose database is on 5433, `-WhatIf` stops at the database
  preflight** with that same refusal. The dry run is still a dry run; it just
  cannot complete its read-only database checks. Everything after the checks is
  skipped under `-WhatIf` anyway.

### Rolling the database back by hand

A promotion that gets as far as serving the new build and then fails its own
checks is **not** rolled back -- by then the new app has been taking writes,
and putting the copy back would throw them away silently. Instead the script
prints the exact one-line command that does it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\scott\Desktop\Code\townreporter-web\ops\promote.ps1" `
  -RollbackDatabase townreporter_prerollout_20261001120000
```

**It refuses while the paper is answering on its port.** A promotion that
failed its own health checks leaves the app UP and serving -- that is the case
this command is printed for -- and swapping a database out from under a running
app is not something to arrive at by accident. So the first thing it does is
ask, and if the paper answers it stops having changed nothing:

> The paper is answering on port 3000. Stop it first, or run the promote's own
> recovery; nothing was changed.

Stop the app by hand and run it again, or add `-StopApp` and it will stop the
app by PID itself (exactly as the promotion does, and only ever the process
holding this install's own port).

**It says what it is about to do before it does it**, in the log and on the
console, with names and sizes -- which is what tells you that you picked the
right copy:

> townreporter_prerollout_20261001120000 (570 MB) becomes townreporter; the
> current townreporter (610.4 MB) is kept as townreporter_failed_20261001120000.

It then waits for every connection to the live database to close (refusing
rather than ending anyone's session), renames the live database aside as
`townreporter_failed_<now>`, puts the copy in its place, puts the build from
before the promotion back and starts it. **Anything written since the new app
started is lost** -- the copy is a picture of the database from before those
writes. That is the whole reason nothing does this by itself.

`-WhatIf` prints that same sentence and changes nothing at all, which on this
path matters more than anywhere else in the script: it is the only place where
the thing being undone cannot be redone.

It runs immediately, whatever else is going on: it does not wait for an
unfinished promotion's marker, check the checkout, or take a backup.

The log names both databases at every database step, and the last line of a
failed run's log says which database holds what. A promotion that fails
anywhere after the copy -- the install, the fast-forward, the build, or a new
build that never answers -- puts the copy back by itself, restores the
previous build and says in plain words that no data was lost, because the
paper was stopped from before the copy was taken.

### The promotion's own log

Every promotion writes `logs\promote-<date>-<time>.log` in the install it is
promoting, and prints that path as its third line. It has one line per step,
stamped with the time, and for each command it runs (the dependency install,
the build) the command, its real exit code and how long it took. The output
those commands produce -- which is where a failed install explains itself --
is in files beside the log, named after it and the step, such as
`promote-20261001-090000-deps.err.log`. Read those before anything else when a
promotion fails; before this existed there was nothing to read at all.

**No step is allowed to run forever.** The dependency install and the build
each have twenty minutes; the wait for the restarted app to answer has one.
Past its limit a step is stopped -- the process and everything under it, by
PID, never by name, so no other copy of the app on this machine is touched --
and the promotion fails the ordinary way, which means the previous build goes
back and starts. The log says `step=<name> TIMED OUT after <n>s -- killed PID
<n>`. If a step is genuinely that slow, raise its limit in
`ops\lib-promote.ps1`; do not wait it out.

### Carrying on from a promotion that stopped

If a promotion stops part way -- the machine restarts, the window it was
started from is closed, the install fails -- it leaves `logs\promote-in-progress`
behind. Running the script again will not start over on top of it: it reads the
last run's log, tells you which step that run reached and which step it would
carry on from, and stops. Re-run it with `-Resume` to continue from that step
instead of starting over; delete `logs\promote-in-progress` to start over
deliberately. Whenever the script stops and the paper is not answering, the
last line it prints is the exact command that brings the paper back.

### "The paper is back on the OLD version"

The build that was running is kept aside before a new one is built, so when the
new build does not work -- it fails, or the restarted app never answers -- the
script puts the previous build back, starts it, and says in the log, in those
words, that the paper is back on the OLD version and the promote did not
complete. The paper is up and serving, but on yesterday's code: the release did
not land, so fix the build and promote again. This is the one case where the
script undoes something by itself. A promotion that gets as far as serving the
new build and then fails its own checks is NOT rolled back -- the app is up,
and an automatic rollback of an already-applied migration would be worse than
the thing being reported. That case still says so loudly and names the backup.

**The database goes back with it.** Since the copy landed, this fallback puts
the copy back *before* it starts the old build, and then says in plain words
that no data was lost because the paper was stopped the whole time and where
the failed rollout's schema is kept. See "The database copy taken before every
promotion" above. If the copy could not be put back -- somebody was still
connected to the database -- the message says that instead, in full, and the
database keeps whatever the failed rollout did to it.

**Then read the sentence after it about the database.** `npm run build` ends in
the database migration, so an old build can be put back on top of a database
that has already moved forward -- which is what happens when the copy could NOT
be put back, and the build/migration failed. When that has happened the message
does not stop at "the OLD version"; it says which migration the database is at
--

> the paper is back on the OLD version, but the database was already migrated
> to 0117_source_replaces.sql; if this build reads a table or column a migration
> removed, tell the developer before continuing

-- or, when the build died part way through the migration and the script cannot
honestly say where the database got to, "migrations may have run" instead of a
name. Either way the paper is up, but a page that reads something a migration
changed can answer wrongly rather than fail, so do not treat "the site is up"
as "the promotion was fine": tell the developer before promoting again.

If promotion hangs, inspect the app and
`C:\Users\scott\Desktop\Code\townreporter-web\logs` first. Stop only a
confirmed hung promotion's own PID if needed; never stop processes by image
name or touch unrelated servers, the tunnel, or the shared database.

---

## Moving to a VPS later

Nothing here is home-specific. Copy the folder, install Node and Postgres, run
`claude` and sign in **on that machine** (there is no key to copy), same
`.env`, then `npm run build && npm start`. Move the tunnel or point DNS
straight at the server.

To build for Vercel instead:

```bash
NITRO_PRESET=vercel npm run build
```

Note that Vercel disables the Chromium page reader and chops up the background
jobs. That is why self-hosting is the default.


## Current Opinion document and review workflow

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Opinion defaults to Codex Sol; Opinion's Automatic tries Codex Sol, then Claude Sonnet. Both subscription writers read the complete configured voice using native instruction-file options and can research while writing. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review and blocked from publication until repaired. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](docs/editor-desk.md) for the complete editor flow.
