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

function handlerBlock(name: "listLeads" | "getLead", next: string): string {
  const start = desk.indexOf(`export const ${name} = createServerFn`);
  const end = desk.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `${name} handler block must be present`);
  return desk.slice(start, end);
}

describe("possible-duplicate linkage survives the desk server boundary", () => {
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
