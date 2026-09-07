import { createHash, randomUUID } from "node:crypto";
import { getSql, withTransaction, type Sql } from "../db.ts";
import { siteUrl } from "../paper.ts";
import { ForbiddenError } from "./membership.ts";
import { ensureLegalSchema, lockRemovalRoom } from "./legal-removal-schema.ts";
import { removalExpiry } from "./legal-removal-time.ts";
import type { LegalSelection, LegalPreview, LegalRemovalInput } from "./legal-removal-types.ts";

type Row = Record<string, unknown>;
type Copies = Record<string, Row[]>;
const _tables = [
  "articles",
  "corrections",
  "leads",
  "drafts",
  "editorial_extras",
  "editorial_requests",
  "follow_ups",
  "beat_memory",
  "deleted_items",
  "desk_jobs",
  "audit_events",
] as const;

async function ownerRoom(userId: string, sql: Sql): Promise<number> {
  const [member] = await sql<{
    role: string;
    newsroom_id: number;
  }>`select role,newsroom_id from newsroom_members where user_id=${userId} for share`;
  if (member?.role !== "owner")
    throw new ForbiddenError("Only the owner can manage legal removals.");
  return member.newsroom_id;
}
function ids(values: unknown): number[] {
  if (
    !Array.isArray(values) ||
    values.length > 200 ||
    values.some((x) => !Number.isSafeInteger(x) || x < 1)
  )
    throw new Error("Choose valid record IDs (at most 200 per list).");
  return [...new Set(values as number[])].sort((a, b) => a - b);
}
function selection(input: LegalSelection): LegalSelection {
  return {
    articleIds: ids(input.articleIds),
    draftIds: ids(input.draftIds ?? []),
    memoryIds: ids(input.memoryIds ?? []),
    auditIds: ids(input.auditIds ?? []),
    trashIds: ids(input.trashIds ?? []),
    reviewedLegacy: input.reviewedLegacy === true,
    reviewedEvidence: input.reviewedEvidence === true,
  };
}
function rowId(row: Row): number {
  return Number(row.id ?? row.draft_id);
}
async function readRows(
  sql: Sql,
  table: (typeof _tables)[number],
  room: number,
  condition = "true",
  params: unknown[] = [],
): Promise<Row[]> {
  const rows = await sql.query<{ row: Row }>(
    `select to_jsonb(t) as row from ${table} t where newsroom_id=$1 and (${condition}) order by ${table === "editorial_extras" ? "draft_id" : "id"}`,
    [room, ...params],
  );
  return rows.map((r) => r.row);
}
function byIds(
  sql: Sql,
  table: (typeof _tables)[number],
  room: number,
  list: number[],
  key = "id",
) {
  return readRows(sql, table, room, `${key}=any($2::int[])`, [list]);
}
function hasId(value: unknown, list: number[]) {
  return typeof value === "number" && list.includes(value);
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function quoteIdentifier(name: string) {
  return '"' + name.replaceAll('"', '""') + '"';
}
async function foreignReferences(sql: Sql, room: number, copies: Copies): Promise<string[]> {
  // Discover real incoming FK edges, including legacy inconsistent room links.
  // No child content or foreign IDs are exposed to this owner.
  const edges = await sql<{
    parent: string;
    schema: string;
    child: string;
    column: string;
    parent_column: string;
    parts: number;
  }>`
    select p.relname as parent,n.nspname as schema,c.relname as child,a.attname as column,pa.attname as parent_column,
      cardinality(k.conkey) as parts from pg_constraint k join pg_class p on p.oid=k.confrelid
      join pg_namespace pn on pn.oid=p.relnamespace join pg_class c on c.oid=k.conrelid
      join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=k.conkey[1]
      join pg_attribute pa on pa.attrelid=p.oid and pa.attnum=k.confkey[1]
      where k.contype='f' and pn.nspname='public' and p.relname=any(${Object.keys(copies)}::text[])`;
  const blockers: string[] = [];
  for (const edge of edges) {
    const targets = copies[edge.parent]?.map(rowId) ?? [];
    if (!targets.length) continue;
    if (edge.parts !== 1 || edge.parent_column !== "id") {
      blockers.push(
        "An unsupported shared foreign-key relationship requires operator review before removal.",
      );
      continue;
    }
    const [hit] = await sql.query<{ count: number }>(
      `select count(*)::int as count from ${quoteIdentifier(edge.schema)}.${quoteIdentifier(edge.child)} child where child.${quoteIdentifier(edge.column)}=any($1::int[]) and (to_jsonb(child)->>'newsroom_id') is distinct from $2::text`,
      [targets, String(room)],
    );
    if (hit.count)
      blockers.push(
        "A linked record belongs to another newsroom or has no newsroom identity. No removal can proceed until a local operator resolves that relationship.",
      );
  }
  return [...new Set(blockers)];
}
async function impact(sql: Sql, room: number, input: LegalSelection, lockParents = false) {
  const selected = selection(input);
  if (!selected.articleIds.length) throw new Error("Choose at least one published article.");
  const copies: Copies = {};
  if (lockParents)
    await sql`select id from articles where newsroom_id=${room} and id=any(${selected.articleIds}::int[]) order by id for update`;
  copies.articles = await byIds(sql, "articles", room, selected.articleIds);
  if (copies.articles.length !== selected.articleIds.length)
    throw new Error("An article is missing or belongs to another newsroom. Reload the preview.");
  const leadIds = [...new Set(copies.articles.map((a) => Number(a.lead_id)).filter(Boolean))];
  const siblings = await readRows(sql, "articles", room, "lead_id=any($2::int[])", [leadIds]);
  const blockers: string[] = [];
  if (siblings.some((a) => !selected.articleIds.includes(rowId(a))))
    blockers.push(
      "Select every article sharing these leads before removing their connected reporting records.",
    );
  if (lockParents)
    await sql`select id from leads where newsroom_id=${room} and id=any(${leadIds}::int[]) order by id for update`;
  copies.leads = await byIds(sql, "leads", room, leadIds);
  const originIds = copies.articles.map((a) => Number(a.origin_draft_id)).filter(Boolean);
  copies.drafts = await readRows(
    sql,
    "drafts",
    room,
    "lead_id=any($2::int[]) or id=any($3::int[])",
    [leadIds, [...originIds, ...selected.draftIds]],
  );
  if (selected.draftIds.some((id) => !copies.drafts.some((d) => rowId(d) === id)))
    throw new Error("A selected draft is missing or belongs to another newsroom.");
  const draftIds = copies.drafts.map(rowId);
  if (lockParents)
    await sql`select id from drafts where newsroom_id=${room} and id=any(${draftIds}::int[]) order by id for update`;
  copies.corrections = await readRows(sql, "corrections", room, "article_id=any($2::int[])", [
    selected.articleIds,
  ]);
  copies.editorial_extras = await byIds(sql, "editorial_extras", room, draftIds, "draft_id");
  copies.editorial_requests = await readRows(
    sql,
    "editorial_requests",
    room,
    "draft_id=any($2::int[])",
    [draftIds],
  );
  let requestIds = copies.editorial_requests.map(rowId);
  const snapshotTargets: { table: string; id: number }[] = [];
  const historicalRequestIds: number[] = [];
  copies.follow_ups = await readRows(
    sql,
    "follow_ups",
    room,
    "article_id=any($2::int[]) or lead_id=any($3::int[])",
    [selected.articleIds, leadIds],
  );
  copies.beat_memory = await readRows(
    sql,
    "beat_memory",
    room,
    "article_id=any($2::int[]) or id=any($3::int[])",
    [selected.articleIds, selected.memoryIds],
  );
  copies.audit_events = await readRows(
    sql,
    "audit_events",
    room,
    "id=any($2::int[]) or (subject_kind='articles' and subject_id=any($3::int[])) or (subject_kind='leads' and subject_id=any($4::int[])) or (subject_kind='drafts' and subject_id=any($5::int[]))",
    [selected.auditIds, selected.articleIds, leadIds, draftIds],
  );
  for (const [table, list] of [
    ["beat_memory", selected.memoryIds],
    ["audit_events", selected.auditIds],
  ] as const) {
    if (list.some((id) => !copies[table].some((r) => rowId(r) === id)))
      throw new Error("A selected historical record is missing or belongs to another newsroom.");
  }
  copies.desk_jobs = await readRows(
    sql,
    "desk_jobs",
    room,
    "(kind='draft' and subject_id=any($2::int[])) or (kind='editorial' and subject_id=any($3::int[]))",
    [leadIds, requestIds],
  );
  const trash = await readRows(sql, "deleted_items", room);
  copies.deleted_items = [];
  const candidates: LegalPreview["candidates"] = [];
  for (const t of trash) {
    let snapshot: {
      row?: Row;
      drafts?: Row[];
      corrections?: Row[];
      extras?: Row;
      requestIds?: number[];
    };
    try {
      snapshot = JSON.parse(String(t.payload));
    } catch {
      snapshot = {};
    }
    const linked =
      (t.kind === "article" && selected.articleIds.includes(Number(t.ref_id))) ||
      (t.kind === "lead" && leadIds.includes(Number(t.ref_id))) ||
      (t.kind === "draft" && draftIds.includes(Number(t.ref_id))) ||
      hasId(snapshot.row?.lead_id, leadIds) ||
      (snapshot.drafts ?? []).some((d) => draftIds.includes(rowId(d)));
    const mixed =
      linked &&
      ((snapshot.drafts ?? []).some(
        (d) => !draftIds.includes(rowId(d)) && !hasId(d.lead_id, leadIds),
      ) ||
        (snapshot.corrections ?? []).some((c) => !hasId(c.article_id, selected.articleIds)));
    if (mixed && !selected.trashIds.includes(rowId(t))) {
      blockers.push(
        `Review mixed trash snapshot #${rowId(t)} and explicitly select the entire snapshot only if all of it is in scope.`,
      );
      candidates.push({
        kind: "trashIds",
        id: rowId(t),
        label: `MIXED: ${String(t.label)} (whole snapshot)`,
      });
    } else if (linked || selected.trashIds.includes(rowId(t))) {
      copies.deleted_items.push(t);
      const rootTable =
        t.kind === "article"
          ? "articles"
          : t.kind === "lead"
            ? "leads"
            : t.kind === "draft"
              ? "drafts"
              : null;
      if (rootTable) snapshotTargets.push({ table: rootTable, id: Number(t.ref_id) });
      for (const d of snapshot.drafts ?? [])
        snapshotTargets.push({ table: "drafts", id: rowId(d) });
      for (const c of snapshot.corrections ?? [])
        snapshotTargets.push({ table: "corrections", id: rowId(c) });
      if (snapshot.extras)
        snapshotTargets.push({ table: "editorial_extras", id: rowId(snapshot.extras) });
      for (const id of snapshot.requestIds ?? [])
        if (Number.isSafeInteger(id) && id > 0) historicalRequestIds.push(id);
    } else candidates.push({ kind: "trashIds", id: rowId(t), label: String(t.label) });
  }
  if (selected.trashIds.some((id) => !copies.deleted_items.some((t) => rowId(t) === id)))
    throw new Error("A selected trash record is missing or belongs to another newsroom.");
  const detachedRequests = await byIds(sql, "editorial_requests", room, historicalRequestIds);
  for (const request of detachedRequests) {
    if (request.draft_id && !draftIds.includes(Number(request.draft_id)))
      blockers.push(
        `Historical request #${rowId(request)} now belongs to another draft. Resolve that shared reference before removal.`,
      );
    else if (!requestIds.includes(rowId(request))) copies.editorial_requests.push(request);
  }
  requestIds = copies.editorial_requests.map(rowId);
  copies.desk_jobs = await readRows(
    sql,
    "desk_jobs",
    room,
    "(kind='draft' and subject_id=any($2::int[])) or (kind='editorial' and subject_id=any($3::int[]))",
    [leadIds, requestIds],
  );
  const allDrafts = await readRows(sql, "drafts", room);
  for (const d of allDrafts.filter((d) => !draftIds.includes(rowId(d))))
    candidates.push({ kind: "draftIds", id: rowId(d), label: String(d.headline) });
  const memory = await readRows(sql, "beat_memory", room, "article_id is null");
  for (const m of memory.filter((m) => !selected.memoryIds.includes(rowId(m))))
    candidates.push({ kind: "memoryIds", id: rowId(m), label: `${m.entity}: ${m.last_angle}` });
  const audit = await readRows(sql, "audit_events", room, "subject_id is null");
  for (const a of audit.filter((a) => !selected.auditIds.includes(rowId(a))))
    candidates.push({ kind: "auditIds", id: rowId(a), label: `${a.action}: ${a.detail}` });
  const sharedInvestigationIds = [
    ...new Set(copies.leads.map((l) => Number(l.investigation_id)).filter(Boolean)),
  ];
  // Other editorials can quote this story's headline/dek via a structured URL.
  const slugs = new Set(copies.articles.map((a) => String(a.slug)));
  const urls = [
    ...new Set([...slugs].flatMap((slug) => [siteUrl(`/articles/${slug}`), `/articles/${slug}`])),
  ];
  const descriptorScrubs: Row[] = [];
  for (const req of await readRows(sql, "editorial_requests", room)) {
    if (requestIds.includes(rowId(req))) continue;
    try {
      const descriptor = JSON.parse(String(req.our_story_json ?? "null")) as {
        url?: string;
      } | null;
      const [identity] =
        typeof descriptor?.url === "string"
          ? await sql<{
              url: string | null;
            }>`select legal_article_url_identity(${descriptor.url}) as url`
          : [{ url: null }];
      if (
        (req.source_kind === "article" && slugs.has(String(req.source_ref))) ||
        (identity.url && urls.includes(identity.url))
      )
        descriptorScrubs.push(req);
    } catch {
      if (req.source_kind === "article" && slugs.has(String(req.source_ref)))
        descriptorScrubs.push(req);
    }
  }
  // Exact own-paper addresses only. Captured investigative evidence is independently
  // shared and is not silently deleted with an article. IDs expose the outstanding scope.
  const capturedCopies: LegalPreview["capturedCopies"] = [];
  const captureFingerprints: Row[] = [];
  for (const [table, condition] of [
    ["artifacts", "legal_article_url_identity(t.url)=any($2::text[])"],
    ["sources", "legal_article_url_identity(t.url)=any($2::text[])"],
    ["source_monitors", "legal_article_url_identity(t.url)=any($2::text[])"],
    ["recurring_baselines", "legal_article_url_identity(t.typical_url)=any($2::text[])"],
    [
      "manual_watch_checks",
      "t.monitor_id in (select id from source_monitors where newsroom_id=$1 and legal_article_url_identity(url)=any($2::text[])) or t.capture_event_id in (select id from capture_events where newsroom_id=$1 and legal_article_url_identity(source_url)=any($2::text[])) or t.previous_version_id in (select id from artifact_versions where newsroom_id=$1 and legal_article_url_identity(url)=any($2::text[]))",
    ],
    ["artifact_versions", "legal_article_url_identity(t.url)=any($2::text[])"],
    [
      "artifact_chunks",
      "t.version_id in (select id from artifact_versions where newsroom_id=$1 and legal_article_url_identity(url)=any($2::text[]))",
    ],
    [
      "artifact_blobs",
      "legal_article_url_identity(t.original_url)=any($2::text[]) or t.version_id in (select id from artifact_versions where newsroom_id=$1 and legal_article_url_identity(url)=any($2::text[]))",
    ],
    [
      "capture_events",
      "legal_article_url_identity(t.source_url)=any($2::text[]) or t.version_id in (select id from artifact_versions where newsroom_id=$1 and legal_article_url_identity(url)=any($2::text[]))",
    ],
    [
      "snapshots",
      "legal_article_url_identity(t.url)=any($2::text[]) or t.source_id in (select id from sources where newsroom_id=$1 and legal_article_url_identity(url)=any($2::text[]))",
    ],
    [
      "search_log",
      "exists(select 1 from legal_search_article_urls(to_jsonb(t)) hit where hit=any($2::text[]))",
    ],
    [
      "frontier_items",
      "legal_article_url_identity(t.label)=any($2::text[]) or legal_article_url_identity(t.evidence)=any($2::text[]) or t.id in (select l.frontier_id from search_log l where l.newsroom_id=$1 and exists(select 1 from legal_search_article_urls(to_jsonb(l)) hit where hit=any($2::text[])))",
    ],
  ] as const) {
    const rows = await sql.query<{ id: number; digest: string }>(
      `select t.id,md5(to_jsonb(t)::text) as digest from ${table} t where t.newsroom_id=$1 and (${condition}) order by t.id`,
      [room, urls],
    );
    for (const row of rows) {
      capturedCopies.push({ table, id: row.id });
      captureFingerprints.push({ table, ...row });
    }
  }
  blockers.push(...(await foreignReferences(sql, room, copies)));
  const reviewPending =
    capturedCopies.length > 0 ||
    !selected.reviewedLegacy ||
    (sharedInvestigationIds.length > 0 && !selected.reviewedEvidence);
  const counts = Object.fromEntries(
    Object.entries(copies).map(([table, rows]) => [table, rows.length]),
  );
  counts.descriptor_scrubs = descriptorScrubs.length;
  counts.unresolved_captured_copies = capturedCopies.length;
  const selectedHistorical: LegalPreview["candidates"] = [];
  for (const [kind, table, label] of [
    ["draftIds", "drafts", "headline"],
    ["memoryIds", "beat_memory", "entity"],
    ["auditIds", "audit_events", "action"],
    ["trashIds", "deleted_items", "label"],
  ] as const)
    for (const row of copies[table])
      if (selected[kind].includes(rowId(row)))
        selectedHistorical.push({
          kind,
          id: rowId(row),
          label: String(row[label] ?? "Selected historical record"),
        });
  const preview: LegalPreview = {
    selection: selected,
    fingerprint: digest({ copies, descriptorScrubs, selected, candidates, captureFingerprints }),
    articles: copies.articles.map((a) => ({ id: rowId(a), headline: String(a.headline) })),
    counts,
    candidates,
    selectedHistorical,
    capturedCopies,
    sharedInvestigationIds,
    blockers,
    reviewPending,
  };
  return { copies, descriptorScrubs, preview, urls, snapshotTargets };
}

export async function previewLegalRemoval(
  userId: string,
  input: LegalSelection,
): Promise<LegalPreview> {
  const sql = await getSql();
  const room = await ownerRoom(userId, sql);
  await ensureLegalSchema();
  return (await impact(sql, room, input)).preview;
}

export async function removeLegally(
  userId: string,
  input: LegalRemovalInput,
): Promise<{ caseId: string }> {
  const sql = await getSql();
  const room = await ownerRoom(userId, sql);
  await ensureLegalSchema();
  if (!["retain", "destroy"].includes(input.policy)) throw new Error("Choose a retention policy.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(input.caseRef))
    throw new Error(
      "Use an opaque case reference (letters, numbers and separators), without story text.",
    );
  return withTransaction(async (tx) => {
    if ((await ownerRoom(userId, tx)) !== room) throw new ForbiddenError();
    await lockRemovalRoom(tx, room);
    const chosen = selection(input.selection);
    const prior = await tx<{
      case_id: string;
    }>`select distinct case_id from legal_removal_targets where newsroom_id=${room} and table_name='articles' and row_id=any(${chosen.articleIds}::int[])`;
    if (prior.length) {
      if (prior.length !== 1) throw new Error("These articles belong to different removal cases.");
      const known = await tx<{
        row_id: number;
      }>`select row_id from legal_removal_targets where case_id=${prior[0].case_id} and table_name='articles'`;
      if (digest(known.map((r) => r.row_id).sort((a, b) => a - b)) !== digest(chosen.articleIds))
        throw new Error("The removal selection conflicts with an existing case.");
      const [intent] = await tx<{
        policy: string;
        case_ref: string;
      }>`select policy,case_ref from legal_removals where id=${prior[0].case_id} and newsroom_id=${room}`;
      if (intent?.policy !== input.policy || intent.case_ref !== input.caseRef)
        throw new Error(
          "The removal intent conflicts with the existing case. Open that case to review its policy.",
        );
      return { caseId: prior[0].case_id };
    }
    const { copies, descriptorScrubs, preview, urls, snapshotTargets } = await impact(
      tx,
      room,
      chosen,
      true,
    );
    if (preview.fingerprint !== input.fingerprint)
      throw new Error("The records changed. Review a fresh preview before confirming.");
    if (preview.blockers.length) throw new Error(preview.blockers.join(" "));
    if (input.policy === "destroy" && preview.capturedCopies.length)
      throw new Error(
        "Known captured copies remain in investigative storage. A local operator must resolve that exact scope before court destruction can proceed.",
      );
    if (input.policy === "destroy" && preview.reviewPending)
      throw new Error(
        "Court destruction requires resolving the historical and shared-evidence review first.",
      );
    // Disable only automatic work aimed at the removed story, preserving its
    // independent evidence and explaining why it needs operator review.
    await tx`update source_monitors set enabled=false,watch_state='paused',watch_lease=null,watch_check_started_at=null,
      watch_last_error='This article was legally removed. Captured evidence needs review; automatic checks are paused.'
      where newsroom_id=${room} and legal_article_url_identity(url)=any(${urls}::text[])`;
    await tx`update sources set status='dropped',last_error='This article was legally removed. Source excluded from scans pending review.'
      where newsroom_id=${room} and legal_article_url_identity(url)=any(${urls}::text[])`;
    const caseId = randomUUID();
    const expiry = input.policy === "retain" ? removalExpiry(new Date()).toISOString() : null;
    await tx`insert into legal_removals(id,newsroom_id,requested_by,case_ref,policy,expires_at,purged_at,review_pending,counts_json)
      values(${caseId},${room},${userId},${input.caseRef},${input.policy},${expiry},${input.policy === "destroy" ? new Date().toISOString() : null},${preview.reviewPending},${JSON.stringify(preview.counts)})`;
    if (input.policy === "retain")
      await tx`insert into legal_removal_copies(case_id,payload) values(${caseId},${JSON.stringify({ copies, descriptorScrubs: descriptorScrubs.map((r) => ({ id: r.id, our_story_json: r.our_story_json, source_ref: r.source_ref })) })})`;
    for (const [table, rows] of Object.entries(copies))
      for (const row of rows) {
        await tx`insert into legal_removal_targets(newsroom_id,table_name,row_id,case_id) values(${room},${table},${rowId(row)},${caseId})`;
      }
    for (const target of snapshotTargets)
      if (Number.isSafeInteger(target.id) && target.id > 0) {
        await tx`insert into legal_removal_targets(newsroom_id,table_name,row_id,case_id) values(${room},${target.table},${target.id},${caseId}) on conflict do nothing`;
      }
    for (const article of copies.articles)
      await tx`insert into legal_removal_slugs(newsroom_id,slug_hash,case_id) values(${room},md5(${String(article.slug)}),${caseId})`;
    for (const url of urls)
      await tx`insert into legal_removal_urls(newsroom_id,url_hash,case_id) values(${room},md5(legal_article_url_identity(${url})),${caseId})`;
    for (const req of descriptorScrubs) {
      const copiedHeadline = (() => {
        try {
          return JSON.parse(String(req.our_story_json))?.headline;
        } catch {
          return null;
        }
      })();
      await tx`update editorial_requests set our_story_json=null,source_ref='',source_kind='legal-removed',
        subject=case when subject=${copiedHeadline} then 'Source removed; review before writing' else subject end,
        error='A source was legally removed. Review the existing draft and start a new request with reviewed sources.',finished_at=now()
        where id=${rowId(req)} and newsroom_id=${room}`;
      await tx`update editorial_extras set source_ref='',source_kind='legal-removed'
        where newsroom_id=${room} and draft_id=${Number(req.draft_id) || null} and source_kind='article' and source_ref=${String(req.source_ref)}`;
      await tx`update desk_jobs set status=case when status in ('queued','running') then 'failed' else status end,stage='Source removed; review required',result_json='{}',
        error='A source was legally removed. Start a new request after reviewing sources.',claim_token=null,finished_at=now()
        where newsroom_id=${room} and kind='editorial' and subject_id=${rowId(req)}`;
    }
    // Explicit children before SET NULL / CASCADE parents. No ordinary trash is created.
    for (const table of [
      "audit_events",
      "deleted_items",
      "desk_jobs",
      "follow_ups",
      "beat_memory",
      "corrections",
      "editorial_extras",
      "editorial_requests",
      "drafts",
      "articles",
      "leads",
    ] as const) {
      await tx.query(
        `delete from ${table} where newsroom_id=$1 and ${table === "editorial_extras" ? "draft_id" : "id"}=any($2::int[])`,
        [room, copies[table].map(rowId)],
      );
    }
    await tx`insert into legal_removal_events(case_id,actor,action) values(${caseId},${userId},'application-removed')`;
    return { caseId };
  });
}

export async function expireLegalCopies(sql: Sql): Promise<number> {
  const expired = await sql<{
    id: string;
  }>`delete from legal_removal_copies c using legal_removals r
    where c.case_id=r.id and r.expires_at<=now() returning c.case_id as id`;
  if (expired.length) {
    await sql`update legal_removals set purged_at=now() where id=any(${expired.map((r) => r.id)}::text[])`;
    for (const row of expired)
      await sql`insert into legal_removal_events(case_id,actor,action) values(${row.id},'system','retention-expired')`;
  }
  return expired.length;
}

export async function listLegalCases(userId: string) {
  const sql = await getSql();
  const room = await ownerRoom(userId, sql);
  await ensureLegalSchema();
  await withTransaction((tx) => expireLegalCopies(tx));
  return sql<{
    id: string;
    case_ref: string;
    policy: string;
    created_at: string;
    expires_at: string | null;
    purged_at: string | null;
    review_pending: boolean;
  }>`
    select id,case_ref,policy,created_at::text as created_at,expires_at::text as expires_at,purged_at::text as purged_at,review_pending from legal_removals where newsroom_id=${room} order by created_at desc`;
}
export async function getLegalCase(userId: string, caseId: string) {
  const sql = await getSql();
  const room = await ownerRoom(userId, sql);
  await ensureLegalSchema();
  await withTransaction((tx) => expireLegalCopies(tx));
  const [record] = await sql<{
    id: string;
    case_ref: string;
    policy: string;
    created_at: string;
    expires_at: string | null;
    purged_at: string | null;
    review_pending: boolean;
    counts_json: string;
  }>`
    select id,case_ref,policy,created_at::text as created_at,expires_at::text as expires_at,purged_at::text as purged_at,review_pending,counts_json from legal_removals where id=${caseId} and newsroom_id=${room}`;
  if (!record) throw new ForbiddenError("Removal case not found.");
  const events = await sql<{
    action: string;
    created_at: string;
  }>`select action,created_at::text as created_at from legal_removal_events where case_id=${caseId} order by id`;
  const backups = await sql<{
    id: number;
    identifier: string;
    confirmed_at: string | null;
  }>`select id,identifier,confirmed_at::text as confirmed_at from legal_removal_backups where case_id=${caseId} order by id`;
  return {
    ...record,
    counts: JSON.parse(record.counts_json) as Record<string, number>,
    events,
    backups,
    externalStatus:
      backups.length > 0 && backups.every((b) => b.confirmed_at) ? "operator-attested" : "pending",
  };
}
export async function readLegalCopy(userId: string, caseId: string): Promise<string> {
  const sql = await getSql();
  const room = await ownerRoom(userId, sql);
  await ensureLegalSchema();
  return withTransaction(async (tx) => {
    if ((await ownerRoom(userId, tx)) !== room) throw new ForbiddenError();
    const [record] = await tx<{
      policy: string;
      current: boolean;
    }>`select policy,(expires_at>now()) as current from legal_removals where id=${caseId} and newsroom_id=${room} for update`;
    if (!record) throw new ForbiddenError("Removal case not found.");
    if (record.policy !== "retain" || !record.current)
      throw new Error("No retained text is available: destroyed or past its retention deadline.");
    const [copy] = await tx<{
      payload: string;
    }>`select payload from legal_removal_copies where case_id=${caseId}`;
    if (!copy) throw new Error("The retained copy is no longer available.");
    await tx`insert into legal_removal_events(case_id,actor,action) values(${caseId},${userId},'retained-copy-viewed')`;
    return copy.payload;
  });
}
export async function recordBackupAction(
  userId: string,
  caseId: string,
  input: { identifier?: string; confirmId?: number },
) {
  const sql = await getSql();
  const room = await ownerRoom(userId, sql);
  await ensureLegalSchema();
  return withTransaction(async (tx) => {
    if ((await ownerRoom(userId, tx)) !== room) throw new ForbiddenError();
    const [record] =
      await tx`select id from legal_removals where id=${caseId} and newsroom_id=${room} for update`;
    if (!record) throw new ForbiddenError("Removal case not found.");
    if (input.confirmId !== undefined) {
      const confirmed =
        await tx`update legal_removal_backups set confirmed_by=${userId},confirmed_at=now() where id=${input.confirmId} and case_id=${caseId} returning id`;
      if (!confirmed.length) throw new Error("Backup action not found in this case.");
      await tx`insert into legal_removal_events(case_id,actor,action) values(${caseId},${userId},'backup-cleanup-attested')`;
    } else {
      const identifier = (input.identifier ?? "").trim();
      if (!identifier || identifier.length > 200)
        throw new Error(
          "Enter a backup location or identifier, at most 200 characters; do not copy story text.",
        );
      await tx`insert into legal_removal_backups(case_id,identifier) values(${caseId},${identifier})`;
      await tx`insert into legal_removal_events(case_id,actor,action) values(${caseId},${userId},'backup-action-added')`;
    }
    return { ok: true as const };
  });
}
