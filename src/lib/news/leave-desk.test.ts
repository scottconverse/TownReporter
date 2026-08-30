import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Giving up the desk must not be reachable by a click alone.
 *
 * An audit walked this end to end: a button in the header of every desk page,
 * two positions from "Sign out", behind one inline confirm. Click, confirm,
 * and the newsroom is unclaimed -- so the next anonymous visitor to /login owns
 * the published archive, the Dark Desk investigation files, the reporting
 * notes, and the Server page that restarts services on the operator's own
 * Windows machine. No password reset exists, so the previous owner had no route
 * back from inside the product, and the desk is on the internet through the
 * tunnel.
 *
 * Three properties hold this shut, and this file asserts all three. The first
 * is the only one that would survive someone rebuilding the interface, which is
 * why it is checked against the server file rather than the component:
 *
 *   1. the RPC compares a caller-supplied email to the signed-in account's own
 *      email, and refuses on a mismatch;
 *   2. the control is not rendered in the desk chrome;
 *   3. the confirmation says what is lost, not how the mechanism works.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("giving up the desk", () => {
  it("refuses unless the caller types the address it is signed in as", () => {
    const src = read("./claim.ts");
    const fn = src.slice(src.indexOf("export const leaveEditor"));
    const body = fn.slice(0, fn.indexOf("export const", 10) + 1 || fn.length);
    assert.match(body, /\.validator\(/, "leaveEditor takes no input, so nothing can be confirmed");
    assert.match(
      body,
      /select email from "user" where id = \$\{context\.userId\}/,
      "the comparison must be against the session's own account, not a client claim",
    );
    assert.match(
      body,
      /typed !== mine/,
      "there must be a mismatch branch that refuses",
    );
    const refuseIdx = body.indexOf("typed !== mine");
    const leaveIdx = body.indexOf("await leaveAsEditor(");
    assert.ok(refuseIdx >= 0 && leaveIdx > refuseIdx, "the refusal must come before the delete");
  });

  it("is not rendered in the chrome of every desk page", () => {
    const chrome = read("../../components/desk-chrome.tsx");
    const rendered = chrome.includes("<LeaveEditorControl");
    assert.equal(
      rendered,
      false,
      "the control is back in the persistent header, one misclick from Sign out",
    );
  });

  it("the confirmation names what is lost", () => {
    const copy = read("./desk-copy.ts");
    const block = copy.slice(copy.indexOf("export function createEditorCopy"));
    const text = block.slice(0, block.indexOf("}", block.indexOf("return {")));
    for (const word of ["archive", "cannot take it back", "Type your email"]) {
      assert.ok(
        text.includes(word),
        `the confirmation no longer mentions "${word}"; it describes the mechanism, not the loss`,
      );
    }
  });
});
