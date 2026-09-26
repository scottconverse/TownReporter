/**
 * The one press that decides a batch of suggested sources.
 *
 * WHY THIS IS NOT A LOOP OVER `setSourceStatus`. The reviewer accepts a batch
 * and picks a section for it; if the section link fails halfway, a loop leaves
 * some rows accepted-and-filed and some accepted-and-not, with no way to tell
 * which from the screen. Everything here is one transaction, so a failure
 * changes nothing and the review screen can say so truthfully.
 *
 * The section half is owner-only, the same rule `saveSections` enforces ("Only
 * the owner can configure newspaper sections.") -- filing a source under a
 * section IS section configuration, and it is the act that puts a page into a
 * section's reading list, so it cannot be a second, looser door into the same
 * table. The decision half is not owner-only: an editor may accept or reject a
 * suggestion, they just cannot say where it files. `role` arrives from
 * `deskMiddleware`, so the refusal is made here rather than only in the screen.
 *
 * The revision bump at the end is the reason this holds under a concurrent
 * Sections save. `saveSections` rewrites a section's source list by DELETE +
 * INSERT under `revision=${input.revision}`; an owner saving a config they read
 * before this press would otherwise drop the link this press just wrote, with
 * both writes "succeeding". Bumping the revision inside this transaction makes
 * that stale save refuse itself with the sentence it already has, instead of
 * silently undoing a decision somebody made.
 *
 * LIFTED OUT OF desk.ts, like the other `perform*` helpers, so the atomicity is
 * something a test can call rather than something a reader has to trust:
 * `desk.ts` reaches `@/lib/...` aliases that plain `node --test` cannot resolve,
 * and "a failure changes nothing" is a claim about the database, not about the
 * source text. The validator stays in `desk.ts` beside the server function.
 */
import { withTransaction } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { LIMITS } from "./request-input.ts";

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

export async function performReviewSuggestedSources(
  context: { userId: string; newsroomId?: number; role: string },
  data: { ids: number[]; decision: "accepted" | "rejected"; sectionKey?: string; note?: string },
) {
  const newsroomId = owned(context);
  const ids = [...new Set(data.ids)];
  const wanted = data.decision === "accepted" ? data.sectionKey?.trim() || null : null;
  const note = data.note?.trim().slice(0, LIMITS.reviewNote) || null;
  try {
    const result = await withTransaction(async (sql) => {
      /*
        Every id must be a source in THIS newsroom, and the count must match
        exactly: a screen that shows 175 rows and a press that quietly decides
        174 of them (one having been accepted in another tab) is the failure
        mode this list exists to prevent.
      */
      const rows = await sql<{ id: number; status: string }>`
        select id, status from sources
        where newsroom_id = ${newsroomId} and id = any(${ids}::int[])
      `;
      if (rows.length !== ids.length)
        throw new Error(
          "One of those suggestions is not on this list any more. Reload and try again.",
        );

      let sectionName: string | null = null;
      if (wanted) {
        if (context.role !== "owner")
          throw new Error("Only the owner can file a source under a section.");
        const [section] = await sql<{ key: string; name: string }>`
          select key, name from newsroom_sections
          where newsroom_id = ${newsroomId} and key = ${wanted}
        `;
        if (!section) throw new Error("That section is not one this newsroom files under.");
        sectionName = section.name;
      }

      /*
        Status first, so the section rows below are only ever written next to
        sources that are already accepted -- the same ordering `saveSections`
        relies on when it refuses to assign anything but an accepted source.
      */
      await sql`
        update sources set
          status = ${data.decision},
          reviewed_at = now(),
          review_note = ${note}
        where newsroom_id = ${newsroomId} and id = any(${ids}::int[])
      `;

      if (wanted) {
        // Serialize with the sections save, then invalidate any revision an
        // editor is holding: see the note above this function.
        await sql`select revision from section_config where newsroom_id = ${newsroomId} for update`;
        await sql`update section_config set revision = revision + 1 where newsroom_id = ${newsroomId}`;
        for (const id of ids)
          await sql`
            insert into section_sources (newsroom_id, section_key, source_id)
            values (${newsroomId}, ${wanted}, ${id})
            on conflict do nothing
          `;
      }

      return { reviewed: ids.length, sectionName };
    });
    return { ok: true as const, ...result };
  } catch (error) {
    return {
      ok: false as const,
      reviewed: 0,
      sectionName: null,
      error: error instanceof Error ? error.message : "Could not review those suggestions.",
    };
  }
}
