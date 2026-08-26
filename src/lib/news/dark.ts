import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { deskMiddleware } from "./desk-auth";
import { grokChat, parseJsonBlock } from "./ai";
import { DARK_SYSTEM } from "./dark-prompt";
import { assertRate, audit } from "./ops";
import {
  checkBaselines,
  ensureInvestigateSchema,
  matchDeadEnds,
  researchLoop,
  resurfaceDeadEnds,
  runDueMonitors,
  seedInvestigation,
} from "./investigate";
import { sanitizePublicUrls } from "./schema";
import type { ArticleRow, MemoryRow, SourceRow } from "./types";

export type DarkSignalRow = {
  id: number;
  run_id: number | null;
  investigation_id: number | null;
  name: string;
  posture: string;
  signal_type: string;
  strength: number;
  confidence: number;
  observation: string;
  pattern: string;
  linkage_map: string;
  alternatives: string;
  counter_narrative: string;
  what_would_kill: string;
  pathway: string;
  privacy_review: string;
  handoff: string;
  created_at: string;
};

export type DarkRunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
};

export type DarkPromiseRow = {
  id: number;
  who_promised: string;
  what: string;
  when_due: string | null;
  source_cite: string | null;
  status: string;
  created_at: string;
};

export type InvestigationRow = {
  id: number;
  title: string;
  status: string;
  summary: string;
  hops: number;
  budget: number;
  created_at: string;
  updated_at: string;
};

const HANDOFFS = new Set([
  "DISCARD",
  "HOLD FOR PATTERN",
  "MONITOR",
  "FOR VERIFICATION",
  "CONTINUE",
  "FINDING",
  "DEAD END",
]);

type DarkJson = {
  window?: string;
  inventory_gaps?: string[];
  editor_summary?: string;
  promises?: {
    who?: string;
    what?: string;
    when_due?: string;
    source_cite?: string;
    status?: string;
  }[];
  signals?: {
    name?: string;
    posture?: string;
    type?: string;
    strength?: number;
    confidence?: number;
    observation?: string;
    pattern?: string;
    linkage_map?: string;
    alternatives?: string;
    counter_narrative?: string;
    what_would_kill?: string;
    pathway?: string;
    privacy_review?: string;
    handoff?: string;
  }[];
};

async function ensureDarkSchema() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists dark_runs (
      id serial primary key,
      user_id text not null,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      summary text,
      error text
    )
  `);
  await sql.query(
    `create index if not exists dark_runs_user_idx on dark_runs (user_id, started_at desc)`,
  );
  await sql.query(`
    create table if not exists dark_signals (
      id serial primary key,
      user_id text not null,
      run_id integer references dark_runs(id) on delete set null,
      name text not null,
      posture text not null,
      signal_type text not null,
      strength integer not null default 3,
      confidence numeric not null default 0.3,
      observation text not null default '',
      pattern text not null default '',
      linkage_map text not null default '',
      alternatives text not null default '',
      counter_narrative text not null default '',
      what_would_kill text not null default '',
      pathway text not null default '',
      privacy_review text not null default '',
      handoff text not null default 'HOLD FOR PATTERN',
      investigation_id integer,
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(
    `create index if not exists dark_signals_user_idx on dark_signals (user_id, created_at desc)`,
  );
  try {
    await sql.query(`alter table dark_signals add column if not exists investigation_id integer`);
  } catch {
    /* older PGLite */
  }
  await sql.query(`
    create table if not exists dark_promises (
      id serial primary key,
      user_id text not null,
      who_promised text not null,
      what text not null,
      when_due text,
      source_cite text,
      status text not null default 'open',
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(
    `create index if not exists dark_promises_user_idx on dark_promises (user_id, created_at desc)`,
  );
  await ensureInvestigateSchema();
}

export const listDarkSignals = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    return sql<DarkSignalRow>`
      select id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, created_at
      from dark_signals
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
  });

export const listDarkRuns = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    return sql<DarkRunRow>`
      select id, started_at, finished_at, summary, error
      from dark_runs
      where user_id = ${context.userId}
      order by started_at desc
      limit 12
    `;
  });

export const listDarkPromises = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    return sql<DarkPromiseRow>`
      select id, who_promised, what, when_due, source_cite, status, created_at
      from dark_promises
      where user_id = ${context.userId}
      order by created_at desc
      limit 40
    `;
  });

