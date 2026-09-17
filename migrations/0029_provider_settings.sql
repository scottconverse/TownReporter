-- Per-paper overrides for a writing model's time budgets (0.6.2).
--
-- The shipped numbers live in code, in PROVIDER_REGISTRY
-- (src/lib/news/provider-registry.ts): 150 seconds per call on the Claude
-- Code and Codex CLIs, 180 on the configured gateway, 600 reserved for the
-- local-model entry that does not exist yet. Those are right for the
-- providers this desk ships with and wrong for a model running on the
-- operator's own box, which can take four minutes to read a 20,000-character
-- pack and would be called a failure every time.
--
-- The operator's rule for this release: "timeouts are likely too short for
-- local models -- give the editor the option to make them longer or shorter
-- in the interface." This table is where that answer is kept.
--
-- Every column except the key is nullable, and null means "use the shipped
-- default". That is deliberate: the Reset button clears the number rather
-- than writing today's default into the row, so a paper that never made a
-- decision keeps inheriting improvements to the defaults.
--
-- Times are stored in MILLISECONDS here and everywhere in code. The Server
-- page shows and accepts seconds; the conversion happens at that edge only
-- (see toSeconds/fromSeconds in src/lib/news/provider-settings.ts).
--
-- `enabled` is the editor's own switch ("do not offer this model on our
-- desk"), which is a different question from the operator's environment off
-- switch (TOWNREPORTER_CODEX=0, "this machine does not have it"). Both have
-- to be on for a provider to be offered; neither can turn on what the other
-- turned off.
--
-- Mirrored by ensureProviderSettingsSchema() in
-- src/lib/news/provider-settings.ts for the PGLite preview and unit-test
-- paths, exactly as paper_settings is by ensurePaperSettingsSchema().
create table if not exists provider_settings (
  id serial primary key,
  newsroom_id integer not null default 1,
  provider_id text not null,
  call_ms integer,
  wall_ms integer,
  enabled boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (newsroom_id, provider_id)
);
