import { readFileSync } from "node:fs";
import type { Sql } from "../db.ts";
import { routineNoticeSourceLimit } from "./routine-notice-source-limit.ts";

export const EVENT_SOURCE_FORMAT_KEY = "community-arts-event-logistics";
export const EVENT_SOURCE_READERS = ["tribe", "squarespace", "libcal", "civicplus", "ics"] as const;

export type EventSourceReader = (typeof EVENT_SOURCE_READERS)[number];
export type EventSourceSeedEntry = {
  town: string;
  name: string;
  reader: EventSourceReader;
  url: string;
  feedId: string;
  batch: number;
  devCheckedAt: string;
  devResult: string;
};
export type SkippedEventSource = {
  town: string;
  name: string;
  url: string;
  reason: string;
  checkedAt: string;
};
export type EventSourceSeedFile = {
  sources: EventSourceSeedEntry[];
  skipped: SkippedEventSource[];
};
export type EventSourceSeedOptions = {
  newsroomId: number;
  batch?: number | "all";
  apply?: boolean;
};
export type EventSourceSeedPlan = {
  source: EventSourceSeedEntry;
  sourceId: number | null;
  addSource: boolean;
  addApproval: boolean;
  addLink: boolean;
};
export type EventSourceSeedResult = {
  newsroomId: number;
  batch: number | "all";
  applied: boolean;
  selected: number;
  revision: number;
  sourceLimit: number;
  linkedBefore: number;
  planned: EventSourceSeedPlan[];
  sourceRowsAdded: number;
  approvalsAdded: number;
  linksAdded: number;
};

export class EventSourceSeedError extends Error {
  readonly code: "invalid-options" | "no-owner" | "no-automation" | "no-policy" | "over-limit";

