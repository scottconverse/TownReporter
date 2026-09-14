import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "../db.ts";
import { DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { isOnboarded } from "./paper-settings.ts";
import { resolveSectionKey } from "./sections.server.ts";
import { stripReporterNotebook } from "./strip-draft.ts";
import { unpackStoredDraft } from "./coerce-draft.ts";
import type { ReaderStory } from "../reader.ts";

const input = z.object({
  q: z.string().trim().max(80).optional(),
  topic: z.string().max(100).optional(),
  page: z.number().int().min(1).max(100000).default(1),
  oldest: z.boolean().default(false),
  saved: z.array(z.string().max(300)).max(500).optional(),
});
export const readerArticles = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    if (!(await isOnboarded(DEFAULT_NEWSROOM_ID)))
      return { stories: [] as ReaderStory[], total: 0, pageSize: 12 };
    const sql = await getSql();
    const topic = data.topic ? await resolveSectionKey(DEFAULT_NEWSROOM_ID, data.topic) : "";
    const q = data.q || "";
    // Treat punctuation literally. Short searches stay on headline and dek.
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const saved = JSON.stringify(data.saved ?? []);
    const where = () => sql<{
      count: string;
    }>`select count(*)::text as count from articles where newsroom_id=${DEFAULT_NEWSROOM_ID} and status='published'
    and (${topic}='' or topic=${topic})
    and (${q}='' or headline ilike ${like} or dek ilike ${like} or (${q.length >= 3} and body ilike ${like}))
    and (${data.saved === undefined} or slug in (select jsonb_array_elements_text(${saved}::jsonb)))`;
    const counts = await where();
    const rows =
      await sql<ReaderStory>`select id,slug,headline,dek,body,topic,published_at from articles where newsroom_id=${DEFAULT_NEWSROOM_ID} and status='published'
    and (${topic}='' or topic=${topic})
    and (${q}='' or headline ilike ${like} or dek ilike ${like} or (${q.length >= 3} and body ilike ${like}))
    and (${data.saved === undefined} or slug in (select jsonb_array_elements_text(${saved}::jsonb)))
    order by case when ${data.oldest} then published_at end asc, case when ${!data.oldest} then published_at end desc, id desc
    limit 12 offset ${(data.page - 1) * 12}`;
    return {
      stories: rows.map((row) => {
        const u = unpackStoredDraft(row);
        return { ...row, ...u, body: stripReporterNotebook(u.body) };
      }),
      total: Number(counts[0]?.count ?? 0),
      pageSize: 12,
    };
  });
