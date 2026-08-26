import { getSql } from "../db.ts";
import { headlineFromUrl, looksLikeUrl } from "./desk-copy.ts";
import { ensureInvestigateSchema, seedInvestigation } from "./investigate.ts";

/** Open a row the editor can see. Does not run hops. */
export async function openInvestigationForEditor(
  userId: string,
  opts: { paste: string; title?: string },
): Promise<{ ok: true; investigationId: number; title: string }> {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const paste = opts.paste.trim().slice(0, 14000);
  const firstLine = paste.split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
  const candidate = (opts.title || firstLine).trim();
  const title = (
    looksLikeUrl(candidate)
      ? headlineFromUrl(candidate)
      : candidate || `Investigation ${new Date().toISOString().slice(0, 10)}`
  ).slice(0, 200);
  const created = await sql<{ id: number }>`
    insert into investigations (user_id, title, status, budget, summary)
    values (${userId}, ${title}, ${"open"}, ${5}, ${"Opened from Dark Desk."})
    returning id
  `;
  const investigationId = created[0]!.id;
  const snaps = await sql<{ title: string; url: string; excerpt: string }>`
    select s.title, s.url, snap.excerpt
    from snapshots snap
    join sources s on s.id = snap.source_id
    where snap.user_id = ${userId}
    order by snap.id desc
    limit 16
  `.catch(() => []);
  await seedInvestigation(userId, investigationId, paste, snaps);
  await sql`
    update investigations set updated_at = now() where id = ${investigationId} and user_id = ${userId}
  `;
  return { ok: true as const, investigationId, title };
}
