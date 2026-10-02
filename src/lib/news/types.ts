export type SourceRow = {
  id: number;
  url: string;
  title: string;
  kind: string;
  tier: string;
  status: string;
  last_hash: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  /*
    The failure streak (migration 0115, unit SH0-1): how many scans in a row
    could not read this source, when that run of failures began, and when it
    last read successfully. Optional for the same reason as the block below --
    a reader that selects only the watch-list columns has no answer rather than
    a wrong one, and `keepsFailing` reads a missing count as zero.
  */
  consecutive_failures?: number | null;
  failure_streak_started_at?: string | null;
  last_ok_at?: string | null;
  /*
    Why this source was suggested, who suggested it, and where it came from
    (migration 0097). Optional because most readers of this type select only
    the watch-list columns, and because every row proposed before 0.6.70 has
    null for all of them -- which is "not recorded", not "no reason".
  */
  proposed_reason?: string | null;
  proposed_by?: string | null;
  proposed_scan_run_id?: number | null;
  proposed_lead_id?: number | null;
  proposed_section?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  /*
    How many new snapshots this source produced on the most recent pass -- 0 on
    a source that was fetched and had not changed. It is what lets the watch
    list say "Changed · 2 new items" rather than only when it was last seen.
    Optional for the same reason as the block above: most readers of this type
    select only the watch-list columns, and a row read by an older select has
    no answer rather than a wrong one.
  */
  new_since_last_pass?: number | null;
  /*
    SH-B: politeness, on the row. `retry_after` is when the desk may ask this
    source again -- set when a site said "come back later" (429/503) and when a
    host blocked us (401/403/bot wall), and the moment the next pass reads to
    decide whether to skip the row. `retry_after_note` is the sentence the
    Sources row prints while it is parked, stored rather than recomputed
    because it is what the site told us, at the moment it told us.
    `blocked_at`/`blocked_attempts` are the run of blocks the backoff is read
    from. Optional for the same reason as the block above: most readers of this
    type select only the watch-list columns.
  */
  retry_after?: string | null;
  retry_after_note?: string | null;
  blocked_at?: string | null;
  blocked_attempts?: number | null;
};

