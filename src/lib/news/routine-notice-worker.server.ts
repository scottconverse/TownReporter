import { getSql, withTransaction } from "../db.ts";
import { ROUTINE_EDITION_UPDATE_PREFIX } from "./correction-origin.ts";
import {
  countedStep,
  ensureJobsSchema,
  progressReporterFor,
  spanPct,
  throwIfJobCancelled,
  waitForModel,
  type DeskJob,
} from "./jobs.ts";
import { ensureRoutineNoticeAutomationSchema } from "./routine-notice-automation.ts";
import {
  assertRoutineNoticeCheckStillBound,
  checkRoutineNoticeSourceForOwner,
} from "./routine-notice-checks.server.ts";
import {
  eligibleRoutineNotices,
  planRoutineEditions,
  type EligibleRoutineNotice,
} from "./routine-notice-editions.ts";
import type { RoutineNoticeCheckGroup } from "./routine-notice-checks.ts";
import type { StructurallyValidRoutineNotice } from "./routine-notice-types.ts";
import { sha256 } from "./fetch-url.ts";

type RoutineNoticeOutcomeStatus = "deferred" | "in-review" | "published";

function routineNoticeOutcomeKey(item: EligibleRoutineNotice) {
  return `${item.channel}:${item.notice.provenance.externalId ?? item.notice.fingerprintMaterial}`;
}

function routineNoticeOutcome(item: EligibleRoutineNotice, status: RoutineNoticeOutcomeStatus) {
  const binding = item.notice.provenance;
  return {
    status,
    channel: item.channel,
    line: item.line,
    occurrenceDate: item.occurrenceDate,
    source: {
      sourceId: binding.sourceId,
      publicSourceUrl: item.sourceUrl,
      formatKey: item.notice.formatKey,
    },
    binding: {
      newsroomId: binding.newsroomId,
      policyRevision: binding.policyRevision,
      captureEventId: binding.captureEventId,
      artifactVersionId: binding.artifactVersionId,
      contentHash: binding.contentHash,
      externalId: binding.externalId,
    },
  };
}

function localStamp(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
  };
}
export async function tickRoutineNoticeEditions(now = new Date()): Promise<{ queued: number }> {
  await ensureJobsSchema();
  await ensureRoutineNoticeAutomationSchema();
  const sql = await getSql();
  const configs = await sql.query<{
    newsroom_id: number;
    revision: number;
    timezone: string;
    local_time: string;
    activated_by: string;
  }>(
    "select newsroom_id,revision,timezone,local_time,activated_by from routine_notice_automations where enabled=true order by newsroom_id",
  );
  let queued = 0;
  for (const config of configs) {
    let stamp;
    try {
      stamp = localStamp(now, config.timezone);
    } catch {
      continue;
    }
    if (stamp.time < config.local_time) continue;
    const made = await withTransaction(async (tx) => {
      const [locked] = await tx.query<{ revision: number; enabled: boolean }>(
        "select revision,enabled from routine_notice_automations where newsroom_id=$1 for update",
        [config.newsroom_id],
      );
      if (!locked?.enabled || locked.revision !== config.revision) return false;
      const [member] = await tx.query<{ role: string }>(
        "select role from newsroom_members where newsroom_id=$1 and user_id=$2 for update",
        [config.newsroom_id, config.activated_by],
      );
      const [policy] = await tx.query<{ revision: number; paused: boolean }>(
        "select revision,paused from routine_notice_policies where newsroom_id=$1 for update",
        [config.newsroom_id],
      );
      const [count] = await tx.query<{ n: number }>(
        "select count(*)::int n from routine_notice_automation_sources where newsroom_id=$1",
        [config.newsroom_id],
      );
      if (member?.role !== "owner" || !policy || policy.paused || !count?.n || count.n > 12)
        return false;
      const rows = await tx.query<{ id: number }>(
        "insert into routine_notice_runs(newsroom_id,local_date,automation_revision,policy_revision,status,actor) values($1,$2,$3,$4,'queued',$5) on conflict do nothing returning id",
        [config.newsroom_id, stamp.date, config.revision, policy.revision, config.activated_by],
      );
      if (!rows[0]) return false;
      await tx.query(
        "insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,research_scope,lane,status,stage) values($1,$2,'routine-notice',$3,'deterministic','scheduled','supplied','default','queued','Queued routine editions')",
        [config.newsroom_id, config.activated_by, rows[0].id],
      );
      return true;
    });
    if (made) queued += 1;
  }
  return { queued };
}

