import { createServerFn } from "@tanstack/react-start";
import { ensureSchemaOnce, getSql, withTransaction, type Sql } from "../db.ts";
import { deskMiddleware } from "./desk-auth.ts";
import { ForbiddenError } from "./membership.ts";

export const ROUTINE_NOTICE_FORMATS = [
  { key: "library-notice", label: "Library notices", description: "Routine library notices." },
  {
    key: "parks-recreation-notice",
    label: "Parks and recreation notices",
    description: "Routine parks and recreation notices.",
  },
  {
    key: "community-arts-event-logistics",
    label: "Community and arts event logistics",
    description: "Organizer-confirmed event logistics.",
  },
  {
    key: "registration-deadline",
    label: "Routine registration deadlines",
    description: "Routine registration deadlines.",
  },
  {
    key: "waste-recycling-schedule",
    label: "Waste and recycling schedules",
    description: "Routine service schedules.",
  },
  {
    key: "public-meeting-logistics",
    label: "Public meeting logistics",
    description: "Routine meeting time and place details.",
  },
] as const;
export type RoutineNoticeFormatKey = (typeof ROUTINE_NOTICE_FORMATS)[number]["key"];
export type RoutineNoticeApproval = {
  sourceId: number;
  sourceTitle: string | null;
  sourceUrl: string;
  formatKey: RoutineNoticeFormatKey;
  sourceState: "accepted" | "changed" | "unaccepted" | "missing";
  valid: boolean;
};
export type RoutineNoticeChange = {
  revision: number;
  actor: string;
  changedAt: string;
  action: "approved" | "revoked" | "paused" | "resumed" | "saved";
  sourceId: number | null;
  sourceUrl: string | null;
  formatKey: RoutineNoticeFormatKey | null;
};
export type RoutineNoticePolicy = {
  paused: boolean;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
  effectivePublicationAvailable: true;
  approvals: RoutineNoticeApproval[];
  recentChanges: RoutineNoticeChange[];
};
export type SaveRoutineNoticePolicyInput = {
  expectedRevision: number;
  paused: boolean;
  approvals: Array<{ sourceId: number; sourceUrl: string; formatKey: RoutineNoticeFormatKey }>;
};
export type RoutineNoticePolicyResult =
  | { ok: true; policy: RoutineNoticePolicy; notice?: string }
  | {
      ok: false;
      code:
        | "forbidden"
        | "conflict"
        | "invalid-input"
        | "foreign-source"
        | "unaccepted-source"
        | "not-found";
      error: string;
    };

export const ROUTINE_NOTICE_APPROVAL_LIMIT = 60;
const KEYS = new Set<string>(ROUTINE_NOTICE_FORMATS.map((x) => x.key));
const NOTICE = "Permissions saved. Permissions alone do not activate routine editions.";
type ErrorCode = Exclude<RoutineNoticePolicyResult, { ok: true }>["code"];
class PolicyError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const DDL = [
  `create table if not exists routine_notice_policies(newsroom_id integer primary key references newsrooms(id) on delete cascade,paused boolean not null default false,revision integer not null default 0 check(revision>=0),updated_by text,updated_at timestamptz)`,
  `create table if not exists routine_notice_approvals(newsroom_id integer not null references routine_notice_policies(newsroom_id) on delete cascade,source_id integer not null references sources(id) on delete cascade,source_url text not null,format_key text not null check(format_key in ('library-notice','parks-recreation-notice','community-arts-event-logistics','registration-deadline','waste-recycling-schedule','public-meeting-logistics')),primary key(newsroom_id,source_id,format_key))`,
  `create table if not exists routine_notice_policy_changes(id serial primary key,newsroom_id integer not null references newsrooms(id) on delete cascade,revision integer not null,actor text not null,action text not null check(action in ('approved','revoked','paused','resumed','saved')),source_id integer,source_url_hash text,format_key text,changed_at timestamptz not null default now())`,
  `create index if not exists routine_notice_policy_changes_room_idx on routine_notice_policy_changes(newsroom_id,id desc)`,
];
export async function ensureRoutineNoticePolicySchema() {
  const sql = await getSql();
  await ensureSchemaOnce(sql, "routine-notice-policy-0052", DDL);
}