export type LeadRow = {
  id: number;
  scan_run_id?: number | null;
  headline: string;
  why: string;
  topic: string;
  /** The scan filed this lead under a section the model never named, so the
   * section shown is the desk's fallback rather than a decision. Set by
   * `parseScanResult` (lib/news/schema.ts), cleared when an editor confirms a
   * section on the draft (`performConfirmDraftTopic`, lib/news/desk.ts). */
  topic_unchosen?: boolean;
  status: string;
  source_urls: string;
  evidence: string | null;
  newsworthiness: number | null;
  created_at: string;
  /** How this lead entered the desk (migration 0091). "import" = read out of
   * a report the editor pasted; null = not recorded, which includes every lead
   * filed before 0091 and every scanner lead (those carry scan_run_id). */
  origin?: string | null;
  article_slug?: string | null;
  investigation_id?: number | null;
  notes_json?: string | null;
  resurfaced_count?: number;
  last_resurfaced_at?: string | null;
  last_resurfaced_scan_run_id?: number | null;
  /** QA-1 round 3: set when this lead was filed as a "possible" (not
   * "strong") match against an existing lead -- see matchStrength in
   * lib/news/lead-match.ts. Points at that existing lead's id; null for a
   * plain new lead or a strong match (which never gets its own new row). */
  possible_duplicate_of?: number | null;
  /** The prior lead is returned only when it still belongs to this newsroom.
   * A removed target is deliberately null rather than leaking historical text.
   *
   * Unit AK item 5: it now carries everything the Compare view shows side by
   * side -- the prior lead's why, sources and dates, and (when it is killed)
   * the record of that kill. Two leads, both readable without a second fetch. */
  possible_duplicate?: {
    id: number;
    headline: string;
    status: string;
    why?: string | null;
    source_urls?: string | null;
    created_at?: string | null;
    kill_reason?: string | null;
    kill_reason_url?: string | null;
    killed_at?: string | null;
  } | null;
  /** Migration 0094. Which of the two duplicate paths filed this lead.
   * `"developing"` (Unit AK item 2) means it was filed
   * against a KILLED lead because it carries facts that lead did not have --
   * see newFactsIn in lib/news/lead-match.ts. `"possible"` is the QA-1
   * "possible" match tier, filed and linked rather than stamped. */
  dup_kind?: string | null;
  /** U28 (migration 0113). The desk's duplicate check, as lib/news/dup-check.ts
   * left it. Null on every field means the desk never asked -- no borderline
   * pair, a check that failed, or a row filed before this unit -- which is NOT
   * the same as `false`: only an explicit `false` suppresses a chip. See
   * `printedDupChip` in lib/news/desk-copy.ts. */
  dup_ai_same?: boolean | null;
  /** The model's one-line reason for the link verdict above. */
  dup_ai_why?: string | null;
  /** The headline that verdict was about; kept when the verdict cleared the link. */
  dup_ai_target?: string | null;
  /** The verdict on the "Looks already printed" chip. */
  dup_ai_printed_same?: boolean | null;
  dup_ai_printed_why?: string | null;
  /** The published story that chip verdict was about. */
  dup_ai_printed_slug?: string | null;
  /** Migration 0094. The reason recorded when this lead was killed, shown on
   * its page and beside any finding filed against it (Unit AK items 4 and 6).
   * Null for a kill with no stated reason, and for every lead killed before
   * the column existed -- killRecordLine (desk-copy.ts) says so in words. */
  kill_reason?: string | null;
  /** The article or lead the kill reason points at, when it names one. */
  kill_reason_url?: string | null;
  killed_at?: string | null;
  meeting_video_id?: string | null;
  meeting_artifact_id?: number | null;
  meeting_lead_purpose?: string | null;
  /** Migration 0105 ("Edit the lead", 0.6.80): when this lead's title, notes
   * or section was last changed through the edit dialog, and who changed it.
   * Null for a lead nobody has edited (or edited before 0.6.80). */
  edited_at?: string | null;
  edited_by?: string | null;
};

export type DraftRow = {
  id: number;
  lead_id: number;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  source_urls: string;
  integrity_notes: string | null;
  updated_at: string;
  provenance_json?: string | null;
  form?: string | null;
  found_note?: string | null;
  unanswered?: string | null;
  research_json?: string | null;
  /** Migration 0091. The reader-facing line the import review screen chose.
   * Empty = the publish path falls back to the standard line. */
  disclosure_text?: string | null;
  /** Migration 0093. The headline the model wrote, kept even when `headline`
   * holds the editor's. Null/absent = written before 0.6.67, not recorded. */
  model_headline?: string | null;
  /** Migration 0093. The section the model chose, kept alongside `topic`
   * (which is what prints and may be the editor's). */
  model_topic?: string | null;
  /** Migration 0093. Who last decided this row's headline: `model` or
   * `editor`. A redraft keeps the editor's headline when this reads editor. */
  headline_source?: string | null;
};

export type ArticleRow = {
  id: number;
  slug: string;
  headline: string;
  dek: string;
  body: string;
  topic: string;
  source_urls: string;
  status: string;
  published_at: string;
  provenance_json?: string | null;
  form?: string | null;
  found_note?: string | null;
  unanswered?: string | null;
  /** Migration 0091. The disclosure line this article prints. Empty = the
   * standard line from src/components/ai-disclosure.tsx. */
  disclosure_text?: string | null;
  provenance?: import("./findings").ProvenanceItem[];
  findings?: import("./findings").StoryFinding[];
  corrections?: { date: string; body: string }[];
};

export type MemoryRow = {
  id: number;
  entity: string;
  last_angle: string;
  updated_at: string;
};

