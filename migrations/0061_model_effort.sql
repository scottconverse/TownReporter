alter table daily_scan_policies
  add column if not exists model_effort text;

alter table dark_runs
  add column if not exists model_effort text;

-- The 0.6.50 connection form allowed Google's endpoint to be saved before a
-- model was chosen. Those encrypted keys are valid, but a null model keeps
-- the connection out of every picker. Preserve the key and make the existing
-- Gemini preset usable on upgrade.
update custom_ai_connections
set model_id = 'gemini-2.5-flash', updated_at = now()
where (model_id is null or btrim(model_id) = '')
  and lower(trim(trailing '/' from base_url)) =
    'https://generativelanguage.googleapis.com/v1beta/openai';
