# Changelog

Current release: **0.5.7**.

## 0.5.7 — 2026-09-02

- **The AI is told which city it works in.** Every Story draft, on every
  provider, ran under a system prompt that said "TownReporter in Longmont,
  Colorado", and the follow-up searches had "Longmont" appended -- so a paper
  set up as another city got stories about Longmont. The release walkthrough
  caught it with a real draft. The research and write prompts, the search
  queries and the Opinion desk note now name the configured paper, city and
  state.
- **Opinion is Claude only.** Codex's model declines to write an editorial
  that takes a position on a local policy question; that is the provider's
  policy, not a bug, so Codex is not offered for editorials. The Opinion
  picker shows Automatic and Claude Opus, both meaning Claude, and says why.
- **Saving first-run setup lands on the desk and stays there.** It could
  bounce straight back to a blank setup form; the browser gate now asserts
  the desk holds.
- The "AI is not available" message names the providers the picker actually
  offers instead of a Grok key and six gateways.

- **Setup help is in the editor.** Queue, workbench and Opinion pickers include
  installation, same-server-account sign-in and retry guidance, with Opinion's
  voice-file prerequisite. Opinion's Close control now closes the editor, draft
  actions use the correct draft identity, and deletion copy explains the
  existing 30-day Undo window.

- **Opinion keeps legitimate disagreement.** Phrases such as "we cannot endorse
  this proposal" and quoted refusals no longer get mistaken for an AI declining
  to write. Actual provider refusals still fail visibly without filing a draft.
  A late failure from an old worker also cannot overwrite an Opinion that has
  already been filed successfully.
- **Operator instructions match the release boundary.** Rebuild guidance now
  requires a stopped target server and the production promotion script. Manuals
  distinguish the unreleased candidate, label historical screens, and explain
  Opinion's per-pass timeout and the live-test opt-in accurately.
- **Codex now runs as the native signed-in Windows user, without a hidden
  capability policy.** TownReporter no longer injects feature-disable flags,
  a read-only sandbox, ignored user configuration/rules, or a skipped-repository
  check. Every Codex Story call keeps native search plus the user's
  available shell/file, browser/computer, app, plugin, hook, skill and
  multi-agent capabilities. Prompts still travel over stdin, model names are
  validated, and timeout cleanup still targets only the child process tree the
  call owns. Expired Codex or Claude OAuth now produces provider-specific
  sign-in guidance before a job is queued; invalid Anthropic API credentials
  are also rejected by a no-generation readiness check.
- **The editor chooses the writing model per run.** Queue and story workbench
  drafts now offer Automatic plus direct Local, Zen, Codex Terra, Codex Sol and
  Claude Opus choices. Automatic uses a configured `LLM_*` gateway exclusively
  when present; otherwise it resolves the first ready Zen → Codex Terra →
  Claude Opus rung before enqueueing. That effective choice is stored on the
  durable job and used for every pass. Explicit choices never fall back. Queue
  puts the picker and result beside each lead's Draft/Redraft action. Local
  remains an explicit choice after a loaded local model failed to complete the
  full reporting pipeline during the release gate. A failed job's actionable
  provider detail now survives a page reload instead of disappearing with the
  click; the release gate also completed and filed a full Story through Zen.
- **The default test command is database-safe.** `npm test` now enters through
  a fail-closed launcher that removes inherited `DATABASE_URL` and hosted
  runtime flags before either test lane starts. It also clears an inherited
  `RUN_LIVE_MODEL_TESTS`, so an ordinary run cannot accidentally contact or
  bill a provider. Tests that need Postgres create and opt into their own
  disposable database after the startup guard runs.
- **Model choice has a real migration.** Migration 0025 adds the durable choice
  to Story jobs and Opinion requests. Its fresh-install path now creates the
  historically lazy Opinion request table before altering it, with a PGlite
  regression test for the failure found during this release's first-run gate.

- **Paper setup now controls meeting discovery end to end.** The setup and
  Server screens expose the paper's YouTube meeting channels and meeting-title
  keywords. Channel scans, meeting classification and sister-tape transcript
  recovery read those saved values instead of silently using Longmont's
  defaults.
- The environment-wrapper test now checks its database diagnostic separately
  from child-process output, matching the deliberate stdout behavior used by
  CI and operators.
- README, operator setup, editor manual, full manual and landing page now
  describe the actual 0.5.6 first-run, Paper setup and invitation screens.

## 0.5.6 — 2026-08-31

**A second city needs no file edits at all.** The paper's identity — name,
city, state, timezone, tagline, watch list, video channels, meeting
keywords, council-votes link, editor contact email — lives in the database
now. A new owner is asked for it once, on a setup screen that appears after
claiming the desk, and can change it later from the Server page. The
welcome article is written for the city being set up. The Pull excerpts,
the model prompts, the search queries, the on-subject check, the dates on
every page and the RSS feed all follow the configured city and timezone.

