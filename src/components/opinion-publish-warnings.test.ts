import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpinionPublishWarnings } from "./opinion-publish-warnings.ts";

/**
 * TJA-4. A piece with no dek and unreviewed claims used to show two "Publish
 * anyway" presses, and each recorded only part of the override. The warning box
 * now holds ONE press, and that press acknowledges every warning listed above it.
 */

type Press = ReactElement<{ onClick?: () => void; children?: ReactNode; disabled?: boolean }>;

/** Every <button> in an element tree, found by walking the children. */
function buttonsIn(node: ReactNode): Press[] {
  if (Array.isArray(node)) return node.flatMap(buttonsIn);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const self = node.type === "button" ? [node as Press] : [];
  return [...self, ...buttonsIn(node.props.children)];
}

const DEK = { key: "dek", sentence: "No dek yet. You can add one, or publish without it." };
const CLAIMS = { key: "editorial-sources", sentence: "The claims in this piece have not been reviewed." };

/** The box for these warnings, and the list of key-lists its press reports. */
function box(warnings: { key: string; sentence: string }[], busy = false) {
  const sent: string[][] = [];
  const tree = OpinionPublishWarnings({ warnings, busy, onPublishAnyway: (keys) => sent.push(keys) });
  return { tree, sent };
}

describe("OpinionPublishWarnings", () => {
  it("lists every warning above one press when there is no dek and the claims are unreviewed", () => {
    const { tree } = box([DEK, CLAIMS]);
    const html = renderToStaticMarkup(tree);
    assert.match(html, /No dek yet/);
    assert.match(html, /The claims in this piece have not been reviewed/);
    assert.equal(buttonsIn(tree).length, 1, "one press, not one per warning");
    assert.equal(buttonsIn(tree)[0].props.children, "Publish anyway — I accept these claims are unreviewed");
  });

  it("one press sends both acknowledgments in a single call", () => {
    const { tree, sent } = box([DEK, CLAIMS]);
    buttonsIn(tree)[0].props.onClick?.();
    assert.deepEqual(sent, [["dek", "editorial-sources"]]);
  });

  it("a missing dek alone gets the plain press, and that press acknowledges the dek", () => {
    const { tree, sent } = box([DEK]);
    assert.equal(buttonsIn(tree).length, 1);
    assert.equal(buttonsIn(tree)[0].props.children, "Publish anyway");
    buttonsIn(tree)[0].props.onClick?.();
    assert.deepEqual(sent, [["dek"]]);
  });

  it("the one press says Publishing… and is disabled while a publish is in flight", () => {
    const { tree } = box([DEK, CLAIMS], true);
    const [press] = buttonsIn(tree);
    assert.equal(press.props.children, "Publishing…");
    assert.equal(press.props.disabled, true);
  });
});
