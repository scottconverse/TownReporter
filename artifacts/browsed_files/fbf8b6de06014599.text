# CivicMeetings

> Formerly published as "CivicClerk"; renamed 2026-07 to avoid confusion with an unrelated commercial product of that name. Package and service identifiers are unchanged.

**CivicMeetings is the CivicSuite module for municipal meetings, agendas, packets, minutes, votes, notices, and public meeting archives.**

Status: CivicMeetings v1.0.4 runtime foundation label is provisional during the CivicSuite release recovery.
Current version: `1.0.4`
Repository: <https://github.com/CivicSuite/civicclerk>  
Depends on: published, Sigstore-attested `civiccore` 1.2.1 wheel from the `v1.2.1` release asset

## Release Recovery Notice

CivicMeetings is not product-ready for public promotion while the CivicSuite
release recovery is active. Treat the current `v1.0.4` recovery patch
as provisional until this repo re-earns release status through the recovery
gates: full local backend tests, frontend unit tests, real Playwright user-flow
tests, WSL runtime install proof, release consistency checks, secret/security
scans, docs-source parity enforcement, and explicit mock validation versus
production deployment labeling. Integration release depth now requires live-wire
or in-process boundary validation; adversarial mock checks are supplemental
regression coverage and are not a substitute for claiming a live production
deployment.

Persistence Phase 1 update: motions, votes, action items, minutes drafts,
public archive records, and resident comments now persist to the configured
database when `CIVICCLERK_MOTION_VOTE_DB_URL`, `CIVICCLERK_MINUTES_DB_URL`,
and `CIVICCLERK_PUBLIC_ARCHIVE_DB_URL` are set — set
`CIVICCLERK_MEETING_DB_URL` as well so the parent meeting records survive
with them — so the legal record of a meeting survives an API restart. The
public archive database must also contain the published meeting's referent
row in `civicclerk.meetings` (migration 0014); the publish endpoint returns
a self-describing 404 with the fix when it does not. Without those
variables CivicMeetings falls back to in-memory stores and the legal record
does not survive a restart — do not run a real public meeting without
database-backed persistence enabled. Minutes adoption/posting write paths,
transcript records, ordinance/resolution handoffs, posted notice records,
and packet snapshots remain in-memory pending Persistence Phase 1b.

## Release Provenance

CivicMeetings now wires the strengthened CivicCore release-provenance preflight
into release-class workflows. GitHub release pages can display a "Verified"
badge for the target commit even when the release tag itself is lightweight or
unsigned, so CivicMeetings treats that badge as a commit-only signal. Post-baseline
releases are verified by a Sigstore-signed `release-attestation.json` plus
bundle, and the exact verification shape lives in `docs/ops/release-signing.md`.

The prior public `v0.1.20` release is a historical pre-gate artifact because
its tag predates the attestation model and its public release assets do not
include `release-attestation.json` or `release-attestation.json.bundle`. CO-4
records the decision in `docs/ops/tier1-retrofit-ledger.md`: do not delete,
recreate, mirror, or promote `v0.1.20` as an attested provenance baseline.

## What CivicMeetings will do

CivicMeetings is designed for the legal record of public meetings:

- agenda item intake from departments
- packet assembly
- statutory notice deadline tracking
- meeting motions, votes, and action logging
- minute drafting with source citations
- ordinance and resolution adoption-event export
- public meeting pages for posted agendas, packets, and approved minutes
- searchable meeting archives

AI may draft or extract. Humans approve every consequential action.

## What exists today

CivicMeetings currently contains the runtime and schema foundation plus database-backed agenda item lifecycle records, meeting lifecycle, packet snapshot, shared CivicCore-backed notice compliance, immutable motion capture, immutable vote capture, action-item capture, citation-gated minutes draft capture, permission-aware public calendar/detail/archive endpoints, a prompt YAML library with an offline evaluation harness, local-first connector imports for Granicus, Legistar, PrimeGov, and NovusAGENDA, accessibility/browser QA gates, CivicCore v1.2.1-backed records export bundles, database-backed agenda intake readiness, database-backed packet assembly records, database-backed notice checklist/posting-proof records, database-backed meeting records, and first staff workflow screens for intake, packet assembly/export, notice checklist, meeting outcome, minutes draft, public archive, connector import, and vendor sync work. These capabilities remain under recovery validation and must not be promoted as product-ready until the recovery gates pass. The staff screens submit agenda intake, record readiness review, create/finalize packet assembly records, create records-ready packet export bundles, persist notice checklist records, attach posting proof, capture motions/votes/action items, create citation-gated minutes drafts, publish public-safe archive records, normalize local connector exports through the shared CivicCore connector import contract, surface vendor sync source health and no-network run logging, expose the shared CivicCore connector runtime validation helpers that future live-sync work can adopt without bespoke security plumbing, expose the first vendor live-sync readiness and circuit-breaker contract for future scheduled pulls, consume the shared CivicCore trusted-header config and proxy-source enforcement helpers, and expose `/staff/auth-readiness` so operators can verify whether OIDC, bearer, or trusted-header staff auth is deployment-ready before testing a live session. When OIDC, bearer, or trusted-header mode is ready, the readiness contract now includes a concrete protected-session probe and a protected-write probe instead of only env-var reminders, and trusted-header readiness now carries a loopback-only local proxy rehearsal contract that points operators to `scripts/local_trusted_header_proxy.py` with `127.0.0.1/32` as the safe starter allowlist.

Shipped in this foundation:

- project README
- user manual with non-technical, IT/technical, and architecture sections
- GitHub Pages landing page at `docs/index.html`
- contributing, support, security, code of conduct, issue templates, and PR template
- discussion seed posts
- docs verification script and CI workflow
- Python package metadata with the published `civiccore` 1.2.1 wheel from the `v1.2.1` release asset
- first `frontend/` React/Vite staff workspace slice adapted from the CivicSuite
  mockup into production TypeScript
- live `GET /meetings` endpoint for staff calendar/list views
- live `PATCH /meetings/{id}` endpoint for pre-lock schedule edits with
  audit entries for changed scheduling fields
- live `/meeting-bodies` create/list/read/update/deactivate endpoints backed by
  the canonical meeting body table
- FastAPI application import path at `civicclerk.main:app`
- root endpoint that explains the current product state
- `/health` endpoint for IT staff
- `/staff` staff workflow screens with a live agenda-intake product cockpit for agenda intake, packet assembly/export, notice checklist/posting-proof, meeting outcome, minutes draft, public archive, connector import, and vendor sync work
- live `/staff` agenda intake submission and clerk readiness-review form actions backed by `/agenda-intake`
- live `/staff` packet assembly create/finalize form actions backed by `/meetings/{id}/packet-assemblies`
- live `/staff` packet export form actions backed by `/meetings/{id}/packet-snapshots` and `/meetings/{id}/export-bundle`
- live `/staff` notice checklist and posting-proof form actions backed by `/meetings/{id}/notice-checklists`
- database-backed agenda intake queue with clerk readiness review state and
  promotion linkage via Alembic migrations `civicclerk_0002_intake_queue` and
  `civicclerk_0008_intake_promotion`
- `/agenda-intake` submit/list/review/promote endpoints with audit events for consequential review and promotion actions
- canonical SQLAlchemy metadata for the fourteen CivicMeetings tables
- Alembic scaffold and first idempotent migration for the `civicclerk` schema
- CC-5 canonical data model completion through Alembic migration
  `civicclerk_0011_data_model`, adding downstream contract columns for packet
  version uniqueness, motion/vote correction metadata, public comment intake,
  closed-session ACLs, document references, transcript sensitivity, and
  CivicCode ordinance handoff status