**Before setup, the paper claims to be nobody.** A fresh install used to
serve Longmont's masthead, Longmont's welcome article and a live link to
Longmont's real city council to anyone who visited. It now shows a plain
"not yet set up" state and publishes nothing until the owner finishes
setup. Installs that already have an owner are marked set-up automatically
and render exactly as before.

**Three release walkthroughs hunted the leaks.** Each found real ones: the
watch list pre-seeded with Longmont's eleven civic sources, the council
link hard-wired to another town, the setup form arriving with "Longmont"
already typed in the City box, the About page naming another city's
newspaper, a corrections address for the wrong town. All closed, each with
a browser test that reads the rendered HTML — links included — so a leak
cannot hide in an href again.

**The Server page stops reaching across installs.** On a machine running
the live paper and a dev copy, the dev copy's Server page reported the
production tunnel as its own and offered to restart it — and the restart
script stopped every cloudflared on the machine. One install now owns the
tunnel (`TOWNREPORTER_TUNNEL=1`); every other install says so and refuses.

## 0.5.5 — 2026-08-30

Repairs from a live incident, plus two small fixes that were measured
rather than assumed.

**The paper served a half-written build for eleven minutes.** The v0.5.4
promotion stopped the app to rebuild; the watchdog, which checks every five
minutes, saw "app down" and started it 45 seconds before the build finished
writing. The running server then answered with pages naming script files
that no longer existed -- the front page still returned 200, which is why
the promotion's own check passed. Now the promotion tells the watchdog to
stand down before it stops anything (with a thirty-minute cap, so a promote
that dies cannot silence the watchdog for good), and its final check fetches
a script the served page itself names, not just the front page. A tab left
open across a deploy now quietly reloads itself once instead of showing
"Failed to fetch dynamically imported module".

**A signed-in editor was told to sign in.** Every desk navigation flashed
"If this sits here, use Sign in" for about 150 milliseconds -- advice for a
problem that had not happened. Measured frame by frame, fixed by letting the
offer wait a beat, and measured again to confirm it is gone.

**Keyboard focus is visible everywhere**, as a real outline rather than a
border-color swap, in both the light and dark desk themes.

**Two clicks on Scan at the wrong moment could error** instead of joining
the scan already running. A narrow double-race in the job queue now
coalesces like every other path.

**The watchdog would have killed the live paper.** Its stale-process sweep
stopped every `node.exe` running this app anywhere on the machine, not the
one on the port it was repairing -- and this machine runs the live paper and
a development copy side by side. It now starts from whoever holds that port,
and still confirms the owner is this app before stopping it.

**Watchdog recovery is proven by machine now, not by outage.** A Windows CI
job boots the built server on a spare port, kills it, runs the watchdog, and
fails unless the app comes back. It also fails if the port was already empty
before the kill, so it cannot pass by killing nothing.

**Hostile pages render inside Chromium's sandbox again.** `--no-sandbox` is
gone from the default launch; `TOWNREPORTER_CHROMIUM_NO_SANDBOX=1` is the
documented opt-out for machines where the sandbox cannot start, and a failed
sandboxed launch falls back once while saying plainly what it gave up.

**Publishing warns when a source newsroom goes uncredited.** If a local
outlet's story is in the sources and the body never names them, you are told
before you print. It warns, never blocks -- a source can be background
rather than leaned on -- and the editor still decides.

**Dependencies:** pglite moves to 0.5.8. Nitro stays where it is: the pin is
what npm resolves as latest, and the only non-beta release is eight months
older.

## 0.5.4 — 2026-08-30

Two editors, one story, at the same time -- now tested. A permanent
integration harness drives two signed-in browser sessions (owner and an
invited editor) against a built server on a real Postgres and races them:
a save against a deleted lead loses with a message and no crash; a
double-save ends last-write-wins with one whole body; and two simultaneous
publishes print exactly one article -- the second confirm found the
two-step publish guard doing its job. The invite table also moves into a
real migration.

## 0.5.3 — 2026-08-30

A second person can join the desk. **Invite an editor**, at the bottom of
the Server page, mints a one-time link for one email address: it expires in
seven days, burns on use, and the person sets their own password and
arrives as an editor -- everything works for them, but they cannot invite
others, and leaving removes only their own seat. The signup wall stays
shut for everyone else; the invite is the single keyed door through it
(there were, it turned out, TWO walls -- the release walk found the second).

## 0.5.2 — 2026-08-30

The Pull button on the story workbench now drops the passage that answers
the pulled line -- readable paragraphs, breaks intact -- instead of the
first 1,600 flattened characters of a page's navigation. Its own release
gate hardened it twice: a long-document crash path became a loop, and a
live walk caught the excerpt anchoring on a page title.

## 0.5.1 — 2026-08-30

The paper went dark for hours and nothing said so. That is the shape of this
release: the newsroom now watches itself, the reader is nobody's product, and
the investigative desk finally does the thing it was built to do.

