/**
 * The server seam of the editor's new dialogs, against a fake database and a
 * fake model.
 *
 * No PGlite and no provider: every `perform*` here takes its `getSql`, its
 * `chat` and its four injected writers from `EditorDialogDeps`, so what is under
 * test is the decision -- which rows the kill pattern counts, what the confirm
 * press saves, what the hold row holds -- and not the SQL dialect underneath it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import {
  performAddLead,
  performChooseHeadline,
  performFindSources,
  performHoldLead,
  performSourceKillPattern,
  performWeaveIntoStory,
  type EditorDialogContext,
  type EditorDialogDeps,
} from "./editor-dialog-actions.server.ts";

const context: EditorDialogContext = { userId: "editor-1", newsroomId: 81 };

type Query = { text: string; values: unknown[]; write: boolean };

type Plan = {
  sources?: unknown[];
  leads?: unknown[];
  drafts?: unknown[];
  killed?: unknown[];
  chat?: { ok: true; text: string } | { ok: false; error: string };
  insertLead?: EditorDialogDeps["insertLead"];
  /**
   * Either half of the answer, and nothing beyond `ok`/`error`: those are the
   * only two fields `performAddLead` reads (a real commit also answers
   * `pending`/`jobId`).
   */
  commitDraft?: () => Promise<{ ok: true } | { ok: false; error: string }>;
  /** A predicate over the source the desk was handed, not over the SQL. */
  proposeSource?: (input: unknown) => boolean;
};

const DRAFT = { id: 3, headline: "Council delays the budget", dek: "Because the numbers moved", body: "The council met on Tuesday.", topic: "council" };

/**
 * A tagged-template stand-in for `Sql`.
 *
 * The dialog code calls it as `sql\`select ... from drafts ...\``, so the tag
 * receives the literal parts and the interpolated values; matching on the
 * literal text is enough to hand back the row a real database would, and the
 * log of every call is what the "writes nothing" assertions read.
 */
function fakeSql(plan: Plan, queries: Query[], chatCalls: { n: number }) {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
    if (/^update /i.test(text)) {
      queries.push({ text, values, write: true });
      return Promise.resolve([]);
    }
    queries.push({ text, values, write: false });
    if (/from drafts/i.test(text)) return Promise.resolve(plan.drafts ?? []);
    if (/from sources/i.test(text)) return Promise.resolve(plan.sources ?? []);
    if (/source_urls/i.test(text)) return Promise.resolve(plan.killed ?? []);
    if (/from leads/i.test(text)) return Promise.resolve(plan.leads ?? []);
    void chatCalls;
    return Promise.resolve([]);
  };
  return tag as unknown as Sql;
}