  constructor(code: EventSourceSeedError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/** The reviewed list checked from the newsroom PC. */
export function readEventSourceSeed(): EventSourceSeedFile {
  return JSON.parse(
    readFileSync(
      new URL("../../../data/event-sources/longmont-region.json", import.meta.url),
      "utf8",
    ),
  ) as EventSourceSeedFile;
}

/**
 * Add reviewed event feeds to one newsroom's routine edition.
 *
 * The caller owns the transaction. `apply: false` only reads and plans. A real
 * apply inserts every missing row and bumps the automation revision once.
 */
export async function seedEventSources(
  sql: Sql,
  options: EventSourceSeedOptions,
): Promise<EventSourceSeedResult> {
  const batch = options.batch ?? "all";
  if (
    !Number.isSafeInteger(options.newsroomId) ||
    options.newsroomId < 1 ||
    !(batch === "all" || (Number.isSafeInteger(batch) && batch >= 1))
  ) {
    throw new EventSourceSeedError(
      "invalid-options",
      "Choose a positive newsroom id and a positive batch number or all.",
    );
  }

  const all = readEventSourceSeed().sources;
  const selected = batch === "all" ? all : all.filter((source) => source.batch === batch);
  const limit = routineNoticeSourceLimit();

  const [owner] = await sql.query<{ user_id: string }>(
    "select user_id from newsroom_members where newsroom_id=$1 and role='owner' order by created_at limit 1 for update",
    [options.newsroomId],
  );
  if (!owner) {
    throw new EventSourceSeedError("no-owner", "The newsroom has no owner to own the new sources.");
  }

  const [automation] = await sql.query<{ revision: number }>(
    "select revision from routine_notice_automations where newsroom_id=$1 for update",
    [options.newsroomId],
  );
  if (!automation) {
    throw new EventSourceSeedError(
      "no-automation",
      "The newsroom has no routine notice automation. Nothing was changed.",
    );
  }

  const [policy] = await sql.query<{ newsroom_id: number }>(
    "select newsroom_id from routine_notice_policies where newsroom_id=$1 for update",
    [options.newsroomId],
  );
  if (!policy) {
    throw new EventSourceSeedError(
      "no-policy",
      "The newsroom has no routine notice policy row. Nothing was changed.",
    );
  }

  const sources = await sql.query<{ id: number; url: string }>(
    "select id,url from sources where newsroom_id=$1 order by id for update",
    [options.newsroomId],
  );
  const approvals = await sql.query<{ source_id: number }>(
    "select source_id from routine_notice_approvals where newsroom_id=$1 and format_key=$2 for update",
    [options.newsroomId, EVENT_SOURCE_FORMAT_KEY],
  );
  const links = await sql.query<{ source_id: number; source_url: string; format_key: string }>(
    "select source_id,source_url,format_key from routine_notice_automation_sources where newsroom_id=$1 for update",
    [options.newsroomId],
  );

  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  const approvedSourceIds = new Set(approvals.map((approval) => approval.source_id));
  const linkedUrls = new Set(
    links
      .filter((link) => link.format_key === EVENT_SOURCE_FORMAT_KEY)
      .map((link) => link.source_url),
  );

  const planned: EventSourceSeedPlan[] = selected.map((source) => {
    const existing = sourceByUrl.get(source.url);
    return {
      source,
      sourceId: existing?.id ?? null,
      addSource: !existing,
      addApproval: !existing || !approvedSourceIds.has(existing.id),
      addLink: !linkedUrls.has(source.url),
    };
  });

  const plannedLinks = planned.filter((item) => item.addLink).length;
  if (links.length + plannedLinks > limit) {
    throw new EventSourceSeedError(
      "over-limit",
      `The routine edition source limit is ${limit}. This batch would link ${links.length + plannedLinks} sources. Nothing was changed.`,
    );
  }

  const base = {
    newsroomId: options.newsroomId,
    batch,
    selected: selected.length,
    revision: automation.revision,
    sourceLimit: limit,
    linkedBefore: links.length,
    planned,
    sourceRowsAdded: 0,
    approvalsAdded: 0,
    linksAdded: 0,
  };

  if (!options.apply) return { ...base, applied: false };

  let sourceRowsAdded = 0;
  let approvalsAdded = 0;
  let linksAdded = 0;
  for (const item of planned) {
    let sourceId = item.sourceId;
    if (sourceId === null) {
      const [created] = await sql.query<{ id: number }>(
        `insert into sources(newsroom_id,user_id,url,title,kind,tier,status,interval_minutes)
         values($1,$2,$3,$4,'community','A','accepted',1440) returning id`,
        [options.newsroomId, owner.user_id, item.source.url, item.source.name],
      );
      sourceId = created!.id;
      sourceRowsAdded += 1;
    }

    if (item.addApproval) {
      await sql.query(
        `insert into routine_notice_approvals(newsroom_id,source_id,format_key,source_url)
         values($1,$2,$3,$4)`,
        [options.newsroomId, sourceId, EVENT_SOURCE_FORMAT_KEY, item.source.url],
      );
      approvalsAdded += 1;
    }

    if (item.addLink) {
      await sql.query(
        `insert into routine_notice_automation_sources(newsroom_id,source_id,format_key,source_url,public_source_url,issuer,locality)
         values($1,$2,$3,$4,$4,$5,$6)`,
        [
          options.newsroomId,
          sourceId,
          EVENT_SOURCE_FORMAT_KEY,
          item.source.url,
          item.source.name,
          `${item.source.town}, Colorado`,
        ],
      );
      linksAdded += 1;
    }
  }

  const changed = sourceRowsAdded + approvalsAdded + linksAdded > 0;
  let revision = automation.revision;
  if (changed) {
    const [updated] = await sql.query<{ revision: number }>(
      "update routine_notice_automations set revision=revision+1,updated_at=now() where newsroom_id=$1 returning revision",
      [options.newsroomId],
    );
    revision = updated!.revision;
    await sql.query(
      "insert into routine_notice_automation_changes(newsroom_id,revision,actor,action,detail) values($1,$2,$3,'saved',$4)",
      [options.newsroomId, revision, owner.user_id, `added ${selected.length} event sources`],
    );
    await sql.query(
      "insert into audit_events(user_id,action,detail,newsroom_id,subject_kind,subject_id) values($1,'routine-notice-automation',$2,$3,'routine-notice-automation',$3)",
      [owner.user_id, `saved; revision ${revision}`, options.newsroomId],
    );
  }

  return {
    ...base,
    applied: true,
    revision,
    sourceRowsAdded,
    approvalsAdded,
    linksAdded,
  };
}