**Hardening pass (August 30)**

A release-gate audit — first-run walkthrough plus a five-role review — ran
against the finished candidate, and what it found went in before the tag:

- The archive search is index-backed. It was an unindexed substring scan over
  every published body that any anonymous reader could trigger; trigram
  indexes keep the behaviour identical and make it a lookup (measured at
  20,000 stories: 220 ms to 0.1 ms).
- The rendered-page fetcher can no longer be steered onto this machine or the
  local network. The browser it drives now resolves every address through the
  same guard the plain fetcher uses, so a hostile site cannot answer a safety
  check with one address and hand the connection a different one.
- The built server recovers stuck background work by itself, on the same
  schedule the dev server always had. Before, a job orphaned by a crash waited
  for the next human click.
- On a phone, both the paper and the desk fold their navigation behind a
  single button. A reader used to scroll nearly two screens of chrome before
  the first headline.
- A failed desk fetch now says so and offers "Try again." It used to spin
  forever, or worse, render as an empty page that looked like there was
  nothing to show.
- Beat memory explains itself when empty; screen-reader heading order no
  longer skips a level on Published; the voice file's containment check
  resolves links before comparing paths, so a link pointing back into the
  public repo counts as inside it.
- Four megabytes of audit screenshots left the repository; a gate keeps
  every non-report file out of it from now on.

**Availability**

- A watchdog runs every five minutes. It checks the app, the tunnel and the
  public URL, restarts what is down, and writes what it did. Proved by killing
  the tunnel and watching it come back.
- A **Server** page (`/desk/ops`): version, uptime, memory, the public URL as
  answered from this machine, tunnel processes, database size, queue depth,
  last watchdog run, free disk, and whether the reader made any outside
  request. Every button says what it will do before it does it, and the two
  that interrupt the paper ask twice.
- Restart and tunnel-restart are Windows scheduled tasks, not child processes.
  The old inline restart reported "Started" and did nothing, and the tunnel
  restart reported an error while succeeding — its own reply was travelling
  over the tunnel it had just killed.

**The machine it runs on**

- The server binds `127.0.0.1` when `HOST` says so, and it does. Without it the
  app answered on every interface, so anything fronting it — a tunnel, a proxy
  — was not the only way in. Measured after the change: `netstat` shows
  loopback and nothing else, the LAN address refuses, and the public site still
  answers 200.
- **Two console windows stopped stealing focus every five minutes.** Both
  five-minute tasks put a window on the operator's screen, which took focus and
  interrupted whatever was being typed — twelve times an hour. `-WindowStyle
Hidden` does not fix it: Task Scheduler creates the console host and shows it
  before the script's own window style applies. They now run through
  `ops/run-hidden.vbs`, which has no console of its own.
- `ops/status.ps1` answers "is it up" in plain words, and works when the paper
  is down — which is exactly when `/desk/ops` cannot, because it lives inside
  the paper. `ops/TownReporter Control.cmd` is the same for someone who does
  not want a terminal: double-click, pick a number. It cannot publish or delete
  anything.
- Documented plainly: both start triggers are _at logon_, so a machine sitting
  at a lock screen after a reboot runs nothing until someone signs in. Verified
  by stopping the database, the app and the tunnel, then firing only the logon
  tasks: fully up in 45 seconds.

**Local models**

- Measured rather than assumed, and written down in
  [docs/local-models.md](docs/local-models.md): a local 35B finds about half as
  many leads per Dark Desk hop as Haiku (26 against 50, median of four runs and
  three), so the planner stays where it is. The same test found that a
  reasoning model behind `LLM_BASE_URL` spends its whole output budget thinking
  and returns nothing, which the app cannot tell from a refusal.

**The reader**

- Fonts are served from this machine. Reading the paper made no request to
  Google or anyone else. Verified: zero outside requests on a cold load.
- A third-party builder script was being injected into every reader's page.
  Removed, along with the share-metadata stripping that came with it.
- Every story carries its own title, description, canonical URL, published
  time and social card. They all used to share one blurb, so every link
  anyone posted looked identical.
- `sitemap.xml`, and `robots.txt` points at it.
- A real 404 is a 404. A missing slug used to render an empty article.

**Opinion**

- An Opinion desk (`/desk/opinion`). Give it a subject, a sentence or a URL and
  it writes an unsigned editorial — OPINION in the headline, no byline, the
  paper's own position — with a claims-and-sources appendix at the end. It
  fetches its own records before it writes, so it takes ten to forty minutes;
  the page shows a running clock rather than a frozen word.
- The editorial voice is a file on disk, named by path in the environment. Only
  the path ever reaches a command line, and the file is never read into the
  app's memory. It is not in this repository and cannot be.
- The writer gets its own timeout. Measured: 9m53s and 32 turns for a piece
  with one document pointer. Fifteen minutes had no headroom and the first real
  request died at the cap with the work already paid for.
