/**
 * "Find a replacement", the AI tier (unit SH0-9), against a fake database and
 * a fake model.
 *
 * WHAT THIS PINS, and each one is a promise the owner's addendum makes:
 *
 *   1. EXACTLY ONE MODEL CALL, ON AN EXPLICIT PRESS, WITH NO TOOLS. The press
 *      is the only thing that spends anything here, and an agent that could
 *      fetch would go and read the very host that just refused the desk.
 *   2. THE TOPIC COMES FROM THE BEAT -- the sections the owner filed the
 *      source under, named as the newsroom names them. Not the source's URL,
 *      and not something the client typed.
 *   3. EVERY ROW CARRIES THE REPLACES-ID AND `proposed_by = 'desk'`, so the
 *      editor can see what the suggestion is for and where it came from.
 *   4. NOTHING IS ACCEPTED. There is no write in this path at all: every row
 *      goes through the one proposal door as `status='proposed'`.
 *
 * MUTATION: drop `replacesSourceId` from the `proposeSource` call and the
 * provenance case fails; the "writes nothing" case keeps the never-automatic
 * promise honest.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "../db.ts";
import {
  performFindReplacement,
  type EditorDialogContext,
  type EditorDialogDeps,
} from "./editor-dialog-actions.server.ts";

const context: EditorDialogContext = { userId: "editor-1", newsroomId: 81 };

type Query = { text: string; write: boolean };

type Plan = {
  source?: unknown[];
  filed?: unknown[];
  sections?: unknown[];
  chat?: { ok: true; text: string } | { ok: false; error: string };
};

function fakeSql(plan: Plan, queries: Query[]) {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join(" ? ").replace(/\s+/g, " ").trim();
    queries.push({ text, write: /^(update|insert|delete)/i.test(text) });
    if (/section_sources/i.test(text)) return Promise.resolve(plan.filed ?? []);
    if (/newsroom_sections/i.test(text)) return Promise.resolve(plan.sections ?? []);
    if (/from sources/i.test(text)) return Promise.resolve(plan.source ?? []);
    return Promise.resolve([]);
  };
  return tag as unknown as Sql;
}

function makeDeps(plan: Plan) {
  const queries: Query[] = [];
  const proposed: Record<string, unknown>[] = [];
  const calls: { system: string; user: string; maxTokens: number; opts: Record<string, unknown> }[] =
    [];
  const sql = fakeSql(plan, queries);
  const deps: EditorDialogDeps = {
    getSql: async () => sql,
    chat: (async (system: string, user: string, maxTokens: number, opts: Record<string, unknown>) => {
      calls.push({ system, user, maxTokens, opts });
      return plan.chat ?? { ok: false as const, error: "no fake model planned" };
    }) as unknown as EditorDialogDeps["chat"],
    readAssignments: async () => [],
    resolveLocalModel: async () => ({ baseUrl: "http://127.0.0.1:1234/v1", id: "test-model" }),
    saveDraft: (async () => ({ ok: true as const })) as unknown as EditorDialogDeps["saveDraft"],
    proposeSource: (async (_sql: unknown, input: Record<string, unknown>) => {
      proposed.push(input);
      return true;
    }) as unknown as EditorDialogDeps["proposeSource"],
    linkDocuments: (async () => ({ ok: true as const })) as unknown as EditorDialogDeps["linkDocuments"],
    insertLead: (async () => ({ ok: true as const, id: 1 })) as unknown as EditorDialogDeps["insertLead"],
    commitDraft: (async () => ({ ok: true as const })) as unknown as EditorDialogDeps["commitDraft"],
    now: () => new Date("2026-10-01T14:05:00Z"),
  };
  return { deps, queries, proposed, calls, writes: () => queries.filter((q) => q.write) };
}

const SOURCE = {
  id: 7,
  url: "https://broken.test/news",
  title: "Broken News",
  proposed_section: null,
};

const SECTIONS = [
  { key: "planning", name: "Planning" },
  { key: "budget", name: "Budget" },
];

const TWO_ROWS = {
  ok: true as const,
  text: "Agendas | https://city.test/agendas | keeps the agendas\nMinutes | https://city.test/minutes | keeps the minutes",
};

describe("performFindReplacement", () => {
  it("sends the selected local endpoint and model to the replacement search", async () => {
    const f = makeDeps({
      source: [SOURCE],
      filed: [{ section_key: "planning" }],
      sections: SECTIONS,
      chat: TWO_ROWS,
    });
    const result = await performFindReplacement(context, { sourceId: 7, modelChoice: "local-model" }, f.deps);
    assert.equal(result.ok, true);
    assert.deepEqual(f.calls[0]?.opts.localModel, {
      baseUrl: "http://127.0.0.1:1234/v1",
      id: "test-model",
    });
  });

  it("makes exactly one call, with no tools, and asks the beat's question", async () => {
    const f = makeDeps({
      source: [SOURCE],
      filed: [{ section_key: "planning" }, { section_key: "budget" }],
      sections: SECTIONS,
      chat: TWO_ROWS,
    });
    const result = await performFindReplacement(context, { sourceId: 7 }, f.deps);
    assert.equal(result.ok, true);
    assert.equal(f.calls.length, 1, "one press is one model call");
    assert.equal(f.calls[0]!.opts.noTools, true, "the desk is asking for a list, not a reader");
    assert.equal(f.calls[0]!.maxTokens, 1400);
    // The topic is the beat, named the way the newsroom names it, then the
    // source being replaced.
    assert.equal(result.ok && result.topic, "Planning — Budget — Broken News");
    assert.match(f.calls[0]!.user, /Planning/);
    assert.match(f.calls[0]!.user, /Budget/);
    assert.match(f.calls[0]!.user, /Broken News/);
  });

  it("falls back to the title, matched against the newsroom's own sections", async () => {
    const f = makeDeps({
      source: [{ ...SOURCE, id: 8, title: "Riverbend Valley Planning Commission" }],
      filed: [],
      sections: SECTIONS,
      chat: TWO_ROWS,
    });
    const result = await performFindReplacement(context, { sourceId: 8 }, f.deps);
    assert.equal(result.ok && result.topic, "Planning — Riverbend Valley Planning Commission");
  });

  it("files every row through the door with the replaces-id and the desk's name", async () => {
    const f = makeDeps({
      source: [SOURCE],
      filed: [{ section_key: "planning" }],
      sections: SECTIONS,
      chat: TWO_ROWS,
    });
    const result = await performFindReplacement(context, { sourceId: 7 }, f.deps);
    assert.equal(result.ok && result.proposed, 2);
    assert.equal(f.proposed.length, 2);
    for (const row of f.proposed) {
      assert.equal(row.replacesSourceId, 7, "every candidate says which source it would replace");
      assert.equal(row.proposedBy, "desk");
      assert.equal(row.newsroomId, 81);
      assert.equal(row.userId, "editor-1");
      // `via` is null: none of the four signpost values describes a page a
      // model named, and the nearest label would be a claim nobody made.
      assert.equal(row.via, undefined);
    }
    assert.deepEqual(
      f.proposed.map((r) => r.url),
      ["https://city.test/agendas", "https://city.test/minutes"],
    );
  });

  it("accepts nothing: there is no write in this path at all", async () => {
    const f = makeDeps({
      source: [SOURCE],
      filed: [{ section_key: "planning" }],
      sections: SECTIONS,
      chat: TWO_ROWS,
    });
    await performFindReplacement(context, { sourceId: 7 }, f.deps);
    assert.deepEqual(f.writes(), [], "the desk proposes; the editor accepts");
  });

  it("says so, and calls no model, when the desk cannot tell what the source was for", async () => {
    const f = makeDeps({ source: [{ ...SOURCE, title: "" }], filed: [], sections: SECTIONS });
    const result = await performFindReplacement(context, { sourceId: 7 }, f.deps);
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /cannot tell what this source was for/);
    assert.equal(f.calls.length, 0, "nothing to search on, so nothing is spent");
  });

  it("refuses a source that is not on this desk, without calling a model", async () => {
    const f = makeDeps({ source: [], sections: SECTIONS });
    const result = await performFindReplacement(context, { sourceId: 99 }, f.deps);
    assert.deepEqual(result, { ok: false, error: "That source is not on the watch list." });
    assert.equal(f.calls.length, 0);
  });

  it("answers honestly when the model is unreachable or comes back empty", async () => {
    const down = makeDeps({
      source: [SOURCE],
      filed: [{ section_key: "planning" }],
      sections: SECTIONS,
      chat: { ok: false as const, error: "unreachable" },
    });
    const failed = await performFindReplacement(context, { sourceId: 7 }, down.deps);
    assert.equal(failed.ok, false);
    assert.deepEqual(down.proposed, []);

    const empty = makeDeps({
      source: [SOURCE],
      filed: [{ section_key: "planning" }],
      sections: SECTIONS,
      chat: { ok: true as const, text: "" },
    });
    const none = await performFindReplacement(context, { sourceId: 7 }, empty.deps);
    assert.equal(none.ok, true);
    assert.equal(none.ok && none.proposed, 0);
    assert.equal(none.ok && none.skipped, 0);
  });
});
