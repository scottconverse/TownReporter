import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { takedownDoneNotice, takedownFailedNotice } from "./takedown-notice.ts";

/*
  FB7, item 5 (A2c X1). "The takedown success notice never says whether the
  public link was kept (it was)."

  The server answers it (`TakeDownCaptureResult.linkKept`) and the checkbox that
  decides it is on the same form, so the only thing missing was the sentence.
*/

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (file: string) => readFileSync(here + file, "utf8");

describe("a takedown says what happened to the public link", () => {
  it("says the link was KEPT when it was", () => {
    const text = takedownDoneNotice(true);
    assert.match(text, /keeps the link to the original/i);
    assert.doesNotMatch(text, /was removed too/i, "and does not say the opposite");
  });

  it("says the link was REMOVED when the editor ticked that box", () => {
    const text = takedownDoneNotice(false);
    assert.match(text, /link to the original was removed too/i);
    assert.doesNotMatch(text, /keeps the link/i);
  });

  it("still says the things a takedown must always say", () => {
    // The two arms differ in one clause and agree on the rest: what was
    // emptied, that the audit trail records why, and that there is no restore.
    for (const text of [takedownDoneNotice(true), takedownDoneNotice(false)]) {
      assert.match(text, /Excerpt taken down/);
      assert.match(text, /audit trail records why/);
      assert.match(text, /There is no restore\./);
    }
  });

  it("keeps a failed takedown honest about what did not happen", () => {
    const text = takedownFailedNotice();
    assert.match(text, /could not be completed/i);
    assert.match(text, /Nothing was removed/i);
  });

  it("is the sentence the review pane actually shows", () => {
    // A pin, because the pane is a route-level component with no props-only
    // seam: what broke was the pane ignoring a field the server sent, and the
    // pin fails on the edit that goes back to one fixed string.
    const pane = read("../../components/finding-evidence-review.tsx");
    assert.match(pane, /takedownDoneNotice\(result\.linkKept\)/, "the pane branches on linkKept");
    assert.match(pane, /takedownFailedNotice\(\)/);
    assert.doesNotMatch(
      pane,
      /Excerpt taken down\./,
      "and the sentence is not also written inline, where it could drift from the tested one",
    );
  });
});