- **No editorial could ever have been filed.** `drafts.lead_id` was declared
  not null in the newsroom's second migration, because until now every draft
  began as a lead. An editorial has none — an editor types a subject and the
  paper states its position — so every finished piece hit a not-null violation
  at the moment it was stored. The two visible failures on the desk were
  timeouts; this one was waiting behind them.
- The writer's ceiling is now 45 minutes, set from three measured runs (9m53s
  at $2.66, 24m06s at $23.76, and one still going at 30). It is the most
  expensive call the newsroom makes.
- A piece that opens with a working note — a sentence ending "Here's the
  piece", or a paragraph followed by a rule — no longer loses its headline to
  it. Both were real deliveries; both put the real headline in the body.

**The desk**

- **An editorial could be read and nothing else.** The story workbench opens by
  lead, and an editorial has no lead, so a finished piece could not be edited,
  printed or thrown away. The panel even told the editor to "edit it in the
  story editor" — a promise the software could not keep. There is now an
  editorial workbench at `/desk/story/draft/:id` with save, publish and delete.
- **Delete, everywhere.** Leads, editorials and published stories. Kill was
  never delete: a killed lead stays under Killed, which is right for "not this
  one" and wrong for a lead filed against the wrong person. Each delete
  confirms in place and says what it costs — taking a story off the paper says
  plainly that its URL becomes a 404 and that a correction is what the paper
  normally does instead.
- **Nothing deleted is gone straight away.** A copy of anything removed waits
  30 days under _Recently deleted_ on the Server page, and an Undo appears
  where the delete happened. Restoring puts the row back with its original id,
  so a story keeps its URL and its corrections, and an editorial keeps its fact
  sheet, rather than coming back orphaned. It is a snapshot table rather than a
  `deleted_at` flag on purpose: a flag means every list, the feed, the sitemap
  and the public article route must each remember to filter, and the one that
  forgets serves something the editor believes is gone.
- **Row actions are visible.** Open, Hold, Kill and Delete used to fade in on
  hover, so an editor scanning twenty leads had to sweep the mouse along the
  list to discover they existed. Touch screens already showed them; now
  everyone gets the same desk.
- The server binds `127.0.0.1` when `HOST` says so. Without it the app answers
  on every interface, so anything fronting it — a tunnel, a proxy — was not the
  only way in.

**Dark Desk**

- Two dials: **Dig** — how far it chases — and **Nerve** — how speculative it
  may be. The panel spells out in a sentence what the current setting will
  actually do, computed from the same functions the run uses, so the promise
  and the run cannot drift.
- The planner had never once run. Its budget was 45 seconds against a call that
  needs 150, and every failure fell back to keyword matching in silence. The
  whole database held zero entities, zero claims and zero hypotheses.
- Planning moved to Haiku, synthesis stays on Opus. Measured over five runs
  each, not guessed: same output quality, about a quarter of the cost.
- Confidence is capped by the label in code, not asked for in a prompt. A
  HYPOTHESIS cannot be filed at 0.9 because the prompt said not to.
- A claim labelled FACT with no citation is downgraded, and claims about the
  desk's own digging are dropped instead of filed as findings. 76 existing
  self-referential claims were archived, not deleted.
- A brief that answers the question the editor actually has: what connects,
  what the hypothesis is, how strong it is, what supports it, the boring
  explanation, and what would kill it.
- A NUL byte in a captured page killed an entire round after 21 documents.
  Sanitised at the point of ingest.

**Leads**

- r/longmont is a tip line. Posts are scored for civic content, paced to stay
  welcome, and filed as unverified tips that are never mistaken for reporting.
- Search works. Exa runs first, and the redirect wrapper that made every Bing
  result unusable is unwrapped.
- A PULL used to answer a Longmont question with three California school
  district PDFs. It now writes several queries, prefers the issuing body's own
  document pages, and drops results that are not on the subject.
- Reporting notes are packed to fit rather than cut at 16,000 characters — the
  old cut landed mid-token and silently wiped every note on the story.

**Layout**

- Opinion and City Council Votes in the paper's navigation; archive search is a
  magnifying glass in the top bar.
- Nothing scrolls sideways any more. The rails wrap.

## 0.5.0 — 2026-08-28

Self-hosted. Runs on the operator's Claude Code login instead of an API key. Ten review findings fixed, plus five things that stopped the software running on Windows at all.

**Deployment**

- Builds to a plain Node server (`node-server`) rather than Vercel. A long-lived process means the Chromium page reader works and background jobs are not chopped up. `NITRO_PRESET=vercel` still builds for Vercel.
- App output is captured to `logs/`, readable while the server runs.

**Model**

- The desk talks to Claude through the local Claude Code CLI — no API key. The harness is stripped per call; `--setting-sources ""` keeps the operator's own CLAUDE.md and skills out of the newsroom's prompts. An API key or a local OpenAI-compatible gateway still take precedence when set.
- Draft budgets come from the provider. 38 seconds was sized for an HTTP API; the CLI needs minutes, so every draft failed before the writing pass ever ran.