- agenda item lifecycle enforcement from `DRAFTED` through `ARCHIVED`
- optional database-backed agenda item lifecycle persistence with `CIVICCLERK_AGENDA_ITEM_DB_URL`
- CivicCore-verifiable persisted audit hashes for allowed and rejected agenda item transitions
- meeting lifecycle enforcement from `SCHEDULED` through `ARCHIVED`
- database-backed meeting records with CivicCore-verifiable lifecycle audit hashes, scheduled
  starts, meeting body linkage, location, normalized meeting type, and Alembic
  migrations `civicclerk_0005_meetings` plus
  `civicclerk_0007_meeting_schedule`
- `/meetings` list endpoint for live React staff calendar loading
- `/meetings/{id}` schedule update endpoint that blocks edits once the meeting
  reaches the in-session lock point and returns an actionable replacement-meeting
  fix path
- emergency/special meeting notice preconditions requiring a statutory basis
- closed/executive session in-progress preconditions requiring a statutory basis
- cancellation support from scheduled or noticed meetings, with terminal-state audit entries
- packet snapshot versioning for meetings
- database-backed packet assembly records with source references, citations,
  packet snapshot linkage, and Alembic migration `civicclerk_0003_packet_asm`
- `/meetings/{id}/packet-assemblies` create/list endpoint and
  `/packet-assemblies/{id}/finalize` endpoint with durable audit hashes
- notice compliance checks for deadlines, statutory basis, and human approval
- database-backed notice checklist and posting-proof records with Alembic
  migration `civicclerk_0004_notice_ck`
- `/meetings/{id}/notice-checklists` create/list endpoint and
  `/notice-checklists/{id}/posting-proof` endpoint with durable audit hashes
- approved public notice posting records with actionable warning/error responses
- immutable captured motions with seconded-by metadata and append-only correction records
- immutable captured votes with aye, nay, abstain, recusal, and absent outcomes plus append-only correction records
- action items linked to meeting outcomes and source motions
- live `/staff` meeting outcome form actions backed by `/meetings/{id}/motions`,
  `/motions/{id}/votes`, and `/meetings/{id}/action-items`
- live `/staff` minutes draft form actions backed by
  `/meetings/{id}/minutes/drafts`
- live `/staff` public archive form actions backed by
  `/meetings/{id}/public-record`, `/public/meetings`,
  `/public/meetings/{id}/{agenda|packet|minutes}.txt`,
  `/public/meetings/{id}/comments`, and `/public/archive/search`
- live `/staff` connector import form actions backed by
  `/imports/{connector}/meetings`
- citation-gated minutes draft records
- provenance for minutes drafts: model, prompt version, data sources, and human approver
- rejection of uncited AI-drafted minutes output before it can be accepted
- permission-aware public meeting calendar, detail, archive search, document download, and public comment endpoints
- resident-facing React public portal at `/public` in the Docker/nginx product
  path, backed by public calendar, detail, and archive search APIs
- closed-session leak prevention for anonymous public archive bodies, counts, suggestions, and not-found responses
- YAML prompt library under `prompts/` for agenda item summary, staff report
  normalization, packet completeness review, notice compliance review,
  motion/vote summary, minutes drafting, ordinance/resolution extraction,
  closed-session safe refusal, and public plain-language meeting explanation
- prompt registration through `civiccore.llm.resolve_template` as CivicCore
  code-level overrides under `consumer_app="civicclerk"`
- offline prompt evaluation harness that runs with `CIVICCORE_LLM_PROVIDER=ollama`
  and outbound network blocked, covering citation requirements,
  closed-session refusal, legal-determination refusal, public approval gates,
  and input mutation stability
- CC-7 API/frontend completeness contract with generated
  `docs/api/openapi.json`, `scripts/generate-openapi-spec.py`, staff report,
  transcript, ordinance/resolution handoff, public comment review, admin config,
  and prompt admin endpoints, plus 20 direct React page routes for the spec
  surfaces
- CC-7 browser QA evidence in
  `docs/browser-qa/cc7-api-frontend-completeness-qa-2026-05-06.json` and
  `docs/screenshots/cc7-api-frontend-completeness-summary.md`, covering all 20
  pages, five QA states, desktop, 390px mobile, keyboard focus, contrast,
  horizontal overflow, visible copy, and console/runtime checks
- prompt-version provenance enforcement for minutes drafts
- integration-depth readiness at `/integrations/readiness` for CivicRecords search,
  CivicCode handoff, codification export, city CMS posting, and vendor live API
  adapters, plus a live CivicCode handoff emitter that sends adopted
  ordinance/resolution records to `CIVICCODE_INTAKE_URL` when
  the suite bearer handoff value is configured
- local-first Granicus, Legistar, PrimeGov, and NovusAGENDA meeting imports
- source provenance on imported meetings and agenda items
- records-ready packet export bundles with CivicCore v1.2.1 manifests, SHA256 checksums, provenance, and hash-chained audit events
- closed-session/restricted source guardrails for public packet export bundles
- safe API export-path handling through `bundle_name` under `CIVICCLERK_EXPORT_ROOT`
- browser QA gate covering loading, success, empty, error, and partial states
- accessibility checks for keyboard navigation, focus states, contrast, and console errors
- React staff shell QA controls covering loading, success, empty, error, and
  partial states for the Clerk dashboard, meeting calendar, and meeting detail
  workspace
- React staff shell live meeting-list wiring for dashboard metrics, calendar
  cards, and meeting detail selection, with `?source=demo` retained for
  deterministic QA state capture
- React staff dashboard Meeting Runbook that turns loaded meeting, agenda,
  packet, notice, outcomes, minutes, and public posting records into an
  end-to-end ready/warning/blocked lifecycle checklist with a next-safe-action
  button for clerks
- React staff dashboard access panel that reads `/staff/session`, shows local
  protected mode, open mode, OIDC browser-session mode, bearer mode, or trusted-header mode,
  displays signed-in subject/provider/roles when available, and links clerks or
  IT directly to `/staff/login`, `/staff/logout`, and `/staff/auth-readiness`
- ADR-0009 documents why the OIDC browser session bridge remains module-local
  until CivicCore ships that helper, while protected API access continues to
  use CivicCore bearer, trusted-header, trusted-proxy-source, and optional
  archive bearer helpers
- nginx-served Docker/installer product routing for `/staff`, `/staff/...`,
  `/public`, and `/public/...`, with workflow API calls staying under
  `/api/...` and staff auth-readiness/session contracts still proxied to the
  backend
- React Notice Checklist Official Notice Record summary that tells clerks
  whether statutory public-notice proof allows the meeting to proceed, is
  blocked, or is incomplete, with deadline, basis, approval, posting proof, and
  immutable audit-hash fields visible together
- React staff dashboard meeting-body management for creating, renaming, and
  deactivating boards and commissions without hard-deleting meeting history
- React staff dashboard meeting scheduling for creating live calendar records
  from active meeting bodies, plus meeting-detail schedule editing for title,
  body, type, start time, and location before the legal record is locked
- API validation that rejects nonexistent or inactive meeting body ids during
  meeting create/update so staff cannot attach a legal meeting record to invalid
  ownership metadata
- React Agenda Intake workflow for submitting department agenda requests,
  reviewing them as ready or needing revision, promoting ready records into
  canonical agenda lifecycle work, and showing audit-hash evidence from the live
  `/api/agenda-intake` queue
- React Notice Checklist workflow for selecting a meeting, previewing the
  statutory deadline, capturing notice type, posting time, statutory basis,
  human approval, and actor, running the live compliance check, attaching
  posting proof after a passing check, and showing an Official Notice Record,
  legal readiness proof chain, legal-blocker copy, and immutable audit-hash
  evidence from the live notice checklist APIs
- React Public Posting portal for resident-safe public meeting list/detail and
  archive search over posted agenda, posted packet, and approved minutes
  records, with plain-language summaries, adopted/signed minutes metadata,
  document downloads, public comment intake where enabled, official-record
  sections, missing-record guidance, and restricted-session non-disclosure copy
- React Meeting Outcomes workflow for selecting a meeting, loading captured
  motions/votes/action items, capturing immutable motions with seconded-by
  metadata, recording roll-call votes including abstentions, recusals, and
  absences, creating follow-up action items tied to source motions, and warning
  clerks that corrections are append-only rather than silent edits
