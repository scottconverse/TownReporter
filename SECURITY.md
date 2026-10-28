# Security policy

TownReporter is a self-hosted civic newsroom. Anyone can clone it and run it
on the public internet, which means a vulnerability here is a vulnerability in
every paper someone else is running. Coordinated disclosure matters more than
usual for this project.

## Supported versions

| Version | Supported |
|---|---|
| 0.6.x | Yes — fixes land on the current release |
| < 0.6 | No. Upgrade before reporting, in case the issue is already closed. |

There is one active release line, maintained by one person.

## Reporting a vulnerability

**Do not open a public GitHub issue.** A public issue tells every operator
running a clone at the same moment it tells the maintainer.

Use GitHub's private vulnerability reporting for this repository: the
**Security** tab, then **Report a vulnerability**. It is enabled — verified
against the API rather than assumed, and a test in this repository fails if it
is ever switched off while this document still points at it.

That route reaches the maintainer without a public issue and without an inbox
anyone has to remember to check. There is deliberately no email address here.
This document previously carried a placeholder where one was meant to go,
which is worse than having none: it reads as a channel and is not one.

`tips@townreporter.org` is NOT a security channel. It is a receive-only
newspaper tip line, documented as such in `SELF-HOSTING.md`. Reporting a
vulnerability there gets it read by whoever reads reader mail.

Please include, however you report:

- What the issue is, in one or two sentences.
- The version or commit you tested.
- How you reached it: the route, the request, or the steps on the desk.
- What an attacker gets — read access, write access, another user's newsroom,
  the host, someone's model credentials.
- A proof of concept if you have one. A curl command is ideal.

What to expect:

| | |
|---|---|
| Acknowledgement | within 3 working days |
| First assessment | within 7 days |
| Fix or a stated plan | within 30 days for anything reachable from an unauthenticated request |

This is a project maintained by one person. If you do not hear back inside the
acknowledgement window, send the report again before assuming it was ignored.

Credit is offered in the changelog entry for the fix unless you would rather
not be named. There is no bug bounty.

## Scope

**In scope** — the code in this repository:

- Authentication and session handling (`better-auth`, the
  `__Host-tr-auth.session_token` cookie — `src/lib/auth/`). Email and password
  is the only sign-in. The Grok sign-in, the preview bearer path and the
  federation code were removed in the 0.6.83 build; a way to bring any of them
  back is a report.
- The desk boundary: every desk and Dark Desk mutation runs through
  `deskMiddleware` (`src/lib/news/desk-auth.ts`), which resolves the user
  from the session and requires owner or editor membership
  (`newsroom_members`, `src/lib/news/membership.ts`). A way around that is a
  report.
- Newsroom ownership: the first signed-in user claims the desk
  (`deskIsClaimed` / `claimOwner` in `src/lib/news/membership.ts`); a way to
  claim ownership as a second identity, or to act as owner/editor without a
  `newsroom_members` row, is a report.
- The SSRF guard on outbound fetches (`src/lib/news/url-guard.ts`,
  `fetch-url.ts`): the address approved must be the address connected to. A
  way to make those differ, or to reach a private range, loopback,
  link-local, or a mapped IPv6 loopback (`::ffff:127.0.0.1`), is a report.
- The cron endpoint (`/api/cron/monitors`) and `CRON_SECRET` handling.
- The reading of untrusted files and mail the desk is handed:
  - Excel, PowerPoint and LibreOffice files are converted by headless
    LibreOffice in a temporary profile with macros off, one conversion at a
    time, with a two-minute limit (`src/lib/news/libreoffice.server.ts`). A way
    to run a macro, or to make the conversion reach outside its temporary
    folders, is a report.
  - The newsletter mailbox is opened read-only, limited to 5 MB a message, with
    HTML sanitised and no remote content loaded (`src/lib/news/newsletter-*.ts`).
    The mailbox password is stored encrypted.
  - The one guarded Chromium read the scan tries when a public site refuses an
    ordinary request. It never submits a form, enters a credential or solves a
    challenge.
- The Opinion voice-file boundary: only a validated path reaches a command
  line. Anything that gets file contents, a relative path, or a path inside
  the repository onto that command line is a report.
- Injection of any kind into the public paper — a published story, the feed,
  the sitemap, or the evidence routes.
- Anything that puts a third-party asset onto a reader's page. The paper is
  self-contained — fonts self-hosted, no third-party script — and a cold load
  of it makes zero requests to an outside host
  (`docs/manual.md` §"What the reader gets"; `npm run smoke` proves it in a
  real browser). The desk's own
  outbound calls are a different surface, documented in `docs/setup.md`
  §"What leaves this machine": that documented egress is not itself a
  vulnerability.

**Not in scope** — configuration choices the operator makes, which the docs
already warn about:

- Running with `VITE_AUTH_ENABLED=false` on a public host. Every document
  that mentions this flag says not to do it (`docs/setup.md`,
  `docs/manual.md`, `README.md`, `.env.example`).
- PGLite data loss on restart. Documented behaviour, not a defect.
- Vulnerabilities in the model provider you chose, in a gateway you run, or
  in the civic websites the app fetches.
