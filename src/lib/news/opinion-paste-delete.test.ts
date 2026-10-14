import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";

/**
 * THU-12: "Paste a piece I wrote".
 *
 * The owner pasted a real column and hit two defects:
 *
 *  (a) the row's "Claims missing" flag cleared only when a source line was
 *      written in the model's own exact shape, `Source: URL (accessed date)`.
 *      His sources read `Source: example.org/record` and `see
 *      www.example.org/record` -- a URL to a person -- and the piece was held.
 *      Any line that names a web address is a source line.
 *  (b) pressing Delete left the piece on the Opinion desk. The desk lists
 *      REQUEST rows, and deleting the draft only DETACHED its request, so a
 *      shell with a subject and a time and no piece stayed.
 *
 * These are behavior tests against the real functions and real PGlite rows.
 * Neither pins source text; the delete test drives the same rows the list
 * query reads and asks the desk's own visibility rule what it shows.
 */

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let editorialSourcesError: typeof import("./editorial.ts").editorialSourcesError;
let fileEditorial: typeof import("./editorial.server.ts").fileEditorial;
let parseEditorial: typeof import("./editorial.ts").parseEditorial;
let editorialRequestShowsOnDesk: typeof import("./opinion.ts").editorialRequestShowsOnDesk;
let repointRequests: typeof import("./trash-store.ts").repointRequests;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ editorialSourcesError, parseEditorial } = await vite.ssrLoadModule("/src/lib/news/editorial.ts"));
  ({ fileEditorial } = await vite.ssrLoadModule("/src/lib/news/editorial.server.ts"));
  ({ editorialRequestShowsOnDesk } = await vite.ssrLoadModule("/src/lib/news/opinion.ts"));
  ({ repointRequests } = await vite.ssrLoadModule("/src/lib/news/trash-store.ts"));
});

after(async () => vite.close());

describe("THU-12(a): a source line with any web address clears the Claims-missing flag", () => {
  const appendixFor = (sourceLine: string) => `CLAIMS AND SOURCES\n[claim] ${sourceLine}`;

  it("accepts the model's exact format, which still works", () => {
    assert.equal(
      editorialSourcesError(appendixFor("Source: https://example.org/record (accessed 2026-01-01)")),
      null,
    );
  });

  it("accepts a bare host with a path, the way an editor writes it", () => {
    assert.equal(editorialSourcesError(appendixFor("Source: example.org/record")), null);
    assert.equal(editorialSourcesError(appendixFor("see www.example.org/record")), null);
    assert.equal(editorialSourcesError(appendixFor("Source: city.gov")), null);
    assert.equal(editorialSourcesError(appendixFor("bouldercounty.gov/budget/2026")), null);
  });

  it("still holds a piece whose appendix names no source at all", () => {
    assert.match(
      editorialSourcesError(appendixFor("the council did it on Tuesday")) ?? "",
      /supporting links/,
      "prose with no address is not a source line",
    );
  });
});

describe("THU-12(b): Delete removes a pasted piece from the desk list", () => {
  let sequence = 77400;

  /** A pasted piece filed the way `fileWrittenEditorial` files one. */
  async function pastedPiece() {
    const sql = await getSql();
    const newsroomId = sequence++;
    const userId = `paste-delete-${newsroomId}`;
    await sql.query("delete from editorial_requests where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from editorial_extras where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from drafts where newsroom_id=$1", [newsroomId]);
    await sql.query("delete from newsroom_members where newsroom_id=$1", [newsroomId]);
    await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,'editor',$2)", [
      userId,
      newsroomId,
    ]);

    const text = [
      "The rail district wants your money twice",
      "",
      "Longmont has been paying for a train since 2004. The train has not come.",
      "",
      "CLAIMS AND SOURCES",
      "",
      "[FasTracks tax] Source: rtd-denver.com/fastracks",
    ].join("\n");
    const ed = parseEditorial(text);
    const filed = await fileEditorial(
      {
        userId,
        newsroomId,
        subject: ed.headline,
        pointers: [],
        sourceKind: "written-by-the-editor",
        sourceRef: "pasted into the Opinion desk",
      },
      ed,
    );
    assert.equal(filed.ok, true, filed.ok ? "" : filed.error);
    const draftId = (filed as { draftId: number }).draftId;
    // The marker row `fileWrittenEditorial` writes, so the piece has a row to
    // be deleted FROM.
    await sql.query(
      `insert into editorial_requests
        (user_id, newsroom_id, subject, source_kind, source_ref, draft_id, finished_at)
        values ($1,$2,$3,'written-by-the-editor',$4,$5, now())`,
      [userId, newsroomId, ed.headline, "pasted into the Opinion desk", draftId],
    );
    const rows = await sql.query<{ id: number; source_kind: string; draft_id: number | null }>(
      "select id, source_kind, draft_id from editorial_requests where newsroom_id=$1",
      [newsroomId],
    );
    return { sql, newsroomId, userId, draftId, request: rows[0]! };
  }

  it("hides the piece the moment its draft is deleted, and Undo can still put it back", async () => {
    const { sql, newsroomId, userId, draftId, request } = await pastedPiece();

    assert.equal(
      editorialRequestShowsOnDesk(request),
      true,
      "the piece is on the desk while it has a draft",
    );

    // What `deleteEditorial` does to the request: the pointer is nulled so the
    // snapshot keeps the ids for Undo (`keepACopy` + `repointRequests`).
    await sql.query(
      "update editorial_requests set draft_id = null where draft_id = $1 and newsroom_id = $2",
      [draftId, newsroomId],
    );

    const [detached] = await sql.query<{ id: number; source_kind: string; draft_id: number | null }>(
      "select id, source_kind, draft_id from editorial_requests where newsroom_id=$1",
      [newsroomId],
    );
    assert.equal(detached!.draft_id, null, "the draft pointer is cleared");
    assert.equal(
      editorialRequestShowsOnDesk(detached!),
      false,
      "the pasted piece is gone from the desk list at once",
    );

    // Undo relinks the surviving request row, so the piece comes back.
    await repointRequests(sql, draftId, [request.id]);
    const [relinked] = await sql.query<{ id: number; source_kind: string; draft_id: number | null }>(
      "select id, source_kind, draft_id from editorial_requests where newsroom_id=$1",
      [newsroomId],
    );
    assert.equal(relinked!.draft_id, draftId, "Undo points the request at the restored draft again");
    assert.equal(editorialRequestShowsOnDesk(relinked!), true, "and the piece is back on the desk");
    void userId;
  });

  it("still shows a desk-written request that finished with no draft, so Clear can remove it", () => {
    assert.equal(
      editorialRequestShowsOnDesk({ source_kind: "note", draft_id: null }),
      true,
      "a request the desk wrote and that failed is clearable, not hidden",
    );
  });
});
