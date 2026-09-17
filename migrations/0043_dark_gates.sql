-- Dark Desk restored to the operator's original two-stage doctrine.
--
-- Stage 1 is the Black Desk (speculative, confidence capped at 0.5). Stage 2
-- is the Dark Signal Desk, whose four adversarial gates are MANDATORY before
-- a signal may be called finalized. Both stages, and the searches the app
-- runs on the signal's behalf, now have somewhere to live.
--
-- Forward migration only: new nullable columns, nothing destructive.
alter table dark_signals add column if not exists stage text not null default 'black-desk';
alter table dark_signals add column if not exists verification_status text not null default 'unverified';
alter table dark_signals add column if not exists gate_disproof text;
alter table dark_signals add column if not exists gate_source_independence text;
alter table dark_signals add column if not exists gate_missing_context text;
alter table dark_signals add column if not exists gate_self_referential boolean;
alter table dark_signals add column if not exists gates_missing text;
-- Every adversarial query the app ran for this signal: query, kind, tier,
-- the URL that answered, and the outcome. The editor sees this list.
alter table dark_signals add column if not exists adversarial_json text;
alter table dark_signals add column if not exists newsworthiness_json text;
alter table dark_signals add column if not exists newsworthiness_decision text;
alter table dark_signals add column if not exists verified_at timestamptz;

-- Round-level record of the sniffing: every search this round ran, with the
-- tier that answered.
alter table dark_runs add column if not exists searches_json text;
alter table dark_runs add column if not exists stage text;

-- Which source tier answered a dig search (official / local-press /
-- community). civic-scanner v2.1 orders them; the app records which one
-- actually came back.
alter table search_log add column if not exists tier text;

-- The county the dark desk scopes its searches to, alongside the city.
alter table dark_settings add column if not exists county text;