- React Member Packet workflow for reviewing packet contents, item history,
  staff-report visibility by role, prior vote ledger entries, and member
  conflict/vote recording from the same workflow surface
- React Minutes Draft workflow for selecting a meeting, loading citation-gated
  drafts, creating drafts with explicit source material, sentence-level
  citations, model/prompt provenance, and human approver, and showing that
  AI-drafted minutes cannot be publicly posted until a human adoption workflow
  approves them
- React Vendor Sync workspace for registering approved vendor sources, showing
  healthy/degraded/circuit-open ledger state, recording run outcomes, and
  making the no-network safety boundary, persisted delta cursor, full
  reconciliation reset control, and IT fix guidance visible before scheduled
  vendor pulls are enabled

### CC-4 workflow claims registry

| README workflow claim | Verification |
| --- | --- |
| Public records include plain-language summaries, adopted/signed minutes metadata, agenda/packet/minutes downloads, and comment intake where enabled. | `tests/test_milestone_8_public_archive.py::test_public_record_downloads_comments_and_plain_language_summary`; `frontend/src/App.test.tsx::shows public downloads, summaries, and comment intake where enabled` |
| Public comment intake refuses disabled or closed public records with an actionable fix path. | `tests/test_milestone_8_public_archive.py::test_public_comment_intake_refuses_closed_or_disabled_records_with_fix` |
| Meeting outcomes capture seconded-by motion metadata and roll-call votes including recusals and absences. | `tests/test_milestone_6_motion_vote_action_capture.py::test_api_captured_motion_is_immutable_and_corrections_reference_original`; `frontend/src/App.test.tsx::opens the member packet surface for item history, staff report visibility, and conflict recording` |
| The staff workflow exposes department/legal/clerk agenda routing and audit signoff, plus member packet review for item history, staff-report visibility, and conflict recording. | `frontend/src/App.test.tsx::submits and reviews agenda intake from the staff workspace`; `frontend/src/App.test.tsx::opens the member packet surface for item history, staff report visibility, and conflict recording` |
| Meeting cancellation reaches the lifecycle audit path from the React meeting detail surface. | `frontend/src/App.test.tsx::cancels a scheduled meeting through the lifecycle audit path` |

### CC-5 data model claims registry

| README data model claim | Verification |
| --- | --- |
| All fourteen canonical CivicMeetings tables remain present in the shared `civicclerk` schema. | `tests/test_milestone_2_schema_and_migrations.py::test_canonical_table_models_exist_and_no_tables_are_missing_or_extra` |
| `civicclerk_0011_data_model` upgrades, downgrades to the prior release head, and re-upgrades while preserving the packet-version contract. | `tests/test_milestone_2_schema_and_migrations.py::test_alembic_command_upgrades_real_pgvector_database`; `tests/test_milestone_2_schema_and_migrations.py::test_data_model_completion_migration_declares_reversible_cc5_contract` |
| Packet snapshots are versioned per meeting by schema constraint. | `tests/test_milestone_2_schema_and_migrations.py::test_packet_versions_are_versioned_per_meeting_by_schema_contract` |
| Motion and vote records carry append-only correction metadata that references the original record. | `tests/test_milestone_2_schema_and_migrations.py::test_motion_vote_canonical_tables_preserve_append_only_correction_contract`; `tests/test_milestone_6_motion_vote_action_capture.py::test_api_captured_motion_is_immutable_and_corrections_reference_original` |
| Closed-session material has staff-only ACL fields, and archive search uses released CivicCore search helpers while document-table references remain ADR-bound until CivicCore ships document tables. | `tests/test_milestone_2_schema_and_migrations.py::test_closed_session_material_has_staff_only_acl_schema_contract`; `tests/test_milestone_2_schema_and_migrations.py::test_civiccore_document_and_search_extraction_boundary_is_documented`; `tests/test_milestone_8_public_archive.py::test_archive_search_requires_allowed_bearer_role_for_closed_session_visibility` |

### CC-6 prompt claims registry

| README prompt claim | Verification |
| --- | --- |
| Every spec-required CivicMeetings prompt ships as versioned YAML and resolves through `civiccore.llm.resolve_template` under `consumer_app="civicclerk"`. | `tests/test_milestone_9_prompt_yaml_evals.py::test_all_spec_prompts_are_versioned_and_resolve_through_civiccore` |
| The offline eval harness covers policy phrases, public approval gates, and input mutation stability without network calls. | `tests/test_milestone_9_prompt_yaml_evals.py::test_prompt_eval_harness_runs_offline_with_ollama_provider_selected` |
| The eval harness uses the CivicCore resolver path instead of standalone prompt rendering. | `tests/test_milestone_9_prompt_yaml_evals.py::test_prompt_eval_harness_uses_civiccore_resolver_not_standalone_rendering` |
- Docker Compose deployment stack with PostgreSQL 17 + pgvector, Redis 7.2,
  Ollama, FastAPI, Celery worker, Celery Beat, and nginx-served React frontend
  wired to the `/api` proxy path
- optional scheduled local connector import sync through Celery Beat, disabled
  by default, that reads approved agenda-system JSON export drops from
  `/data/connector-imports`, writes a provenance ledger under `/data/exports`,
  and never contacts vendor networks
- vendor live-sync readiness and persistence primitives that validate proposed
  source URLs through CivicCore guards, reject credentials in URLs, persist
  source/run/failure state in `vendor_sync_*` tables, project source-list
  health and operator fix paths through the shared CivicCore source-status
  helper, compute `healthy`/`degraded`/`circuit_open`, and open the circuit
  after five consecutive full-run failures or two post-unpause grace-period
  failures
- Docker Compose staff-auth env propagation for OIDC browser-login,
  bearer-token, and trusted-header pilot profiles, so `.env` values reach the
  API, worker, and beat containers consistently
- unsigned Windows installer source package with Inno Setup build script,
  Docker Desktop prerequisite check, Install or Repair shortcut, daily Start
  shortcut, `.env` creation from `docs/examples/docker.env.example`, generated
  local PostgreSQL password, health checks, seeded demo startup, and an
  installer wizard warning that explains the expected "Unknown Publisher" /
  "Windows protected your PC" first-install experience, why this small free
  open-source project ships unsigned installers, and when it is OK to choose
  "More info" -> "Run anyway"
- CivicMeetings v1.0.4 release gate and build artifacts
- `scripts/start_fresh_install_rehearsal.ps1` to rehearse the documented
  Windows-first wheel install and first-run smoke checks from an isolated
  `.fresh-install-rehearsal` virtual environment
- `scripts/start_fresh_install_rehearsal.sh` to rehearse the same fresh-install
  wheel path from Bash on Linux, macOS, or Git Bash
- `scripts/check_backup_restore_rehearsal.py` plus
  `scripts/start_backup_restore_rehearsal.ps1` and
  `scripts/start_backup_restore_rehearsal.sh` to seed the SQLite-backed
  workflow stores, back them up with packet export evidence, restore them to
  `.backup-restore-rehearsal`, and verify the restored records are readable
- `docs/examples/deployment.env.example` plus
  `python scripts/check_deployment_readiness.py --env-file ... --strict` so IT
  can validate a deployment env profile without hand-exporting every variable
- `scripts/check_protected_deployment_smoke.py` to consume a completed env
  profile and execute the readiness-provided protected session and write probes
  without printing bearer tokens
- `scripts/check_installer_readiness.py` to verify release artifacts, checksums,
  and handoff bundle contents before building or handing off installer packages
- `scripts/check_enterprise_installer_signing.py` remains available for
  downstream organizations that choose to sign their own internal copy, but
  CivicSuite's supported public Windows path is unsigned
- `scripts/check_connector_sync_readiness.py` to verify supported connector
  payload contracts and future source guards without outbound network calls
