# TownReporter — how this is actually running

Repository documentation version: **0.6.66**. See the [0.6.66 release guide](docs/releases/0.6.66.md); it separates source, package metadata, GitHub publication, and production deployment as distinct facts.

**New installations:** use the [Windows installation guide](docs/windows-install.md), not the machine-specific scripts described below.

**Legacy operator migration for 0.6.27:** maintenance scripts now refuse guessed machine ownership. Before using an existing Halo-style installation's scripts, its local operator must configure `TOWNREPORTER_LEGACY_OPS=1`, `TOWNREPORTER_LEGACY_ROOT` as that checkout's absolute path, its actual `PORT` and loopback `DATABASE_URL`, and absolute `TOWNREPORTER_PG_BIN` / `TOWNREPORTER_PG_DATA` paths for the database it owns. Verify those paths locally; do not copy values from another machine. Packaged installations use their own launcher and refuse the legacy path even if that flag is set. This document is not an instruction for the remote developer to access Halo.

These are **Halo-local operator deployment notes**, not instructions to treat a
remote development machine as production. The paper is hosted at
**https://townreporter.org** on the Halo box in Longmont, through a Cloudflare
Tunnel. “This machine” below refers to Halo.

Production was independently checked on 2026-09-13 at source `c926fc48e8e11ebce437a47bc0fd3c990671ecb8` before packaging 0.6.44. The local and public app answered, the served version matched the build, and published articles were preserved. The [current release record](docs/releases/0.6.54.md) identifies the current repository release and evidence boundaries; it does not rewrite the dated deployment evidence. A repository version, GitHub tag or release does not establish production version. Earlier machine inventories and receipts below describe their observation dates.

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
| `TownReporter`                | at logon    | starts Postgres, applies migrations, serves the app                                                                                 |
| `TownReporter Tunnel`         | at logon    | connects the Cloudflare Tunnel                                                                                                      |
| `TownReporter Monitors`       | every 5 min | rechecks watched sources, drains desk jobs                                                                                          |
| `TownReporter Watchdog`       | every 5 min | checks the app, the tunnel and the public URL; restarts what is down; appends to `logs/watchdog.log` when there is something to say |
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
| The paper                        | the same task, after Postgres accepts connections | logon, a few seconds later    |
| The Reddit reader (Redlib)       | the same task, detached, then the watchdog   | logon, in the background      |
| Ollama                           | your own Startup shortcut (`Ollama.lnk`)     | logon, by Windows, not by us  |
| The Cloudflare Tunnel            | the `TownReporter Tunnel` task               | logon                         |
| Whatever has stopped since       | the `TownReporter Watchdog` task             | every 5 minutes               |
| LM Studio                        | nothing here                                 | not started or touched at all |

Three of these are optional and their absence is a supported state, not a
fault. The paper serves either way.

- **Redlib** is the only way the desk reads a Reddit thread in full — post
  body, scores, replies. Without it the desk reads the subreddit through
  Reddit's `.rss` and says so in the source text rather than pretending it read
  the thread. Install or repair it with `ops/redlib.ps1 setup`; check it with
  `ops/redlib.ps1 status`; stop it with `ops/redlib.ps1 stop`. It is stopped
  through the pid file the installation wrote, never by image name. Set
  `TOWNREPORTER_REDLIB=0` in `.env` to leave it alone entirely.
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
Ollama, the last backup, the last scan and the test copy, and the rows that do
not matter — Redlib and Ollama — are marked optional and never inflate the
count.

The six buttons carry the menu's own wording: check, restart the paper, restart
the tunnel, start everything, stop everything, restart the Reddit reader.
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
ladder only; stories, scans and Dark Desk walk DeepSeek v4.1 Flash, then Qwen
3.6 35B on this computer when it is loaded, then Codex Terra, and do not select
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
| Scan and Dark Desk  | per-run picker; Automatic uses a configured gateway first or the shared ladder — DeepSeek v4.1 Flash, then Qwen 3.6 35B when it is loaded, then Codex Terra; named choices are tried first   | technical recovery retries only the unfinished call and records requested/actual model and effort             |
| Daily scan          | one named Codex or Claude model, Local model, or saved Custom AI connection is tried first; technical switches are recorded | repair provider credentials when no ready fallback exists and resume the schedule |
| Story — Automatic   | configured `LLM_*` first when present; otherwise the shared readiness ladder — DeepSeek v4.1 Flash, then Qwen 3.6 35B when it is loaded, then Codex Terra | recognized technical failures retry only the unfinished call and record requested/actual model and effort; refusals stop |
| Story — named       | Codex Astra, Sol, Terra, or Luna; Claude Fable, Opus, Sonnet, or Haiku; Local model; or a saved custom connection is tried first | the job records requested/actual model and effort, any technical switch, and preserved checkpoints |
| Opinion             | Automatic starts Codex Sol → Claude Sonnet; named choices are tried first; technical retry is per unfinished call | the completed row records the provider that delivered; refusals stop |

For ordinary Story calls, Codex reuses the signed-in user's native configuration and full available
Windows access. TownReporter does not disable search, shell/files,
browser/computer tools, apps, plugins, hooks, skills, user rules, repository
instructions, or multi-agent capability, and it launches with
`danger-full-access`. Assignments travel over stdin; Opinion loads the complete voice through the native instruction-file setting. Timeout cleanup targets only
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
   Before it stops the server, it also refuses to promote while an editor has
   a desk job (a draft, a scan, a Dark Desk round, an Opinion piece) running
   or queued -- restarting under one orphans it, and while the 120-second
   stale-reclaim always recovers it automatically, there is no reason to make
   an editor watch that happen. It prints the open job(s) and stops. Pass
   `-WaitForJobs` to have it poll every 15 seconds, up to 15 minutes, for them
   to clear on their own, or `-Force` to proceed anyway with a loud warning.
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


## Current Opinion document and review workflow

Opinion and Write a story share large-document upload, OCR, long pasted text and URL intake. Opinion defaults to Codex Sol; Opinion's Automatic tries Codex Sol, then Claude Sonnet. Both subscription writers read the complete configured voice using native instruction-file options and can research while writing. Failed requests retain saved material for restoration. A provider refusal creates no draft. A saved editorial missing its required claims-and-sources appendix remains marked for review and blocked from publication until repaired. Written-source name matches support corrections; unresolved identities remain visible. See [the current desk guide](docs/editor-desk.md) for the complete editor flow.
