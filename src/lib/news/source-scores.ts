/**
 * Dynamic sources unit 8 (D169, spec 6a/6b): what the Source inventory screen
 * shows about the self-updating source list.
 *
 *   counts  accepted / on trial / dormant sources, and suggested sites waiting;
 *   moves   the latest automatic and editor moves (promoted / demoted), newest
 *           first, each with the source's status now, so the screen can offer
 *           the move back;
 *   rows    every accepted, trial and dormant source with its 90-day numbers
 *           and score, highest score first.
 *
 * Read-only. Declared with the narrow tagged-template SQL type for tests.
 */
import type { SqlTag } from "./lead-filing.ts";
import { yieldScore } from "./source-yield.ts";

export type SourceMove = {
  id: number;
  sourceId: number;
  title: string;
  url: string;
  statusNow: string;
  kind: "promoted" | "demoted";
  note: string;
  by: string;
  at: string;
};

export type SourceScoreRow = {
  id: number;
  title: string;
  url: string;
  status: string;
  kind: string | null;
  tier: string | null;
  reads90: number;
  leads90: number;
  published90: number;
  score: number | null;
  lastLeadAt: string | null;
  nextDueAt: string | null;
  rhythm: string | null;
  intervalMinutes: number | null;
  trialReads: number;
  dormantReason: string | null;
};

function iso(value: unknown): string | null {
  if (value == null) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function loadSourceScores(sql: SqlTag, newsroomId: number) {
  const [counts] = await sql<{ accepted: number; trial: number; dormant: number; suggested_sites: number }>`
    select
      count(*) filter (where status = 'accepted')::int as accepted,
      count(*) filter (where status = 'trial')::int as trial,
      count(*) filter (where status = 'dormant')::int as dormant,
      count(distinct lower(regexp_replace(split_part(regexp_replace(url, '^https?://', ''), '/', 1), '^www\.', '')))
        filter (where status = 'proposed')::int as suggested_sites
    from sources where newsroom_id = ${newsroomId}`;
  const moves = await sql<Record<string, unknown>>`
    select o.id, o.source_id, s.title, s.url, s.status, o.kind, coalesce(o.note, '') as note,
      o.observed_by, o.created_at
    from source_observations o join sources s on s.id = o.source_id
    where o.newsroom_id = ${newsroomId} and o.kind in ('promoted', 'demoted')
    order by o.created_at desc, o.id desc
    limit 40`;
  const rows = await sql<Record<string, unknown>>`
    select s.id, s.title, s.url, s.status, s.kind, s.tier, s.next_due_at, s.rhythm, s.interval_minutes,
      s.trial_reads, s.dormant_reason,
      coalesce(y.reads_90, 0) as reads_90, coalesce(y.leads_90, 0) as leads_90,
      coalesce(y.published_90, 0) as published_90, y.leads_per_read, y.published_per_read,
      coalesce(y.bad_source_kills_90, 0) as bad_source_kills_90, y.last_lead_at
    from sources s left join source_yield y on y.source_id = s.id
    where s.newsroom_id = ${newsroomId} and s.status in ('accepted', 'trial', 'dormant')
    order by s.id`;
  const scored: SourceScoreRow[] = rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    url: String(r.url ?? ""),
    status: String(r.status),
    kind: (r.kind as string | null) ?? null,
    tier: (r.tier as string | null) ?? null,
    reads90: Number(r.reads_90),
    leads90: Number(r.leads_90),
    published90: Number(r.published_90),
    score: yieldScore({
      source_id: Number(r.id),
      reads_90: Number(r.reads_90),
      leads_per_read: r.leads_per_read == null ? null : Number(r.leads_per_read),
      published_per_read: r.published_per_read == null ? null : Number(r.published_per_read),
      bad_source_kills_90: Number(r.bad_source_kills_90),
    }),
    lastLeadAt: iso(r.last_lead_at),
    nextDueAt: iso(r.next_due_at),
    rhythm: (r.rhythm as string | null) ?? null,
    intervalMinutes: r.interval_minutes == null ? null : Number(r.interval_minutes),
    trialReads: Number(r.trial_reads ?? 0),
    dormantReason: (r.dormant_reason as string | null) ?? null,
  }));
  scored.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || b.leads90 - a.leads90 || a.id - b.id);
  return {
    counts: {
      accepted: counts?.accepted ?? 0,
      trial: counts?.trial ?? 0,
      dormant: counts?.dormant ?? 0,
      suggestedSites: counts?.suggested_sites ?? 0,
    },
    moves: moves.map(
      (m): SourceMove => ({
        id: Number(m.id),
        sourceId: Number(m.source_id),
        title: String(m.title ?? ""),
        url: String(m.url ?? ""),
        statusNow: String(m.status),
        kind: m.kind === "demoted" ? "demoted" : "promoted",
        note: String(m.note ?? ""),
        by: String(m.observed_by ?? ""),
        at: iso(m.created_at) ?? "",
      }),
    ),
    rows: scored,
  };
}