**Correctness**

- Jobs no longer run twice. Nothing refreshed `updated_at` mid-run, so any job past the two-minute stale line was re-claimed and run alongside the original. Heartbeat plus a claim token.
- SSRF is closed at connect time. The guard resolved DNS and then let the request resolve again; the address approved is now the address connected to.
- Newsletter signup was a site-wide lockout lever and never counted repeats of an existing address. Now per-address, with a much higher global backstop.
- The signup response no longer reveals whether an address is already subscribed.
- RSS emits absolute links and escapes titles. A CDATA terminator in a headline used to break the entire feed, not just one item.
- The rate limiter records before it decides, so two concurrent clicks cannot both pass.
- A crashed Chromium is dropped rather than cached, which had silently degraded every later fetch for the life of the process.
- Slug collisions are checked until free; the single-retry fallback could still hit the unique index and throw a 500.
- PDF escape decoding is single-pass. Chained replaces turned an escaped backslash into a line break.

**Desk**

- The queue orders by score within a batch. Ordering on the timestamp alone put a 14-point lead below an 8-point one.
- Clicking Draft once is enough. A stale failed job cancelled the new draft the instant it started, so the first click looked dead.
- Three seed source URLs were dead, including NextLight pointing at a domain that does not exist. Corrected against the city's own site.
- Source-line parsing moved out of `desk.ts` and given tests. A `TIER` header on the same line as a URL was ignored, silently filing a news outlet as an official record. Bare hostnames are now accepted.

**Windows**

- `npm run dev` and `npm run build` both failed: spawn cannot execute npm's `.cmd` shim.
- Every route returned 500 on a self-hosted build; the SSR barrel repair only knew the Vercel output path.
- PGLite's binaries were never copied into the build, so the first database read hit ENOENT.
- The scripts test glob matched nothing, so 170 tests had never run.
- No favicon link at all, so every page load 404'd on `/favicon.ico`.

Not in 0.5.0: real OCR, city picker, mailer, invite.

## 0.4.3 — 2026-08-28

URL history, watches, cadence, and names belong to the newsroom. Two drainers cannot both run the same job. An empty quote is unresolved.

- `artifact_versions`, `source_monitors`, `recurring_baselines`, and `entities` unique keys and lookups are `(newsroom_id, …)`. A later editor reuses the captured page, the watch, the cadence, and the name graph. Who clicked is still stored.
- Job claim is compare-and-set: only one drainer can take a queued (or stale-running) row. The loser walks away.
- Provenance with no excerpt is unresolved even when the model named a real capture id. The cited version is kept so you can see what it pointed at.
- `deskIsClaimed`, first-user-owns, and the public paper / RSS list this newsroom, not a global count.

Not in 0.4.3: real OCR, city picker, mailer, invite.

## 0.4.2 — 2026-08-27

The cited document has to contain the quote. Mapped IPv6 loopback is blocked. Leave only clears this newsroom.

- Provenance `resolved` means the quoted evidence is in the captured text (or a stored chunk of it), not that the model named an id that exists. A real capture with an invented quote stays unresolved. The cited version is still stored so you can see what it pointed at.
- `http://[::ffff:7f00:1]/` and `http://[::ffff:a9fe:a9fa]/` are blocked. The URL parser emits the hex form; the guard was only unwrapping dotted `::ffff:127.0.0.1`, which production never sees. Tests hit the production function, not a copy.
- **Leave as editor** deletes members of this newsroom, not every row in the table.

Not in 0.4.2: real OCR, city picker, mailer, invite, newsroom-keyed URL history / monitors / names.

## 0.4.1 — 2026-08-27

Dark hops belong to the file. Jobs finish after the click even if this program goes to sleep.

- After the desk is claimed, `/login` is sign-in only. Paper top-right **Create editor** only while nobody owns the desk. **Leave as editor** on the desk drops the owner, signs them out, and puts Create editor back. The paper stays. Next person in owns it. Signed-in but not the editor sees the desk is taken, not an empty Scan page.
- Dark Desk hops (frontier, captures, search log, claims) are the file's, not whoever opened it. A later editor on the same newsroom continues the trail. Who clicked is still stored.
- Scan, Draft, and Keep digging still write a job and return. A wake-up finishes waiting jobs: the same monitors ping (`GET /api/cron/monitors` with `CRON_SECRET`), and this long-lived process also drains on its own. A frozen serverless host needs that ping. Documented.

Not in 0.4.1: real OCR, city picker, mailer, invite a second editor.

## 0.4.0 — 2026-08-27

Hardening. Trustworthiness and lifecycle, not a redesign.