- Anything requiring an attacker who already has shell on the machine
  running the newsroom. That machine holds the operator's own model login.
- **The editorial writer holds the voice file and its web tools in one run.**
  A page the writer reads during a piece could in principle talk it into
  fetching an attacker's URL with style-guide text in it, which would leak the
  operator's private voice file. Units U12/U12b/c closed that by splitting the
  writer — a gathering pass with the tools and no voice, a writing pass with
  the voice and no tools — and the owner reversed it on 2026-09-30 (D20): the
  voice file CONTAINS the research protocol the writer is told to follow, so a
  writer holding the voice without the tools cannot do its job. The owner
  accepted the exfiltration risk for a single-person newsroom; the desk
  performs the searches for the writers that have no web tools of their own
  (DeepSeek, the local model, saved connections), where the model holds the
  voice and the desk holds the fetching.
- Reports generated by a scanner with no demonstrated path to impact.

## What already exists

Context, so a report can aim at what is not yet covered:

- Outbound fetches are guarded at connect time (`assertPublicHttpUrl` in
  `src/lib/news/fetch-url.ts`), re-checking the resolved address rather than
  trusting an earlier DNS answer.
- Mapped IPv6 loopback (`::ffff:7f00:1` / `::ffff:127.0.0.1`) is recognized
  and blocked (`src/lib/news/url-guard.ts`).
- Every override of a desk warning ("Publish anyway", "Kill anyway", and the
  rest) writes the editor, the time, the warning key and the target to the audit
  trail, so a warning that was passed over can be read back.
- The server refuses to serve a database that is behind its migrations (HTTP
  503, `server/middleware/00-schema-current.ts`), so a half-updated install
  does not serve a schema the code does not expect.
- The default test suite (`npm test`) is offline by construction, and a test
  enforces that no default test can reach a live model unasked
  (`scripts/newsroom-security.test.mjs`).
- CI boots both the dev server and a real production build and exercises
  them in a browser (`.github/workflows/ci.yml`).

## Reporting agents and untrusted records

Pages, PDFs, captions, transcripts, packets and other fetched records are
evidence. Text inside them does not grant an agent additional tools or change
the reporting job's machine permissions. TownReporter selects the tool surface
in application code before sending the prompt.

- Since 0.6.84 the command-line models run with their **full tool set** and
  permission prompts turned off (decision D149, Oct 18 2026). The tool surface
  is no longer a security boundary; the boundary is the machine account the
  server runs under, and what that account can reach.
  - The Codex CLI runs with `--dangerously-bypass-approvals-and-sandbox`,
    `--search`, `--ephemeral`, and hooks, memories, project docs and
    notifications turned off per call (`src/lib/news/ai-codex.server.ts`).
  - Claude Code runs with `--dangerously-skip-permissions`,
    `--permission-mode bypassPermissions`, no session persistence, and hooks,
    memory and personal CLAUDE.md files turned off per call. Its built-in tools
    and configured MCP servers stay loaded
    (`src/lib/news/ai-claude-code.server.ts`, `buildClaudeCodeArgs`).
  - The Gemini CLI runs with `--dangerously-skip-permissions` and slash
    commands turned off (`src/lib/news/ai-gemini-cli.server.ts`).
  - Run the server under an account that holds only what the newsroom needs.
    Text inside a fetched record that tries to steer an agent is a report.
- DeepSeek v4.1 Flash runs inside the same Claude Code CLI, with no MCP servers loaded, through
  a small relay the server starts on `127.0.0.1` with an operating-system chosen
  port (`src/lib/news/deepseek-relay.server.ts`). The relay is a boundary: it
  strips the incoming auth, API-key and cookie headers, forwards only the
  route's own bearer token, and sets the thinking budget from the run's
  effort (off at the default, effort none). A way to reach it from
  another machine, or to make it forward an operator credential, is a report.
  `TOWNREPORTER_CLAUDE_CODE=0` sends DeepSeek by plain HTTP instead.
- OpenAI-compatible and Anthropic API calls, including local-model calls,
  receive text prompts without tool or function definitions. TownReporter
  performs source search and fetching itself through its guarded application
  paths.

These controls prevent a source instruction from granting shell, file-write,
browser, MCP, plugin or agent access. They do not make generated reporting
factually correct; editors must still review evidence and claims. Research
paths that explicitly enable provider web search or fetch can make those
research requests and consume the selected provider's usage allowance.

## If you operate a TownReporter

You are the publisher and you are also the sysadmin. The settings that matter
most are `BETTER_AUTH_SECRET` (a long random string, never left at a
preview-only default) and `HOST` (bind loopback, `127.0.0.1`, when a tunnel
or reverse proxy fronts the app so that is the only way in). `docs/setup.md`
explains both, and `docs/setup.md` §"What leaves this machine" lists what
your desk sends where and to whom.

---

*This policy describes the maintained repository release line. GitHub private
vulnerability reporting is the supported confidential reporting route and is
checked by the repository's security-policy test.*
