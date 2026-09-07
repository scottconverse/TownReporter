import { randomUUID } from "node:crypto";
import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { ensureInvestigateSchema, rememberCapture } from "./investigate.ts";
import { ingestDocument, type OcrOptions } from "./ingest.ts";
import { assertHttpUrl, sha256 } from "./url-guard.ts";
import { canonicalPublicUrl } from "./fetch-outcome.ts";
import { storyModelChoice } from "./model-choice.ts";
import { readProviderOverrides } from "./provider-settings.ts";
import type { IngestDocument } from "./ingest.ts";
/** Compare complete lines, including short numbers. Excerpts are bounded and labelled. */
export function watchChangeText(previous: string, current: string): string {
  if (previous === current) return "No text change.";
  const lines = (s: string) =>
    s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  const a = lines(previous),
    b = lines(current),
    as = new Set(a),
    bs = new Set(b);
  const removed = a.filter((x) => !bs.has(x)),
    added = b.filter((x) => !as.has(x));
  const excerpt = (xs: string[]) =>
    xs
      .slice(0, 12)
      .map((x) => (x.length > 500 ? `${x.slice(0, 480)} [shortened]` : x))
      .join("\n");
  const note =
    removed.length > 12 || added.length > 12
      ? "\nExcerpt only — open both captures for the complete text."
      : "";
  return (
    `${removed.length ? `Removed: ${excerpt(removed)}\n` : ""}${added.length ? `Added: ${excerpt(added)}` : ""}${note}` ||
    "Text order or spacing changed. Open both captures to compare."
  );
}
export function watchOutcome(doc: IngestDocument, previous: string | null): string {
  if (doc.extractionMethod.startsWith("refused-")) return doc.extractionMethod;
  if (doc.needsOcr || doc.outcome === "needs-ocr") return "needs-ocr";
  if ([401, 403, 429].includes(doc.status)) return "blocked";
  if ([404, 410].includes(doc.status) || ["not-found", "removed", "soft-404"].includes(doc.outcome))
    return "unavailable";
  if (!doc.ok && (doc.status === 0 || doc.status >= 400)) return "failed";
  if (!doc.ok && doc.outcome === "fetch-failed") return "blocked";
  // Some challenge pages return HTTP200 and enough text to pass extraction.
  // Treat their explicit challenge heading as a refusal, never a new record.
  if (
    /^(access denied|just a moment[.!…]*|verify (that )?you are human|robot check|captcha|subscription required)$/i.test(
      doc.title.trim(),
    ) ||
    /^(please verify you are human|checking (your browser|if the site connection)|you must (sign in|subscribe) to (read|continue))/i.test(
      doc.text.trim(),
    )
  )
    return "blocked";
  if (!doc.ok || !doc.text.trim()) return "no-readable-text";
  if (doc.redirectChain.length > 1) return "moved";
  return previous === null ? "first-capture" : previous === doc.text ? "unchanged" : "changed";
}

