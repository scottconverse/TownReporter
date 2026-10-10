import { getSql } from "../db.ts";
import { editorWarning, type EditorWarningResult } from "./editor-override.ts";
import { checkCooldown, checkRate, recordDeskRun } from "./ops.ts";
import { assertHttpUrl } from "./url-guard.ts";
import { sanitizePublicUrls } from "./schema.ts";
import { packNotes, parseNotes } from "./notes.ts";
import { disclosureLine } from "./import-stories.ts";

type Context = { userId: string; newsroomId?: number };
type Refusal = { ok: false; error: string };
export type FileLeadRequest = {
  headline: string; why: string; topic: string; url?: string; urls?: string[];
  disclosureKey?: "outside-ai" | "person" | "other"; disclosureOther?: string;
  importedText?: boolean; origin?: "import"; override?: string[];
};
export type FiledLead = {
  headline: string; why: string; topic: string; urls: string[]; notesJson: string;
  disclosure: string; importedText: boolean; origin?: "import";
};

/** The filing boundary shared by the desk's manual lead controls. */
export async function fileLeadForEditor<T>(context: Context, data: FileLeadRequest, insert: (data: FiledLead) => Promise<T>): Promise<T | Refusal | EditorWarningResult> {
  const headline = data.headline.trim().slice(0, 180);
  const why = data.why.trim().slice(0, 800);
  if (!headline) return { ok: false, error: "Headline needs a full sentence." };
  let urls: string[] = [];
  if (data.url?.trim()) {
    try { urls = [assertHttpUrl(data.url.trim()).toString()]; }
    catch { return { ok: false, error: "That source URL is not a public http(s) address." }; }
  }
  // Supplied public links keep the desk's existing sanitation and deduplication.
  urls = sanitizePublicUrls([...urls, ...(data.urls ?? [])]);
  const target = { kind: "newsroom", id: context.newsroomId ?? 1 };
  if (headline.length < 8) {
    const warning = await editorWarning(context, data.override, "lead-short-headline", "Headline needs a full sentence.", target);
    if (warning) return warning;
  }
  if (why.length < 8) {
    const warning = await editorWarning(context, data.override, "lead-short-why", "Say why this is news.", target);
    if (warning) return warning;
  }
  return insert({ headline, why, topic: (data.topic || "council").slice(0, 40), urls,
    notesJson: packNotes({ ...parseNotes(null), suppliedUrls: urls }),
    disclosure: data.disclosureKey ? disclosureLine(data.disclosureKey, data.disclosureOther ?? "") : "",
    importedText: data.importedText === true, origin: data.origin });
}

export type SourceCheckRecord = { id: number; url: string; title: string; status: string; blocked_at: string | null; blocked_attempts: number | null };
/** A manual check can read a paused row once without resuming its schedule. */
export async function checkSourceForEditor<T>(context: Context, sourceId: number, override: readonly string[] | undefined, run: (source: SourceCheckRecord) => Promise<T>, seconds = 30) {
  const sql = await getSql();
  const [source] = await sql.query<SourceCheckRecord>("select id,url,title,status,blocked_at,blocked_attempts from sources where id=$1 and newsroom_id=$2", [sourceId, context.newsroomId ?? 1]);
  const fail = (error: string) => ({ ok: false as const, error, line: error, url: source?.url ?? "", title: source?.title ?? "" });
  if (!source) return fail("That source is not on this desk.");
  try { assertHttpUrl(source.url); } catch { return fail("That source URL is not a public http(s) address."); }
  if (source.status !== "accepted" && source.status !== "paused") return fail("This source is not on the watch list.");
  if (source.status === "paused") {
    const warning = await editorWarning(context, override, "source-paused", "This source is paused. This check will read it once without resuming its schedule.", { kind: "source", id: sourceId });
    if (warning) return { ...warning, line: warning.error, url: source.url, title: source.title };
  }
  const cooldown = await checkCooldown(context.userId, `check-source:${sourceId}`, seconds, context.newsroomId ?? 1, override);
  if (cooldown) return { ...cooldown, line: cooldown.error, url: source.url, title: source.title };
  return run(source);
}

export type PullStartRequest = { leadId: number; query: string; url?: string; index?: number; override?: string[] };
/** All policy checks precede the rate unit and the actual enqueue. */
export async function startPullForEditor<T>(context: Context, input: PullStartRequest, enqueue: (query: string, sourceUrl: string | null) => Promise<T>): Promise<T | Refusal | EditorWarningResult> {
  const sql = await getSql();
  const newsroomId = context.newsroomId ?? 1;
  const [lead] = await sql<{ id: number }>`select id from leads where id=${input.leadId} and newsroom_id=${newsroomId}`;
  if (!lead) return { ok: false, error: "Lead not found" };
  let sourceUrl: string | null = null;
  if (input.url?.trim() && /^https?:\/\//i.test(input.url.trim())) {
    try { sourceUrl = assertHttpUrl(input.url.trim()).toString(); }
    catch { return { ok: false, error: "That source URL is not a public http(s) address." }; }
  }
  const [open] = await sql<{ id: number }>`select id from desk_jobs where newsroom_id=${newsroomId} and kind='pull' and subject_id=${input.leadId} and status in ('queued','running') limit 1`;
  if (open) return { ok: false, error: "This story already has a Pull running. Its live progress is shown beside the reporting line." };
  const query = input.query.trim().slice(0, 240);
  if (query.length < 4) {
    const warning = await editorWarning(context, input.override, "pull-short-query", "That line is too thin to search.", { kind: "lead", id: input.leadId });
    if (warning) return warning;
  }
  const rate = await checkRate(context.userId, "pull", newsroomId, input.override, { record: false });
  if (rate) return rate;
  const result = await enqueue(query, sourceUrl);
  if (!(result && typeof result === "object" && "ok" in result && result.ok === false)) await recordDeskRun(context.userId, "pull", newsroomId);
  return result;
}
