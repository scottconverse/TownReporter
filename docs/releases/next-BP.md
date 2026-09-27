# Next TownReporter patch — the paper during a backup, and failed dumps

**State:** Candidate work in progress. This document does not assert a release,
a tag, a GitHub publication, a production deployment, or a live-provider
result.

Three fixes, all of them things an operator would only notice on a bad night.

## The paper no longer waits for a backup

On 2026-09-26 an editor opened the leads page while the nightly `pg_dump` was
running and the page did not load until the dump finished. Nothing was broken:
the two were queueing.

Almost every page's first database call brought the paper's own tables up to
date before doing its real work, statement by statement, on **every** call.
`create table if not exists` against a table that already exists is cheap and
takes no lock worth mentioning, but `alter table ... add column if not exists`
takes the strongest lock there is, and `pg_dump` holds a read lock on the table
for as long as it runs. The ALTER queued behind the dump, and every other read
of that table queued behind the ALTER.

The paper now records, per batch of statements and per database, that the batch
has already run — in a small table it owns (`_schema_ensure_state`) — and skips
the batch from then on. The first call in a process still does the work; every
call after it is two round trips and no DDL at all.

Sixteen modules were still running their statements on every call; they now go
through that one helper (`ensureSchemaOnce`, `src/lib/db.ts`), twenty batches
between them. The ten modules that already went through it are unchanged, no
statement's text was reworded, and no statement's order changed. One of the
sixteen is the paper's settings, which the public front page and the feed ask
for on every load, and another is the beacon that counts a page view — so this
is the public's path too, not only the desk's.

What is proved, and how:

- `src/lib/news/paper-settings-read-lock.test.ts` opens a second connection and
  holds the same read lock `pg_dump` holds on `paper_settings`, warms the read
  path once, then calls the public read again. On the commit before this change
  the call did not return inside the two seconds the test allows, which is the
  reported hang reproduced in a test. With the change it returns at once.
- `src/lib/news/schema-ensure-second-call.test.ts` counts the statements a
  second call actually sends: exactly two, the marker table's own create and
  the lookup that decides to return early. No `alter`, no `create` beyond that.
- `src/lib/news/dark-schema-rebuild.test.ts` is unchanged and still passes: a
  table that is rebuilt from a migration still gets its columns.

Limits: the lock test ran against a scratch Postgres on this machine, not
against the live cluster. And the helper swallows a failing statement on
purpose (an older embedded database does not know every column type), so a
batch that half-succeeds still records itself; the modules that verify their
own tables afterwards still do.

## The watchdog knows its own server

On the same night the watchdog found the stalled server holding port 3000 and
logged *"PID 35156 (node.exe), which is not this app -- not touching it"*, so
the paper was never restarted. It compared a path written with forward slashes
against a command line that Windows reports with backslashes, and that cannot
match — so every port owner took the "not this app" branch.

It now asks the shared predicate, which normalizes the slashes and still
refuses a second installation or an unrelated `node.exe`. The two predicates
are run in a real PowerShell by the tests, under backslash, forward-slash and
mixed spellings.

## A backup that fails cleans up after itself

A dump that dies part way — the database went away, the disk filled, the
machine was restarted — used to leave its half-written file in the folder,
renamed `.incomplete`, with the newest two kept "for inspection". Nobody read
them. A paper whose database is down at 2 AM asks for a backup every five
minutes, so 300 MB of half-written dump could land 288 times in one night, and
the system disk is the one that fills.

Now, before the file is deleted, the backup log gets its size and its last 2 KB
as one line of plain text, so an operator can still see how far `pg_dump` got.
Then the file goes. Any `.incomplete` left in that folder by the older version
goes with it. Only files named `*.sql.incomplete`, and only in the folder a
dump was just attempted in — a real backup, or one of the hand-named safety
copies, is still never deleted.

`scripts/ci-backup.ps1` proves it against the real library with a fake dump
command and no database: a run whose dump works deletes nothing, a run whose
dump is cut short deletes its own file and the older leftover, no
`.incomplete` remains, and the log carries the exact number of bytes that had
been written and the tail it read.

## Not asserted by this document

No release, tag, GitHub publication, production deployment or promoted
candidate is asserted here, and nothing here was measured against the live
paper's cluster. Every check named above ran on this development machine
against a scratch database, a fake backup folder, or an in-memory database.