- `scripts/run_mock_city_environment_suite.py` to run the reusable no-network
  City of Brookfield mock-city contract suite for Legistar, Granicus, PrimeGov,
  NovusAGENDA, the Brookfield Entra ID OIDC contract, and the Brookfield
  backup-retention/off-host policy contract, with optional `--hostile-mode`
  fixtures for IdP expiry/refresh/JWKS/MFA/clock-skew/group-claim behavior,
  agenda-vendor rate-limit/pagination/schema-drift/partial-outage/duplicate/stale-delta
  cases, and backup-retention restore/manifest/legal-hold/checksum failures
  before module teams add their own module-specific assertions
- `scripts/check_vendor_live_sync_readiness.py` to preview the vendor live-sync
  source contract, auth method, credential placement, health status, and
  circuit-breaker behavior without contacting vendor systems
- `scripts/run_vendor_live_sync.py` to run one explicitly enabled vendor-network
  pull from an approved source, revalidate the URL, read credentials from a
  deployment secret env var, normalize returned JSON through the existing
  connector contract, and record the run outcome in the vendor sync ledger
- optional scheduled vendor-network sync through Celery Beat, disabled by
  default and gated by both `CIVICCLERK_VENDOR_NETWORK_SYNC_SCHEDULE_ENABLED`
  and `CIVICCLERK_VENDOR_NETWORK_SYNC_ENABLED`, so approved source IDs can be
  pulled repeatedly only after IT has configured credentials and accepted live
  vendor traffic
- connector-specific delta request planning for supported vendor live-sync
  sources, so the scheduled path has a tested "changed since" URL contract
  backed by a persisted `last_success_cursor_at` source cursor that advances
  only after fully successful normalized vendor pulls
- `/vendor-live-sync/sources/{id}/cursor-reset` to clear or move that cursor
  without contacting vendors, so IT can force a full source reconciliation with
  an operator reason before the next controlled scheduled pull
- `/vendor-live-sync/sources` and `/vendor-live-sync/sources/{id}/run-log` to
  save proposed vendor sources and record run outcomes with durable operator
  health state; these endpoints are no-network ledgers and do not start vendor
  pulls
- `scripts/run_connector_import_sync.py` to normalize one or more local
  connector export files into a repeatable import ledger without contacting
  vendor systems
- `CIVICCLERK_VENDOR_SYNC_DB_URL` for the durable vendor live-sync source,
  run-log, and failure ledger; it defaults to an in-memory local rehearsal store
  when unset
- `CIVICCLERK_CONNECTOR_SYNC_ENABLED`,
  `CIVICCLERK_CONNECTOR_SYNC_PAYLOAD_DIR_HOST`,
  `CIVICCLERK_CONNECTOR_SYNC_LEDGER_PATH`,
  `CIVICCLERK_CONNECTOR_SYNC_CONNECTORS`, and
  `CIVICCLERK_CONNECTOR_SYNC_INTERVAL_SECONDS` for optional Docker/Celery
  scheduled ingestion of approved local connector export drops
- `scripts/build_release_handoff_bundle.ps1` to package the built wheel, sdist,
  checksums, current docs, proxy reference, and rehearsal helpers into a
  repeatable IT handoff zip without calling it an installer
- `/staff/login`, `/staff/oidc/callback`, and `/staff/logout` for the first OIDC authorization-code + PKCE browser sign-in/session foundation
- `/staff/session` to report whether the live staff shell is in protected default mode, local open mode, OIDC-protected staff mode, OIDC browser-session mode, bearer-protected staff mode, or trusted-header staff mode
- `/staff/auth-readiness` to report whether the current OIDC token-validation and browser-login, bearer-token, or trusted-header staff auth contract is deployment-ready
- structured `session_probe` and `write_probe` guidance from `/staff/auth-readiness` when OIDC, bearer, or trusted-header deployment is ready
- structured `reverse_proxy_reference` guidance from `/staff/auth-readiness` when trusted-header deployment needs a real nginx bridge starting point
- structured `local_proxy_rehearsal` guidance from `/staff/auth-readiness` when trusted-header mode needs a safe loopback-only rehearsal path
- `CIVICCLERK_STAFF_AUTH_MODE=protected|open|oidc|bearer|trusted_header` for the first staff auth foundation contract
- `CIVICCLERK_STAFF_OIDC_PROVIDER`, `CIVICCLERK_STAFF_OIDC_ISSUER`, `CIVICCLERK_STAFF_OIDC_AUDIENCE`, `CIVICCLERK_STAFF_OIDC_JWKS_URL`, `CIVICCLERK_STAFF_OIDC_ROLE_CLAIMS`, and `CIVICCLERK_STAFF_OIDC_ALGORITHMS` for municipal identity-provider access-token validation
- `CIVICCLERK_STAFF_OIDC_AUTHORIZATION_URL`, `CIVICCLERK_STAFF_OIDC_TOKEN_URL`, `CIVICCLERK_STAFF_OIDC_CLIENT_ID`, `CIVICCLERK_STAFF_OIDC_CLIENT_SECRET`, `CIVICCLERK_STAFF_OIDC_REDIRECT_URI`, and `CIVICCLERK_STAFF_OIDC_SESSION_COOKIE_SECRET` for browser authorization-code + PKCE sign-in with a signed HttpOnly staff session cookie
- `CIVICCLERK_STAFF_AUTH_TOKEN_ROLES` for bearer-token-to-role mapping during staff workflow access
- `CIVICCLERK_STAFF_SSO_PRINCIPAL_HEADER`, `CIVICCLERK_STAFF_SSO_ROLES_HEADER`, `CIVICCLERK_STAFF_SSO_PROVIDER`, and `CIVICCLERK_STAFF_SSO_TRUSTED_PROXIES` for trusted reverse-proxy SSO bridge configuration

Not shipped yet:

- city-specific live endpoint enablement for CivicRecords, CivicCode, CMS,
  codifier, or municipal Granicus/Legistar/PrimeGov/NovusAGENDA tenants. The
  CivicMeetings side now distinguishes live-wire or in-process boundary validation
  from supplemental adversarial mock regression checks, and real credentials
  plus endpoint activation remain a deployment task.

## New user experience today

A new user can inspect and run the foundation, open staff workflow screens at `/staff`, open the resident-facing React public portal at `/public` in the Docker/nginx product path, inspect the React staff workspace in `frontend/`, see the current staff access mode and municipal SSO session status directly on the React dashboard, use the React dashboard Meeting Runbook to see the next safe end-to-end meeting action, create and maintain meeting bodies through the React dashboard and `/api/meeting-bodies`, schedule meetings through the React dashboard, load live meetings into the React dashboard/calendar/detail flow through `/api/meetings`, edit pre-lock meeting schedule fields through the React meeting detail view and `PATCH /api/meetings/{id}`, submit agenda intake items into a database-backed queue from the browser, record clerk readiness review from the browser, promote ready intake work into agenda lifecycle records, create/finalize packet assembly records from the React Packet Builder, run the React Notice Checklist with statutory deadline, Official Notice Record proof summary, basis, approval, posting-proof, legal-blocker, and audit-hash visibility, inspect the React Public Posting view over resident-safe agenda, packet, minutes, and archive search records, capture immutable motions, roll-call votes, and source-linked action items from the React Meeting Outcomes workspace, create citation-gated minutes drafts with source material, sentence citations, prompt provenance, human approver, and blocked auto-posting visibility from the React Minutes workspace, inspect the React Vendor Sync workspace for source health/circuit status and no-network run logging, persist notice checklist/posting-proof records from the browser, create citation-gated minutes drafts from the browser, publish public-safe archive records from the browser, normalize local connector exports from the browser or through scheduled local Docker import drops, persist vendor sync source/run health through `CIVICCLERK_VENDOR_SYNC_DB_URL`, persist agenda item lifecycle records through `CIVICCLERK_AGENDA_ITEM_DB_URL`, persist meeting records and lifecycle audit entries through `CIVICCLERK_MEETING_DB_URL`, create draft agenda items and meetings through the API, and generate a records-ready packet export bundle with manifest, checksums, provenance, and audit evidence. The Docker profile is now usable as an end-to-end local product rehearsal or pilot-grade demo with seeded Brookfield data, including a PostgreSQL-native backup/restore rehearsal, OIDC staff-token validation, OIDC browser sign-in/session-cookie foundation, React sign-in/session status polish, optional scheduled local connector export-drop ingestion, and staff-visible vendor sync ledger health; production readiness is validated by adversarial no-network mock city suites for retention/off-host backup operations, municipal IdP behavior, and vendor API drift; unsigned installer warnings are the supported public Windows path for this small free open-source project. The correct next experience is:

