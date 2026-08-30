import { createServerFn } from "@tanstack/react-start";
import { getSql, type Sql } from "@/lib/db";
import {
  reinsert,
  repointRequests,
  TRASH_DAYS,
  type Snapshot,
  type TrashKind,
  type TrashRow,
} from "./trash-store";
import { deskMiddleware } from "./desk-auth";
import { audit } from "./ops";
import { DEFAULT_NEWSROOM_ID } from "./membership";

/**
 * Recently deleted, and putting it back.
 *
 * Delete is one click away from the whole desk, which is what the operator
 * asked for. This is the floor under it. A lead takes its drafts with it and an
 * editorial draft has no copy anywhere, so a mis-click used to be final.
 *
 * The design is snapshot-and-remove, not a `deleted_at` flag. A flag means
 * every list, the feed, the sitemap and the public article route must each
 * remember to filter it out, and the one that forgets serves something the
 * editor believes is gone. Here the row is really deleted; what is kept is a
 * copy in a table nothing else reads.
 *
 * Snapshots are taken with `to_jsonb`, and restored by rebuilding the insert
 * from the keys that came back. That is deliberate: this file does not list the
 * columns of `leads`, `drafts` or `articles`, so a later migration that adds
 * one does not silently start dropping it on restore.
 */

export type { TrashKind, TrashRow } from "./trash-store";
export {
  keepACopy,
  reinsert,
  snapshotArticle,
  snapshotDraft,
  snapshotLead,
  TRASH_DAYS,
  purgeAllOldTrash,
} from "./trash-store";

function owned(context: { newsroomId?: number }) {
  return context.newsroomId ?? DEFAULT_NEWSROOM_ID;
}

/**
 * Throw out what has been in the trash longer than the window, for the
 * newsroom whose list was just opened.
 *
 * Lazy on purpose: called when the list is read, so an editor who opens Trash
 * never sees a stale row hanging around. This alone used to be the *only*
 * trigger that ever ran a purge, which meant "thirty days" was really "thirty
 * days, if someone happens to look" — see `purgeAllOldTrash` in
 * `trash-store.ts` for the unattended half of the fix (ENG-106), wired into
 * the five-minute cron tick in `monitors-cron.ts`. Kept here as
 * belt-and-braces: it costs nothing and keeps this list self-consistent even
 * if the cron tick has not run yet.
 */
async function purgeOld(sql: Sql, newsroomId: number): Promise<void> {
  await sql`
    delete from deleted_items
    where newsroom_id = ${newsroomId}
      and deleted_at < now() - make_interval(days => ${TRASH_DAYS})
  `.catch(() => undefined);
}

export const listTrash = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .handler(async ({ context }): Promise<TrashRow[]> => {
    const sql = await getSql();
    await purgeOld(sql, owned(context));
    const rows = await sql<{
      id: number;
      kind: TrashKind;
      ref_id: number;
      label: string;
      payload: string;
      deleted_at: string;
    }>`
      select id, kind, ref_id, label, payload, deleted_at
      from deleted_items where newsroom_id = ${owned(context)}
      order by deleted_at desc limit 100
    `.catch(() => []);

    return rows.map((r) => {
      let extra = "";
      try {
        const s = JSON.parse(r.payload) as Snapshot;
        const bits: string[] = [];
        if (s.drafts?.length) bits.push(`${s.drafts.length} draft${s.drafts.length > 1 ? "s" : ""}`);
        if (s.corrections?.length) {
          bits.push(`${s.corrections.length} correction${s.corrections.length > 1 ? "s" : ""}`);
        }
        if (s.extras) bits.push("fact sheet");
        extra = bits.join(" · ");
      } catch {
        extra = "";
      }
      return {
        id: r.id,
        kind: r.kind,
        ref_id: r.ref_id,
        label: r.label,
        deleted_at: r.deleted_at,
        extra,
      };
    });
  });

/**
 * Put it back.
 *
 * Order matters: the parent goes in before anything that references it, or the
 * foreign key rejects the child and the restore is half done.
 */
export const restoreTrashItem = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    const { withTransaction } = await import("@/lib/db");
    const sql = await getSql();
    const rows = await sql<{ kind: TrashKind; label: string; payload: string }>`
      select kind, label, payload from deleted_items
      where id = ${id} and newsroom_id = ${owned(context)} limit 1
    `;
    const item = rows[0];
    if (!item) return { ok: false as const, error: "That is not in the trash any more." };

    let snap: Snapshot;
    try {
      snap = JSON.parse(item.payload) as Snapshot;
    } catch {
      return { ok: false as const, error: "That copy is unreadable." };
    }

    try {
      await withTransaction(async (tx) => {
        if (item.kind === "lead") {
          await reinsert(tx, "leads", snap.row);
          for (const d of snap.drafts ?? []) await reinsert(tx, "drafts", d);
        } else if (item.kind === "article") {
          await reinsert(tx, "articles", snap.row);
          for (const c of snap.corrections ?? []) await reinsert(tx, "corrections", c);
        } else {
          await reinsert(tx, "drafts", snap.row);
          if (snap.extras) await reinsert(tx, "editorial_extras", snap.extras);
          // The draft is back; the Opinion desk still has to be told.
          const draftId = Number(snap.row.id);
          if (Number.isFinite(draftId) && snap.requestIds?.length) {
            await repointRequests(tx, draftId, snap.requestIds);
          }
        }
      });
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message.slice(0, 200) : "That would not go back.",
      };
    }

    await sql`delete from deleted_items where id = ${id} and newsroom_id = ${owned(context)}`;
    await audit(context.userId, "restore", `${item.kind} — ${item.label.slice(0, 100)}`);
    return { ok: true as const, kind: item.kind };
  });

/** Really gone, now, rather than in thirty days. */
export const purgeTrashItem = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((id: number) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await getSql();
    const gone = await sql<{ label: string }>`
      delete from deleted_items
      where id = ${id} and newsroom_id = ${owned(context)}
      returning label
    `;
    if (!gone[0]) return { ok: false as const, error: "Already gone." };
    await audit(context.userId, "purge", gone[0].label.slice(0, 120));
    return { ok: true as const };
  });
