-- WR1: the whole-meeting story writer's ledger, claims and run stats.
--
-- WHY THIS EXISTS. The transcript-story path (see `meeting-draft-material`
-- and the `meeting-transcript` mode in `report.ts`) could draft from a meeting
-- tape, but a four-hour council session holds twenty-odd newsworthy items and
-- the writer was locked to one of them: `retrieveMeetingEvidence` chooses a
-- single subject and the write prompt strips "unrelated votes". Everything the
-- meeting did outside that subject -- motions, budget figures, proclamations,
-- tributes -- was read and then dropped with nothing recording that it had
-- been seen. The work order for WR1 asks for one story that leads with the
-- meeting's main decision and still names the rest, against a ledger that
-- accounts for every item so an omission is a decision, not an accident.
--
-- THREE TABLES/COLUMNS, ALL ADDITIVE:
--
-- `meeting_ledger_items` is the ledger. One row per item the inventory pass
-- found in the tape (or marked unread). `status` is the editorial decision --
-- lead, roundup, excluded, unread -- and `reason` is the one-line why, kept so
-- a reader of the panel can see the draft's own accounting. `source_excerpt`
-- is the verbatim tape text the item was read from, with `start_seconds` and
-- `packet_page` locating it. Nothing here is model prose stored unguarded: the
-- writer routes every column through the same storable-text guard as the rest
-- of the draft (see `desk.ts`).
--
-- `draft_claims` is the check output. Every dollar figure, percent, date and
-- vote word the finished body states is a row, marked `found` when it appears
-- in the transcript or packet text the writer read and `flagged` when it does
-- not. This is the "zero invented facts" pass mark made inspectable: the desk
-- can list the flagged rows rather than asserting the draft is clean.
--
-- `drafts.meeting_notes` carries the check results and the cold-check list for
-- one draft. It is deliberately NOT length-capped (unlike `integrity_notes`,
-- cut at 2,000 chars in `coerce-draft.ts`): the whole point is that the
-- accounting can be longer than a note.
--
-- `drafts.run_stats` records what the run cost: wall-clock milliseconds, the
-- number of model calls, and input/output tokens summed from the per-call
-- `ChatResultMetadata`. Before this the pipeline dropped the provider metadata
-- the adapters already fill; a run's cost was unmeasurable after the fact.
--
-- All four are nullable / defaulted so every draft written before this
-- migration reads as "not recorded" rather than as an empty ledger or a free
-- run. The tables have no ensure-counterpart in the runtime schema helpers on
-- purpose -- they are written by the desk's own draft transaction, not by a
-- boot-time ensure (see the migrations-only note in `schema-parity.test.ts`).

create table if not exists meeting_ledger_items (
  id bigserial primary key,
  newsroom_id integer not null,
  draft_id integer not null,
  lead_id integer not null,
  -- The position in the ledger's own numbering (1..n), so the panel can order
  -- rows without trusting insertion order.
  item_no integer not null,
  -- What the item is: motion, amendment, vote, withdrawn-motion, staff-report,
  -- presentation, public-comment, council-comment, announcement, proclamation,
  -- tribute. Free text rather than an enum: the inventory model names the kind
  -- and a value outside the prompt's list must still be storable.
  kind text not null default 'item',
  -- The item's own words, as the inventory pass wrote them (short clause).
  text text not null default '',
  -- Where on the tape and in the packet it was read from. Null is honest:
  -- an announcement may have no timestamp, a public comment no packet page.
  start_seconds integer,
  packet_page integer,
  -- The editorial decision. Constrained to the four the pipeline can make:
  -- `lead` (the story leads with it), `roundup` (named in ALSO AT THE MEETING),
  -- `excluded` (not in the story, with a reason), `unread` (the window's
  -- inventory reply could not be parsed, so the item is accounted for as
  -- unread rather than silently lost).
  status text not null default 'excluded'
    check (status in ('lead', 'roundup', 'excluded', 'unread')),
  -- The one-line why for the status. Empty is allowed for `unread`, where the
  -- status itself is the reason.
  reason text not null default '',
  -- The verbatim tape excerpt the item was read from.
  source_excerpt text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists meeting_ledger_items_draft_idx
  on meeting_ledger_items (draft_id, item_no);
comment on table meeting_ledger_items is
  'Every item the WR1 inventory pass found in a meeting tape, with its editorial status and the verbatim excerpt it came from.';

create table if not exists draft_claims (
  id bigserial primary key,
  newsroom_id integer not null,
  draft_id integer not null,
  -- The claim exactly as the finished body states it (a figure, a percent, a
  -- date, a vote word, a name).
  claim text not null,
  -- Where the check looked: `primary` is the meeting's own record (transcript
  -- or packet text), `secondary` is anything else the writer was given.
  source_kind text not null default 'primary'
    check (source_kind in ('primary', 'secondary')),
  -- What the claim was matched against: a segment id, a packet page, or a
  -- short note naming the source text.
  source_ref text not null default '',
  -- `found` when the claim appears in the source text, `flagged` when it does
  -- not (and therefore needs an editor's eye before publication).
  check_status text not null default 'flagged'
    check (check_status in ('found', 'flagged')),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists draft_claims_draft_idx on draft_claims (draft_id);
comment on table draft_claims is
  'Every figure, date, quote and vote word the WR1 body states, marked found in the meeting record or flagged for review.';

-- The check results and the cold-check list for one draft, uncapped.
alter table drafts add column if not exists meeting_notes text;
comment on column drafts.meeting_notes is
  'WR1 check results and cold-check list for a whole-meeting draft. Not length-capped (integrity_notes is). Null = not a whole-meeting draft.';

-- What the run cost: { wallMs, modelCalls, inputTokens, outputTokens }.
alter table drafts add column if not exists run_stats jsonb;
comment on column drafts.run_stats is
  'Wall-clock ms, model-call count and token totals for the draft run, summed from ChatResultMetadata. Null = written before this migration.';