1. Read this README.
2. Read `USER-MANUAL.md`.
3. Read `docs/roadmap/mvp-plan.md`.
4. On Windows PowerShell, create a fresh virtual environment and install the current wheel:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   python -m pip install dist/civicclerk-1.0.4-py3-none-any.whl
   ```

5. Start the FastAPI app from the installed package:

   ```powershell
   $env:CIVICCLERK_STAFF_AUTH_MODE="protected"
   python -m uvicorn civicclerk.main:app --host 127.0.0.1 --port 8776
   ```

6. Confirm the fresh-machine smoke-check path:
   - `GET http://127.0.0.1:8776/health` must return `{"status":"ok","service":"civicclerk","version":"1.0.4","civiccore":"1.2.1"}`
   - `GET http://127.0.0.1:8776/staff/auth-readiness` must report `mode: "protected"` and explain that anonymous staff writes are denied until OIDC, bearer, or trusted-header deployment is configured
   - Open `http://127.0.0.1:8776/staff` and confirm the first workflow shell loads
   - In the Docker product path, open `http://127.0.0.1:8080/public` and confirm the React resident public portal loads official agenda, packet, and approved-minutes sections without exposing restricted-session existence.
   - Use `powershell -ExecutionPolicy Bypass -File scripts/start_fresh_install_rehearsal.ps1 -PrintOnly` to print the repeatable Windows fresh-install rehearsal plan, or rerun without `-PrintOnly` to create `.fresh-install-rehearsal\.venv`, install the release wheel, start the installed app, and run the same smoke checks automatically
   - Use `bash scripts/start_fresh_install_rehearsal.sh --print-only` to print the same fresh-install rehearsal plan from Linux, macOS, or Git Bash, or rerun without `--print-only` to create `.fresh-install-rehearsal/.venv`, install the release wheel, start the installed app, and run the same smoke checks automatically; Linux hosts need Python 3 with `venv` support installed first, such as `python3-venv` on Debian or Ubuntu
   - For the Docker product path on Windows, run `powershell -ExecutionPolicy Bypass -File install.ps1` from the source checkout or installed package to create `.env`, build/start Docker Compose, wait for `/health` and the React staff app, and open `http://127.0.0.1:8080/`
   - Build the unsigned Windows setup executable with `bash installer/windows/build-installer.sh` on a workstation with Inno Setup 6; SmartScreen will identify it as unsigned, and Docker volumes are intentionally preserved on uninstall
   - Expect Windows SmartScreen to show "Unknown Publisher" or "Windows protected your PC" because CivicSuite is a small free open-source project and the public installer is not signed with a paid publisher certificate. That warning is expected; choose "More info" and "Run anyway" only when the installer came from the official CivicSuite GitHub release source or your IT team built it from verified CivicSuite source.
   - Use `powershell -ExecutionPolicy Bypass -File scripts/build_release_handoff_bundle.ps1 -PrintOnly` on Windows PowerShell or `bash scripts/build_release_handoff_bundle.sh --print-only` on Linux, macOS, or Git Bash to preview the release handoff bundle, or rerun without the print-only flag after `bash scripts/verify-release.sh` has built `dist/` artifacts
   - Run `python scripts/check_installer_readiness.py` after creating the handoff bundle to verify installer input artifacts, checksums, docs, env examples, and rehearsal helpers before building or handing off the Windows setup package
   - Run `python scripts/check_starter_set_integration.py --umbrella-root ..\civicsuite --require-archives` from this repo when verifying the CivicSuite starter-set package; it checks that CivicCore installs first, CivicRecords AI and CivicMeetings are selectable, package workflow proof is required, and Linux/Windows archives exist
   - Run `python scripts/check_connector_sync_readiness.py` before vendor-network live-sync design work to prove the supported local connector payload contracts and optional future URL/ODBC guard checks without making vendor network calls
   - Run `python scripts/run_mock_city_environment_suite.py --output mock-city-report.json` to prove the reusable City of Brookfield vendor-interface and municipal IdP contract suite before adding module-specific integration assertions; this does not contact vendor networks or expose mock secrets
   - Run `python scripts/run_mock_city_environment_suite.py --hostile-mode --output mock-city-hostile-report.json` to prove the adversarial IdP, agenda-vendor, and backup-retention fixtures remain secret-free, no-network, and actionable before live city integration work begins
   - Run `python scripts/check_vendor_live_sync_readiness.py --connector legistar --source-url https://vendor.example.gov/api/meetings --auth-method bearer_token` to preview the vendor source contract, credential-placement guard, health status, and circuit-breaker behavior before any scheduled vendor pull is wired
   - Set `CIVICCLERK_VENDOR_SYNC_DB_URL`, then use `POST /vendor-live-sync/sources` and `POST /vendor-live-sync/sources/{id}/run-log` to persist proposed vendor source health and run outcomes without making vendor network calls
   - For a deliberately enabled one-time vendor pull, set `CIVICCLERK_VENDOR_NETWORK_SYNC_ENABLED=true`, store the credential in a deployment secret env var, then run `python scripts/run_vendor_live_sync.py --source-id <id> --db-url <ledger-url> --auth-secret-env <SECRET_ENV>`; the runner records success/failure in the same circuit-breaker ledger and refuses circuit-open sources
   - Review `delta_request_url`, `cursor_param`, `cursor_value`, and `cursor_advanced_at` in each one-time or scheduled vendor-network sync report; failed or partial runs intentionally leave the cursor unchanged so the next run can retry without skipping records
   - If IT suspects a missed vendor delta or receives a vendor backfill notice,
     use the Vendor Sync workspace or `POST /vendor-live-sync/sources/{id}/cursor-reset`
     with a clear reason to clear the cursor for full reconciliation; the reset is
     recorded locally as a `cursor_reset` run-log event and still does not contact
     the vendor network
   - For scheduled vendor-network pulls in Docker, keep `CIVICCLERK_VENDOR_NETWORK_SYNC_ENABLED=false` and `CIVICCLERK_VENDOR_NETWORK_SYNC_SCHEDULE_ENABLED=false` until IT has approved `/vendor-live-sync/sources` records, then set `CIVICCLERK_VENDOR_NETWORK_SYNC_SOURCE_IDS`, configure `CIVICCLERK_VENDOR_NETWORK_SYNC_AUTH_SECRET_ENV` or per-source secret env vars, and review the per-source reports under `CIVICCLERK_VENDOR_NETWORK_SYNC_REPORT_DIR`
   - Run `python scripts/run_connector_import_sync.py --payload-dir path\to\exports --connector granicus --output connector-import-ledger.json` when IT has local agenda-system export JSON files and wants a repeatable normalized import ledger without vendor network calls, or set `CIVICCLERK_CONNECTOR_SYNC_ENABLED=true` with `CIVICCLERK_CONNECTOR_SYNC_PAYLOAD_DIR_HOST=.\connector-imports` in the Docker `.env` to let Celery Beat schedule the same local-first import repeatedly
   - Use `python scripts/check_deployment_readiness.py` to print a non-mutating deployment preflight before moving beyond local rehearsal; add `--strict` when CI or IT handoff should fail unless auth, persistent-store env vars, packet export root, release artifacts, docs, and trusted-header proxy references are deployment-ready
   - Copy `docs/examples/deployment.env.example` to a private deployment profile, replace placeholders, and run `python scripts/check_deployment_readiness.py --env-file path\to\deployment.env --strict` to validate OIDC/protected auth, persistent stores, packet export root, release artifacts, docs, and proxy references without printing database URLs or token values
   - Run `python scripts/check_protected_deployment_smoke.py --env-file path\to\deployment.env` after strict readiness passes to execute `/health`, `/staff/auth-readiness`, the protected session probe, and the protected write probe without printing bearer tokens
   - Run `python scripts/check_pilot_readiness.py` after `verify-release.sh`
     and the release handoff bundle to prove developer-owned pilot readiness;
     the report uses adversarial mock city vendor, municipal IdP, protected-auth, and backup-retention suites as supplemental regression evidence while integration release-depth claims require live-wire or in-process boundary validation
     instead of marking them as unbuilt product code; the developer-owned side
     now includes the reusable vendor-interface, municipal IdP, and backup
     retention/off-host mock-city contract suites
   - Use `powershell -ExecutionPolicy Bypass -File scripts/start_backup_restore_rehearsal.ps1 -PrintOnly` on Windows PowerShell or `bash scripts/start_backup_restore_rehearsal.sh --print-only` on Linux, macOS, or Git Bash to preview the backup/restore rehearsal; rerun without the print-only flag to seed the five persistent SQLite stores, create `backup/civicclerk-backup-manifest.json`, restore into `.backup-restore-rehearsal`, and verify the restored agenda intake, agenda item, meeting, packet assembly, notice checklist, and packet export evidence
   - For the Docker product path, use `powershell -ExecutionPolicy Bypass -File scripts/start_docker_backup_restore_rehearsal.ps1 -PrintOnly` on Windows PowerShell or `bash scripts/start_docker_backup_restore_rehearsal.sh --print-only` on Linux, macOS, or Git Bash to preview a PostgreSQL-native rehearsal; rerun without the print-only flag while the Compose stack is running to create `.docker-backup-restore-rehearsal`, capture `backup/civicclerk-postgres.dump` with `pg_dump`, restore it into a temporary database with `pg_restore`, write `backup/civicclerk-docker-backup-manifest.json`, verify restored application tables, and drop the temporary restore database without overwriting the source database
   - Use `powershell -ExecutionPolicy Bypass -File scripts/start_protected_demo_rehearsal.ps1 -PrintOnly` on Windows PowerShell or `bash scripts/start_protected_demo_rehearsal.sh --print-only` on Linux, macOS, or Git Bash to print the protected trusted-header demo profile before launching it