type CheckFn = typeof checkRoutineNoticeSourceForOwner;
async function assertRoutineRunCanContinue(job: DeskJob, run: {
  id: number;
  newsroom_id: number;
  automation_revision: number;
  policy_revision: number;
  actor: string;
}) {
  await withTransaction(async (tx) => {
    const [claim] = await tx.query<{ status: string; claim_token: string | null }>(
      "select status,claim_token from desk_jobs where id=$1 and newsroom_id=$2 for update",
      [job.id, job.newsroom_id],
    );
    const [automation] = await tx.query<{ enabled: boolean; revision: number }>(
      "select enabled,revision from routine_notice_automations where newsroom_id=$1 for update",
      [run.newsroom_id],
    );
    const [policy] = await tx.query<{ paused: boolean; revision: number }>(
      "select paused,revision from routine_notice_policies where newsroom_id=$1 for update",
      [run.newsroom_id],
    );
    const [member] = await tx.query<{ role: string }>(
      "select role from newsroom_members where newsroom_id=$1 and user_id=$2 for update",
      [run.newsroom_id, run.actor],
    );
    if (
      claim?.status !== "running" ||
      !job.claim_token ||
      claim.claim_token !== job.claim_token ||
      !automation?.enabled ||
      automation.revision !== run.automation_revision ||
      policy?.paused ||
      policy?.revision !== run.policy_revision ||
      member?.role !== "owner"
    )
      throw new Error("Routine edition authority changed before source work.");
    await tx.query(
      "update routine_notice_runs set status='running' where id=$1 and newsroom_id=$2 and status in ('queued','running')",
      [run.id, run.newsroom_id],
    );
  });
}
export async function performRoutineNoticeWork(
  job: DeskJob,
  deps: Parameters<typeof performRoutineNoticeWorkWith>[1] = {},
): Promise<void> {
  try {
    await performRoutineNoticeWorkWith(job, deps);
  } catch (error) {
    const sql = await getSql();
    const [prior] = await sql.query<{ summary_json: string }>(
      "select summary_json from routine_notice_runs where id=$1 and newsroom_id=$2",
      [job.subject_id, job.newsroom_id],
    );
    let summary: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(prior?.summary_json || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        summary = parsed as Record<string, unknown>;
    } catch {
      // A failed run still gets a readable error even if an older receipt was malformed.
    }
    await sql.query(
      `update routine_notice_runs r set status='failed',finished_at=now(),summary_json=$3
        from desk_jobs j
       where r.id=$1 and r.newsroom_id=$2 and j.id=$4 and j.newsroom_id=r.newsroom_id
         and r.status in ('queued','running') and j.status='running' and j.claim_token=$5`,
      [
        job.subject_id,
        job.newsroom_id,
        JSON.stringify({
          ...summary,
          error: error instanceof Error ? error.message : "Routine edition failed.",
        }),
        job.id,
        job.claim_token,
      ],
    );
    throw error;
  }
}
export async function performRoutineNoticeWorkWith(
  job: DeskJob,
  deps: {
    check?: CheckFn;
    beforeCommit?: () => Promise<void>;
    verifyCheck?: typeof assertRoutineNoticeCheckStillBound;
    now?: Date | (() => Date);
  } = {},
): Promise<void> {
  await ensureRoutineNoticeAutomationSchema();
  const sql = await getSql();
  const [run] = await sql.query<{
    id: number;
    newsroom_id: number;
    local_date: string;
    automation_revision: number;
    policy_revision: number;
    actor: string;
    timezone: string;
  }>(
    "select r.id,r.newsroom_id,r.local_date,r.automation_revision,r.policy_revision,r.actor,a.timezone from routine_notice_runs r join routine_notice_automations a on a.newsroom_id=r.newsroom_id where r.id=$1 and r.newsroom_id=$2",
    [job.subject_id, job.newsroom_id],
  );
  if (!run) throw new Error("Routine edition run is missing.");
  const now = () => typeof deps.now === "function" ? deps.now() : deps.now ?? new Date();
  if (localStamp(now(), run.timezone).date !== String(run.local_date).slice(0, 10))
    throw new Error("Routine edition run expired before publication; editor review is required.");
  const sources = await sql.query<{
    source_id: number;
    source_url: string;
    public_source_url: string;
    issuer: string;
    locality: string;
    format_key: any;
  }>(
    "select source_id,source_url,public_source_url,issuer,locality,format_key from routine_notice_automation_sources where newsroom_id=$1 order by source_id,format_key limit 13",
    [run.newsroom_id],
  );
  if (!sources.length || sources.length > 12)
    throw new Error("Routine edition source selection is unavailable.");
  const groups: RoutineNoticeCheckGroup[] = [];
  const check = deps.check ?? checkRoutineNoticeSourceForOwner;
  /*
    FB1, unit 2: this worker used to say NOTHING at all while it ran.

    No stage, no step, and -- because `beat_at` is only written by
    `reportProgress` -- no heartbeat either. Its card would have called a
    perfectly healthy routine edition "stalled" at sixty seconds and offered the
    editor "Retry on next model" for a job that was mid-fetch. Twelve sources,
    each one a real network read, is not instant and is not invisible any more.
  */
  const report = progressReporterFor(job);
  await report("Reading the routine sources", spanPct(0, sources.length, 0, 60));
  for (const [sourceIndex, source] of sources.entries()) {
    await assertRoutineRunCanContinue(job, run);
    /*
      B8B item 2: two things this loop did not do.

      CANCEL. `assertRoutineRunCanContinue` is about AUTHORITY -- the claim, the
      automation revision, a paused policy, an owner who left -- and never about
      the editor's Cancel, so a Cancel pressed while a routine edition was
      reading twelve sources was not noticed until the loop happened to end.
      `throwIfJobCancelled` is the desk's own act, at the source boundary.

      HEARTBEAT. `report` speaks once per source, so the card was honest BETWEEN
      sources and silent DURING one -- and a single `check` is a real network
      read that can run past `JOB_STALL_SECONDS`, which is long enough for the
      card to call a healthy edition "stalled" and offer a Retry. `waitForModel`
      is the same ticker every model-calling worker uses: it beats while the
      read is in flight (so the row never goes quiet) and it reads Cancel on the
      same tick (so a Cancel lands mid-fetch rather than at the next source).

      Its label is the counted step, so the ticker's "Waiting on …" sentence
      names the source being read rather than a model that is not involved.
    */
    await throwIfJobCancelled(job.id);
    await report(
      countedStep("Reading the routine sources", sourceIndex + 1, sources.length),
      spanPct(sourceIndex + 1, sources.length, 0, 60),
    );
    const result = await waitForModel({
      jobId: job.id,
      label: () => countedStep("Reading the routine sources", sourceIndex + 1, sources.length),
      run: () =>
        check(
          { userId: run.actor, newsroomId: run.newsroom_id },
          {
            requestId: crypto.randomUUID(),
            sourceId: source.source_id,
            sourceUrl: source.source_url,
            formatKey: source.format_key,
            expectedPolicyRevision: run.policy_revision,
          },
        ),
    });
    groups.push(result.check);
  }
  await deps.beforeCommit?.();
  await report("Planning the edition", 70);
  const notices: StructurallyValidRoutineNotice[] = [];
  for (const group of groups) {
    const source = sources.find(
      (s) => s.source_id === group.source.id && s.format_key === group.formatKey,
    )!;
    for (const candidate of group.candidates) {
      if (candidate.conflict) continue;
      const candidateKey = `${candidate.externalIdHash}:${await sha256(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(candidate.fields)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, value.value]),
          ),
        ),
      )}`;
      notices.push({
        formatKey: candidate.formatKey,
        variant: candidate.variant,
        provenance: {
          newsroomId: run.newsroom_id,
          sourceId: source.source_id,
          sourceUrl: source.public_source_url,
          policyRevision: run.policy_revision,
          captureEventId: group.capture?.captureEventId ?? 0,
          artifactVersionId: group.capture?.artifactVersionId ?? 0,
          contentHash: "bound-check",
          externalId: candidateKey,
        },
        provenanceVerification: "unverified",
        fields: {
          ...candidate.fields,
          issuer: { value: source.issuer, locator: "OWNER_ISSUER" },
        },
        normalizedFields: Object.fromEntries(
          Object.entries({
            ...candidate.fields,
            issuer: { value: source.issuer, locator: "OWNER_ISSUER" },
          }).map(([key, value]) => [key, value.value]),
        ),
        fingerprintMaterial: candidateKey,
      });
    }
  }
  const localDate = String(run.local_date).slice(0, 10);
  const planned = eligibleRoutineNotices(notices, localDate, run.timezone);
  const earlierDeadlineKeys = new Set<string>();
  let malformedDeadlineReceipt = false;
  for (const row of await sql.query<{ candidate_keys_json: string }>(
    "select candidate_keys_json from routine_notice_publications where newsroom_id=$1 and channel='deadlines' and issue_date<$2",
    [run.newsroom_id, localDate],
  )) {
    try {
      const keys: unknown = JSON.parse(row.candidate_keys_json);
      if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string"))
        throw new Error("malformed receipt");
      for (const key of keys) earlierDeadlineKeys.add(key);
    } catch {
      malformedDeadlineReceipt = true;
    }
  }
  if (malformedDeadlineReceipt)
    throw new Error("A prior deadline publication receipt is malformed; editor review is required.");
  // Same-day receipts survive automation revisions and must be applied before the cap.
  const sameDayKeys = new Map<string, Set<string>>();
  for (const row of await sql.query<{ channel: string; candidate_keys_json: string }>(
    "select channel,candidate_keys_json from routine_notice_publications where newsroom_id=$1 and issue_date=$2",
    [run.newsroom_id, localDate],
  )) {
    let keys: unknown;
    try {
      keys = JSON.parse(row.candidate_keys_json);
    } catch {
      throw new Error("A same-day publication receipt is malformed; editor review is required.");
    }
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string"))
      throw new Error("A same-day publication receipt is malformed; editor review is required.");
    sameDayKeys.set(row.channel, new Set(keys));
  }
  const allEligible = planned.eligible.slice();
  const alreadyPublished = new Set<string>();
  const schedulable = allEligible.filter((item) => {
    const externalId = item.notice.provenance.externalId ?? "";
    if (sameDayKeys.get(item.channel)?.has(externalId) ||
      (item.channel === "deadlines" && earlierDeadlineKeys.has(externalId))) {
      alreadyPublished.add(routineNoticeOutcomeKey(item));
      return false;
    }
    return true;
  });
  const priorRuns = await sql.query<{ summary_json: string }>(
    "select summary_json from routine_notice_runs where newsroom_id=$1 order by local_date,id",
    [run.newsroom_id],
  );
  const latestPriorOutcome = new Map<string, { status: string; order: number }>();
  let priorOrder = 0;
  for (const row of priorRuns) {
    try {
      const summary = JSON.parse(row.summary_json || "{}");
      if (!Array.isArray(summary.notices)) continue;
      for (const notice of summary.notices) {
        const externalId = notice?.binding?.externalId;
        if (typeof notice?.channel !== "string" || typeof externalId !== "string") continue;
        latestPriorOutcome.set(`${notice.channel}:${externalId}`, {
          status: String(notice.status ?? ""),
          order: priorOrder++,
        });
      }
    } catch {
      // An older malformed summary cannot be used as a planning receipt.
    }
  }
  const deferredPriority = new Map(
    [...latestPriorOutcome]
      .filter(([, outcome]) => outcome.status === "deferred")
      .map(([key, outcome]) => [key, outcome.order]),
  );
  const orderedEligible = schedulable.slice().sort((a, b) => {
    const aOrder = deferredPriority.get(routineNoticeOutcomeKey(a));
    const bOrder = deferredPriority.get(routineNoticeOutcomeKey(b));
    if (aOrder !== undefined || bOrder !== undefined) {
      if (aOrder === undefined) return 1;
      if (bOrder === undefined) return -1;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }
    return (
      a.occurrenceDate.localeCompare(b.occurrenceDate) ||
      a.line.localeCompare(b.line) ||
      a.channel.localeCompare(b.channel)
    );
  });
  const selectedEligible = orderedEligible.slice(0, 5);
  const overflow = orderedEligible.slice(5);
  let plans = planRoutineEditions(selectedEligible, localDate);
  if (new Date(`${localDate}T12:00:00Z`).getUTCDay() !== 5)
    plans = plans.filter((p) => p.channel !== "weekend");
  const noticeStatuses = new Map<string, RoutineNoticeOutcomeStatus>();
  for (const item of allEligible)
    noticeStatuses.set(
      routineNoticeOutcomeKey(item),
      alreadyPublished.has(routineNoticeOutcomeKey(item)) ? "published" : "in-review",
    );
  for (const item of overflow) noticeStatuses.set(routineNoticeOutcomeKey(item), "deferred");
  const plannedChannels = new Set(plans.map((plan) => plan.channel));
  for (const item of selectedEligible)
    if (!plannedChannels.has(item.channel)) noticeStatuses.set(routineNoticeOutcomeKey(item), "deferred");
  const noticeRows = () =>
    allEligible.map((item) =>
      routineNoticeOutcome(item, noticeStatuses.get(routineNoticeOutcomeKey(item)) ?? "in-review"),
    );
  let needsReview =
    planned.review.length +
    groups.reduce(
      (total, group) =>
        total +
        group.counts.refused +
        group.counts.conflicts +
        (group.state === "capture-failed" || group.state === "evidence-unavailable" ||
        (group.state === "refused" && group.counts.refused === 0) ? 1 : 0),
      0,
    );
  const summary = (published: number, corrected: number) => ({
    published,
    corrected,
    needsReview,
    eligible: allEligible.length,
    deferred: [...noticeStatuses.values()].filter((status) => status === "deferred").length,
    notices: noticeRows(),
  });
  await sql.query(
    "update routine_notice_runs set summary_json=$2 where id=$1 and newsroom_id=$3 and status='running'",
    [run.id, JSON.stringify(summary(0, 0)), run.newsroom_id],
  );
  await report("Filing the notices", 90);
  await withTransaction(async (tx) => {
    const [claim] = await tx.query<{ claim_token: string | null; status: string }>(
      "select claim_token,status from desk_jobs where id=$1 and newsroom_id=$2 for update",
      [job.id, job.newsroom_id],
    );
    if (claim?.status !== "running" || !job.claim_token || claim.claim_token !== job.claim_token)
      throw new Error("Routine edition job lease changed before publication.");
    const [current] = await tx.query<any>(
      "select enabled,revision,today_section,weekend_section,deadlines_section from routine_notice_automations where newsroom_id=$1 for update",
      [run.newsroom_id],
    );
    if (localStamp(now(), run.timezone).date !== localDate)
      throw new Error("Routine edition run expired before publication; editor review is required.");
    const [policy] = await tx.query<any>(
      "select paused,revision from routine_notice_policies where newsroom_id=$1 for update",
      [run.newsroom_id],
    );
    const [member] = await tx.query<any>(
      "select role from newsroom_members where newsroom_id=$1 and user_id=$2 for update",
      [run.newsroom_id, run.actor],
    );
    if (
      !current?.enabled ||
      current.revision !== run.automation_revision ||
      policy?.paused ||
      policy?.revision !== run.policy_revision ||
      member?.role !== "owner"
    )
      throw new Error("Routine edition authority changed before publication.");
    for (const source of sources) {
      const [valid] = await tx.query<any>(
        "select a.source_url from routine_notice_automation_sources x join routine_notice_approvals a on a.newsroom_id=x.newsroom_id and a.source_id=x.source_id and a.format_key=x.format_key join sources s on s.newsroom_id=x.newsroom_id and s.id=x.source_id and s.status='accepted' and s.url=x.source_url where x.newsroom_id=$1 and x.source_id=$2 and x.format_key=$3 for update of x,a,s",
        [run.newsroom_id, source.source_id, source.format_key],
      );
      if (valid?.source_url !== source.source_url)
        throw new Error("Routine edition source changed before publication.");
    }
    for (const group of groups) {
      if (!group.candidates.length) continue;
      await (deps.verifyCheck ?? assertRoutineNoticeCheckStillBound)(tx, {
        userId: run.actor,
        newsroomId: run.newsroom_id,
      }, group);
    }
    const sections = {
      today: current.today_section,
      weekend: current.weekend_section,
      deadlines: current.deadlines_section,
    };
    let published = 0,
      corrected = 0;
    const existingByChannel = new Map(
      (
        await tx.query<any>(
          "select * from routine_notice_publications where newsroom_id=$1 and issue_date=$2 for update",
          [run.newsroom_id, localDate],
        )
      ).map((publication) => [publication.channel, publication]),
    );
    for (const channel of ["today", "weekend", "deadlines"] as const) {
      if (existingByChannel.has(channel) && !plans.some((plan) => plan.channel === channel))
        needsReview += 1;
    }
    const markChannel = (channel: string, status: RoutineNoticeOutcomeStatus) => {
      for (const item of selectedEligible)
        if (item.channel === channel) noticeStatuses.set(routineNoticeOutcomeKey(item), status);
    };
    for (const plan of plans) {
      const [section] = await tx.query<any>(
        "select visible from newsroom_sections where newsroom_id=$1 and key=$2 for update",
        [run.newsroom_id, sections[plan.channel]],
      );
      if (!section?.visible) {
        needsReview += 1;
        markChannel(plan.channel, "in-review");
        continue;
      }
      const fingerprint = await sha256(plan.body);
      const existing = existingByChannel.get(plan.channel);
      if (existing) {
        if (existing.content_fingerprint === fingerprint) {
          markChannel(plan.channel, "published");
          continue;
        }
        const [article] = existing.article_id
          ? await tx.query<{ body: string; status: string }>(
              "select body,status from articles where id=$1 and newsroom_id=$2 for update",
              [existing.article_id, run.newsroom_id],
            )
          : [];
        if (
          !article ||
          article.status !== "published" ||
          (await sha256(article.body)) !== existing.article_body_hash
        ) {
          needsReview += 1;
          continue;
        }
        await tx.query(
          "insert into corrections(user_id,newsroom_id,article_id,body) values($1,$2,$3,$4)",
          [
            run.actor,
            run.newsroom_id,
            existing.article_id,
            `${ROUTINE_EDITION_UPDATE_PREFIX}\n\n${plan.body}`,
          ],
        );
        await tx.query(
          "update routine_notice_publications set run_id=$2,content_fingerprint=$3,candidate_keys_json=$4 where id=$1",
          [
            existing.id,
            run.id,
            fingerprint,
            JSON.stringify(
              [...new Set([
                ...(sameDayKeys.get(plan.channel) ?? []),
                ...selectedEligible
                  .filter((entry) => entry.channel === plan.channel)
                  .map((entry) => entry.notice.provenance.externalId),
              ])],
            ),
          ],
        );
        corrected += 1;
        markChannel(plan.channel, "published");
        continue;
      }
      const slug = `routine-${plan.channel}-${localDate}-${run.newsroom_id}`;
      const [article] = await tx.query<{ id: number }>(
        "insert into articles(user_id,newsroom_id,slug,headline,dek,body,topic,source_urls,status,published_at) values($1,$2,$3,$4,$5,$6,$7,$8,'published',now()) returning id",
        [
          run.actor,
          run.newsroom_id,
          slug,
          plan.headline,
          "Logistics from approved public sources.",
          plan.body,
          sections[plan.channel],
          JSON.stringify(plan.sourceUrls),
        ],
      );
      await tx.query(
        "insert into routine_notice_publications(newsroom_id,run_id,channel,issue_date,article_id,content_fingerprint,candidate_keys_json,article_body_hash) values($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          run.newsroom_id,
          run.id,
          plan.channel,
          localDate,
          article!.id,
          fingerprint,
          JSON.stringify(
            selectedEligible
              .filter((e) => e.channel === plan.channel)
              .map((e) => e.notice.provenance.externalId),
          ),
          await sha256(plan.body),
        ],
      );
      published += 1;
      markChannel(plan.channel, "published");
    }
    await tx.query(
      "update routine_notice_runs set status='completed',summary_json=$2,finished_at=now() where id=$1",
      [
        run.id,
        JSON.stringify(summary(published, corrected)),
      ],
    );
    await tx.query(
      "insert into audit_events(user_id,action,detail,newsroom_id,subject_kind,subject_id) values($1,'routine-notice-run',$2,$3,'routine-notice-run',$4)",
      [
        run.actor,
        `published ${published}; corrected ${corrected}; review ${needsReview}`,
        run.newsroom_id,
        run.id,
      ],
    );
    await tx.query(
      "update desk_jobs set status='completed',stage='Done',finished_at=now(),updated_at=now() where id=$1 and status='running' and claim_token=$2",
      [job.id, job.claim_token],
    );
  });
}