- One newsroom row; members carry `newsroom_id`. Two concurrent first users can no longer both become owner. Desk and Dark lists are keyed by that id. Investigate hops still write as the editor who opened the file.
- `NEWSROOM_SETUP_TOKEN`: when set, creating an account does not own the desk until the token is presented. Preview with the token unset is still first-account-owns.
- Chromium aborts subrequests to private/LAN/metadata addresses. Cron with no `CRON_SECRET` is disabled.
- Captures store extracted vs raw hashes when bytes exist. Public provenance cannot be minted by the model for a URL we did not fetch.
- Image-only PDFs are unread. JPEG-as-chat is not OCR.
- Scan, Draft/Redraft, and Keep digging enqueue a persisted job and return. The UI watches `desk_jobs` / unfinished `scan_runs` / `investigating`. The drain is in-process — it runs on a long-lived Node host, not on a frozen serverless function.
- Dark Start no longer dumps the last 16 snapshots into the file. Command-center Start digging continues into research. Keep digging / Set aside disabled while a round runs.
- Redraft saves Pulled notes first. Killed has Back. Queue All excludes killed. Send-to-queue is idempotent with a real topic.
- Corrections render on the article, timestamped. Published correction errors are errors.
- Source URLs are links; kind/tier inferred from the host. Nested button-in-link removed. Forced-night Dark Desk hides the Light switch. Newsletter promise removed. GitHub tag is the source download.
- Filing a lead fills the workbench even when the first draft body is empty.
- One Playwright lifecycle path in CI: create the desk → file a lead → publish → correction on the article. `npm run typecheck` and GitHub Actions on test+types.
- Longmont edition. No mailer. No city picker. OCR is still unread-image, not an engine.

## 0.3.9 — 2026-08-26

Designer pass. Paper search and newsletter inputs have borders again. Version leaves the desk masthead. Pulled notes uses the same does-not-print chip as reporting notes. Publish keeps pulled notes. Dark Desk noticed list caps; Start digging errors stay on one surface.

## 0.3.8 — 2026-08-26

Start digging no longer swallows a failed open. The card stays put, says so, and you can click again. A previous click that died on the cookie glitch had hidden the card for the rest of the session.

## 0.3.7 — 2026-08-26

Redraft no longer dies on a sign-in cookie glitch (`Cannot destructure property 'setCookie'`). You stay signed in; the click can finish.

## 0.3.6 — 2026-08-26

Draft with AI actually reports. Still-to-pull lines can be pulled into a paste box.

- Research looks for the named company’s or agency’s own press release / newsroom page before it settles for another paper’s rewrite. A Leader listing is a lead, not the story.
- Every load-bearing number, name, date, and quote is supposed to land as a claim with a URL in notes (primary document, official record, or credited news).
- On the workbench, **Pull** next to a still-to-pull line searches that item and drops the excerpt into **Pulled notes** under the story — cut and paste, does not print. Redraft reads that box.
- A missing company announcement becomes a still-to-pull line instead of a silent hole.

## 0.3.5 — 2026-08-26

Draft with AI paints the workbench when the writing pass finishes, even if the click already died.

- The workbench no longer stops looking after two minutes. It polls until a body is actually on the lead, then fills headline / dek / body without a reload.
- The click returning the finished draft writes it straight into the form. A dropped connection is not treated as "nothing happened."
- The "Drafting…" state stays up and keeps checking. Reload is not required.

## 0.3.4 — 2026-08-26

Draft with AI no longer looks empty when the server already wrote. Credit the originating newsroom with a story URL, not a homepage.

- Workbench polls while Draft with AI is in flight. A gateway timeout no longer leaves a blank form; the draft appears when it lands, without a reload. A real failure says so and asks you to click again — not Dark Desk “Keep digging.”
- One draft click is budgeted so the writing pass usually finishes before the request dies. Extra fetches that would hang are skipped; a matching article URL is still followed.
- A listing page (homepage, `/local-news`) yields article URLs. When a draft hangs on another newsroom, the body names them and links the exact story. A homepage is not a story URL. If only a listing remains, notes ask for the full URL instead of paraphrasing their legal claims as TownReporter’s.
- Printed stories render those markdown links.

## 0.3.3 — 2026-08-26

Longmont edition cleanliness. Dates, cadence, and the printed paper all stay on Mountain Time and stop repeating themselves.

- Masthead, bylines, and desk clocks use `PAPER.timezone` (`America/Denver`). A Wednesday evening in Longmont no longer prints as Thursday UTC.
- Meeting-cadence math (`nthWeekday`, usual weekday) uses Denver, not the host clock.
- The public paper and RSS collapse overlapping printed headlines and keep the longer body. Quiet-zone ×2 and survey ×2 drop; Airport Vision (Sept 26) stays next to the Boulder County joint session (Sept 21). Search is unchanged. Archive URLs stay live.
- Desk sources table no longer forces `display:block` on every table. On a phone the rows stack instead of shoving a 674px THEAD sideways.
- Desk chrome says `Editor's desk — Longmont` from `PAPER.city`.

## 0.3.2 — 2026-08-26

Product documentation. Clone-and-run was not a product.

