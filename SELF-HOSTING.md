# TownReporter — how this is actually running

Live at **https://townreporter.org**, served from a Node process on this
machine through a Cloudflare Tunnel. No hosting bill, no ports open on the
router.

The live-deployment notes below record the established setup as of the
tagged **v0.6.4** build, which is what the production checkout runs.

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

## Six scheduled tasks

| Task                          | When        | Does                                                                                                                                |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TownReporter`                | at logon    | starts Postgres, applies migrations, serves the app                                                                                 |
| `TownReporter Tunnel`         | at logon    | connects the Cloudflare Tunnel                                                                                                      |
| `TownReporter Monitors`       | every 5 min | rechecks watched sources, drains desk jobs                                                                                          |
| `TownReporter Watchdog`       | every 5 min | checks the app, the tunnel and the public URL; restarts what is down; appends to `logs/watchdog.log` when there is something to say |
| `TownReporter Restart`        | on demand   | stops and starts the paper                                                                                                          |
| `TownReporter Tunnel Restart` | on demand   | stops and starts the tunnel                                                                                                         |
| (Postgres)                    | —           | started by the first task, not separately registered                                                                                |

### Registering them

```
powershell -ExecutionPolicy Bypass -File ops\install-tasks.ps1
```

Idempotent — safe to run again after a path change or a rename. Add `-WhatIf`
to see what it would do first.

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

### Without a terminal

`ops/TownReporter Control.cmd`. Double-click, pick a number: check, restart the
paper, restart the tunnel, start everything, stop everything. It cannot publish
or delete anything.

For a Desktop icon, run this once:

```powershell
powershell -ExecutionPolicy Bypass -File ops\install-shortcut.ps1
```

It creates the shortcut as `cmd /k`, deliberately. A shortcut pointing straight
at the `.cmd` lets the console close the instant the batch file ends, which is
how the answer you asked for disappears before you can read it. `ops/status.ps1` is the read-only check on its own, and it works when
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

### The default: Claude Code, no key

No API key. The desk shells out to your local **Claude Code** login, so the
subscription powers it.

Model: **Claude Opus 5**. The CLI also makes a small internal Haiku call per
request that cannot be turned off from here.

The harness is stripped on every call — importantly `--setting-sources ""`,
which keeps your personal `CLAUDE.md` and skills **out** of the newsroom's
prompts. Without it your developer instructions get prepended to every story.

```
# ANTHROPIC_MODEL=claude-opus-5     # the default
# TOWNREPORTER_CLAUDE_CODE=0        # take the CLI out of the chain entirely
```

If quota bites, restore the Claude login/quota, or pick another provider for
the run.

### Provider rules, per desk action (v0.5.7)

| Desk work           | Provider rule                                                                                                | Recovery                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Scan and Dark Desk  | configured `LLM_*`, Anthropic/Claude Code, or Grok path                                                      | repair the configured endpoint/key or sign back into Claude Code                                              |
| Story — Automatic   | configured `LLM_*` exclusively when present; otherwise Claude Opus → Codex Terra readiness ladder            | repair the provider named on the failed job; a run stays pinned to one provider                               |
| Story — explicit    | Codex Terra, Codex Sol, or Claude Opus; no fallback                                                          | open and sign into the named CLI                                                                               |
| Opinion             | Claude Opus only, through the signed-in Claude Code session; Codex is not offered for editorials             | open Claude Code and renew its login; the completed row records the provider that delivered                   |

Codex reuses the signed-in user's native configuration and full available
Windows access. TownReporter does not disable search, shell/files,
browser/computer tools, apps, plugins, hooks, skills, user rules, repository
instructions, or multi-agent capability, and it launches with
`danger-full-access`. Prompts travel over stdin and timeout cleanup targets only
the spawned PID tree. If OAuth expires, open Codex and sign in again; the app
does not read or store the token.

Opinion rejects provider refusals, assistant notes, implausible headlines, and
incomplete bodies before draft storage. Codex is not offered for editorials
because its model declines to write a piece that takes a position; the
Opinion picker is Claude only. A failed request has no draft or Publish
action.

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

## Updating this installation

**Never build beneath a running server.** Replacing a served `.output` can leave
the page answering 200 while its scripts and editor controls fail. This applies
even when no database migration is needed.

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
4. The script backs up the database, stops only this installation's server,
   updates its checkout, builds while that server is down, and starts it again.
   It leaves the shared Postgres cluster running. Its promotion marker also
   tells the watchdog to stand down; it does not build in the development
   checkout on your behalf.
5. Require the local page, public page, a script named by the served HTML, and
   the published-story count to pass the script's checks. Verify the served
   version matches the approved release. A homepage 200 alone is not proof.
6. Re-enable **TownReporter Watchdog** after the promotion has finished, or a
   failed promotion has been deliberately stopped and no build is still
   running. Keep the named backup and inspect the reported failure before
   deciding how to recover. The script does not automatically roll back a
   potentially applied migration.

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
