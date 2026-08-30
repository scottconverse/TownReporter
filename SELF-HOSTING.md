# TownReporter — how this is actually running

Live at **https://townreporter.org**, served from a Node process on this
machine through a Cloudflare Tunnel. No hosting bill, no ports open on the
router.

Everything below is running and was verified end to end.

---

## The shape of it

```
visitor -> Cloudflare edge -> tunnel -> 127.0.0.1:3000 (this box)
                                            |
                                            +-- Postgres on 127.0.0.1:5433
                                            +-- Claude Code CLI (your login)
```

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

| Task | When | Does |
|---|---|---|
| `TownReporter` | at logon | starts Postgres, applies migrations, serves the app |
| `TownReporter Tunnel` | at logon | connects the Cloudflare Tunnel |
| `TownReporter Monitors` | every 5 min | rechecks watched sources, drains desk jobs |
| `TownReporter Watchdog` | every 5 min | checks the app, the tunnel and the public URL; restarts what is down; appends to `logs/watchdog.log` when there is something to say |
| `TownReporter Restart` | on demand | stops and starts the paper |
| `TownReporter Tunnel Restart` | on demand | stops and starts the tunnel |
| (Postgres) | — | started by the first task, not separately registered |

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
desk reads the operator's Claude Code login out of their own profile.

The last two are tasks rather than child processes of the app for two reasons
learned the hard way: a process cannot restart itself, and a tunnel restart
cannot deliver its own result over the tunnel it has just killed. The Server
page at `/desk/ops` triggers them and reads the watchdog log.

**After a reboot it comes back when you log in, not before.** Both start
triggers are *at logon* for HALO\scott, and the two five-minute tasks are
interactive as well, so a machine sitting at the lock screen runs nothing. Log
in and everything starts on its own. Tested by stopping the lot and letting the
tasks restart it.

If the paper ever needs to survive a reboot with nobody logging in, the tasks
have to run as S4U ("whether user is logged on or not") — which is a real
change, not a checkbox, because the desk shells out to the Claude Code CLI and
that reads the operator's login out of their profile.

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

If quota ever bites, point `LLM_BASE_URL` at a local model on this box instead.

`npm test` makes no model call and costs nothing — 540 tests in about fourteen
seconds, with no provider contacted. It used to make one real Claude call, and
this page went on saying so long after that stopped being true.

The live model path has its own opt-in script, so nobody spends quota by
running the ordinary suite:

```bash
npm run test:live-model
```

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

If you ever want to *send* from `tips@`, the SPF record must be widened to
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

## Rebuilding after a change

```bash
npm run build
```

```bash
powershell -Command "Start-ScheduledTask -TaskName 'TownReporter'"
```

Stop the app first if the build needs to run migrations against a database this
box is serving from — the build fails closed if Postgres is down, which is
correct but surprising.

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