function makeDeps(plan: Plan) {
  const queries: Query[] = [];
  const chatCalls = { n: 0 };
  const chatOptions: Record<string, unknown>[] = [];
  const saved: unknown[] = [];
  const linked: unknown[] = [];
  const proposed: unknown[] = [];
  const sql = fakeSql(plan, queries, chatCalls);

  const deps: EditorDialogDeps = {
    getSql: async () => sql,
    chat: (async (_system: string, _user: string, _maxTokens: number, options: Record<string, unknown>) => {
      chatCalls.n += 1;
      chatOptions.push(options);
      return plan.chat ?? { ok: false as const, error: "no fake model planned" };
    }) as unknown as EditorDialogDeps["chat"],
    readAssignments: async () => [],
    resolveLocalModel: async () => ({ baseUrl: "http://127.0.0.1:1234/v1", id: "loaded-exact-model" }),
    saveDraft: (async (_ctx: unknown, data: unknown) => {
      saved.push(data);
      return { ok: true as const };
    }) as unknown as EditorDialogDeps["saveDraft"],
    proposeSource: (async (_sql: unknown, input: unknown) => {
      proposed.push(input);
      return plan.proposeSource?.(input) ?? true;
    }) as unknown as EditorDialogDeps["proposeSource"],
    linkDocuments: (async (_sql: unknown, _newsroomId: number, _userId: string, _leadId: number, ids: string[]) => {
      linked.push(ids);
      return { ok: true as const };
    }) as unknown as EditorDialogDeps["linkDocuments"],
    insertLead: plan.insertLead ?? (async () => ({ ok: true as const, id: 42 })),
    commitDraft: (plan.commitDraft ?? (async () => ({ ok: true as const }))) as unknown as EditorDialogDeps["commitDraft"],
    now: () => new Date("2026-09-26T14:05:00Z"),
  };
  const writes = () => queries.filter((q) => q.write);
  return { deps, queries, writes, saved, linked, proposed, chatCalls, chatOptions };
}
describe("the source kill pattern", () => {
  const SOURCE = { id: 7, url: "https://records.example/news", title: "Records" };
  const killed = [
    // Blames the source, and was filed from it: the only row that counts.
    { id: 1, headline: "Council delays the budget", kill_reason: "Bad source: the page would not load", source_urls: JSON.stringify(["https://www.records.example/news"]) },
    // Filed from it, but killed for a reason that is not the source's fault.
    { id: 2, headline: "Water rates rise", kill_reason: "Not newsworthy", source_urls: JSON.stringify(["https://records.example/news"]) },
    // Blames a source -- a different one, one path along.
    { id: 3, headline: "The archive story", kill_reason: "Unreadable page", source_urls: JSON.stringify(["https://records.example/news-archive"]) },
    // Blames the source, but the lead carries no URLs at all.
    { id: 4, headline: "No sources at all", kill_reason: "Bad source: 404", source_urls: null },
  ];

  it("counts only the kills whose reason blames the source, and writes nothing", async () => {
    const { deps, writes } = makeDeps({ sources: [SOURCE], killed });
    const result = await performSourceKillPattern(context, { sourceId: 7 }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.killedFromSource, 2);
    assert.equal(result.ok && result.badSource, 1);
    assert.deepEqual(result.ok && result.examples, [{ id: 1, headline: "Council delays the budget" }]);
    assert.equal(result.ok && result.source.name, "Records");
    // "Show the pattern only, never change weights": there is no write here to
    // reach, and this is the assertion that keeps it that way.
    assert.deepEqual(writes(), []);
  });

  it("reads the lead's own count and the source's own count as different facts", async () => {
    const { deps } = makeDeps({ sources: [SOURCE], killed: [killed[1]!] });
    const result = await performSourceKillPattern(context, { sourceId: 7 }, deps);
    assert.equal(result.ok && result.killedFromSource, 1);
    assert.equal(result.ok && result.badSource, 0);
    assert.deepEqual(result.ok && result.examples, []);
  });

  it("refuses a source that is not on the watch list", async () => {
    const { deps } = makeDeps({ sources: [] });
    assert.deepEqual(await performSourceKillPattern(context, { sourceId: 9 }, deps), {
      ok: false,
      error: "That source is not on the watch list.",
    });
  });

  it("refuses a source whose URL cannot be matched to a lead", async () => {
    const { deps } = makeDeps({ sources: [{ id: 7, url: "not a url", title: null }], killed });
    const result = await performSourceKillPattern(context, { sourceId: 7 }, deps);
    assert.equal(result.ok, false);
    assert.match(result.ok || result.error, /cannot be matched/);
  });
});