export const listInvestigations = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    return sql<InvestigationRow>`
      select id, title, status, summary, hops, budget, created_at, updated_at
      from investigations
      where user_id = ${context.userId}
      order by updated_at desc
      limit 20
    `;
  });

export const getInvestigation = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const inv = await sql<InvestigationRow>`
      select id, title, status, summary, hops, budget, created_at, updated_at
      from investigations where id = ${id} and user_id = ${context.userId} limit 1
    `;
    if (!inv[0]) return null;
    const frontier = await sql<{ id: number; kind: string; label: string; why: string; priority: number; status: string; closed_reason: string | null }>`
      select id, kind, label, why, priority, status, closed_reason from frontier_items
      where investigation_id = ${id} and user_id = ${context.userId}
      order by priority desc, id desc limit 40
    `;
    const artifacts = await sql<{ id: number; url: string; title: string; classification: string; fetch_status: number | null; fetch_outcome: string | null; version_id: number | null; created_at: string }>`
      select id, url, title, classification, fetch_status, fetch_outcome, version_id, created_at from artifacts
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
    const entities = await sql<{ name: string; kind: string; why: string }>`
      select e.name, e.kind, e.why
      from investigation_entities ie
      join entities e on e.id = ie.entity_id
      where ie.investigation_id = ${id} and ie.user_id = ${context.userId}
      order by ie.id desc limit 40
    `;
    const historicalEntities = await sql<{
      name: string;
      kind: string;
      why: string;
      investigation_id: number;
      verdict: string | null;
    }>`
      select e.name, e.kind, e.why, ie.investigation_id, m.verdict
      from entities e
      join investigation_entities ie on ie.entity_id = e.id
      left join entity_matches m on m.user_id = ${context.userId}
        and (
          (m.left_canonical = e.canonical and m.right_canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.user_id = ${context.userId}
          ))
          or (m.right_canonical = e.canonical and m.left_canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.user_id = ${context.userId}
          ))
        )
      where e.user_id = ${context.userId}
        and ie.investigation_id <> ${id}
        and (
          e.canonical in (
            select e2.canonical from investigation_entities x
            join entities e2 on e2.id = x.entity_id
            where x.investigation_id = ${id} and x.user_id = ${context.userId}
          )
          or m.id is not null
        )
      order by ie.id desc
      limit 12
    `;
    const relationships = await sql<{ from_name: string; to_name: string; kind: string; evidence: string; version_id: number | null; capture_event_id: number | null; provenance_status: string | null }>`
      select from_name, to_name, kind, evidence, version_id, capture_event_id, provenance_status from relationships
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
    const claims = await sql<{ body: string; kind: string; evidence: string; confidence: number | null; version_id: number | null; capture_event_id: number | null; provenance_status: string | null }>`
      select body, kind, evidence, confidence, version_id, capture_event_id, provenance_status from claims
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
    const hypotheses = await sql<{ body: string; status: string; supporting: string; contradicting: string }>`
      select body, status, supporting, contradicting from hypotheses
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 20
    `;
    const anomalies = await sql<{ kind: string; summary: string; url: string | null }>`
      select kind, summary, url from anomalies
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 20
    `;
    const deadEnds = await sql<{ hypothesis: string; dismissed_because: string }>`
      select hypothesis, dismissed_because from dead_ends
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 20
    `;
    const searches = await sql<{ hop: number; query: string; state: string | null; provider: string | null }>`
      select hop, query, state, provider from search_log
      where investigation_id = ${id} and user_id = ${context.userId}
      order by id desc limit 40
    `;
    return {
      investigation: inv[0],
      frontier,
      artifacts,
      entities,
      historicalEntities,
      relationships,
      claims,
      hypotheses,
      anomalies,
      deadEnds,
      searches,
    };
  });

async function synthesizeSignals(
  userId: string,
  runId: number,
  investigationId: number,
  paste: string,
) {
  const sql = await getSql();
  const sources = await sql<SourceRow>`
    select id, url, title, kind, tier, status, last_hash, last_fetched_at, last_error
    from sources where user_id = ${userId} order by id asc
  `;
  const arts = await sql<{ title: string; url: string; full_text: string }>`
    select title, url, full_text from artifacts
    where investigation_id = ${investigationId} and user_id = ${userId}
    order by id desc limit 12
  `;
  const frontier = await sql<{ label: string; kind: string; why: string }>`
    select label, kind, why from frontier_items
    where investigation_id = ${investigationId} and user_id = ${userId} and status in ('open', 'investigating', 'reopened')
    order by priority desc limit 16
  `;
  const rels = await sql<{ from_name: string; to_name: string; kind: string }>`
    select from_name, to_name, kind from relationships
    where investigation_id = ${investigationId} and user_id = ${userId} limit 20
  `;
  const claims = await sql<{ body: string; kind: string }>`
    select body, kind from claims
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 12
  `;
  const hyps = await sql<{ body: string; status: string }>`
    select body, status from hypotheses
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 12
  `;
  const anoms = await sql<{ kind: string; summary: string }>`
    select kind, summary from anomalies
    where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 10
  `;
  const leads = await sql<{ headline: string; why: string; topic: string; status: string }>`
    select headline, why, topic, status from leads where user_id = ${userId} order by created_at desc limit 8
  `;
  const articles = await sql<Pick<ArticleRow, "headline" | "topic" | "published_at">>`
    select headline, topic, published_at from articles
    where user_id = ${userId} and status = 'published' order by published_at desc limit 6
  `;
  const memory = await sql<MemoryRow>`
    select entity, last_angle from beat_memory where user_id = ${userId} order by updated_at desc limit 12
  `;
  const searches = await sql<{ query: string }>`
    select query from search_log where investigation_id = ${investigationId} and user_id = ${userId} order by id desc limit 20
  `;

  const pack = [
    `CITY: Longmont, Colorado. Investigation ${investigationId}. Watch list is a start, not a boundary.`,
    `WATCH LIST:\n${sources.map((s) => `${s.tier} ${s.status} ${s.title} ${s.url}`).join("\n") || "(empty)"}`,
    `SEARCHES RUN:\n${searches.map((s) => s.query).join("\n") || "(none)"}`,
    `FRONTIER:\n${frontier.map((f) => `${f.kind}: ${f.label} — ${f.why}`).join("\n") || "(none)"}`,
    `RELATIONSHIPS:\n${rels.map((r) => `${r.from_name} -[${r.kind}]-> ${r.to_name}`).join("\n") || "(none)"}`,
    `CLAIMS:\n${claims.map((c) => `${c.kind}: ${c.body}`).join("\n") || "(none)"}`,
    `HYPOTHESES:\n${hyps.map((h) => `[${h.status}] ${h.body}`).join("\n") || "(none)"}`,
    `ANOMALIES:\n${anoms.map((a) => `${a.kind}: ${a.summary}`).join("\n") || "(none)"}`,
    `ARTIFACTS:\n${arts.map((s) => `### ${s.title}\n${s.url}\n${s.full_text.slice(0, 1600)}`).join("\n\n") || "(none)"}`,
    `OPEN LEADS:\n${leads.map((l) => `${l.status} ${l.topic}: ${l.headline}`).join("\n") || "(none)"}`,
    `PUBLISHED:\n${articles.map((a) => `${a.topic}: ${a.headline}`).join("\n") || "(none)"}`,
    `BEAT MEMORY:\n${memory.map((m) => `${m.entity}: ${m.last_angle}`).join("\n") || "(none)"}`,
    paste ? `EDITOR PASTE:\n${paste.slice(0, 8000)}` : "EDITOR PASTE: (none)",
  ].join("\n\n");

  const ai = await grokChat(DARK_SYSTEM, pack.slice(0, 28000), 3200);
  if (!ai.ok) return { stored: 0, summary: "", error: ai.error as string | undefined };

  const parsed = parseJsonBlock<DarkJson>(ai.text) ?? {};
  const summary = String(parsed.editor_summary ?? "").slice(0, 2000);
  const gaps = (parsed.inventory_gaps ?? []).join("; ").slice(0, 800);
  const header = [summary, gaps ? `Gaps: ${gaps}` : "", parsed.window ? `Window: ${parsed.window}` : ""]
    .filter(Boolean)
    .join("\n");

  let stored = 0;
  for (const sig of parsed.signals ?? []) {
    const name = String(sig.name ?? "").trim();
    if (!name) continue;
    const strength = Math.min(15, Math.max(3, Number(sig.strength) || 3));
    const confidence = Math.min(1, Math.max(0, Number(sig.confidence) || 0.3));
    let handoff = String(sig.handoff ?? "HOLD FOR PATTERN").toUpperCase();
    if (!HANDOFFS.has(handoff)) handoff = "HOLD FOR PATTERN";
    await sql`
      insert into dark_signals (
        user_id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff
      ) values (
        ${userId}, ${runId}, ${investigationId}, ${name.slice(0, 200)},
        ${String(sig.posture ?? "").slice(0, 80)},
        ${String(sig.type ?? "").slice(0, 80)},
        ${strength}, ${confidence},
        ${String(sig.observation ?? "").slice(0, 4000)},
        ${String(sig.pattern ?? "").slice(0, 4000)},
        ${String(sig.linkage_map ?? "").slice(0, 4000)},
        ${String(sig.alternatives ?? "").slice(0, 4000)},
        ${String(sig.counter_narrative ?? "").slice(0, 4000)},
        ${String(sig.what_would_kill ?? "").slice(0, 2000)},
        ${String(sig.pathway ?? "").slice(0, 2000)},
        ${String(sig.privacy_review ?? "").slice(0, 500)},
        ${handoff}
      )
    `;
    stored += 1;
  }

  for (const p of parsed.promises ?? []) {
    const who = String(p.who ?? "").trim();
    const what = String(p.what ?? "").trim();
    if (!who || !what) continue;
    await sql`
      insert into dark_promises (user_id, who_promised, what, when_due, source_cite, status)
      values (
        ${userId}, ${who.slice(0, 200)}, ${what.slice(0, 800)},
        ${String(p.when_due ?? "").slice(0, 120) || null},
        ${String(p.source_cite ?? "").slice(0, 400) || null},
        ${String(p.status ?? "open").slice(0, 40)}
      )
    `;
  }

  return { stored, summary: header, error: undefined as string | undefined };
}

export const runDarkDesk = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: { paste: string; investigationId?: number }) => input)
  .handler(async ({ context, data }) => {
    await ensureDarkSchema();
    await assertRate(context.userId, "dark");
    const sql = await getSql();
    const runRows = await sql<{ id: number }>`
      insert into dark_runs (user_id) values (${context.userId}) returning id
    `;
    const runId = runRows[0]!.id;
    const paste = data.paste.trim().slice(0, 14000);

    let investigationId = data.investigationId ?? 0;
    if (!investigationId) {
      const title =
        paste.slice(0, 80).replace(/\s+/g, " ") ||
        `Investigation ${new Date().toISOString().slice(0, 10)}`;
      const created = await sql<{ id: number }>`
        insert into investigations (user_id, title, budget)
        values (${context.userId}, ${title.slice(0, 200)}, ${5})
        returning id
      `;
      investigationId = created[0]!.id;
      const snaps = await sql<{ title: string; url: string; excerpt: string }>`
        select s.title, s.url, snap.excerpt
        from snapshots snap
        join sources s on s.id = snap.source_id
        where snap.user_id = ${context.userId}
        order by snap.id desc
        limit 16
      `;
      await seedInvestigation(context.userId, investigationId, paste, snaps);
    }

    await checkBaselines(context.userId, investigationId);
    await runDueMonitors({ userId: context.userId });

    const loop = await researchLoop({
      userId: context.userId,
      investigationId,
      hops: 5,
    });

    const synth = await synthesizeSignals(context.userId, runId, investigationId, paste);
    const names = (
      await sql<{ name: string }>`
        select e.name from investigation_entities ie
        join entities e on e.id = ie.entity_id
        where ie.investigation_id = ${investigationId} and ie.user_id = ${context.userId}
        order by ie.id desc limit 40
      `
    ).map((n) => n.name);
    await resurfaceDeadEnds(context.userId, investigationId, names, { foreignOnly: true });
    const revived = await matchDeadEnds(context.userId, names);

    const header = [
      loop.summary,
      synth.summary,
      `Hops ${loop.hops}. Artifacts ${loop.artifacts}. Open frontier ${loop.frontier}.`,
      revived.length
        ? `Prior dead ends matched: ${revived.map((r) => r.hypothesis).join("; ")}`
        : "",
      synth.error ? `Synthesis: ${synth.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await sql`
      update dark_runs
      set finished_at = now(), summary = ${header.slice(0, 2500)}, error = ${synth.error ?? null}
      where id = ${runId} and user_id = ${context.userId}
    `;
    await audit(
      context.userId,
      "dark",
      `run ${runId} inv ${investigationId} hops ${loop.hops} signals ${synth.stored}`,
    );
    return {
      ok: true as const,
      runId,
      investigationId,
      stored: synth.stored,
      hops: loop.hops,
      artifacts: loop.artifacts,
      frontier: loop.frontier,
      paused: loop.paused,
      summary: header,
    };
  });