7. Exercise `/agenda-intake`, `/agenda-intake/{id}/review`, `/agenda-items`, `/agenda-items/{id}/transitions`, `/meetings`, `/meetings/{id}/transitions`, `/meetings/{id}/packet-snapshots`, `/meetings/{id}/packet-assemblies`, `/packet-assemblies/{id}/finalize`, `/meetings/{id}/notice-checklists`, `/notice-checklists/{id}/posting-proof`, `/meetings/{id}/export-bundle`, `/meetings/{id}/notices/post`, `/meetings/{id}/motions`, `/motions/{id}/votes`, `/meetings/{id}/action-items`, `/meetings/{id}/minutes/drafts`, `/meetings/{id}/public-record`, `/public/meetings`, `/public/archive/search`, `/imports/{connector}/meetings`, `/vendor-live-sync/sources`, `/vendor-live-sync/sources/{id}/run-log`, and `/vendor-live-sync/sources/{id}/cursor-reset` to smoke-check Milestone 10 plus the production-depth live staff action slices and the no-network vendor sync ledger.
8. Set `CIVICCLERK_AGENDA_ITEM_DB_URL` before agenda item lifecycle persistence smoke checks, set `CIVICCLERK_MEETING_DB_URL` before meeting persistence smoke checks, set `CIVICCLERK_VENDOR_SYNC_DB_URL` before durable vendor sync ledger smoke checks, and set `CIVICCLERK_EXPORT_ROOT` before API packet export smoke checks; API callers provide a relative `bundle_name`, not an arbitrary filesystem path.
9. In OIDC, bearer, or trusted-header mode, call `/staff/auth-readiness` first and use the returned `session_probe` plus `write_probe` before trusting a protected deployment. In OIDC mode, complete the browser-login settings and open `/staff/login`; CivicMeetings redirects to the municipal provider with authorization-code + PKCE parameters, accepts the callback at `/staff/oidc/callback`, and stores a signed HttpOnly CivicMeetings staff session cookie instead of storing the raw OIDC token in the browser.
10. If trusted-header mode is headed toward a real deployment, start from the returned `reverse_proxy_reference` block and the shipped `docs/examples/trusted-header-nginx.conf` sample before you wire in your real identity provider variables and TLS paths.
11. If trusted-header mode is still being rehearsed on one workstation, use the returned `local_proxy_rehearsal` block, set `CIVICCLERK_STAFF_SSO_TRUSTED_PROXIES=127.0.0.1/32`, run `python scripts/local_trusted_header_proxy.py`, and browse the helper listen URL instead of the upstream app URL.
12. If you want the trusted-header demo profile without hand-exporting env vars on Windows PowerShell, run `powershell -ExecutionPolicy Bypass -File scripts/start_protected_demo_rehearsal.ps1 -PrintOnly` to print the exact commands, then rerun the same script without `-PrintOnly` to launch the app on `8877` and the helper proxy on `8878`.
13. If you want the same protected demo profile from Bash on Linux, macOS, or Git Bash, run `bash scripts/start_protected_demo_rehearsal.sh --print-only` first, then rerun without `--print-only` to launch the app on `8877` and the helper proxy on `8878`.
14. Run `CIVICCORE_LLM_PROVIDER=ollama CIVICCLERK_EVAL_OFFLINE=1 NO_NETWORK=1 python scripts/run-prompt-evals.py` before changing prompt YAML.
15. Run `python scripts/verify-browser-qa.py` before landing frontend or browser-visible documentation changes.
16. For the React staff workspace slice, run the frontend package from
   `frontend/` with `npm ci`, `npm audit --audit-level=moderate`,
   `npm run dev`, `npm run test`, and `npm run build`.
17. Follow GitHub issues and discussions for future hardening; do not label mock-only evidence as integration release depth.

## Architecture direction

CivicMeetings follows the CivicSuite pattern:

- FastAPI backend
- React frontend
- PostgreSQL 17 + pgvector
- Redis 7.2 + Celery + Celery Beat
- Ollama / Gemma 4 through `civiccore.llm`, selected by `CIVICCORE_LLM_PROVIDER=ollama`
- local data ownership, no runtime telemetry, no cloud inference

The first Docker Compose stack now exists for local product rehearsal:

```powershell
Copy-Item docs\examples\docker.env.example .env
docker compose up --build
```

Then open `http://127.0.0.1:8080/staff` for the React staff app, or
`http://127.0.0.1:8776/health` for the API health check. The default
`CIVICCLERK_STAFF_AUTH_MODE=protected` is the default and denies anonymous staff writes; explicitly set `CIVICCLERK_STAFF_AUTH_MODE=open` only for local rehearsal, or switch to
OIDC, bearer, or trusted-header mode before shared deployment. The Compose profile
sets `CIVICCLERK_DEMO_SEED=1` by default so the API starts with Brookfield
meeting bodies, meetings, promoted agenda intake, a finalized packet, a posted
notice checklist with posting proof, captured outcomes, citation-gated minutes,
and a public archive record. Set `CIVICCLERK_DEMO_SEED=0` in `.env` for an
empty rehearsal database. The Windows installer package under
`installer/windows/` wraps this same Docker stack.
The installer is unsigned, local-rehearsal oriented, and still requires Docker
Desktop; use OIDC, bearer, or trusted-header auth before any shared deployment.