- Full README: pitch, disclaimer, two rooms, how it works, city swap, FAQ.
- Operator manual: `docs/setup.md` — Node 22, env, Playwright, Postgres, gateways, Vercel limits, second editor, city swap via `paper.ts`.
- Editor manual: `docs/editor.md` — login through publish, meetings/tapes (captions are not minutes), Dark Desk piles, corrections.
- Marketing landing: `docs/index.html` (cream / ink / rust) for GitHub Pages from `/docs`. `docs/.nojekyll`. Enable Pages: Settings → Pages → branch `main` / `/docs`.
- `package.json` `engines.node` `>=22`.

## 0.3.1 — 2026-08-26

Self-host pack. Clone it, run it, point it at Grok or any OpenAI-compatible gateway.

- MIT license. `.env.example`. README is a clone-and-run.
- Grok (`XAI_API_KEY`) is the default model.
- `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` is any `/v1/chat/completions` gateway: LiteLLM, Bifrost, Helicone, MLflow AI Gateway, Kong AI Gateway, Ollama, OpenAI, OpenRouter. No extra package. Bifrost must not bind port 8080 (TownReporter).
- Self-host desk: email + password on `/login`. Grok Google/X buttons only on `*.grok.me`.
- `npx playwright install chromium` for meeting transcripts and JS civic sites.
- `.env` is loaded by the dev wrapper.

## 0.3.0 — 2026-08-26

Meeting records, reporting notes, and Dark Desk actually reading the tape. Draft notebook language stays off the paper.

- **PrimeGov.** `longmont.primegov.com` is a watched official source. Catalog comes from the public JSON API (upcoming + archived), not Crawl4AI. Agenda/packet/minutes PDFs are separate records via `CompiledDocument`. YouTube titles join the matching meeting (206 S. Main ↔ Avis notice; council 08/25/2026 ↔ that packet). Minutes not posted after 36 hours is a catalog note.
- **YouTube meetings.** Channel page is a catalog. Full timestamped transcripts live on each watch URL (Show transcript; no 12k slice). Upcoming livestreams stay listed with no fake transcript and are rechecked every 6 hours. `@LongmontPublicMedia` is the second tape; same-meeting titles are merged; if the city tape has no captions we use theirs.
- **Dark Desk.** Planner no longer feeds the first 1,800 characters of a five-hour tape (hold music). Retrieval picks the vote, the aside, “skip it all.” Captions are a map, not minutes; names may be wrong; quotes need a check.
- **Reporting notes** on the story workbench (designer 2): to-dos strike/restore, human lines tagged “yours,” add-a-line, research memo persists across redrafts and never prints.
- Draft with AI strips reporter-notebook leftovers (`What is solid`, `Next checks are…`) from the story body.
- Playwright civic hosts now include PrimeGov. SSR export patch after build. Site walkthrough script checked in.

## 0.2.5 — 2026-08-26

Playwright render path for JavaScript civic sites. Simple GET remains the default.

- After SSRF checks, HTML that is an app shell (Municode IE9 page, empty `#root`, “enable JavaScript”) is opened in headless Chromium. The captured copy is the rendered text, not the sorry-page.
- Known JS hosts (Municode, eCode360, Granicus, Legistar, CivicClerk, BoardDocs, CivicPlus, American Legal) always try the browser.
- PDFs and ordinary static city pages stay on the existing GET. Playwright is skipped when it is missing or still returns a shell.
- Fetch User-Agent is a current Chrome string plus TownReporter/1.0.

## 0.2.4 — 2026-08-26

Dark Desk open file puts captured records first. Designer brief checked in. Investigative engine unchanged.

- “34 records on file” is no longer a count with nowhere to click. The open file leads with **What to read**: title, excerpt, Open original, Read captured copy.
- Empty “What we know / testing / questions” sections stay hidden.
- Still unopened is labeled as not-yet-fetched, not the reading list.
- Designer handoff: `docs/dark-desk-editor.md`.

## 0.2.3 — 2026-08-26

Dark Desk editor language and desk piles. Investigative engine unchanged.

- A round of research is five short passes, then a stop. Remaining pages, names, and documents stay on the file. That stop is not a failure and not “too many leads.”
- Editor copy no longer uses hop, frontier, or research-budget jargon. Status, progress, findings, and run logs are plain English.
- Dark Desk is three piles: To look at (not opened yet), On the desk (started, including files that stopped with more to read), Set aside (parked or finished, pull back anytime).
- Start digging moves a card off To look at and onto the desk. Close file leaves it on the desk. Set aside files it. Pull back restores it.
- On-desk files show records saved, things still unopened, and last touched. The open file is the work surface.
- Fetch and model errors no longer leak as raw TypeErrors. A hop-budget pause is not overwritten by a later model hiccup.

## 0.2.2 — 2026-08-26

Reporting breadth and evidence chronology. Dark Desk engine unchanged; editor UI rewritten.

