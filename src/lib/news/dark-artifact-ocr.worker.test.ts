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
let initialModelRuntimeReceipt: typeof import("./model-runtime-receipt.ts").initialModelRuntimeReceipt;

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
  ({ initialModelRuntimeReceipt } = await vite.ssrLoadModule("/src/lib/news/model-runtime-receipt.ts"));
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
  /*
    B5. The production enqueue writes the request nested under a model-runtime
    snapshot, exactly as `queueArtifactOcr` does, so the terminal write's merge
    preserves the snapshot rather than the bare request.
  */
  const enqueueReceipt = JSON.stringify({
    request: { artifactId: artifact!.id, start: 13, end: 13, modelChoice: "claude-frontier", modelEffort: "medium", mode: "range" },
    ...initialModelRuntimeReceipt({
      requestedRuntime: "claude-frontier",
      requestedEffort: "medium",
      actualRuntime: "claude-frontier",
      actualEffort: "medium",
      localModel: null,
    }),
  });
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
    const [job] = await sql<{ id: number }>`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,status,claim_token,result_json) values(${user},${room},'artifact-ocr',${artifact!.id},'claude-frontier','running',${claimToken},${enqueueReceipt}) returning id`;
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
    // The B5 enqueue snapshot survives the terminal write, key for key.
    requestedRuntime: "claude-frontier",
    requestedEffort: "medium",
    actualRuntime: "claude-frontier",
    modelEffort: "medium",
    preflightFailover: null,
    request: {
      artifactId: artifact!.id,
      start: 13,
      end: 13,
      modelChoice: "claude-frontier",
      modelEffort: "medium",
      mode: "range",
    },
    artifactId: artifact!.id, start: 13, end: 13,
    mode: "range",
    pages: [{ page: 13, text: "Page thirteen transcript." }],
    pagesRead: 1,
    pagesTotal: 14,
    batchesCompleted: 1,
    batchesTotal: 1,
    unreadPages: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14],
    modelCalls: 1,
    budgetPaused: false,
    provider: "Claude",
    reason: null,
  });
});