export const continueInvestigation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    await assertRate(context.userId, "dark");
    const sql = await getSql();
    const inv = await sql<{ id: number }>`
      select id from investigations where id = ${id} and user_id = ${context.userId} limit 1
    `;
    if (!inv[0]) return { ok: false as const, error: "Investigation not found" };
    const runRows = await sql<{ id: number }>`
      insert into dark_runs (user_id) values (${context.userId}) returning id
    `;
    const runId = runRows[0]!.id;
    await checkBaselines(context.userId, id);
    await runDueMonitors({ userId: context.userId });
    const loop = await researchLoop({
      userId: context.userId,
      investigationId: id,
      hops: 5,
    });
    const synth = await synthesizeSignals(context.userId, runId, id, "");
    const names = (
      await sql<{ name: string }>`
        select e.name from investigation_entities ie
        join entities e on e.id = ie.entity_id
        where ie.investigation_id = ${id} and ie.user_id = ${context.userId}
        order by ie.id desc limit 40
      `
    ).map((n) => n.name);
    await resurfaceDeadEnds(context.userId, id, names, { foreignOnly: true });
    const revived = await matchDeadEnds(context.userId, names);
    const header = [
      loop.summary,
      synth.summary,
      `Hops ${loop.hops}. Artifacts ${loop.artifacts}. Open frontier ${loop.frontier}.`,
      revived.length
        ? `Prior dead ends matched: ${revived.map((r) => r.hypothesis).join("; ")}`
        : "",
      synth.error ? `Synthesis: ${synth.error}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await sql`
      update dark_runs
      set finished_at = now(), summary = ${header.slice(0, 2500)}, error = ${synth.error ?? null}
      where id = ${runId} and user_id = ${context.userId}
    `;
    await audit(
      context.userId,
      "dark-continue",
      `run ${runId} inv ${id} hops ${loop.hops} signals ${synth.stored}`,
    );
    return {
      ok: true as const,
      runId,
      investigationId: id,
      stored: synth.stored,
      hops: loop.hops,
      artifacts: loop.artifacts,
      frontier: loop.frontier,
      paused: loop.paused,
      summary: header,
    };
  });

export const sendDarkSignalToQueue = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    await ensureDarkSchema();
    const sql = await getSql();
    const rows = await sql<DarkSignalRow>`
      select id, run_id, investigation_id, name, posture, signal_type, strength, confidence,
        observation, pattern, linkage_map, alternatives, counter_narrative,
        what_would_kill, pathway, privacy_review, handoff, created_at
      from dark_signals where id = ${id} and user_id = ${context.userId} limit 1
    `;
    const sig = rows[0];
    if (!sig) return { ok: false as const, error: "Signal not found" };
    const arts = sig.investigation_id
      ? await sql<{ url: string }>`
          select url from artifacts
          where user_id = ${context.userId} and investigation_id = ${sig.investigation_id}
          order by id desc limit 12
        `
      : await sql<{ url: string }>`
          select url from artifacts
          where user_id = ${context.userId}
          order by id desc limit 12
        `;
    const urls = JSON.stringify(sanitizePublicUrls(arts.map((a) => a.url)));
    const why = [
      `DARK DESK investigation notes. Claim kinds in the evidence. Publication is a separate human action.`,
      `Posture: ${sig.posture}. Type: ${sig.signal_type}. Strength ${sig.strength} / confidence ${sig.confidence}.`,
      sig.observation,
      `Linkage: ${sig.linkage_map}`,
      `Alternatives: ${sig.alternatives}`,
      `Pathway: ${sig.pathway}`,
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 4000);
    const created = await sql<{ id: number }>`
      insert into leads (user_id, headline, why, topic, status, source_urls, evidence, newsworthiness, investigation_id)
      values (
        ${context.userId},
        ${sig.name.slice(0, 240)},
        ${why},
        'council',
        'new',
        ${urls},
        ${sig.observation.slice(0, 4000)},
        ${Math.min(20, sig.strength)},
        ${sig.investigation_id}
      )
      returning id
    `;
    await audit(context.userId, "dark-handoff", String(id));
    return { ok: true as const, leadId: created[0]!.id };
  });
