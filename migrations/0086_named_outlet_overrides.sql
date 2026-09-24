-- Named-outlet overrides (0.6.62, item 4 of the public-trust fixes).
--
-- A story that names a news outlet not in its Sources is refused at publish.
-- An editor can clear one outlet at a time for one draft, and this is where
-- that decision is recorded: who, when, which outlet, which draft. Append-only
-- like the meeting review history in 0085 -- an override is a decision the
-- paper made before printing, and rewriting it after the fact is exactly what
-- the record exists to prevent.
create table if not exists named_outlet_overrides (
  id serial primary key,
  newsroom_id integer not null,
  -- The draft the override was granted for. The body can still be rewritten
  -- after this (draft rows are edited in place), so this is "the draft", not
  -- "the version of the draft": an outlet overridden once stays overridden for
  -- that draft, while any *other* outlet the rewrite names still blocks.
  draft_id integer not null,
  lead_id integer not null,
  outlet text not null check (length(trim(outlet)) > 0),
  overridden_by text not null,
  overridden_at timestamptz not null default now(),
  unique (newsroom_id,draft_id,outlet)
);

create index if not exists named_outlet_overrides_draft_idx
  on named_outlet_overrides (newsroom_id,draft_id);

create or replace function reject_named_outlet_override_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'named outlet overrides are append-only';
end;
$$;

drop trigger if exists named_outlet_overrides_immutable on named_outlet_overrides;
create trigger named_outlet_overrides_immutable
before update or delete on named_outlet_overrides
for each row execute function reject_named_outlet_override_mutation();