function clean(raw: unknown): SaveRoutineNoticePolicyInput {
  if (!raw || typeof raw !== "object")
    throw new PolicyError("invalid-input", "Routine notice settings were malformed.");
  const value = raw as Record<string, unknown>;
  if (
    typeof value.paused !== "boolean" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 0 ||
    !Array.isArray(value.approvals) ||
    value.approvals.length > ROUTINE_NOTICE_APPROVAL_LIMIT
  )
    throw new PolicyError("invalid-input", "Routine notice settings were malformed.");
  const seen = new Set<string>();
  const approvals = value.approvals.map((rawPair) => {
    if (!rawPair || typeof rawPair !== "object")
      throw new PolicyError("invalid-input", "Choose valid source and format pairs.");
    const pair = rawPair as Record<string, unknown>;
    if (
      !Number.isSafeInteger(pair.sourceId) ||
      Number(pair.sourceId) < 1 ||
      typeof pair.sourceUrl !== "string" ||
      !pair.sourceUrl.trim() ||
      pair.sourceUrl.length > 4000 ||
      typeof pair.formatKey !== "string" ||
      !KEYS.has(pair.formatKey)
    )
      throw new PolicyError("invalid-input", "Choose valid source and format pairs.");
    const key = `${pair.sourceId}:${pair.formatKey}`;
    if (seen.has(key))
      throw new PolicyError("invalid-input", "Each source and format pair may be selected once.");
    seen.add(key);
    return {
      sourceId: Number(pair.sourceId),
      sourceUrl: pair.sourceUrl,
      formatKey: pair.formatKey as RoutineNoticeFormatKey,
    };
  });
  return { expectedRevision: Number(value.expectedRevision), paused: value.paused, approvals };
}

async function assertCurrentOwner(sql: Sql, userId: string, newsroomId: number) {
  const [member] = await sql.query<{ role: string }>(
    "select role from newsroom_members where user_id=$1 and newsroom_id=$2 for update",
    [userId, newsroomId],
  );
  if (member?.role !== "owner")
    throw new PolicyError(
      "forbidden",
      "Only the current newsroom owner can manage routine notice permissions.",
    );
}

async function readPolicy(sql: Sql, newsroomId: number): Promise<RoutineNoticePolicy> {
  const [policy] = await sql.query<{
    paused: boolean;
    revision: number;
    updated_by: string | null;
    updated_at: string | null;
  }>(
    "select paused,revision,updated_by,updated_at from routine_notice_policies where newsroom_id=$1",
    [newsroomId],
  );
  const approvals = await sql.query<{
    source_id: number;
    source_url: string;
    format_key: RoutineNoticeFormatKey;
    title: string | null;
    current_url: string | null;
    status: string | null;
  }>(
    `select a.source_id,a.source_url,a.format_key,s.title,s.url current_url,s.status from routine_notice_approvals a left join sources s on s.id=a.source_id and s.newsroom_id=a.newsroom_id where a.newsroom_id=$1 order by a.source_id,a.format_key`,
    [newsroomId],
  );
  const changes = await sql.query<{
    revision: number;
    actor: string;
    changed_at: string;
    action: RoutineNoticeChange["action"];
    source_id: number | null;
    format_key: RoutineNoticeFormatKey | null;
    source_url: string | null;
  }>(
    `select c.revision,c.actor,c.changed_at,c.action,c.source_id,c.format_key,s.url source_url from routine_notice_policy_changes c left join sources s on s.id=c.source_id and s.newsroom_id=c.newsroom_id and md5(s.url)=c.source_url_hash where c.newsroom_id=$1 order by c.id desc limit 30`,
    [newsroomId],
  );
  return {
    paused: policy?.paused ?? false,
    revision: policy?.revision ?? 0,
    updatedAt: policy?.updated_at ? String(policy.updated_at) : null,
    updatedBy: policy?.updated_by ?? null,
    effectivePublicationAvailable: true,
    approvals: approvals.map((a) => {
      const state = !a.current_url
        ? "missing"
        : a.current_url !== a.source_url
          ? "changed"
          : a.status === "accepted"
            ? "accepted"
            : "unaccepted";
      return {
        sourceId: a.source_id,
        sourceTitle: a.title,
        sourceUrl: a.source_url,
        formatKey: a.format_key,
        sourceState: state,
        valid: state === "accepted",
      };
    }),
    recentChanges: changes.map((c) => ({
      revision: c.revision,
      actor: c.actor,
      changedAt: String(c.changed_at),
      action: c.action,
      sourceId: c.source_id,
      sourceUrl: c.source_url,
      formatKey: c.format_key,
    })),
  };
}

