-- The "Local model" entry's own per-newsroom pick (0.6.19): which local
-- server and which model on it, as opposed to the call/wall timeouts
-- provider_settings already stored (0029_provider_settings.sql).
--
-- Both columns are nullable together: an editor who has never opened the
-- local-model select has no row here, and `local-models.server.ts`'s
-- discovered default is used instead (see `resolveLocalModelChoice` in
-- src/lib/news/provider-settings.ts). A stored id that later drops off the
-- server's model list is not deleted -- `resolveLocalModelChoice` falls
-- back to the current default and surfaces a one-line notice in the picker
-- rather than silently discarding what the editor picked.
--
-- Mirrored by ensureProviderSettingsSchema() in
-- src/lib/news/provider-settings.ts for the PGLite preview and unit-test
-- paths, exactly as the rest of that table is.
alter table provider_settings
  add column if not exists local_model_base_url text,
  add column if not exists local_model_id text;
