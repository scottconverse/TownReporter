import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/*
 * `listLeads` and `getLead` are createServerFn handlers in desk.ts; that
 * module has Vite-only aliases and cannot be imported by a plain Node test.
 * This is still the server-response boundary: these are the exact SELECT
 * projections that serialize LeadRow to the queue and workbench. Keep this
 * narrow source-shape contract so a future column-list edit cannot once again
 * write possible_duplicate_of during filing but drop it before the editor can
 * compare the two leads.
 */
const desk = readFileSync(new URL("./desk.ts", import.meta.url), "utf8");
const leadView = readFileSync(new URL("../../components/desk-leads.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

/*
 * Unit CZ-long-lists (0.6.81) took the queue projection out of `listLeads` and
 * put it in `queryLeadRows`, which the Queue's window (`listQueuePage`) reads
 * too -- one query, one order, so the two answers cannot drift. The queue half
 * of this pin follows the projection to where it now lives and asserts the
 * delegation, instead of pinning SQL desk.ts no longer holds: what this test
 * owes the editor was never "the SELECT sits inside listLeads", it is that the
 * rows the Queue receives still carry the comparison target.
 */
const QUEUE_READER = "queryLeadRows";

function handlerBlock(name: "listLeads" | "getLead", next: string): string {
  if (name === "listLeads") return queryReaderBlock();
  const start = desk.indexOf(`export const ${name} = createServerFn`);
  const end = desk.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `${name} handler block must be present`);
  return desk.slice(start, end);
}

/** The shared reader's own block: `queryLeadRows` up to its first caller. */
function queryReaderBlock(): string {
  const start = desk.indexOf(`async function ${QUEUE_READER}(`);
  const end = desk.indexOf("export const listLeads = createServerFn", start);
  assert.ok(start >= 0 && end > start, `${QUEUE_READER} handler block must be present`);
  return desk.slice(start, end);
}

/** A server function's own block, for the delegation check below. */
function callerBlock(name: string): string {
  const start = desk.indexOf(`export const ${name} = createServerFn`);
  const end = desk.indexOf("async function insertLeadWithDraft", start);
  assert.ok(start >= 0 && end > start, `${name} must be present`);
  return desk.slice(start, end);
}

describe("possible-duplicate linkage survives the desk server boundary", () => {
  it("reads the Queue through the one shared projection, never a second SELECT", () => {
    // Both responses the Queue draws from -- `listLeads` (the batch dialog, the
    // Sources kill-pattern gate, the import screen) and `listQueuePage` (the
    // screen's own 25-row window) -- must go through `queryLeadRows`. A second
    // query written inline would be a second answer to "which leads are there",
    // and the projection asserted below is pinned on the reader's block only.
    for (const name of ["listLeads", "listQueuePage"]) {
      assert.match(
        callerBlock(name),
        new RegExp(`${QUEUE_READER}\\(context\\)`),
        `${name} must read the shared projection, not its own query`,
      );
    }
  });

  it("projects possible_duplicate_of to the queue response", () => {
    const block = handlerBlock("listLeads", "async function insertLeadWithDraft");
    assert.match(
      block,
      /select[\s\S]*?l\.possible_duplicate_of[\s\S]*?from leads l/i,
      "listLeads must return the comparison target that LeadRowView renders",
    );
  });

  it("projects possible_duplicate_of to the workbench response", () => {
    const block = handlerBlock("getLead", "export const deleteLead");
    assert.match(
      block,
      /select[\s\S]*?l\.possible_duplicate_of[\s\S]*?from leads l[\s\S]*?where l\.id/i,
      "getLead must preserve the comparison target for a lead opened from the queue",
    );
  });

  it("projects the earlier headline and disposition through a same-newsroom join", () => {
    for (const [name, next] of [
      ["listLeads", "async function insertLeadWithDraft"],
      ["getLead", "export const deleteLead"],
    ] as const) {
      const block = handlerBlock(name, next);
      assert.match(block, /left join leads prior on prior\.id = l\.possible_duplicate_of\s+and prior\.newsroom_id = l\.newsroom_id/i);
      assert.match(block, /prior\.headline/i, `${name} must return a readable earlier headline`);
      assert.match(block, /prior\.status/i, `${name} must return the earlier disposition`);
    }
  });

  it("keeps an unavailable earlier lead null rather than exposing a stale or removed headline", () => {
    for (const [name, next] of [
      ["listLeads", "async function insertLeadWithDraft"],
      ["getLead", "export const deleteLead"],
    ] as const) {
      const block = handlerBlock(name, next);
      assert.match(block, /case when prior\.id is null then null else jsonb_build_object/i,
        `${name} must make absent/deleted cross-room targets unavailable`);
    }
  });

  it("shows available prior context in the main row and keeps the narrow badge bounded", () => {
    assert.match(leadView, /lead\.possible_duplicate_of \? \([\s\S]*?lead\.status === "held"/i);
    assert.match(leadView, /possible duplicate of[\s\S]*?lead\.possible_duplicate\.headline[\s\S]*?lead\.possible_duplicate\.status/i);
    assert.match(leadView, /lead\.possible_duplicate \? \([\s\S]*?Possible duplicate · compare/i);
    assert.match(leadView, /Possible duplicate · unavailable/i);
    assert.match(styles, /\.desk-ltr \.chip\.maybe-same \{[^}]*max-width:100%[^}]*white-space:normal[^}]*overflow-wrap:anywhere/i);
    assert.match(styles, /@media \(max-width:600px\) \{[\s\S]*?\.desk-ltr \.lead-row \{[^}]*grid-template-columns:auto minmax\(0,1fr\)[^}]*[\s\S]*?\.desk-ltr \.lead-flags \{[^}]*grid-column:1 \/ -1[^}]*flex-direction:row[^}]*flex-wrap:wrap/i);
  });
});