export async function readRoutineNoticePolicyFor(userId: string, newsroomId: number) {
  await ensureRoutineNoticePolicySchema();
  const sql = await getSql();
  const [member] = await sql.query<{ role: string }>(
    "select role from newsroom_members where user_id=$1 and newsroom_id=$2",
    [userId, newsroomId],
  );
  if (member?.role !== "owner")
    throw new PolicyError(
      "forbidden",
      "Only the current newsroom owner can view routine notice permissions.",
    );
  return readPolicy(sql, newsroomId);
}

export async function saveRoutineNoticePolicyFor(userId: string, newsroomId: number, raw: unknown) {
  const input = clean(raw);
  await ensureRoutineNoticePolicySchema();
  return withTransaction(async (sql) => {
    const [room] = await sql.query<{ id: number }>(
      "select id from newsrooms where id=$1 for update",
      [newsroomId],
    );
    if (!room) throw new PolicyError("not-found", "The newsroom no longer exists.");
    await assertCurrentOwner(sql, userId, newsroomId);
    const [current] = await sql.query<{ paused: boolean; revision: number }>(
      "select paused,revision from routine_notice_policies where newsroom_id=$1 for update",
      [newsroomId],
    );
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== input.expectedRevision)
      throw new PolicyError("conflict", "Routine notice settings changed. Reload before saving.");
    const prior = await sql.query<{ source_id: number; source_url: string; format_key: string }>(
      "select source_id,source_url,format_key from routine_notice_approvals where newsroom_id=$1 order by source_id,format_key for update",
      [newsroomId],
    );
    const priorKeys = new Map(prior.map((p) => [`${p.source_id}:${p.format_key}`, p]));
    const ids = [...new Set(input.approvals.map((a) => a.sourceId))].sort((a, b) => a - b);
    const sources = ids.length
      ? await sql.query<{ id: number; newsroom_id: number; url: string; status: string }>(
          "select id,newsroom_id,url,status from sources where id=any($1::int[]) order by id for update",
          [ids],
        )
      : [];
    const byId = new Map(sources.map((s) => [s.id, s]));
    for (const pair of input.approvals) {
      const old = priorKeys.get(`${pair.sourceId}:${pair.formatKey}`);
      if (old && old.source_url === pair.sourceUrl) continue;
      const source = byId.get(pair.sourceId);
      if (!source || source.newsroom_id !== newsroomId)
        throw new PolicyError(
          "foreign-source",
          "A source is missing or belongs to another newsroom.",
        );
      if (source.status !== "accepted")
        throw new PolicyError(
          "unaccepted-source",
          "Only accepted sources can receive a routine notice permission.",
        );
      if (source.url !== pair.sourceUrl)
        throw new PolicyError("conflict", "A source address changed. Reload before saving.");
    }
    const revision = currentRevision + 1;
    if (current)
      await sql.query(
        "update routine_notice_policies set paused=$2,revision=$3,updated_by=$4,updated_at=now() where newsroom_id=$1",
        [newsroomId, input.paused, revision, userId],
      );
    else
      await sql.query(
        "insert into routine_notice_policies(newsroom_id,paused,revision,updated_by,updated_at) values($1,$2,$3,$4,now())",
        [newsroomId, input.paused, revision, userId],
      );
    await sql.query("delete from routine_notice_approvals where newsroom_id=$1", [newsroomId]);
    for (const pair of input.approvals)
      await sql.query(
        "insert into routine_notice_approvals(newsroom_id,source_id,source_url,format_key) values($1,$2,$3,$4)",
        [newsroomId, pair.sourceId, pair.sourceUrl, pair.formatKey],
      );
    const desiredByKey = new Map(input.approvals.map((p) => [`${p.sourceId}:${p.formatKey}`, p]));
    const added = input.approvals.filter((p) => {
      const previous = priorKeys.get(`${p.sourceId}:${p.formatKey}`);
      return !previous || previous.source_url !== p.sourceUrl;
    });
    const removed = prior.filter((p) => {
      const desired = desiredByKey.get(`${p.source_id}:${p.format_key}`);
      return !desired || desired.sourceUrl !== p.source_url;
    });
    for (const pair of added)
      await sql.query(
        "insert into routine_notice_policy_changes(newsroom_id,revision,actor,action,source_id,source_url_hash,format_key) values($1,$2,$3,'approved',$4,md5($5),$6)",
        [newsroomId, revision, userId, pair.sourceId, pair.sourceUrl, pair.formatKey],
      );
    for (const pair of removed)
      await sql.query(
        "insert into routine_notice_policy_changes(newsroom_id,revision,actor,action,source_id,source_url_hash,format_key) values($1,$2,$3,'revoked',$4,md5($5),$6)",
        [newsroomId, revision, userId, pair.source_id, pair.source_url, pair.format_key],
      );
    const pauseAction: RoutineNoticeChange["action"] | null =
      input.paused && !current?.paused
        ? "paused"
        : !input.paused && current?.paused
          ? "resumed"
          : null;
    if (pauseAction || (!added.length && !removed.length))
      await sql.query(
        "insert into routine_notice_policy_changes(newsroom_id,revision,actor,action,source_id,format_key) values($1,$2,$3,$4,null,null)",
        [newsroomId, revision, userId, pauseAction ?? "saved"],
      );
    await sql.query(
      "insert into audit_events(user_id,action,detail,newsroom_id,subject_kind,subject_id) values($1,'routine-notice-policy',$2,$3,'routine-notice-policy',$3)",
      [
        userId,
        `revision ${revision}; ${pauseAction ?? "saved"}; ${added.length} added; ${removed.length} removed`,
        newsroomId,
      ],
    );
    return readPolicy(sql, newsroomId);
  });
}

function resultError(error: unknown): RoutineNoticePolicyResult {
  if (error instanceof PolicyError) return { ok: false, code: error.code, error: error.message };
  if (error instanceof ForbiddenError)
    return { ok: false, code: "forbidden", error: error.message };
  throw error;
}
export const getRoutineNoticePolicy = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<RoutineNoticePolicyResult> => {
    try {
      return {
        ok: true,
        policy: await readRoutineNoticePolicyFor(context.userId, context.newsroomId),
      };
    } catch (error) {
      return resultError(error);
    }
  });
export const saveRoutineNoticePolicy = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((input: SaveRoutineNoticePolicyInput) => input)
  .handler(async ({ context, data }): Promise<RoutineNoticePolicyResult> => {
    try {
      return {
        ok: true,
        policy: await saveRoutineNoticePolicyFor(context.userId, context.newsroomId, data),
        notice: NOTICE,
      };
    } catch (error) {
      return resultError(error);
    }
  });
