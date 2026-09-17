import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { requireEditor, ForbiddenError, DEFAULT_NEWSROOM_ID } from "./membership.ts";
import { getSql } from "../db.ts";
import { getSections, saveSections } from "./sections.server.ts";
import type { SectionConfig } from "./section-types.ts";

export const publicSections = createServerFn({ method: "GET" }).handler(async () => {
  const config = await getSections(DEFAULT_NEWSROOM_ID);
  return config.sections.map(({ key, name, visible, replacementKey }) => ({
    key,
    name,
    visible,
    replacementKey,
  }));
});
export const editorSections = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const me = await requireEditor(context.userId);
    const config = await getSections(me.newsroomId);
    const sql = await getSql();
    const sources = await sql<{
      id: number;
      title: string;
      url: string;
    }>`select id,title,url from sources where newsroom_id=${me.newsroomId} and status='accepted' order by title,id`;
    const counts = await sql<{
      topic: string;
      count: number;
    }>`select topic,count(*)::integer as count from (
    select topic from articles where newsroom_id=${me.newsroomId}
    union all select topic from drafts where newsroom_id=${me.newsroomId}
    union all select topic from leads where newsroom_id=${me.newsroomId}) records group by topic`;
    return { ...config, sources, counts, canEdit: me.role === "owner" };
  });
export const applySections = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: SectionConfig) => data)
  .handler(async ({ context, data }) => {
    try {
      const me = await requireEditor(context.userId);
      if (me.role !== "owner")
        throw new ForbiddenError("Only the owner can configure newspaper sections.");
      return { ok: true as const, config: await saveSections(me.newsroomId, data) };
    } catch (error) {
      return {
        ok: false as const,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save sections. Your changes have not been applied.",
      };
    }
  });
