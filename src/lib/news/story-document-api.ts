import { createServerFn } from "@tanstack/react-start";
import { deskMiddleware } from "./desk-auth";
export const uploadStoryDocument = createServerFn({ method: "POST" })
  .middleware([deskMiddleware])
  .validator((data: FormData) => data)
  .handler(async ({ data, context }) => {
    const form = data as unknown as FormData;
    const file = form.get("file");
    if (!file || typeof file === "string") throw new Error("Choose a document to upload.");
    if (file.size > 4 * 1024 * 1024) throw new Error("Upload part exceeds 4 MB.");
    const { storeStoryDocumentPart } = await import("./story-documents.server.ts");
    return storeStoryDocumentPart(
      context.newsroomId ?? 1,
      context.userId,
      file.name,
      file.type,
      new Uint8Array(await file.arrayBuffer()),
      Number(form.get("total")),
      Number(form.get("offset")),
      String(form.get("id") ?? ""),
    );
  });
export const listStoryDocuments = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((data: { leadId: number }) => data)
  .handler(async ({ data, context }) => {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const { ensureStoryDocuments } = await import("./story-documents.server.ts");
    await ensureStoryDocuments(sql);
    return sql<{
      id: string;
      filename: string;
      status: string;
      detail: string;
      pages: number | null;
      read_parts: number;
      total_parts: number;
      characters: number;
    }>`select id,filename,status,detail,pages,read_parts,total_parts,length(full_text) as characters from story_documents where newsroom_id=${context.newsroomId ?? 1} and lead_id=${data.leadId} order by created_at,id`;
  });
export const downloadStoryDocument = createServerFn({ method: "GET" })
  .middleware([deskMiddleware])
  .validator((data: { id: string; extracted?: boolean }) => data)
  .handler(async ({ data, context }) => {
    const { getSql } = await import("../db.ts");
    const sql = await getSql();
    const rows = await sql<{
      filename: string;
      mime: string;
      original: Uint8Array;
      full_text: string | null;
    }>`select filename,mime,original,full_text from story_documents where id=${data.id} and newsroom_id=${context.newsroomId ?? 1} and (lead_id is not null or user_id=${context.userId})`;
    const doc = rows[0];
    if (!doc) throw new Error("Document unavailable.");
    if (data.extracted && !doc.full_text) throw new Error("Text extraction is not complete yet.");
    return {
      filename: data.extracted ? `${doc.filename}.txt` : doc.filename,
      mime: data.extracted ? "text/plain" : doc.mime || "application/octet-stream",
      base64: Buffer.from(data.extracted ? doc.full_text! : doc.original).toString("base64"),
    };
  });