test("retained-PDF OCR sends the exact saved local endpoint and model", async () => {
  const sql = await getSql();
  const room = 97005;
  const user = `artifact-ocr-local-${Date.now()}`;
  const selected = { baseUrl: "http://127.0.0.1:11434/v1", id: "loaded-vision-model" };
  await sql.query("insert into newsrooms(id,name) values($1,'Local OCR room') on conflict(id) do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
  const [inv] = await sql<{ id: number }>`insert into investigations(user_id,newsroom_id,title) values(${user},${room},'Local packet') returning id`;
  const [version] = await sql<{ id: number }>`
    insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome,content_type,extraction_method)
    values(${user},${room},'https://example.org/local.pdf','local-pdf-hash','Local packet','',200,'fetched','application/pdf','ocr-pages-partial:Local:0/1') returning id
  `;
  const [artifact] = await sql<{ id: number }>`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,classification,fetch_status,fetch_outcome,version_id,extraction_method)
    values(${user},${room},${inv!.id},'https://example.org/local.pdf','Local packet','local-pdf-hash','','discovered',200,'fetched',${version!.id},'ocr-pages-partial:Local:0/1') returning id
  `;
  const raw = Buffer.from("%PDF-local-ocr");
  await sql`insert into artifact_blobs(version_id,user_id,newsroom_id,sha256,mime,original_url,byte_length,body_b64) values(${version!.id},${user},${room},'local-raw-hash','application/pdf','https://example.org/local.pdf',${raw.byteLength},${raw.toString("base64")})`;
  const request = JSON.stringify({ artifactId: artifact!.id, start: 1, end: 1, modelChoice: "local-model" });
  const claimToken = "local-ocr-claim";
  const [job] = await sql<{ id: number }>`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,status,claim_token,result_json) values(${user},${room},'artifact-ocr',${artifact!.id},'local-model','running',${claimToken},${request}) returning id`;
  let received: { provider?: string; localModel?: typeof selected | null } | undefined;
  await performArtifactOcrWork({ id: job!.id, user_id: user, newsroom_id: room, kind: "artifact-ocr", subject_id: artifact!.id, model_choice: "local-model", claim_token: claimToken } as never, {
    resolveLocalModel: async (newsroomId, scope) => {
      assert.equal(newsroomId, room);
      assert.equal(scope, "ocr");
      return selected;
    },
    ocr: async (_bytes, options) => {
      received = { provider: options?.provider, localModel: options?.localModel };
      return { text: "Local packet page text.", pages: [{ page: 1, text: "Local packet page text." }], provider: "Local", pagesRead: 1, pagesTotal: 1 };
    },
  });
  assert.deepEqual(received, { provider: "local-model", localModel: selected });
  const [receipt] = await sql<{ result_json: string }>`select result_json from desk_jobs where id=${job!.id}`;
  assert.equal(JSON.parse(receipt!.result_json).modelId, selected.id);
  assert.equal(JSON.parse(receipt!.result_json).modelEndpoint, selected.baseUrl);
});

test("complete packet OCR resumes after retained pages and checkpoints every bounded batch", async () => {
  const sql = await getSql();
  const room = 97002;
  const user = `artifact-ocr-complete-${Date.now()}`;
  await sql.query("insert into newsrooms(id,name) values($1,'Complete OCR room') on conflict(id) do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
  const [inv] = await sql<{ id: number }>`insert into investigations(user_id,newsroom_id,title) values(${user},${room},'Complete packet') returning id`;
  const [version] = await sql<{ id: number }>`
    insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome,content_type,extraction_method,page_count)
    values(${user},${room},'https://example.org/complete.pdf','complete-hash','Complete packet','Pages 1-12 already retained',200,'fetched','application/pdf','ocr-pages-partial:Codex:12/30',30) returning id
  `;
  const [artifact] = await sql<{ id: number }>`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,classification,fetch_status,fetch_outcome,version_id,extraction_method)
    values(${user},${room},${inv!.id},'https://example.org/complete.pdf','Complete packet','complete-hash','Pages 1-12 already retained','discovered',200,'fetched',${version!.id},'ocr-pages-partial:Codex:12/30') returning id
  `;
  for (let page = 1; page <= 12; page++) {
    const excerpt = `Previously retained page ${page}`;
    await sql`
      insert into artifact_chunks(version_id,user_id,newsroom_id,chunk_index,page_number,section,excerpt,locator)
      values(${version!.id},${user},${room},${page - 1},${page},'',${excerpt},${`page:${page}`})
    `;
  }
  const raw = Buffer.from("%PDF-retained-complete-packet");
  await sql`insert into artifact_blobs(version_id,user_id,newsroom_id,sha256,mime,original_url,byte_length,body_b64) values(${version!.id},${user},${room},'complete-raw-hash','application/pdf','https://example.org/complete.pdf',${raw.byteLength},${raw.toString("base64")})`;
  const request = JSON.stringify({ artifactId: artifact!.id, start: 1, end: 1, modelChoice: "codex-balanced", mode: "complete" });
  const claimToken = "complete-claim";
  const [job] = await sql<{ id: number }>`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,status,claim_token,result_json) values(${user},${room},'artifact-ocr',${artifact!.id},'codex-balanced','running',${claimToken},${request}) returning id`;
  const calls: Array<{ start?: number; end?: number }> = [];
  await performArtifactOcrWork({ id: job!.id, user_id: user, newsroom_id: room, kind: "artifact-ocr", subject_id: artifact!.id, model_choice: "codex-balanced", claim_token: claimToken } as never, {
    pageCount: async () => 30,
    ocr: async (_bytes, options) => {
      const start = options?.pageRange?.start ?? 0;
      const end = options?.pageRange?.end ?? 0;
      calls.push({ start, end });
      const pages = Array.from({ length: end - start + 1 }, (_, index) => ({
        page: start + index,
        text: `Retained OCR text for page ${start + index}.`,
      }));
      return {
        text: pages.map((page) => page.text).join("\n\n"),
        pages,
        provider: "Codex",
        pagesRead: pages.length,
        pagesTotal: 30,
      };
    },
  });

  assert.deepEqual(calls, [{ start: 13, end: 24 }, { start: 25, end: 30 }]);
  const savedPages = await sql<{ page_number: number }>`
    select distinct page_number from artifact_chunks
    where version_id=${version!.id} and page_number is not null order by page_number
  `;
  assert.deepEqual(savedPages.map((row) => row.page_number), Array.from({ length: 30 }, (_, index) => index + 1));
  const [savedVersion] = await sql<{ extraction_method: string; page_count: number }>`
    select extraction_method,page_count from artifact_versions where id=${version!.id}
  `;
  assert.deepEqual(savedVersion, { extraction_method: "ocr-pages:Codex:30/30", page_count: 30 });
  const [receipt] = await sql<{ result_json: string }>`select result_json from desk_jobs where id=${job!.id}`;
  const parsed = JSON.parse(receipt!.result_json);
  assert.equal(parsed.mode, "complete");
  assert.equal(parsed.pagesRead, 30);
  assert.equal(parsed.pagesTotal, 30);
  assert.equal(parsed.batchesCompleted, 2);
  assert.equal(parsed.batchesTotal, 2);
  assert.equal(parsed.modelCalls, 18);
  assert.equal(parsed.budgetPaused, false);
  assert.deepEqual(parsed.unreadPages, []);
});

test("a replaced OCR worker cannot mutate retained evidence at checkpoint", async () => {
  const sql = await getSql();
  const room = 97003;
  const user = `artifact-ocr-claim-${Date.now()}`;
  await sql.query("insert into newsrooms(id,name) values($1,'OCR claim room') on conflict(id) do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
  const [inv] = await sql<{ id: number }>`insert into investigations(user_id,newsroom_id,title) values(${user},${room},'Claim race') returning id`;
  const [version] = await sql<{ id: number }>`
    insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome,content_type,extraction_method)
    values(${user},${room},'https://example.org/claim.pdf','claim-hash','Claim packet','Original retained text',200,'fetched','application/pdf','ocr-pages-partial:Codex:0/2') returning id
  `;
  const [artifact] = await sql<{ id: number }>`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,classification,fetch_status,fetch_outcome,version_id,extraction_method)
    values(${user},${room},${inv!.id},'https://example.org/claim.pdf','Claim packet','claim-hash','Original retained text','discovered',200,'fetched',${version!.id},'ocr-pages-partial:Codex:0/2') returning id
  `;
  const raw = Buffer.from("%PDF-retained-claim-packet");
  await sql`insert into artifact_blobs(version_id,user_id,newsroom_id,sha256,mime,original_url,byte_length,body_b64) values(${version!.id},${user},${room},'claim-raw-hash','application/pdf','https://example.org/claim.pdf',${raw.byteLength},${raw.toString("base64")})`;
  const request = JSON.stringify({ artifactId: artifact!.id, start: 1, end: 2, modelChoice: "codex-balanced", mode: "range" });
  const claimToken = "old-claim";
  const [job] = await sql<{ id: number }>`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,status,claim_token,result_json) values(${user},${room},'artifact-ocr',${artifact!.id},'codex-balanced','running',${claimToken},${request}) returning id`;

  await assert.rejects(
    performArtifactOcrWork({ id: job!.id, user_id: user, newsroom_id: room, kind: "artifact-ocr", subject_id: artifact!.id, model_choice: "codex-balanced", claim_token: claimToken } as never, {
      ocr: async () => ({
        text: "Competing worker page text.",
        pages: [{ page: 1, text: "Competing worker page text." }],
        provider: "Codex",
        pagesRead: 1,
        pagesTotal: 2,
        modelCalls: 1,
      }),
      beforeCheckpoint: async () => {
        await sql`update desk_jobs set claim_token='replacement-claim' where id=${job!.id}`;
      },
    }),
    /replaced by a newer worker/i,
  );

  const chunks = await sql<{ count: number }>`select count(*)::int as count from artifact_chunks where version_id=${version!.id}`;
  assert.equal(chunks[0]?.count, 0);
  const [saved] = await sql<{ extraction_method: string }>`select extraction_method from artifact_versions where id=${version!.id}`;
  assert.equal(saved!.extraction_method, "ocr-pages-partial:Codex:0/2");
});

/*
  Unit U11b2: a PDF read must not write passages back onto a capture the owner
  has taken down.

  The purge empties every `artifact_chunks` excerpt of a taken-down version. An
  OCR job that was already queued when the takedown happened would otherwise
  land afterwards with model-read text from the publisher's page and refill the
  table the purge had just cleared -- the evidence page would say the excerpt
  was removed while the database held it again. The read still finishes (its
  bookkeeping is not this capture's text), and it adds nothing.
*/
test("an OCR read adds no passages to a capture that has been taken down", async () => {
  const sql = await getSql();
  const room = 97004;
  const user = `artifact-ocr-takedown-${Date.now()}`;
  await sql.query("insert into newsrooms(id,name) values($1,'Takedown OCR room') on conflict(id) do nothing", [room]);
  await sql.query("insert into newsroom_members(user_id,newsroom_id,role) values($1,$2,'editor')", [user, room]);
  const [inv] = await sql<{ id: number }>`insert into investigations(user_id,newsroom_id,title) values(${user},${room},'Removed packet') returning id`;
  /* The capture as it stands after a takedown: no text, no passages, marked. */
  const [version] = await sql<{ id: number }>`
    insert into artifact_versions(user_id,newsroom_id,url,content_hash,title,full_text,fetch_status,fetch_outcome,content_type,extraction_method,taken_down_at,taken_down_reason)
    values(${user},${room},'https://example.org/removed.pdf','removed-hash','Removed packet','',200,'fetched','application/pdf','ocr-pages-partial:Claude:0/2',now(),'Publisher asked.') returning id
  `;
  const [artifact] = await sql<{ id: number }>`
    insert into artifacts(user_id,newsroom_id,investigation_id,url,title,content_hash,full_text,classification,fetch_status,fetch_outcome,version_id,extraction_method)
    values(${user},${room},${inv!.id},'https://example.org/removed.pdf','Removed packet','removed-hash','','discovered',200,'fetched',${version!.id},'ocr-pages-partial:Claude:0/2') returning id
  `;
  const raw = Buffer.from("%PDF-removed-packet");
  await sql`insert into artifact_blobs(version_id,user_id,newsroom_id,sha256,mime,original_url,byte_length,body_b64) values(${version!.id},${user},${room},'removed-raw-hash','application/pdf','https://example.org/removed.pdf',${raw.byteLength},${raw.toString("base64")})`;
  const request = JSON.stringify({ artifactId: artifact!.id, start: 1, end: 2, modelChoice: "claude-frontier", mode: "range" });
  const claimToken = "takedown-claim";
  const [job] = await sql<{ id: number }>`insert into desk_jobs(user_id,newsroom_id,kind,subject_id,model_choice,status,claim_token,result_json) values(${user},${room},'artifact-ocr',${artifact!.id},'claude-frontier','running',${claimToken},${request}) returning id`;

  await performArtifactOcrWork({ id: job!.id, user_id: user, newsroom_id: room, kind: "artifact-ocr", subject_id: artifact!.id, model_choice: "claude-frontier", claim_token: claimToken } as never, {
    ocr: async () => ({
      text: "Model-read text from the publisher's page.",
      pages: [
        { page: 1, text: "Model-read text from the publisher's page." },
        { page: 2, text: "More model-read text." },
      ],
      provider: "Claude",
      pagesRead: 2,
      pagesTotal: 2,
      modelCalls: 1,
    }),
  });

  const chunks = await sql<{ count: number }>`select count(*)::int as count from artifact_chunks where version_id=${version!.id}`;
  assert.equal(chunks[0]?.count, 0, "a taken-down capture must gain no OCR passages");
  const [saved] = await sql<{ full_text: string }>`select full_text from artifact_versions where id=${version!.id}`;
  assert.equal(saved!.full_text, "", "and its purged text must stay purged");
});