export type ScanRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  sources_fetched: number;
  leads_created: number;
  sources_proposed: number;
  /**
   * Coverage accounting (migration 0065). Every run records the full path from
   * selection to filing so a zero-lead success, a provider failure, and a
   * partially-analyzed run are distinguishable in the UI. Absent on rows
   * written before this migration -- read them with `?? 0`, never assume.
   */
  sources_selected?: number;
  sources_attempted?: number;
  sources_failed?: number;
  sources_analyzed?: number;
  model_batches_used?: number;
  model_batches_failed?: number;
  failed_sources?: string | null;
  meetings_found?: number;
  meetings_captured?: number;
  meetings_failed?: number;
  meeting_failures?: string | null;
  summary: string | null;
  error: string | null;
  execution_origin?: "manual" | "scheduled";
  /**
   * Set by `listScans` on every open row -- true when its run has no error or
   * finish receipt but the corresponding desk_jobs row is missing, terminal,
   * or has a cold heartbeat. See `runLooksStalled` in `./jobs`.
   */
  stalled?: boolean;
};

export type CorrectionRow = {
  id: number;
  body: string;
  created_at: string;
  headline: string | null;
  slug?: string | null;
};

/**
 * The Follow-ups object (Direction A, stage 1): who the editor asked and
 * what they owe. One row per ask; `lead_id`/`article_id` link it to the
 * story it belongs to when known. See migrations/0042_follow_ups.sql.
 *
 * Redesign phase 6 (migrations/0101_ai_follow_ups.sql) added a second kind of
 * row to the same table: an AI follow-up, where an agent keeps working on the
 * question instead of the editor. `agent_kind` null is a manual ask -- the
 * 0042 shape, and every row written before 0101 -- and is drawn as a Manual
 * card. The two vocabularies coexist in `status`: open/answered/dropped for a
 * manual ask, active/paused/stopped/done for an agent.
 */
export type FollowUpRow = {
  id: number;
  /**
   * Owner and newsroom are part of the row because the run path needs them and
   * has no session to read them from: `performDueFollowUps` has no editor, and
   * the scheduler enqueues the job under the follow-up's own user. Every
   * select in ./follow-ups.ts already returned both.
   */
  newsroom_id: number;
  user_id: string;
  lead_id: number | null;
  article_id: number | null;
  who: string;
  what: string;
  due_on: string | null;
  status: FollowUpStatus;
  nudged_at: string | null;
  answered_at: string | null;
  reply_text: string | null;
  created_at: string;
  /** null on a manual row; recheck | search | agenda on an agent (0101). */
  agent_kind: FollowUpAgentKind | null;
  /** JSON array of URL strings -- see followUpTargets() in ./follow-ups.ts. */
  targets_json: string;
  /** 2h | 6h | 12h | daily | weekly | posting-days, or '' on a manual row. */
  schedule: string;
  /** A provider id, `auto`, or `custom:<uuid>`. `auto` = the phase 5 order. */
  model_choice: string;
  last_run_at: string | null;
  next_run_at: string | null;
  /** The agent's last outcome; null on a manual row that has never run. */
  last_state: FollowUpState | null;
  /** JSON object -- see FollowUpFinding in ./follow-ups.ts. `{}` when none. */
  finding_json: string;
  lead_headline?: string | null;
  article_slug?: string | null;
  article_headline?: string | null;
};

/** What an AI follow-up's agent does. Text + check in the database (0101). */
export type FollowUpAgentKind = "recheck" | "search" | "agenda";

/**
 * `last_state`. `no-change` and `could-not-check` are deliberately separate:
 * an agent that ran and found nothing is working, one that could not reach the
 * page is not, and a quietly failing follow-up must not look like a quietly
 * working one. The reason behind a `could-not-check` is in the finding.
 */
export type FollowUpState = "found" | "no-change" | "could-not-check" | "running" | "waiting";

/**
 * The union of both vocabularies: a manual ask (0042) and an agent (0101).
 * The database's check constraint is this union too -- see 0101's note on why
 * it was widened rather than rewritten.
 */
export type FollowUpStatus =
  | "open"
  | "answered"
  | "dropped"
  | "active"
  | "paused"
  | "stopped"
  | "done";
