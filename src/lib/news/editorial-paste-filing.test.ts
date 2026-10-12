import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql } from "../db.ts";
import type { Editorial } from "./editorial.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { ensureEditorialSchema, fileEditorial } from "./editorial.server.ts";
// Same fixture as editorial-result-persistence.test.ts: this file needs the
// migrated schema (`drafts.model_body`, `editorial_extras`) and asks for it.
await applyMigrationsToTestPglite();

/*
  FC04 root cause: "Paste a piece I wrote" files through fileEditorial with
  sourceKind "written-by-the-editor". No model wrote that text, so the draft
  must not carry a model body. An AI-drafted opinion piece keeps its body.
*/
const PIECE: Editorial = {
  headline: "Keep local history public",
  body: "The city archive is the only place a resident can check what the council promised.",
  appendix: "",
  factSheet: "",
  imagePrompt: "",
};

function uniqueUser(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()}`;
}

async function cleanDrafts(userId: string) {
  const sql = await getSql();
  await sql`
    delete from editorial_extras
    where draft_id in (select id from drafts where user_id = ${userId})
  `;
  await sql`delete from drafts where user_id = ${userId}`;
}

describe("Filing an editorial's model body", () => {
  it("stores no model_body for a piece the editor pasted in", async () => {
    const sql = await getSql();
    await ensureEditorialSchema();
    const userId = uniqueUser("paste-filing");

    try {
      const result = await fileEditorial(
        {
          userId,
          newsroomId: 1,
          subject: PIECE.headline,
          pointers: [],
          sourceKind: "written-by-the-editor",
          sourceRef: "pasted into the Opinion desk",
        },
        PIECE,
      );
      assert.equal(result.ok, true);
      if (!result.ok) assert.fail((result as { error: string }).error);

      const [draft] = await sql<{ body: string; model_body: string | null }>`
        select body, model_body from drafts where id = ${result.draftId}
      `;
      assert.equal(draft.body, PIECE.body, "the pasted text is still filed as the draft body");
      assert.equal(
        draft.model_body,
        null,
        "a pasted piece no model wrote stores no model body",
      );
    } finally {
      await cleanDrafts(userId);
    }
  });

  it("keeps the model body of an AI-drafted piece exactly as before", async () => {
    const sql = await getSql();
    await ensureEditorialSchema();
    const userId = uniqueUser("ai-filing");

    try {
      const result = await fileEditorial(
        {
          userId,
          newsroomId: 1,
          subject: PIECE.headline,
          pointers: [],
          sourceKind: "paste",
          sourceRef: "desk",
        },
        PIECE,
        "claude-frontier",
      );
      assert.equal(result.ok, true);
      if (!result.ok) assert.fail((result as { error: string }).error);

      const [draft] = await sql<{ body: string; model_body: string | null }>`
        select body, model_body from drafts where id = ${result.draftId}
      `;
      assert.equal(
        draft.model_body,
        PIECE.body,
        "a model-written piece keeps its model body, word for word",
      );
    } finally {
      await cleanDrafts(userId);
    }
  });
});
