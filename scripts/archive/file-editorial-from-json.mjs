/**
 * File an editorial that was produced outside the desk.
 *
 * One-off recovery tool. A 24-minute, $23.76 run finished after the job that
 * asked for it had already been killed at the old timeout, so the piece existed
 * on disk with nothing pointing at it. This puts it on the Opinion desk as a
 * draft — never as a published story; publishing stays a person's click.
 *
 *   node scripts/file-editorial-from-json.mjs <cli-output.json> <userId> [requestId]
 */
import { readFileSync } from "node:fs";


const [, , jsonPath, userId, requestId] = process.argv;
if (!jsonPath || !userId) {
  console.error("usage: file-editorial-from-json.mjs <cli-output.json> <userId> [requestId]");
  process.exit(1);
}

const { parseEditorial } = await import("../src/lib/news/editorial.ts");
const { fileEditorial } = await import("../src/lib/news/editorial.server.ts");
const { getSql } = await import("../src/lib/db.ts");

const envelope = JSON.parse(readFileSync(jsonPath, "utf8"));
const text = typeof envelope.result === "string" ? envelope.result : String(envelope);
const ed = parseEditorial(text);
if (!ed.body.trim()) {
  console.error("no body in that file");
  process.exit(1);
}

const result = await fileEditorial(
  {
    userId,
    newsroomId: 1,
    subject: ed.headline,
    pointers: [],
    sourceKind: "recovered",
    sourceRef: jsonPath,
  },
  ed,
);

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log(`draft ${result.draftId}: ${result.headline}`);
console.log(`${result.words} words, appendix: ${result.hadAppendix}`);

if (requestId) {
  const sql = await getSql();
  await sql`
    update editorial_requests
    set draft_id = ${result.draftId}, error = null, finished_at = now()
    where id = ${Number(requestId)}
  `;
  console.log(`request ${requestId} now points at draft ${result.draftId}`);
}
process.exit(0);