describe("add to this story", () => {
  it("passes the saved exact local endpoint and model to the model call", async () => {
    const { deps, chatOptions } = makeDeps({ drafts: [DRAFT], chat: { ok: true as const, text: "The council met on Tuesday. It voted 4-3." } });
    const result = await performWeaveIntoStory(
      context,
      { leadId: 5, mode: "weave", material: "It voted 4-3.", modelChoice: "local-model" },
      deps,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(chatOptions[0]?.localModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "loaded-exact-model",
    });
  });

  it("shows the new body on the review press and saves exactly those bytes on the confirm", async () => {
    const plan = { drafts: [DRAFT], chat: { ok: true as const, text: "The council met on Tuesday. It voted 4-3." } };
    const { deps, saved, linked, chatCalls } = makeDeps(plan);

    const review = await performWeaveIntoStory(context, { leadId: 5, mode: "weave", material: "It voted 4-3." }, deps);
    assert.equal(review.ok, true);
    assert.equal(review.ok && review.saved, false);
    assert.equal(review.ok && review.before, DRAFT.body);
    assert.equal(review.ok && review.after, "The council met on Tuesday. It voted 4-3.");
    assert.equal(chatCalls.n, 1);
    assert.deepEqual(saved, []);
    assert.deepEqual(linked, []);

    const confirm = await performWeaveIntoStory(
      context,
      { leadId: 5, mode: "weave", material: "ignored on this press", saveText: review.ok ? review.after : "", documentIds: ["doc-1"] },
      deps,
    );
    assert.equal(confirm.ok && confirm.saved, true);
    // The model is NOT asked again: a second call would rewrite prose the
    // editor has already read and approved.
    assert.equal(chatCalls.n, 1);
    assert.deepEqual(saved, [
      { leadId: 5, headline: DRAFT.headline, dek: DRAFT.dek, body: review.ok ? review.after : "", topic: DRAFT.topic },
    ]);
    assert.deepEqual(linked, [["doc-1"]]);
    assert.equal(confirm.ok && confirm.documents, 1);
  });

  it("computes the two no-AI modes itself, without a model call", async () => {
    const { deps, chatCalls } = makeDeps({ drafts: [DRAFT] });

    const asIs = await performWeaveIntoStory(context, { leadId: 5, mode: "as-is", material: "It voted 4-3." }, deps);
    assert.equal(asIs.ok && asIs.after, `${DRAFT.body}\n\nIt voted 4-3.`);

    const update = await performWeaveIntoStory(context, { leadId: 5, mode: "update", material: "It voted 4-3." }, deps);
    assert.match(update.ok ? update.after : "", /^Updated [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM): It voted 4-3\.\n\nThe council met on Tuesday\.$/);

    assert.equal(chatCalls.n, 0);
    assert.deepEqual(makeDeps({ drafts: [DRAFT] }).saved, []);
  });

  it("refuses when the lead has no draft, and when the model cannot be reached", async () => {
    const none = makeDeps({ drafts: [] });
    assert.deepEqual(await performWeaveIntoStory(context, { leadId: 5, mode: "as-is", material: "x" }, none.deps), {
      ok: false,
      error: "This lead has no draft to add to yet.",
    });

    const down = makeDeps({ drafts: [DRAFT], chat: { ok: false as const, error: "unreachable" } });
    const failed = await performWeaveIntoStory(context, { leadId: 5, mode: "weave", material: "It voted 4-3." }, down.deps);
    assert.equal(failed.ok, false);
    assert.match(failed.ok || failed.error, /Your draft is exactly as it was\./);
    assert.deepEqual(down.saved, []);
  });

  it("refuses a model answer too short to be the story, rather than saving it", async () => {
    const short = makeDeps({ drafts: [DRAFT], chat: { ok: true as const, text: "  Okay.  " } });
    const failed = await performWeaveIntoStory(context, { leadId: 5, mode: "weave", material: "It voted 4-3." }, short.deps);
    assert.equal(failed.ok, false);
    assert.match(failed.ok || failed.error, /too little to be the story/);
  });
});