const WATCH_SCHEMA = `-- Manual investigative page watching. Additive; capture history is retained.
alter table source_monitors add column if not exists manual_watch boolean not null default false;
alter table source_monitors add column if not exists watch_reason text not null default '';
alter table source_monitors add column if not exists watch_state text not null default 'active';
alter table source_monitors add column if not exists watch_lease text;
alter table source_monitors add column if not exists watch_check_started_at timestamptz;
alter table source_monitors add column if not exists watch_last_readable_version_id integer;
alter table source_monitors add column if not exists watch_model_choice text not null default 'auto';
alter table source_monitors add column if not exists watch_last_error text;
create table if not exists manual_watch_checks (
 id serial primary key, newsroom_id integer not null, monitor_id integer not null,
 capture_event_id integer not null unique, previous_version_id integer,
 state text not null, note text not null default '', created_at timestamptz not null default now()
);
create index if not exists manual_watch_checks_monitor on manual_watch_checks(newsroom_id,monitor_id,id desc);
create table if not exists manual_watch_actions (
 newsroom_id integer not null, check_id integer not null, action text not null,
 target_id integer not null default 0, result_id integer not null default 0,
 created_at timestamptz not null default now(),
 primary key(newsroom_id,check_id,action,target_id)
);
`;
export type WatchIdentity = { userId: string; newsroomId: number };
export type WatchInput = {
  url: string;
  name: string;
  reason: string;
  investigationId?: number | null;
  modelChoice?: string;
};
export type WatchRow = {
  id: number;
  url: string;
  title: string;
  watch_reason: string;
  watch_state: string;
  watch_model_choice: string;
  watch_check_started_at: string | null;
  watch_last_error: string | null;
  last_check_at: string | null;
  last_outcome: string | null;
  next_check_at: string;
  investigation_id: number | null;
  watch_last_readable_version_id: number | null;
};
export async function ensurePageWatchSchema() {
  await ensureInvestigateSchema();
  const sql = await getSql();
  await ensureSchemaOnce(
    sql,
    "manual-page-watch",
    WATCH_SCHEMA.replace(/^--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  // Do not claim readiness if a schema statement was rejected by an older DB.
  await sql.query(
    "select watch_reason,watch_lease,watch_last_readable_version_id from source_monitors limit 0",
  );
  await sql.query("select check_id from manual_watch_actions limit 0");
}
async function ownedInvestigation(
  room: number,
  id: number | null | undefined,
  transactionSql?: Sql,
) {
  if (id == null) return true;
  const sql = transactionSql ?? (await getSql());
  const rows = await sql`select id from investigations where id=${id} and newsroom_id=${room}`;
  return rows.length === 1;
}
export async function createPageWatchFor(who: WatchIdentity, input: WatchInput) {
  await ensurePageWatchSchema();
  const sql = await getSql();
  let url: string;
  try {
    const parsed = assertHttpUrl(input.url);
    if (parsed.username || parsed.password) throw new Error("Credentials in URLs are not allowed");
    url = canonicalPublicUrl(parsed.href);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Invalid URL" };
  }
  if (!input.name.trim() || !input.reason.trim())
    return { ok: false as const, error: "Give this watch a name and a reason." };
  if (!(await ownedInvestigation(who.newsroomId, input.investigationId)))
    return { ok: false as const, error: "Investigation not found in this newsroom." };
  const existing = await sql<{
    id: number;
    manual_watch: boolean;
  }>`select id,manual_watch from source_monitors where newsroom_id=${who.newsroomId} and url=${url}`;
  if (existing[0]?.manual_watch)
    return { ok: true as const, id: existing[0].id, alreadyExists: true };
  const rows = await sql<{ id: number }>`
 insert into source_monitors(user_id,newsroom_id,url,title,manual_watch,watch_reason,watch_state,watch_model_choice,investigation_id,enabled,cadence_hours,next_check_at)
 values(${who.userId},${who.newsroomId},${url},${input.name.trim().slice(0, 200)},true,${input.reason.trim().slice(0, 2000)},'active',${storyModelChoice(input.modelChoice)},${input.investigationId ?? null},true,24,now())
 on conflict(newsroom_id,url) do update set manual_watch=true,watch_reason=excluded.watch_reason,title=excluded.title,
 watch_model_choice=excluded.watch_model_choice,investigation_id=coalesce(source_monitors.investigation_id,excluded.investigation_id)
 where source_monitors.manual_watch=false returning id`;
  if (!rows[0]) {
    const raced = await sql<{
      id: number;
    }>`select id from source_monitors where newsroom_id=${who.newsroomId} and url=${url}`;
    return { ok: true as const, id: raced[0]!.id, alreadyExists: true };
  }
  return { ok: true as const, id: rows[0].id, alreadyExists: false };
}
export async function listPageWatchesFor(who: WatchIdentity) {
  await ensurePageWatchSchema();
  const sql = await getSql();
  return sql<WatchRow>`select id,url,title,watch_reason,watch_state,watch_model_choice,watch_check_started_at,watch_last_error,last_check_at,last_outcome,next_check_at,investigation_id,watch_last_readable_version_id from source_monitors where newsroom_id=${who.newsroomId} and manual_watch=true order by id desc`;
}
export async function setPageWatchStateFor(who: WatchIdentity, id: number, state: string) {
  if (!["active", "paused", "stopped"].includes(state))
    return { ok: false as const, error: "Invalid watch state." };
  await ensurePageWatchSchema();
  const sql = await getSql();
  const rows =
    await sql`update source_monitors set watch_state=${state},enabled=${state === "active"},next_check_at=case when ${state}='active' then now() else next_check_at end where id=${id} and newsroom_id=${who.newsroomId} and manual_watch=true returning id`;
  return rows.length ? { ok: true as const } : { ok: false as const, error: "Watch not found." };
}
export async function checkPageWatchFor(
  who: WatchIdentity,
  id: number,
  opts: {
    fetch?: (url: string, options: OcrOptions) => Promise<IngestDocument>;
    now?: Date;
    beforePersist?: () => Promise<void>;
    afterPersistLock?: () => Promise<void>;
  } = {},
) {
  await ensurePageWatchSchema();
  const sql = await getSql();
  const now = opts.now ?? new Date(),
    token = randomUUID();
  const claimed =
    await sql<WatchRow>`update source_monitors set watch_lease=${token},watch_check_started_at=${now.toISOString()}::timestamptz,watch_last_error=null
 where id=${id} and newsroom_id=${who.newsroomId} and manual_watch=true and watch_state='active'
 and (watch_lease is null or watch_check_started_at < ${new Date(now.getTime() - 30 * 60000).toISOString()}::timestamptz)
 returning id,url,title,watch_reason,watch_state,watch_model_choice,watch_check_started_at,watch_last_error,last_check_at,last_outcome,next_check_at,investigation_id,watch_last_readable_version_id`;
  if (!claimed[0]) {
    const found = await sql<{
      watch_state: string;
      watch_lease: string | null;
    }>`select watch_state,watch_lease from source_monitors where id=${id} and newsroom_id=${who.newsroomId} and manual_watch=true`;
    return {
      ok: false as const,
      busy: !!found[0]?.watch_lease,
      error: found[0]?.watch_lease
        ? "A check is already running."
        : found[0]
          ? "Resume this watch before checking it."
          : "Watch not found.",
    };
  }
  const m = claimed[0];
  try {
    const prior = m.watch_last_readable_version_id
      ? await sql<{
          full_text: string;
        }>`select full_text from artifact_versions where id=${m.watch_last_readable_version_id} and newsroom_id=${who.newsroomId} and url=${m.url}`
      : [];
    const overrides = opts.fetch ? null : await readProviderOverrides(who.newsroomId);
    let got: IngestDocument,
      failure = "";
    try {
      got = await (opts.fetch ?? ingestDocument)(m.url, {
        provider: m.watch_model_choice,
        newsroomId: String(who.newsroomId),
        jobLabel: `Watched page ${m.title}`,
        localModel: overrides?.["local-model"]?.localModel,
      });
    } catch (e) {
      failure = e instanceof Error ? e.message.slice(0, 300) : "Check failed";
      got = {
        ok: false,
        status: 0,
        outcome: "fetch-failed",
        text: "",
        title: m.title,
        extras: [],
        contentType: "",
        needsOcr: false,
        redirectChain: [],
        extractionMethod: "none",
        pages: [],
        notices: [],
      };
    }
    await opts.beforePersist?.();
    return await withTransaction(async (sql) => {
      // Lock and fence the monitor until every capture/check/baseline write commits.
      const still =
        await sql`select id from source_monitors where id=${id} and newsroom_id=${who.newsroomId} and watch_lease=${token} for update`;
      if (!still.length)
        return { ok: false as const, error: "This check was superseded. Reload the watch." };
      await opts.afterPersistLock?.();
      const state = watchOutcome(got, prior[0]?.full_text ?? null),
        readable = ["first-capture", "changed", "unchanged", "moved"].includes(state);
      const record = await rememberCapture({
        sql,
        userId: who.userId,
        newsroomId: who.newsroomId,
        investigationId: null,
        url: m.url,
        title: got.title || m.title,
        text: readable ? got.text : "",
        hash: await sha256(readable ? got.text : `${state}:${got.status}`),
        status: got.status,
        outcome: readable
          ? state === "first-capture" || state === "moved"
            ? "fetched"
            : state
          : got.outcome,
        triggerKind: "manual-watch",
        monitorId: id,
        redirectChain: got.redirectChain,
        contentType: got.contentType,
        extractionMethod: got.extractionMethod,
        pages: got.pages,
        extras: got.extras,
        observedAt: now,
        rawBytes: got.rawBytes,
      });
      const note =
        failure ||
        got.needsOcrReason ||
        (state.startsWith("refused-")
          ? "Response was refused by the safe fetch limits. No article text was accepted."
          : "");
      const checks = await sql<{
        id: number;
      }>`insert into manual_watch_checks(newsroom_id,monitor_id,capture_event_id,previous_version_id,state,note,created_at)
  select ${who.newsroomId},${id},${record.captureEventId},${m.watch_last_readable_version_id},${state},${note},${now.toISOString()}::timestamptz
  from source_monitors where id=${id} and newsroom_id=${who.newsroomId} and watch_lease=${token} returning id`;
      if (!checks[0])
        return { ok: false as const, error: "This check was superseded. Reload the watch." };
      if (readable && m.investigation_id) {
        const attached = await actOnPageWatchFor(
          who,
          {
            watchId: id,
            checkId: checks[0].id,
            action: "attach",
            investigationId: m.investigation_id,
          },
          sql,
        );
        if (!attached.ok)
          await sql`update manual_watch_checks set note=${`Capture saved, but attachment failed: ${attached.error}`} where id=${checks[0].id} and newsroom_id=${who.newsroomId}`;
      }
      const finished =
        await sql`update source_monitors set watch_lease=null,watch_check_started_at=null,watch_last_error=${note || null},last_check_at=${now.toISOString()}::timestamptz,last_outcome=${state},last_version_id=${record.versionId},watch_last_readable_version_id=case when ${readable} then ${record.versionId} else watch_last_readable_version_id end,last_success_at=case when ${readable} then ${now.toISOString()}::timestamptz else last_success_at end,next_check_at=${new Date(now.getTime() + 24 * 3600000).toISOString()}::timestamptz where id=${id} and newsroom_id=${who.newsroomId} and watch_lease=${token} returning id`;
      if (!finished.length)
        return {
          ok: false as const,
          error: "A newer check owns this watch. Reload for its result.",
        };
      return { ok: true as const, state, checkId: checks[0]!.id };
    });
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 300) : "Could not save this check.";
    await sql`update source_monitors set watch_lease=null,watch_check_started_at=null,watch_last_error=${error} where id=${id} and newsroom_id=${who.newsroomId} and watch_lease=${token}`;
    return { ok: false as const, error };
  }
}
export async function pageWatchDetailFor(who: WatchIdentity, id: number, offset = 0) {
  const watch = (await listPageWatchesFor(who)).find((w) => w.id === id);
  if (!watch) return null;
  const sql = await getSql();
  const history = await sql<{
    id: number;
    state: string;
    note: string;
    created_at: string;
    capture_event_id: number;
    version_id: number;
    previous_version_id: number | null;
    full_text: string;
    previous_text: string | null;
    redirect_chain: string;
    extraction_method: string;
  }>`
 select c.id,c.state,c.note,c.created_at::text,c.capture_event_id,ce.version_id,c.previous_version_id,av.full_text,pv.full_text as previous_text,ce.redirect_chain,ce.extraction_method
 from manual_watch_checks c join capture_events ce on ce.id=c.capture_event_id and ce.newsroom_id=c.newsroom_id and ce.monitor_id=c.monitor_id
 join artifact_versions av on av.id=ce.version_id and av.newsroom_id=c.newsroom_id and av.url=${watch.url} and ce.source_url=${watch.url} and ce.content_hash=av.content_hash
 left join artifact_versions pv on pv.id=c.previous_version_id and pv.newsroom_id=c.newsroom_id and pv.url=${watch.url}
 where c.newsroom_id=${who.newsroomId} and c.monitor_id=${id} order by c.id desc limit 20 offset ${Math.max(0, offset)}`;
  const actions = await sql<{
    check_id: number;
    action: string;
    target_id: number;
    result_id: number;
  }>`select a.check_id,a.action,a.target_id,a.result_id from manual_watch_actions a join manual_watch_checks c on c.id=a.check_id and c.newsroom_id=a.newsroom_id where c.newsroom_id=${who.newsroomId} and c.monitor_id=${id}`;
  return {
    watch,
    history: history.map((h) => ({
      ...h,
      actions: actions.filter((a) => a.check_id === h.id),
      textChanged: h.previous_text != null && h.full_text !== h.previous_text,
      diff: watchChangeText(h.previous_text ?? "", h.full_text),
      full_text: h.full_text.slice(0, 30000),
      previous_text: h.previous_text?.slice(0, 30000) ?? null,
      textShortened: h.full_text.length > 30000 || (h.previous_text?.length ?? 0) > 30000,
    })),
  };
}
export async function actOnPageWatchFor(
  who: WatchIdentity,
  input: {
    watchId: number;
    checkId: number;
    action: "lead" | "attach" | "dismiss";
    investigationId?: number;
  },
  transactionSql?: Sql,
) {
  if (!transactionSql) await ensurePageWatchSchema();
  const sql = transactionSql ?? (await getSql());
  const captures = await sql<{
    id: number;
    state: string;
    title: string;
    url: string;
    reason: string;
    full_text: string;
    version_id: number;
    capture_event_id: number;
    content_hash: string;
    http_status: number;
    fetch_outcome: string;
    extraction_method: string;
  }>`
 select c.id,c.state,m.title,m.url,m.watch_reason as reason,av.full_text,av.id as version_id,ce.id as capture_event_id,av.content_hash,ce.http_status,ce.fetch_outcome,ce.extraction_method
 from manual_watch_checks c join source_monitors m on m.id=c.monitor_id and m.newsroom_id=c.newsroom_id and m.manual_watch=true
 join capture_events ce on ce.id=c.capture_event_id and ce.monitor_id=m.id and ce.newsroom_id=m.newsroom_id
 join artifact_versions av on av.id=ce.version_id and av.newsroom_id=m.newsroom_id and av.url=m.url and ce.source_url=m.url and ce.content_hash=av.content_hash
 where c.id=${input.checkId} and m.id=${input.watchId} and m.newsroom_id=${who.newsroomId}`;
  const cap = captures[0];
  if (!cap) return { ok: false as const, error: "Capture not found on this watch." };
  if (input.action === "dismiss") {
    await sql`insert into manual_watch_actions(newsroom_id,check_id,action,target_id,result_id) values(${who.newsroomId},${cap.id},'dismiss',0,0) on conflict do nothing`;
    return { ok: true as const, dismissed: true };
  }
  if (!["first-capture", "changed", "unchanged", "moved"].includes(cap.state) || !cap.full_text)
    return {
      ok: false as const,
      error: "This check has no readable capture to hand off. Open the original or check again.",
    };
  if (input.action === "attach") {
    const previous = await sql<{
      result_id: number;
      exists: boolean;
    }>`select a.result_id,exists(select 1 from artifacts r where r.id=a.result_id and r.newsroom_id=a.newsroom_id and r.investigation_id=a.target_id and r.capture_event_id=${cap.capture_event_id}) as exists from manual_watch_actions a where a.newsroom_id=${who.newsroomId} and a.check_id=${cap.id} and a.action='attach' and a.target_id=${input.investigationId ?? 0}`;
    if (previous[0] && !previous[0].exists)
      return {
        ok: false as const,
        error: "The previously attached record was removed. Nothing was recreated.",
      };
    if (
      !input.investigationId ||
      !(await ownedInvestigation(who.newsroomId, input.investigationId, sql))
    )
      return { ok: false as const, error: "Investigation not found in this newsroom." };
    const existing = await sql<{
      id: number;
    }>`select id from artifacts where newsroom_id=${who.newsroomId} and investigation_id=${input.investigationId} and capture_event_id=${cap.capture_event_id} limit 1`;
    if (existing[0])
      return {
        ok: true as const,
        investigationId: input.investigationId,
        artifactId: existing[0].id,
      };
    const inserted = await sql<{ id: number }>`with action as (
   insert into manual_watch_actions(newsroom_id,check_id,action,target_id,result_id)
   values(${who.newsroomId},${cap.id},'attach',${input.investigationId},nextval('artifacts_id_seq'))
   on conflict(newsroom_id,check_id,action,target_id) do update set result_id=manual_watch_actions.result_id returning result_id
  ), saved as (
   insert into artifacts(id,user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,classification,fetch_status,fetch_outcome,version_id,capture_event_id,extraction_method)
   select result_id,${who.userId},${who.newsroomId},${input.investigationId},${cap.url},${cap.title},${cap.content_hash},${cap.full_text},'watched-page',${cap.http_status},${cap.fetch_outcome},${cap.version_id},${cap.capture_event_id},${cap.extraction_method} from action
   on conflict(id) do nothing returning id
  ) select result_id as id from action`;
    return {
      ok: true as const,
      investigationId: input.investigationId,
      artifactId: inserted[0]!.id,
    };
  }
  if (input.action !== "lead") return { ok: false as const, error: "Unknown watch action." };
  const priorLead = await sql<{
    result_id: number;
    exists: boolean;
  }>`select a.result_id,exists(select 1 from leads l where l.id=a.result_id and l.newsroom_id=a.newsroom_id) as exists from manual_watch_actions a where a.newsroom_id=${who.newsroomId} and a.check_id=${cap.id} and a.action='lead' and a.target_id=0`;
  if (priorLead[0] && !priorLead[0].exists)
    return { ok: false as const, error: "The previous lead was removed. Nothing was recreated." };
  const why =
    `Unverified lead from a watched page. A changed page is a reporting prompt, not proof of wrongdoing.\nWhy watched: ${cap.reason}\nCapture state: ${cap.state}. Open the captured record before drafting.`.slice(
      0,
      4000,
    );
  const rows = await sql<{ id: number }>`with action as (
  insert into manual_watch_actions(newsroom_id,check_id,action,target_id,result_id) values(${who.newsroomId},${cap.id},'lead',0,nextval('leads_id_seq'))
  on conflict(newsroom_id,check_id,action,target_id) do update set result_id=manual_watch_actions.result_id returning result_id
 ), saved as (
  insert into leads(id,user_id,newsroom_id,headline,why,topic,status,source_urls,evidence,newsworthiness)
  select result_id,${who.userId},${who.newsroomId},${cap.title.slice(0, 240)},${why},'council','new',${JSON.stringify([cap.url])},${cap.full_text.slice(0, 4000)},12 from action
  on conflict(id) do nothing returning id
 ) select result_id as id from action`;
  return { ok: true as const, leadId: rows[0]!.id };
}
export async function tickManualPageWatches(
  opts: {
    fetch?: (url: string, options: OcrOptions) => Promise<IngestDocument>;
    limit?: number;
  } = {},
) {
  await ensurePageWatchSchema();
  const sql = await getSql();
  const rows = await sql<{
    id: number;
    user_id: string;
    newsroom_id: number;
  }>`select id,user_id,newsroom_id from source_monitors where manual_watch=true and watch_state='active' and enabled=true and next_check_at<=now() order by next_check_at asc limit ${opts.limit ?? 12}`;
  let checked = 0;
  for (const row of rows) {
    const result = await checkPageWatchFor(
      { userId: row.user_id, newsroomId: row.newsroom_id },
      row.id,
      { fetch: opts.fetch },
    );
    if (result.ok) checked++;
  }
  return { checked };
}

export async function setPageWatchModelFor(who: WatchIdentity, id: number, choice: string) {
  await ensurePageWatchSchema();
  const sql = await getSql();
  const rows =
    await sql`update source_monitors set watch_model_choice=${storyModelChoice(choice)} where id=${id} and newsroom_id=${who.newsroomId} and manual_watch=true returning id`;
  return rows.length ? { ok: true as const } : { ok: false as const, error: "Watch not found." };
}
export async function readPageWatchCaptureFor(
  who: WatchIdentity,
  input: { watchId: number; checkId: number; previous?: boolean },
) {
  await ensurePageWatchSchema();
  const sql = await getSql();
  const rows = await sql<{ full_text: string; title: string }>`
 select av.full_text,av.title from manual_watch_checks c
 join source_monitors m on m.id=c.monitor_id and m.newsroom_id=c.newsroom_id and m.manual_watch=true
 join capture_events ce on ce.id=c.capture_event_id and ce.monitor_id=m.id and ce.newsroom_id=m.newsroom_id
 join artifact_versions av on av.id=case when ${input.previous ?? false} then c.previous_version_id else ce.version_id end and av.newsroom_id=m.newsroom_id and av.url=m.url and ce.source_url=m.url
 where c.id=${input.checkId} and m.id=${input.watchId} and m.newsroom_id=${who.newsroomId}`;
  return rows[0] ?? null;
}