The foundation is intentionally thin. Canonical schema, Alembic scaffolding, agenda item lifecycle enforcement, agenda item lifecycle persistence, meeting lifecycle enforcement, meeting records, packet snapshot versioning, packet assembly records, notice checklist records, shared notice compliance enforcement, immutable motion capture, immutable vote capture, action-item capture, citation-gated minutes draft capture, permission-aware public archive endpoints, prompt YAML/evaluation gates, local-first connector import normalization, browser QA gates, CivicMeetings v1.0.4 release artifacts, and CivicCore v1.2.1 packet export, browser-evidence verification, connector runtime validation, and trusted-header config enforcement primitives are present. Minutes drafts require sentence-level citations, YAML prompt-version provenance, and human approval before acceptance, and they are never auto-adopted or auto-posted. Anonymous public archive endpoints do not reveal closed-session content in response bodies, counts, suggestions, or error messages. Connector imports record source provenance and do not require outbound network calls in the default local profile. The vendor live-sync foundation now validates proposed vendor source URLs without network calls, blocks credentials in URLs, persists source/run/failure state in `vendor_sync_sources`, `vendor_sync_run_log`, and `vendor_sync_failures`, computes source health as `healthy`, `degraded`, or `circuit_open`, persists `last_success_cursor_at`, plans connector-specific delta URLs from that cursor, advances it only after fully successful normalized pulls, and follows the CivicRecords AI circuit-breaker pattern of five consecutive full-run failures or two grace-period failures after unpause. Public packet exports block closed-session/restricted sources and include manifest, checksum, provenance, and audit evidence. Agenda item records now persist lifecycle status and CivicCore-verifiable transition audit hashes when `CIVICCLERK_AGENDA_ITEM_DB_URL` is configured, and ready agenda intake records can be promoted into those lifecycle records while preserving the generated agenda item id, promotion timestamp, and audit hash on the intake record. Meeting records now persist scheduled starts, meeting body ids, locations, normalized meeting type, lifecycle status, and CivicCore-verifiable transition and schedule-edit audit hashes when `CIVICCLERK_MEETING_DB_URL` is configured; schedule edits are allowed before the in-session lock point, write audit entries, and validate changed meeting body ids before accepting create/update requests. Vendor sync source, run, failure, and cursor state persist when `CIVICCLERK_VENDOR_SYNC_DB_URL` is configured; the API records operator state and no-network cursor resets without pulling vendors, while `scripts/run_vendor_live_sync.py` provides an explicitly enabled one-source pull runner that records outcomes in the same circuit-breaker ledger. Packet assembly records now persist source references, citations, linked packet snapshot ids, and durable audit hashes. Notice checklist records persist compliance outcomes, warnings, posting proof, and durable audit hashes. Browser QA now checks loading, success, empty, error, and partial states plus keyboard, focus, contrast, and console evidence, and release screenshots are bound to the current docs page through shared CivicCore verification helpers. CivicMeetings v1.0.4 now pairs with the published `civiccore` 1.2.1 wheel from the `v1.2.1` release asset. The first staff auth foundation is now explicit: fresh installs default to `CIVICCLERK_STAFF_AUTH_MODE=protected` so anonymous staff writes are denied, local rehearsals can explicitly opt into `CIVICCLERK_STAFF_AUTH_MODE=open`, municipal identity-provider deployments can set `CIVICCLERK_STAFF_AUTH_MODE=oidc` plus issuer, audience, JWKS, role-claim, algorithm, authorization URL, token URL, client, redirect URI, and session-cookie-secret settings, bearer-protected pilots can set `CIVICCLERK_STAFF_AUTH_MODE=bearer` plus `CIVICCLERK_STAFF_AUTH_TOKEN_ROLES`, and trusted reverse-proxy deployments can set `CIVICCLERK_STAFF_AUTH_MODE=trusted_header` plus `CIVICCLERK_STAFF_SSO_PRINCIPAL_HEADER`, `CIVICCLERK_STAFF_SSO_ROLES_HEADER`, `CIVICCLERK_STAFF_SSO_PROVIDER`, and `CIVICCLERK_STAFF_SSO_TRUSTED_PROXIES`. The `/staff/auth-readiness` endpoint now tells operators whether those OIDC token-validation, OIDC browser-login, bearer, or trusted-proxy settings are merely present or actually deployment-ready, and it includes a loopback-only rehearsal recipe so trusted-header testing does not require inventing a custom proxy first.

The staff experience at `/staff` now includes a product cockpit plus first workflow screens for agenda intake, packet assembly/export, notice checklist/posting-proof, meeting outcome, minutes draft, public archive, connector import, and vendor sync work. It is intentionally honest: the cockpit gives clerks a day-at-a-glance desk, reads the live agenda intake queue for ready/pending/needs-revision counts, the Agenda Intake, Packet Assembly, Notice Checklist, Meeting Outcomes, Minutes Draft, and Vendor Sync panels render live queue/record rows with escaped user-submitted titles where applicable and actionable empty/unavailable-store rows, the workflow screens can submit their corresponding live API actions, the auth panel now renders concrete protected-session and protected-write probes from `/staff/auth-readiness` when OIDC, bearer, or trusted-header mode is ready, it surfaces the loopback-only local proxy rehearsal command and env vars when trusted-header mode is being staged, and the broader multi-role React clerk console is now beginning under `frontend/`. The React slice uses the CivicSuite mockup direction for a real staff shell, meeting body management, meeting scheduling, meeting calendar, lifecycle ribbon, audit/evidence drawer, pre-lock schedule editing, Agenda Intake submit/review/promotion, Packet Builder promoted-item selection, packet draft creation, per-meeting queue review, packet finalization, Notice Checklist statutory deadline review, legal-blocker copy, posting-proof attachment, immutable audit-hash evidence, Public Posting resident-safe list/detail/search, Meeting Outcomes motion/vote/action capture with immutable-record guidance, Minutes Draft source/citation/provenance capture, Vendor Sync source-health/circuit-breaker/cursor visibility with no-network run logging and full-reconciliation reset guidance, and no-dead-end QA states. The Docker profile now seeds Brookfield demo data so city IT can open the React app and see live work immediately; the unsigned Windows installer wraps that same stack for install/repair and daily start. The resident-facing `/public` route in the nginx product path now opens the React public portal directly, loads public calendar records, public-safe detail, and anonymous archive search from the live public APIs, and keeps restricted-session existence, counts, and summaries out of resident copy.

For Windows installer packaging, `install.ps1` is the install/repair entrypoint and `installer/windows/` contains the Inno Setup source, launcher scripts, prerequisite checker, and build helper. The package creates `.env` from `docs/examples/docker.env.example` when needed, generates a local database password, starts Docker Compose with seeded demo data by default, waits for API and staff-app health, and opens the React staff app. The public CivicSuite installer is unsigned by design for this small free open-source project, so Windows may show SmartScreen or Unknown Publisher warnings; it is OK to bypass those warnings only for official CivicSuite release artifacts or installer builds your IT team produced from verified CivicSuite source. The installer preserves Docker volumes on uninstall and does not replace the protected-auth deployment checks required for shared municipal use.

For the first real trusted-header deployment handoff, `docs/examples/trusted-header-nginx.conf` now ships a reference nginx bridge that strips client-supplied identity headers, sets proxy-owned staff headers, and points operators back to `CIVICCLERK_STAFF_SSO_TRUSTED_PROXIES` plus the `/staff/auth-readiness` contract before live staff traffic is trusted.

For fresh Windows install rehearsals, `scripts/start_fresh_install_rehearsal.ps1` now prints and can execute the documented wheel-install path from an isolated `.fresh-install-rehearsal` virtual environment: create venv, upgrade pip, install `dist/civicclerk-1.0.4-py3-none-any.whl`, set `CIVICCLERK_STAFF_AUTH_MODE=protected`, launch the installed app on `127.0.0.1:8776`, verify `/health`, verify `/staff/auth-readiness`, and fetch `/staff`. If the wheel is missing, the helper tells the operator to build it with `python -m build` before trying again.

