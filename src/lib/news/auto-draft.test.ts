import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { getSql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { AUTO_DRAFT_SCORE_THRESHOLD, autoDraftEligibleLeads } from "./auto-draft.server.ts";

// The rule is exercised against the real migrated schema: `leads`, `drafts` and
// `desk_jobs` all have columns the selection reads, and a hand-built copy that
// missed one would prove nothing.
await applyMigrationsToTestPglite();

const NEWSROOM = 914_001;

async function reset() {
  const sql = await getSql();
  await sql`delete from desk_jobs where newsroom_id = ${NEWSROOM}`;
  await sql`delete from drafts where newsroom_id = ${NEWSROOM}`;
  await sql`delete from leads where newsroom_id = ${NEWSROOM}`;
}

async function fileLead(opts: {
  headline: string;
  score: number | null;
  status?: string;
}): Promise<number> {
  const sql = await getSql();
  const [row] = await sql<{ id: number }>`
    insert into leads (user_id, newsroom_id, headline, why, topic, status, newsworthiness)
    values ('owner', ${NEWSROOM}, ${opts.headline}, 'the reason it matters', 'council',
            ${opts.status ?? "new"}, ${opts.score})
    returning id
  `;
  return Number(row.id);
}

async function fileDraft(leadId: number, body: string) {
  const sql = await getSql();
  await sql`
    insert into drafts (user_id, newsroom_id, lead_id, headline, body, topic)
    values ('owner', ${NEWSROOM}, ${leadId}, 'A draft', ${body}, 'council')
  `;
}

async function fileJob(leadId: number, status: string) {
  const sql = await getSql();
  await sql`
    insert into desk_jobs (newsroom_id, user_id, kind, subject_id, status, model_choice)
    values (${NEWSROOM}, 'owner', 'draft', ${leadId}, ${status}, 'auto')
  `;
}

/** A commit stand-in that records what it was asked to draft. */
function recorder(opts: { refuse?: number } = {}) {
  const asked: number[] = [];
  const commitDraft = async (input: { leadId: number }) => {
    asked.push(input.leadId);
    if (opts.refuse === input.leadId)
      return { ok: false as const, kind: "not-ready", error: "No model is ready." };
    return { ok: true as const };
  };
  return { asked, commitDraft };
}

describe("the automatic draft rule (Scott: 14 and up)", () => {
  beforeEach(reset);

  it("drafts a lead at 14 and one above it, never one at 13", async () => {
    const fourteen = await fileLead({ headline: "At the line", score: AUTO_DRAFT_SCORE_THRESHOLD });
    const thirteen = await fileLead({ headline: "Below the line", score: 13 });
    const twenty = await fileLead({ headline: "The biggest story", score: 20 });

    const { asked, commitDraft } = recorder();
    const outcome = await autoDraftEligibleLeads(
      await getSql(),
      { userId: "owner", newsroomId: NEWSROOM },
      { commitDraft },
    );

    assert.deepEqual(asked, [twenty, fourteen], "highest score first, and 13 never asked");
    assert.equal(outcome.considered, 2);
    assert.equal(outcome.queued, 2);
    assert.equal(outcome.refused, 0);
    assert.ok(!asked.includes(thirteen));
  });

  it("skips a killed, held, published or already-drafted lead", async () => {
    const killed = await fileLead({ headline: "Killed", score: 18, status: "killed" });
    const held = await fileLead({ headline: "Held", score: 18, status: "held" });
    const published = await fileLead({ headline: "Published", score: 18, status: "published" });
    const drafted = await fileLead({ headline: "Drafted", score: 18, status: "drafted" });
    const open = await fileLead({ headline: "Open", score: 18 });

    const { asked, commitDraft } = recorder();
    const outcome = await autoDraftEligibleLeads(
      await getSql(),
      { userId: "owner", newsroomId: NEWSROOM },
      { commitDraft },
    );

    assert.deepEqual(asked, [open]);
    assert.equal(outcome.considered, 1);
    for (const id of [killed, held, published, drafted]) assert.ok(!asked.includes(id));
  });

  it("skips a lead that already carries a written draft", async () => {
    const written = await fileLead({ headline: "Already written", score: 18 });
    await fileDraft(written, "The body of the story is here.");
    const blank = await fileLead({ headline: "Only a placeholder", score: 18 });
    await fileDraft(blank, "   ");

    const { asked, commitDraft } = recorder();
    await autoDraftEligibleLeads(
      await getSql(),
      { userId: "owner", newsroomId: NEWSROOM },
      { commitDraft },
    );

    assert.deepEqual(asked, [blank], "a whitespace-only placeholder is not a draft");
  });

  it("skips a lead whose draft job is still queued or running", async () => {
    const queued = await fileLead({ headline: "Queued", score: 18 });
    await fileJob(queued, "queued");
    const running = await fileLead({ headline: "Running", score: 18 });
    await fileJob(running, "running");
    // A finished job is not an open one: a lead whose draft failed is allowed
    // to be tried again, which is what "no OPEN draft job" means.
    const finished = await fileLead({ headline: "Finished", score: 18 });
    await fileJob(finished, "failed");

    const { asked, commitDraft } = recorder();
    await autoDraftEligibleLeads(
      await getSql(),
      { userId: "owner", newsroomId: NEWSROOM },
      { commitDraft },
    );

    assert.deepEqual(asked, [finished]);
  });

  it("keeps a refusal note on the refused lead and drafts the rest", async () => {
    const refused = await fileLead({ headline: "No model for this one", score: 19 });
    const healthy = await fileLead({ headline: "Draft this one", score: 15 });

    const { asked, commitDraft } = recorder({ refuse: refused });
    const outcome = await autoDraftEligibleLeads(
      await getSql(),
      { userId: "owner", newsroomId: NEWSROOM },
      { commitDraft },
    );

    assert.deepEqual(asked, [refused, healthy], "the refusal did not stop the sweep");
    assert.equal(outcome.queued, 1);
    assert.equal(outcome.refused, 1);

    const sql = await getSql();
    const [stored] = await sql<{ notes_json: string }>`
      select notes_json from leads where id = ${refused}
    `;
    const notes = JSON.parse(stored.notes_json) as {
      lastDraftRefusal?: { text: string; at: string };
    };
    assert.equal(notes.lastDraftRefusal?.text, "No model is ready.");
    assert.ok(!Number.isNaN(Date.parse(notes.lastDraftRefusal?.at ?? "")));
  });

  it("goes on when one lead's commit throws outright", async () => {
    const broken = await fileLead({ headline: "The commit blows up", score: 19 });
    const healthy = await fileLead({ headline: "This one still drafts", score: 15 });

    const asked: number[] = [];
    const commitDraft = async (input: { leadId: number }) => {
      asked.push(input.leadId);
      if (input.leadId === broken) throw new Error("provider exploded");
      return { ok: true as const };
    };
    const outcome = await autoDraftEligibleLeads(
      await getSql(),
      { userId: "owner", newsroomId: NEWSROOM },
      { commitDraft },
    );

    assert.deepEqual(asked, [broken, healthy]);
    assert.equal(outcome.queued, 1);
    assert.equal(outcome.refused, 1);
  });

  it("never drafts a lead from another newsroom", async () => {
    const sql = await getSql();
    const [other] = await sql<{ id: number }>`
      insert into leads (user_id, newsroom_id, headline, why, topic, status, newsworthiness)
      values ('owner', ${NEWSROOM + 1}, 'Elsewhere', 'why', 'council', 'new', 20)
      returning id
    `;
    try {
      const { asked, commitDraft } = recorder();
      await autoDraftEligibleLeads(
        await getSql(),
        { userId: "owner", newsroomId: NEWSROOM },
        { commitDraft },
      );
      assert.deepEqual(asked, []);
    } finally {
      await sql`delete from leads where id = ${Number(other.id)}`;
    }
  });
});
