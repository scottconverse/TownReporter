import { getSql } from "../db.ts";
import { INVESTIGATION_TITLE_LIMIT } from "./dark-rail.ts";
import { headlineFromUrl, looksLikeUrl } from "./desk-copy.ts";
import { ensureInvestigateSchema, seedInvestigation } from "./investigate.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { DARK_LIMITS, type DarkLimitKey } from "./editor-dialog-logic.ts";

/**
 * Open a row the editor can see. Does not run hops.
 *
 * `budget` is the dial the dark-file dialog draws, in the engine's own unit
 * (hops). It was hardcoded to 5 here; it is a parameter now because the
 * redesign's dialog offers Quick / Standard / Deep, and a Limits choice that
 * did not reach the row it was chosen for would be a control that does
 * nothing. Absent keeps 5, so no existing caller changes.
 */
export async function openInvestigationForEditor(
  userId: string,
  opts: {
    paste: string;
    title?: string;
    budget?: number;
    ordinaryExplanation?: string;
    limitKey?: DarkLimitKey;
  },
  newsroomId: number = DEFAULT_NEWSROOM_ID,
): Promise<{ ok: true; investigationId: number; title: string }> {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const paste = opts.paste.trim().slice(0, 14000);
  /*
    Clamped rather than trusted: the dialect's own ceiling is 20
    (`DARK_LIMITS`' deepest is 10, and `budgetFor` reads this column), and a
    budget of 0 would open a file that can never take a single hop.
  */
  const limit = DARK_LIMITS.find((row) => row.key === opts.limitKey) ?? DARK_LIMITS[1];
  const budget = opts.limitKey
    ? limit.hops
    : Math.min(20, Math.max(1, Math.round(Number(opts.budget ?? 5)) || 5));
  const configuredScope = await sql<{ scope: string }>`
    select scope from dark_settings where newsroom_id = ${newsroomId} limit 1
  `.catch(() => [] as { scope: string }[]);
  const rawScope = configuredScope[0]?.scope;
  const scope = ["city", "county", "region", "adjacent"].includes(rawScope ?? "") ? rawScope! : "city";
  const ordinaryExplanation = String(opts.ordinaryExplanation ?? "").trim().slice(0, 1600);
  const firstLine = paste.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  const candidate = (opts.title || firstLine).trim();
  /*
    The cut length lives in `dark-rail.ts` beside the code that reads it back:
    the rail can tell a title cut HERE from an editor's own short question only
    by knowing exactly how long a cut one is.
  */
  const title = (
    looksLikeUrl(candidate)
      ? headlineFromUrl(candidate)
      : candidate || `Investigation ${new Date().toISOString().slice(0, 10)}`
  ).slice(0, INVESTIGATION_TITLE_LIMIT);
  const created = await sql<{ id: number }>`
    insert into investigations (
      user_id, newsroom_id, title, status, budget, summary, ordinary_explanation, scope_json,
      limit_key, limit_minutes, limit_dollars
    )
    values (
      ${userId}, ${newsroomId}, ${title}, ${"open"}, ${budget}, ${"Opened from Dark Desk."},
      ${ordinaryExplanation}, ${JSON.stringify({ scope })}, ${limit.key}, ${limit.minutes}, ${limit.dollars}
    )
    returning id
  `;
  const investigationId = created[0]!.id;
  await seedInvestigation(userId, investigationId, paste, [], newsroomId);
  await sql`
    update investigations set updated_at = now() where id = ${investigationId}
  `;
  return { ok: true as const, investigationId, title };
}