- Four reporting lanes are allocated by lane, not array order. A four-search budget is one context, one stakeholder, one contradiction, one gap. Extra budget on explainers and investigations comes after that.
- A prospective brief is challenged once (attachments already followed, one context/contradiction search, beat memory) before the classification sticks. Money, history, a changed timeline, affected people, contradiction or a missing record promote it to reported and the normal lanes run. A genuine small item stays a brief.
- Story form follows the reporting that exists. It does not control what the system is allowed to discover.
- “What TownReporter found” requires a published source URL and a specific captured version or capture event. A URL match alone is not enough. Unbound hypotheses stay in the newsroom.
- Public evidence history is capture chronology (`capture_events.observed_at`), not unique content versions. Repeated observation of the same bytes is kept. A missing check is an event. A revert compares B → A when A is what TownReporter last saw.
- Public evidence is scoped to source URLs cited in a published story, not a door into the evidence store.
- Original-bytes language no longer implies a download the page does not provide.
- Dark Desk editor UI: Worth a Look cards use headlines, not raw URLs. Start digging opens an investigation immediately and shows progress on the card while hops run. Results live in an investigation workspace (what started this / what we know / what Dark Desk found / next leads / evidence). API errors such as 403 are translated. Research log is behind a disclosure. The investigative engine is still non-gating.

## 0.2.1 — 2026-08-26

Evidence hardening on the path from capture → reporting → story → proof. Dark Desk engine unchanged.

- Paragraph collapse requires near-equivalence. A richer paragraph with new numbers, names, dates, quotes or consequences is kept.
- Rewrite detection is near-verbatim n-gram reuse of the announcing source, not bag-of-words overlap with the evidence. Grounded reporting is not auto-downgraded to a brief.
- Reported stories run four research lanes before writing: context/precedent, stakeholders/impact, alternative/contradiction, gap filling. Briefs skip extra lanes.
- The writer is fed retrieved evidence chunks (cost, dates, amendments, contradictions), not only document prefixes. Context limits belong in retrieval.
- Provenance merges field-by-field. Capture timestamps/version IDs win forensically; blank capture rows do not wipe title, organization, date or role.
- Public captured-version and compare-versions routes. Only records already cited in a published story are visible.
- “What TownReporter found” is a structured finding. The public module renders only when source URLs or version IDs resolve against published provenance.
- Worth a Look is open-ended: every open/reopened frontier item is eligible. Known patterns get ranking bonuses. Ranking is not a gate.
- First signed-in user remains owner. A second identity is not auto-granted editor.

## 0.2.0 — 2026-08-26

The public record is only the beginning. Stories are researched before they are written. Dark Desk opens on things worth examining.

- Drafting is a reporting pass, not a rewrite of the announcing source. Research follows attachments, named records, and prior meetings; consecutive restatements and empty AI filler are stripped; a rewrite is cut to a civic brief.
- Reader-facing provenance: source title, organization, document date, exact URL, capture time. Homepages are not stand-ins for documents. Disappeared sources say so. Multiple versions: Compare versions. Distinctive finds: What TownReporter found.
- Paper positioning: independent civic reporting for Longmont; “Civic news, human-edited” is supporting trust language. About and How we report describe watch → detect → follow → preserve → investigate → write, then a human gate.
- Dark Desk is an investigative desk UI. Worth a look ranks missing reports, disappeared records, monitor alerts, reopened trails, open promises, and high-newsworthiness leads. Three starts: Find something to dig into, Investigate a lead, Keep digging. Investigation view: what we know / testing / found / trail / open questions / leads / dead ends / evidence. The investigative engine is unchanged.

## 0.1.0 — 2026-08-26

First tagged release. Civic paper + editor desk for Longmont. Scan up to 200 sources. Dark Desk investigates without using uncertainty as a stop.

- Dark Desk does not gate on unknown classification, unresolved identity, missing provenance, weak sources, contradictions, or low confidence. Those states are recorded; the next hop still runs.
- Exhausted / dead-end frontier items reopen on materially new evidence. Prior status, reason, timestamp, and search history stay on the record.
- One zero-result query is not exhaustion. Remaining strategies continue. Failed providers fall through DuckDuckGo → Bing → Brave → Wikipedia.
- Hop budget pauses remaining work (`paused` + `pause_reason`). Continue digging resumes leftover URLs. Evidence exhaustion closes a path; budget does not.
- Production OCR: native PDF text, then Grok vision on embedded JPEGs, then optional tesseract.js. `needs-ocr` does not defer the lead.
- Original artifact bytes stored (`artifact_blobs`, ≤4MB).
- Source monitors tick in the background (dev interval + `GET /api/cron/monitors`). They do not wait for an editor to open Dark Desk.
- Prompt: coordination is not automatically wrongdoing. Private citizens: no drive-by dossiers; follow material public-interest trails.
- Eight non-gating regression tests plus Bing/Brave parser coverage.
