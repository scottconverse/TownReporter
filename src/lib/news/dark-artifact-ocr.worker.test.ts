import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";

let vite: Awaited<ReturnType<typeof createServer>>;
let getSql: typeof import("../db.ts").getSql;
let ensureDarkSchema: typeof import("./dark.ts").ensureDarkSchema;
let performArtifactOcrWork: typeof import("./dark.ts").performArtifactOcrWork;
let ensureJobsSchema: typeof import("./jobs.ts").ensureJobsSchema;

before(async () => {
  vite = await createServer({
    configFile: false,
    cacheDir: join(tmpdir(), `townreporter-artifact-ocr-${process.pid}`),
    server: { middlewareMode: true, hmr: { port: 0 } },
    appType: "custom",
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ ensureDarkSchema, performArtifactOcrWork } = await vite.ssrLoadModule("/src/lib/news/dark.ts"));
  ({ ensureJobsSchema } = await vite.ssrLoadModule("/src/lib/news/jobs.ts"));
  await ensureDarkSchema();
  await ensureJobsSchema();
});

after(async () => vite.close());

test("later-page OCR preserves the captured PDF and deduplicates identical evidence", async () => {
  const sql = await getSql();
  const room = 97001;
  const user = `artifact-ocr-${Date.now()}`;
  await sql.query("insert into newsrooms(id,name) values($1,'Artifact OCR room') on conflict(id) do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
  const [inv] = await sql<{ id: number }>`insert into investigations(user_id,newsroom_id,title) values(${user},${room},'Packet') returning id`;
  const original = "Original pages one through twelve stay here.";
  const [version] = await sql<{ id: number }>`
    insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome,content_type,extraction_method)
    values(${user},${room},'https://example.org/packet.pdf','packet-hash','Packet',${original},200,'fetched','application/pdf','ocr-pages-partial:Claude:12/14') returning id
  `;
  const [artifact] = await sql<{ id: number }>`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,classification,fetch_status,fetch_outcome,version_id,extraction_method)
    values(${user},${room},${inv!.id},'https://example.org/packet.pdf','Packet','packet-hash',${original},'discovered',200,'fetched',${version!.id},'ocr-pages-partial:Claude:12/14') returning id
  `;
  const raw = Buffer.from("%PDF-retained-original");
  await sql`insert into artifact_blobs(version_id,user_id,newsroom_id,sha256,mime,original_url,byte_length,body_b64) values(${version!.id},${user},${room},'raw-hash','application/pdf','https://example.org/packet.pdf',${raw.byteLength},${raw.toString("base64")})`;
  const request = JSON.stringify({ artifactId: artifact!.id, start: 13, end: 13, modelChoice: "claude-frontier" });
  const calls: { provider?: string; start?: number; end?: number }[] = [];
  const run = async (id: number, claimToken: string) => performArtifactOcrWork({ id, user_id: user, newsroom_id: room, kind: "artifact-ocr", subject_id: artifact!.id, model_choice: "claude-frontier", claim_token: claimToken } as never, {
    ocr: async (_bytes, options) => {
      calls.push({ provider: options?.provider, start: options?.pageRange?.start, end: options?.pageRange?.end });
      return { text: `Page thirteen${String.fromCharCode(0)} transcript.`, pages: [{ page: 13, text: `Page thirteen${String.fromCharCode(0)} transcript.` }], provider: "Claude", pagesRead: 1, pagesTotal: 14 };
    },
  });
  let finalJobId = 0;
  for (let n = 0; n < 2; n++) {
    const claimToken = `claim-${n}`;
    const [job] = await sql<{ id: number }>`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,status,claim_token,result_json) values(${user},${room},'artifact-ocr',${artifact!.id},'claude-frontier','running',${claimToken},${request}) returning id`;
    finalJobId = job!.id;
    await run(job!.id, claimToken);
    // The queue marks a successful worker complete before another read is allowed.
    await sql`update desk_jobs set status='completed', finished_at=now(), claim_token=null where id=${job!.id}`;
  }
  assert.deepEqual(calls, [{ provider: "claude-frontier", start: 13, end: 13 }, { provider: "claude-frontier", start: 13, end: 13 }]);
  const chunks = await sql<{ excerpt: string; page_number: number }>`select excerpt,page_number from artifact_chunks where version_id=${version!.id} and section='editor-requested OCR'`;
  assert.deepEqual(chunks, [{ excerpt: "Page thirteen transcript.", page_number: 13 }]);
  const [saved] = await sql<{ full_text: string }>`select full_text from artifact_versions where id=${version!.id}`;
  const [blob] = await sql<{ body_b64: string }>`select body_b64 from artifact_blobs where version_id=${version!.id}`;
  assert.equal(saved!.full_text, original);
  assert.equal(blob!.body_b64, raw.toString("base64"));
  const [receipt] = await sql<{ result_json: string }>`select result_json from desk_jobs where id=${finalJobId}`;
  assert.deepEqual(JSON.parse(receipt!.result_json), {
    artifactId: artifact!.id, start: 13, end: 13,
    pages: [{ page: 13, text: "Page thirteen transcript." }],
    pagesRead: 1, pagesTotal: 14, provider: "Claude", reason: null,
  });
});