For fresh Bash install rehearsals on Linux, macOS, or Git Bash, `scripts/start_fresh_install_rehearsal.sh` now prints and can execute the same wheel-install path from an isolated `.fresh-install-rehearsal/.venv`, with the same `/health`, `/staff/auth-readiness`, `/staff`, missing-wheel, occupied-port, and Python `venv` prerequisite checks as the Windows helper. On Debian or Ubuntu, install `python3-venv` before executing the helper.

For IT release handoff, `scripts/build_release_handoff_bundle.ps1` and `scripts/build_release_handoff_bundle.sh` now print and can create `dist/civicclerk-1.0.4-release-handoff.zip` containing the built wheel, source distribution, checksums, current README/manual/changelog/license, docs landing page, deployment env profile example, installer-readiness helper, enterprise signing-readiness helper, connector sync readiness helper, vendor live-sync readiness helper, protected deployment smoke helper, trusted-header nginx reference, and the fresh-install/protected-demo rehearsal helpers. Both helpers intentionally refuse to overwrite an existing bundle and they are release-input zips, not setup executables; build artifacts first with `bash scripts/verify-release.sh`. After the zip exists, `python scripts/check_installer_readiness.py` verifies the handoff bundle before the Windows setup package is built or handed to IT.

For connector import operations, `python scripts/check_connector_sync_readiness.py` verifies the supported Granicus, Legistar, PrimeGov, and NovusAGENDA local payload contracts without outbound network calls. It can also validate a proposed `--source-url` or `--odbc-connection-string` through the shared CivicCore host guards before vendor-network live sync is designed. `python scripts/check_vendor_live_sync_readiness.py --connector legistar --source-url https://vendor.example.gov/api/meetings --auth-method bearer_token` checks the first live-sync source contract, rejects credentials in URLs, previews `healthy`/`degraded`/`circuit_open`, and simulates the circuit breaker without contacting the vendor. With `CIVICCLERK_VENDOR_SYNC_DB_URL` set, `POST /vendor-live-sync/sources` saves a validated source and `POST /vendor-live-sync/sources/{id}/run-log` records success, partial, or failed run outcomes into the durable no-network ledger; `GET /vendor-live-sync/sources` and `GET /vendor-live-sync/sources/{id}/run-log` expose the operator health state and actionable fix text. When IT has exported local JSON files, `python scripts/run_connector_import_sync.py --payload-dir path\to\exports --output connector-import-ledger.json` normalizes `<connector>.json` or `<connector>/*.json` payloads through the same import contract and writes a provenance ledger. In the Docker product path, IT can enable the same local-first normalization on a schedule with `CIVICCLERK_CONNECTOR_SYNC_ENABLED=true`, drop approved exports into `CIVICCLERK_CONNECTOR_SYNC_PAYLOAD_DIR_HOST`, and review the ledger at `CIVICCLERK_CONNECTOR_SYNC_LEDGER_PATH`. This scheduled local export-drop sync still does not contact vendors, and the vendor live-sync ledger does not contact vendors until a later adapter/scheduled-pull slice is built.

For deployment hardening, `scripts/check_deployment_readiness.py` now prints a non-mutating readiness report that reuses the staff auth readiness contract, checks whether deployment database URL environment variables are present without printing secret values, warns when `CIVICCLERK_EXPORT_ROOT` is still using the local default, verifies release artifacts and required docs exist, and confirms the trusted-header nginx reference is available. Run it without flags for an operator report, with `--env-file path\to\deployment.env` to validate a copied profile from `docs/examples/deployment.env.example`, or with `--strict` when CI or IT handoff should fail unless the deployment posture is ready.

### CivicCode live handoff emitter

CivicMeetings emits ordinance/resolution handoff records to CivicCode when the
city-core installer or operator configures `CIVICCODE_INTAKE_URL` and the suite
bearer handoff value. On successful
`POST /meetings/{meeting_id}/ordinance-resolution-handoff`, CivicMeetings maps the
meeting, motion/agenda provenance, affected sections, source document reference,
and adopted text into CivicCode's existing
`/api/v1/civiccode/staff/civicclerk/ordinance-events` intake contract. The
local handoff record always shows the result:

- `EMIT_DELIVERED` with `civiccode_event_id` when CivicCode accepts it.
- `EMIT_FAILED` with `civiccode_handoff_last_error` and
  `civiccode_handoff_last_attempt_at` when CivicCode returns 4xx/5xx or the
  network times out.
- `EMIT_SKIPPED_UNCONFIGURED` when either required setting is missing.

Retry failed or previously unconfigured records with
`POST /meetings/{meeting_id}/ordinance-resolution-handoff/retry`. CivicMeetings does
not run an infinite background retry loop; operators should fix the URL, shared
value, or CivicCode health issue shown in the local record and then retry.

For protected deployment smoke checks, `scripts/check_protected_deployment_smoke.py --env-file path\to\deployment.env` now loads the completed env profile, requires strict deployment readiness, verifies `/health` and `/staff/auth-readiness`, executes the readiness-provided protected session probe, executes the protected write probe, and redacts bearer tokens from output. Trusted-header profiles use `127.0.0.1` as the default in-process proxy source; pass `--trusted-proxy-client-ip` when the completed profile allowlists a different proxy test address. The sample profile intentionally fails this smoke until placeholders are replaced.

For local wheel backup/restore rehearsal, `scripts/check_backup_restore_rehearsal.py` creates a timestamped run under `.backup-restore-rehearsal`, seeds the SQLite-backed agenda intake, agenda item, meeting, packet assembly, and notice checklist stores, writes packet export evidence, copies those files into a backup directory with `civicclerk-backup-manifest.json`, restores them to separate `restored-data` and `restored-exports` directories, and reopens the restored records through CivicMeetings repositories. Operators can preview the Windows-first wrapper with `powershell -ExecutionPolicy Bypass -File scripts/start_backup_restore_rehearsal.ps1 -PrintOnly` or the Bash wrapper with `bash scripts/start_backup_restore_rehearsal.sh --print-only`; failures name the file or record that did not survive and tell the operator to keep the run directory, fix the backup source or env var, and rerun with a new run id.

For Docker/PostgreSQL backup/restore rehearsal, `scripts/check_docker_backup_restore_rehearsal.py` works against the running Compose stack instead of the SQLite wheel stores. Operators can preview it with `powershell -ExecutionPolicy Bypass -File scripts/start_docker_backup_restore_rehearsal.ps1 -PrintOnly` or `bash scripts/start_docker_backup_restore_rehearsal.sh --print-only`; rerunning without the print-only flag creates `.docker-backup-restore-rehearsal`, uses `pg_dump` to write `backup/civicclerk-postgres.dump`, creates a temporary restore database, runs `pg_restore`, records restored application tables in `restore-verification.json`, writes `backup/civicclerk-docker-backup-manifest.json`, and drops the temporary restore database by default. It does not drop, clean, or overwrite the source `civicclerk` database.

For protected demos on Windows PowerShell, `scripts/start_protected_demo_rehearsal.ps1` now prints and can launch the loopback-only trusted-header profile end to end: the app on `127.0.0.1:8877`, the helper proxy on `127.0.0.1:8878`, the required trusted-header env vars, the health/readiness checks, and the browser target for `/staff`.

For Bash-based operator rehearsals on Linux, macOS, or Git Bash, `scripts/start_protected_demo_rehearsal.sh` now prints and can launch the same loopback-only trusted-header profile with `export` commands and the same smoke-check/browser targets instead of leaving Unix shell parity undocumented.

## Verification

Before every push:

```bash
python -m pytest
bash scripts/verify-docs.sh
python scripts/check-civiccore-placeholder-imports.py
python scripts/verify-browser-qa.py
CIVICCORE_LLM_PROVIDER=ollama CIVICCLERK_EVAL_OFFLINE=1 NO_NETWORK=1 python scripts/run-prompt-evals.py
bash scripts/verify-release.sh
```

## License

Code: Apache License 2.0; see `LICENSE-CODE`.  
Documentation: CC BY 4.0 unless otherwise stated; see `LICENSE-DOCS`.
