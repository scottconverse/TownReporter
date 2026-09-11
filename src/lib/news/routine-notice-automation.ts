import { createServerFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { ROUTINE_NOTICE_FORMAT_KEYS, type RoutineNoticeFormatKey } from "./routine-notice-types.ts";

export type RoutineEditionChannel = "today" | "weekend" | "deadlines";
export type RoutineAutomationSource = {
  sourceId: number;
  sourceUrl: string;
  publicSourceUrl: string;
  formatKey: RoutineNoticeFormatKey;
  issuer: string;
  locality: string;
  collectionArea: string | null;
};
export type RoutineNoticeAutomation = {
  enabled: boolean;
  revision: number;
  timezone: string;
  localTime: string;
  sections: Record<RoutineEditionChannel, string>;
  sources: RoutineAutomationSource[];
  updatedAt: string | null;
  recentRuns: Array<{
    id: number;
    localDate: string;
    status: string;
    summary: {
      published: number;
      corrected: number;
      needsReview: number;
      eligible: number;
      error: string | null;
    };
    createdAt: string;
    articles: Array<{ channel: RoutineEditionChannel; headline: string; href: string }>;
  }>;
};
export type SaveRoutineNoticeAutomationInput = Omit<
  RoutineNoticeAutomation,
  "revision" | "updatedAt" | "recentRuns"
> & { expectedRevision: number };
export type RoutineNoticeAutomationResult =
  | { ok: true; automation: RoutineNoticeAutomation }
  | { ok: false; code: "forbidden" | "conflict" | "invalid-input"; error: string };

const DDL = [
  `create table if not exists routine_notice_automations(newsroom_id integer primary key references newsrooms(id) on delete cascade,enabled boolean not null default false,revision integer not null default 0 check(revision>=0),timezone text not null,local_time text not null default '06:15',today_section text not null,weekend_section text not null,deadlines_section text not null,activated_by text,activated_at timestamptz,updated_at timestamptz not null default now())`,
  `create table if not exists routine_notice_automation_sources(newsroom_id integer not null references routine_notice_automations(newsroom_id) on delete cascade,source_id integer not null,format_key text not null,source_url text not null,public_source_url text not null,issuer text not null,locality text not null,collection_area text,primary key(newsroom_id,source_id,format_key),foreign key(newsroom_id,source_id,format_key) references routine_notice_approvals(newsroom_id,source_id,format_key) on delete cascade)`,
  `create table if not exists routine_notice_automation_changes(id serial primary key,newsroom_id integer not null references newsrooms(id) on delete cascade,revision integer not null,actor text not null,action text not null check(action in ('saved','activated','paused','resumed')),detail text not null default '',changed_at timestamptz not null default now())`,
  `create index if not exists routine_notice_automation_changes_room_idx on routine_notice_automation_changes(newsroom_id,id desc)`,
  `create table if not exists routine_notice_runs(id serial primary key,newsroom_id integer not null references newsrooms(id) on delete cascade,local_date date not null,automation_revision integer not null,policy_revision integer not null,status text not null check(status in ('queued','running','completed','failed','cancelled')),actor text not null,summary_json text not null default '{}',created_at timestamptz not null default now(),finished_at timestamptz,unique(newsroom_id,local_date,automation_revision))`,
  `create table if not exists routine_notice_publications(id serial primary key,newsroom_id integer not null references newsrooms(id) on delete cascade,run_id integer not null references routine_notice_runs(id) on delete restrict,channel text not null check(channel in ('today','weekend','deadlines')),issue_date date not null,article_id integer references articles(id) on delete set null,content_fingerprint text not null,candidate_keys_json text not null default '[]',article_body_hash text not null,created_at timestamptz not null default now(),unique(newsroom_id,channel,issue_date))`,
];
const formatKeys = new Set<string>(ROUTINE_NOTICE_FORMAT_KEYS);
export async function ensureRoutineNoticeAutomationSchema() {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "routine-notice-automation-0054", DDL);
}
class InputError extends Error {
  readonly code: "forbidden" | "conflict" | "invalid-input";
  constructor(code: "forbidden" | "conflict" | "invalid-input", message: string) {
    super(message);
    this.code = code;
  }
}
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
function publicUrl(value: unknown) {
  const raw = text(value, 4000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? raw
      : null;
  } catch {
    return null;
  }
}
function isSupportedHtmlWasteBulletin(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return (
      url.hostname.replace(/^www\./i, "").toLowerCase() === "longmontcolorado.gov" &&
      url.pathname.replace(/\/+$/, "/") ===
        "/waste-services-trash-recycling-composting/special-services-events/fall-leaf-collection/"
    );
  } catch {
    return false;
  }
}
function validTimezone(value: unknown) {
  const zone = text(value, 100);
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    return null;
  }
}
function clean(raw: unknown): SaveRoutineNoticeAutomationInput {
  if (!raw || typeof raw !== "object")
    throw new InputError("invalid-input", "Routine edition settings were malformed.");
  const x = raw as any;
  if (
    typeof x.enabled !== "boolean" ||
    !Number.isSafeInteger(x.expectedRevision) ||
    x.expectedRevision < 0 ||
    !validTimezone(x.timezone) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(x.localTime) ||
    !x.sections ||
    !Array.isArray(x.sources) ||
    x.sources.length > 12
  )
    throw new InputError("invalid-input", "Routine edition settings were malformed.");
  const sections = {
    today: text(x.sections.today, 80),
    weekend: text(x.sections.weekend, 80),
    deadlines: text(x.sections.deadlines, 80),
  };
  if (Object.values(sections).some((v) => !v))
    throw new InputError("invalid-input", "Choose a current section for every edition.");
  const seen = new Set<string>();
  const sources = x.sources.map((s: any) => {
    const key = `${s?.sourceId}:${s?.formatKey}`;
    if (
      !Number.isSafeInteger(s?.sourceId) ||
      s.sourceId < 1 ||
      !text(s.sourceUrl, 4000) ||
      !publicUrl(s.publicSourceUrl) ||
      !text(s.issuer, 200) ||
      !text(s.locality, 200) ||
      !formatKeys.has(s.formatKey) ||
      seen.has(key)
    )
      throw new InputError(
        "invalid-input",
        "Choose valid, unique routine sources with issuer and locality.",
      );
    seen.add(key);
    if (
      s.formatKey === "waste-recycling-schedule" &&
      s.publicSourceUrl.trim() === s.sourceUrl.trim() &&
      !isSupportedHtmlWasteBulletin(s.sourceUrl)
    )
      throw new InputError(
        "invalid-input",
        "Waste calendars require a separate public attribution address.",
      );
    if (s.formatKey === "waste-recycling-schedule" && !text(s.collectionArea, 200))
      throw new InputError(
        "invalid-input",
        "Waste schedules require an owner-entered collection area without a residential address.",
      );
    if (s.formatKey === "library-notice" && !text(s.collectionArea, 200))
      throw new InputError(
        "invalid-input",
        "Library notices require the owner-entered branch name used by structured hours.",
      );
    return {
      sourceId: s.sourceId,
      sourceUrl: s.sourceUrl,
      publicSourceUrl: s.publicSourceUrl,
      formatKey: s.formatKey,
      issuer: s.issuer.trim(),
      locality: s.locality.trim(),
      collectionArea: text(s.collectionArea, 200),
    };
  });
  if (x.enabled && !sources.length)
    throw new InputError("invalid-input", "Choose at least one source before activation.");
  return {
    enabled: x.enabled,
    expectedRevision: x.expectedRevision,
    timezone: x.timezone.trim(),
    localTime: x.localTime,
    sections: sections as any,
    sources,
  };
}
async function owner(sql: Sql, userId: string, room: number) {
  const [r] = await sql.query<{ role: string }>(
    "select role from newsroom_members where user_id=$1 and newsroom_id=$2 for update",
    [userId, room],
  );
  if (r?.role !== "owner")
    throw new InputError(
      "forbidden",
      "Only the current newsroom owner can manage routine editions.",
    );
}
async function read(sql: Sql, room: number): Promise<RoutineNoticeAutomation> {
  const [r] = await sql.query<any>(
    "select * from routine_notice_automations where newsroom_id=$1",
    [room],
  );
  const sources = r
    ? await sql.query<any>(
        "select source_id,source_url,public_source_url,format_key,issuer,locality,collection_area from routine_notice_automation_sources where newsroom_id=$1 order by source_id,format_key",
        [room],
      )
    : [];
  const runs = await sql
    .query<any>(
      "select id,local_date,status,summary_json,created_at from routine_notice_runs where newsroom_id=$1 order by id desc limit 20",
      [room],
    )
    .catch(() => []);
  const publications = await sql
    .query<any>(
      `select p.run_id,p.channel,a.headline,a.slug from routine_notice_publications p
       join articles a on a.id=p.article_id and a.newsroom_id=p.newsroom_id
       where p.newsroom_id=$1 and a.status='published' order by p.id desc`,
      [room],
    )
    .catch(() => []);
  const visibleSections = !r
    ? await sql
        .query<{ key: string }>(
          "select key from newsroom_sections where newsroom_id=$1 and visible=true order by key",
          [room],
        )
        .catch(() => [])
    : [];
  const defaultSection = visibleSections[0]?.key ?? "news";
  const recentRuns = runs.map((row) => {
    const summary = JSON.parse(row.summary_json || "{}");
    return {
      id: row.id,
      localDate: String(row.local_date).slice(0, 10),
      status: String(row.status),
      summary: {
        published: Number(summary.published) || 0,
        corrected: Number(summary.corrected) || 0,
        needsReview: Number(summary.needsReview) || 0,
        eligible: Number(summary.eligible) || 0,
        error: typeof summary.error === "string" ? summary.error : null,
      },
      createdAt: String(row.created_at),
      articles: publications
        .filter((publication) => publication.run_id === row.id)
        .map((publication) => ({
          channel: publication.channel,
          headline: publication.headline,
          href: `/articles/${encodeURIComponent(publication.slug)}`,
        })),
    };
  });
  return r
    ? {
        enabled: r.enabled,
        revision: r.revision,
        timezone: r.timezone,
        localTime: r.local_time,
        sections: {
          today: r.today_section,
          weekend: r.weekend_section,
          deadlines: r.deadlines_section,
        },
        sources: sources.map((s) => ({
          sourceId: s.source_id,
          sourceUrl: s.source_url,
          publicSourceUrl: s.public_source_url,
          formatKey: s.format_key,
          issuer: s.issuer,
          locality: s.locality,
          collectionArea: s.collection_area,
        })),
        updatedAt: String(r.updated_at),
        recentRuns,
      }
    : {
        enabled: false,
        revision: 0,
        timezone: "America/Denver",
        localTime: "06:15",
        sections: {
          today: defaultSection,
          weekend: visibleSections.find((section) => /event/i.test(section.key))?.key ?? defaultSection,
          deadlines:
            visibleSections.find((section) => /deadline|service/i.test(section.key))?.key ?? defaultSection,
        },
        sources: [],
        updatedAt: null,
        recentRuns,
      };
}
export async function saveRoutineNoticeAutomationFor(userId: string, room: number, raw: unknown) {
  const x = clean(raw);
  await ensureRoutineNoticeAutomationSchema();
  return withTransaction(async (sql) => {
    await owner(sql, userId, room);
    const [current] = await sql.query<{ revision: number; enabled: boolean }>(
      "select revision,enabled from routine_notice_automations where newsroom_id=$1 for update",
      [room],
    );
    if ((current?.revision ?? 0) !== x.expectedRevision)
      throw new InputError("conflict", "Routine edition settings changed. Reload before saving.");
    for (const s of x.sources) {
      const [a] = await sql.query<{ source_url: string }>(
        "select a.source_url from routine_notice_approvals a join sources s on s.newsroom_id=a.newsroom_id and s.id=a.source_id and s.status='accepted' and s.url=a.source_url where a.newsroom_id=$1 and a.source_id=$2 and a.format_key=$3 for update of a,s",
        [room, s.sourceId, s.formatKey],
      );
      if (!a || a.source_url !== s.sourceUrl)
        throw new InputError(
          "conflict",
          "A routine source permission changed. Reload before saving.",
        );
    }
    for (const section of Object.values(x.sections)) {
      const [s] = await sql.query<{ visible: boolean }>(
        "select visible from newsroom_sections where newsroom_id=$1 and key=$2",
        [room, section],
      );
      if (!s?.visible)
        throw new InputError(
          "invalid-input",
          "Choose current visible sections for routine editions.",
        );
    }
    const revision = x.expectedRevision + 1;
    await sql.query(
      `insert into routine_notice_automations(newsroom_id,enabled,revision,timezone,local_time,today_section,weekend_section,deadlines_section,activated_by,activated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,case when $2 then now() else null end) on conflict(newsroom_id) do update set enabled=excluded.enabled,revision=excluded.revision,timezone=excluded.timezone,local_time=excluded.local_time,today_section=excluded.today_section,weekend_section=excluded.weekend_section,deadlines_section=excluded.deadlines_section,activated_by=case when excluded.enabled then excluded.activated_by else routine_notice_automations.activated_by end,activated_at=case when excluded.enabled and not routine_notice_automations.enabled then now() else routine_notice_automations.activated_at end,updated_at=now()`,
      [
        room,
        x.enabled,
        revision,
        x.timezone,
        x.localTime,
        x.sections.today,
        x.sections.weekend,
        x.sections.deadlines,
        userId,
      ],
    );
    await sql.query("delete from routine_notice_automation_sources where newsroom_id=$1", [room]);
    for (const s of x.sources)
      await sql.query(
        "insert into routine_notice_automation_sources(newsroom_id,source_id,format_key,source_url,public_source_url,issuer,locality,collection_area) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          room,
          s.sourceId,
          s.formatKey,
          s.sourceUrl,
          s.publicSourceUrl,
          s.issuer,
          s.locality,
          s.collectionArea,
        ],
      );
    const action =
      (!current && x.enabled) || (current && !current.enabled && x.enabled)
        ? "activated"
        : current?.enabled && !x.enabled
          ? "paused"
          : "saved";
    await sql.query(
      "insert into routine_notice_automation_changes(newsroom_id,revision,actor,action,detail) values($1,$2,$3,$4,$5)",
      [room, revision, userId, action, `${x.sources.length} sources`],
    );
    await sql.query(
      "insert into audit_events(user_id,action,detail,newsroom_id,subject_kind,subject_id) values($1,'routine-notice-automation',$2,$3,'routine-notice-automation',$3)",
      [userId, `${action}; revision ${revision}`, room],
    );
    return read(sql, room);
  });
}
export async function readRoutineNoticeAutomationFor(userId: string, room: number) {
  await ensureRoutineNoticeAutomationSchema();
  const sql = await getSql();
  await owner(sql, userId, room);
  return read(sql, room);
}
const failure = (e: unknown): RoutineNoticeAutomationResult =>
  e instanceof InputError
    ? { ok: false, code: e.code, error: e.message }
    : (() => {
        throw e;
      })();
export const getRoutineNoticeAutomation = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<RoutineNoticeAutomationResult> => {
    try {
      return {
        ok: true,
        automation: await readRoutineNoticeAutomationFor(context.userId, context.newsroomId),
      };
    } catch (e) {
      return failure(e);
    }
  });
export const saveRoutineNoticeAutomation = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((x: SaveRoutineNoticeAutomationInput) => x)
  .handler(async ({ context, data }): Promise<RoutineNoticeAutomationResult> => {
    try {
      return {
        ok: true,
        automation: await saveRoutineNoticeAutomationFor(context.userId, context.newsroomId, data),
      };
    } catch (e) {
      return failure(e);
    }
  });
