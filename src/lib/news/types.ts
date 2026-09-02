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
};

export type LeadRow = {
  id: number;
  headline: string;
  why: string;
  topic: string;
  status: string;
  source_urls: string;
  evidence: string | null;
  newsworthiness: number | null;
  created_at: string;
  article_slug?: string | null;
  investigation_id?: number | null;
  notes_json?: string | null;
  resurfaced_count?: number;
  last_resurfaced_at?: string | null;
  last_resurfaced_scan_run_id?: number | null;
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
  summary: string | null;
  error: string | null;
  /**
   * Set only on the most recent row by `listScans` -- true when the run
   * looks open (no finished_at, no error) but the desk_jobs heartbeat behind
   * it has gone cold or never existed. See `runLooksStalled` in `./jobs`.
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