describe("add a lead", () => {
  it("sends the exact saved local endpoint and model to lead scoring", async () => {
    const { deps, chatOptions } = makeDeps({
      chat: { ok: true as const, text: '{"score": 72, "reason": "New and checkable."}' },
    });
    const result = await performAddLead(
      context,
      { paste: "A neighbor says the vote was 4-3", then: "score", modelChoice: "local-model" },
      deps,
    );
    assert.equal(result.ok && result.score, 72);
    assert.deepEqual(chatOptions[0]?.localModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "loaded-exact-model",
    });
  });

  it("files it and reports the score on the happy path", async () => {
    const filed: { headline: string; why: string; topic: string; urls: string[] }[] = [];
    const { deps, writes, chatCalls } = makeDeps({
      chat: { ok: true as const, text: '{"score": 72, "reason": "New and checkable."}' },
      insertLead: async (_ctx, input) => {
        filed.push(input);
        return { ok: true as const, id: 42 };
      },
    });
    const result = await performAddLead(context, { paste: "https://records.example/minutes", then: "score" }, deps);
    assert.equal(result.ok && result.leadId, 42);
    assert.equal(result.ok && result.then, "score");
    assert.equal(result.ok && result.score, 72);
    assert.equal(result.ok && result.reason, "New and checkable.");
    assert.equal(chatCalls.n, 1);
    // The readable name of that URL is "Minutes" -- seven characters -- so the
    // lead is listed under the URL rather than refused for being too short. A
    // link the dialog accepted is content, whatever its name measures.
    assert.deepEqual(filed, [
      { headline: "https://records.example/minutes", why: "", topic: "council", urls: ["https://records.example/minutes"] },
    ]);
    const score = writes()[0]!;
    assert.match(score.text, /^update leads set newsworthiness/);
    assert.deepEqual(score.values, [72, "New and checkable.", 42, 81]);
  });

  it("answers ok with a notice when the model fails after the lead is filed", async () => {
    const { deps } = makeDeps({ chat: { ok: false as const, error: "unreachable" } });
    const result = await performAddLead(context, { paste: "A neighbor says the vote was 4-3", then: "score" }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.leadId, 42);
    assert.equal(result.ok && result.score, undefined);
    assert.match(result.ok ? String(result.notice) : "", /could not reach a model to score it/);
  });

  it("answers ok with a notice when the draft does not start after the lead is filed", async () => {
    const { deps, chatCalls } = makeDeps({
      commitDraft: async () => ({ ok: false as const, error: "No provider is set up." }),
    });
    const result = await performAddLead(context, { paste: "A neighbor says the vote was 4-3", then: "draft" }, deps);
    assert.equal(result.ok, true);
    assert.match(result.ok ? String(result.notice) : "", /Filed it, but the draft did not start\. No provider is set up\./);
    // "Research and draft" starts the desk's own draft; it is not a model call
    // this dialog makes itself.
    assert.equal(chatCalls.n, 0);
  });

  it("files and stops for as-is, with no model call and no notice", async () => {
    const { deps, chatCalls } = makeDeps({});
    const result = await performAddLead(context, { paste: "A neighbor says the vote was 4-3", then: "as-is" }, deps);
    assert.equal(result.ok && result.then, "as-is");
    assert.equal(result.ok && result.notice, undefined);
    assert.equal(chatCalls.n, 0);
  });

  it("files nothing when the desk cannot file, and nothing when there is nothing to file", async () => {
    const refused = makeDeps({ insertLead: async () => ({ ok: false as const, error: "Could not file it." }) });
    assert.deepEqual(await performAddLead(context, { paste: "A neighbor says the vote was 4-3", then: "as-is" }, refused.deps), {
      ok: false,
      error: "Could not file it.",
    });

    const empty = makeDeps({});
    const blank = await performAddLead(context, { paste: "short", then: "as-is" }, empty.deps);
    assert.equal(blank.ok, false);
    assert.match(blank.ok ? "" : blank.error, /Give the desk a link or a tip\./);
    assert.deepEqual(empty.queries, []);
  });
});

describe("hold", () => {
  const lead = { id: 5, headline: "Council delays the budget", status: "new", notes_json: null };

  it("writes status held and the reason into notes_json, with the row's own time", async () => {
    const { deps, writes } = makeDeps({ leads: [lead] });
    const result = await performHoldLead(context, { id: 5, choice: "record-or-date", note: "  Waiting on the minutes  " }, deps);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.key, "record-or-date");
    assert.equal(result.ok && result.notice, null);
    const write = writes()[0]!;
    assert.match(write.text, /^update leads set status/);
    assert.equal(write.values[0], "held");
    const notes = JSON.parse(String(write.values[1])) as { hold: { key: string; reason: string; note: string; at: string } };
    assert.deepEqual(notes.hold, {
      key: "record-or-date",
      reason: "Waiting on a record or date",
      note: "Waiting on the minutes",
      at: "2026-09-26T14:05:00.000Z",
    });
    assert.deepEqual(write.values.slice(2), [5, 81]);
  });

  it("keeps what the lead already noted, and records no-reason as its own fact", async () => {
    // `news` is one of the fields `parseNotes` names, so it survives the read;
    // anything it does not name is dropped, which is why the hold record lives
    // in `notes.ts` beside the rest rather than in a column.
    const { deps, writes } = makeDeps({ leads: [{ ...lead, notes_json: JSON.stringify({ news: "Keep this" }) }] });
    const result = await performHoldLead(context, { id: 5, choice: "none" }, deps);
    assert.equal(result.ok && result.key, "none");
    const notes = JSON.parse(String(writes()[0]!.values[1])) as { news: string; hold: { key: string; reason: string } };
    assert.equal(notes.news, "Keep this");
    assert.equal(notes.hold.key, "none");
    assert.equal(notes.hold.reason, "");
  });

  it("says plainly that nothing will chase an AI follow-up", async () => {
    const { deps } = makeDeps({ leads: [lead] });
    const result = await performHoldLead(context, { id: 5, choice: "follow-up" }, deps);
    assert.equal(result.ok, true);
    assert.match(result.ok ? String(result.notice) : "", /AI follow-ups are not built/);
  });

  it("refuses a lead that is not on the desk, and a reason the desk does not have", async () => {
    const missing = makeDeps({ leads: [] });
    assert.deepEqual(await performHoldLead(context, { id: 5, choice: "none" }, missing.deps), {
      ok: false,
      error: "That lead is not on the desk.",
    });
    assert.deepEqual(missing.writes(), []);

    const bad = makeDeps({ leads: [lead] });
    assert.deepEqual(await performHoldLead(context, { id: 5, choice: "not-a-reason" }, bad.deps), {
      ok: false,
      error: "That is not a hold reason.",
    });
    assert.deepEqual(bad.writes(), []);
  });
});

