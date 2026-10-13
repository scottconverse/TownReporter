// Guard for Scott's rule (standing, Oct 10): the app warns, it never blocks. Every
// warning the editor can meet has a "<action> anyway" press, and that press is
// enabled. Renders the real warn-then-override component (OverrideAnyway) with
// the five warning cases the desk shows, and reads the sentence and the button.
//
// Fails when a change draws a warning without its press, or disables the press.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverrideAnyway } from "../../components/override-anyway.ts";
import { warningPressLabel } from "../../components/editor-warning.ts";

const cases = [
  {
    name: "Story publish warnings",
    actionWord: "Publish",
    sentence: "2 warnings before Publish. You can resolve them here or choose Publish anyway.",
  },
  {
    name: "Kill with an unprinted draft",
    actionWord: "Kill",
    sentence: "This story has a draft the paper has not printed. Kill it anyway?",
  },
  {
    name: "Opinion publish with no dek",
    actionWord: "Publish",
    sentence: "This opinion has no dek. Publish it without one anyway?",
  },
  {
    name: "Draft anyway on an unreachable model",
    actionWord: "Draft",
    sentence: "DeepSeek v4.1 Flash is unavailable. If you draft anyway, the desk will use the next ready writing model.",
  },
  {
    name: "Story with no section",
    actionWord: "Publish",
    sentence: "This story has no section. Publish it without one anyway?",
  },
];

function renderWarning(warning: { key: string; sentence: string }, actionWord: string, busy = false) {
  return renderToStaticMarkup(
    createElement(OverrideAnyway, { warning, actionWord, busy, onOverride: () => {} }),
  );
}

function pressOf(html: string): string {
  return html.match(/<button[^>]*>[^<]*<\/button>/)?.[0] ?? "";
}

describe("warn, never block: every warning has an enabled 'anyway' press", () => {
  for (const warning of cases) {
    it(`${warning.name} draws its sentence and an enabled '${warning.actionWord} anyway' press`, () => {
      const html = renderWarning({ key: warning.name.replace(/\W+/g, "-"), sentence: warning.sentence }, warning.actionWord);
      assert.ok(html.includes(warning.sentence), "the warning sentence must be drawn");
      const press = pressOf(html);
      assert.ok(press.includes(`${warning.actionWord} anyway`), `the press must read "${warning.actionWord} anyway", got: ${press}`);
      assert.doesNotMatch(press, /\bdisabled\b/, "the 'anyway' press must not be disabled");
    });
  }

  it("the press reads the action word for a run, a check and a default warning", () => {
    assert.equal(warningPressLabel("Kill story"), "Kill story anyway");
    assert.equal(warningPressLabel("Run scan", "run"), "Run anyway");
    assert.equal(warningPressLabel("Check now", "check"), "Check anyway");
  });
});