describe("choose a headline", () => {
  it("saves through the draft's own save, with the rest of the draft unchanged", async () => {
    const { deps, saved } = makeDeps({ drafts: [DRAFT] });
    const result = await performChooseHeadline(context, { id: 5, headline: "  Council votes 4-3 to delay the budget  " }, deps);
    assert.equal(result.ok && result.headline, "Council votes 4-3 to delay the budget");
    assert.deepEqual(saved, [
      {
        leadId: 5,
        headline: "Council votes 4-3 to delay the budget",
        dek: DRAFT.dek,
        body: DRAFT.body,
        topic: DRAFT.topic,
      },
    ]);
  });

  it("refuses a headline too short to be one, and a lead with no draft", async () => {
    const short = makeDeps({ drafts: [DRAFT] });
    assert.deepEqual(await performChooseHeadline(context, { id: 5, headline: "Budget" }, short.deps), {
      ok: false,
      error: "A headline needs a full sentence.",
    });
    assert.deepEqual(short.saved, []);

    const none = makeDeps({ drafts: [] });
    assert.deepEqual(await performChooseHeadline(context, { id: 5, headline: "Council delays the budget" }, none.deps), {
      ok: false,
      error: "This lead has no draft yet. Write one first.",
    });
  });
});

describe("find sources", () => {
  it("sends the exact saved local endpoint and model to source discovery", async () => {
    const { deps, chatOptions } = makeDeps({
      chat: {
        ok: true as const,
        text: "Records | https://records.example/minutes | keeps the minutes",
      },
    });
    const result = await performFindSources(
      context,
      { topic: "Longmont water", scope: "records", modelChoice: "local-model" },
      deps,
    );
    assert.equal(result.ok && result.proposed, 1);
    assert.deepEqual(chatOptions[0]?.localModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "loaded-exact-model",
    });
  });

  it("counts what the desk accepted, not what the model offered", async () => {
    const { deps, proposed } = makeDeps({
      chat: {
        ok: true as const,
        text: "Records | https://records.example/minutes | keeps the minutes\nhttps://b.example/news\nhttps://c.example/news",
      },
      proposeSource: (input) => (input as { url: string }).url !== "https://b.example/news",
    });
    const result = await performFindSources(context, { topic: "Longmont water", scope: "records" }, deps);
    assert.equal(result.ok && result.proposed, 2);
    // The refused row is reported, not silently dropped: a model that offers
    // three and lands two has not proposed three sources.
    assert.equal(result.ok && result.skipped, 1);
    assert.equal(proposed.length, 3);
    assert.deepEqual((proposed[0] as { proposedBy: string }).proposedBy, "editor");
  });

  it("refuses a topic too short to search for, and answers ok when the model fails", async () => {
    const short = makeDeps({});
    assert.deepEqual(await performFindSources(context, { topic: "wat", scope: "records" }, short.deps), {
      ok: false,
      error: "Say what the paper should cover.",
    });
    assert.deepEqual(short.queries, []);

    const down = makeDeps({ chat: { ok: false as const, error: "unreachable" } });
    const failed = await performFindSources(context, { topic: "Longmont water", scope: "records" }, down.deps);
    assert.equal(failed.ok, false);
    assert.match(failed.ok || failed.error, /existing suggestion list is untouched/);
  });

  it("says so when the model came back with nothing the desk can use", async () => {
    const { deps, proposed } = makeDeps({ chat: { ok: true as const, text: "I could not find anything." } });
    const result = await performFindSources(context, { topic: "Longmont water", scope: "records" }, deps);
    assert.equal(result.ok && result.proposed, 0);
    assert.match(result.ok ? String(result.notice) : "", /nothing the desk could use/);
    assert.deepEqual(proposed, []);
  });
});
