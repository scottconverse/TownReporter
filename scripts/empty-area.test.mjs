// guards: an empty area could misleadingly say the whole newspaper is unpublished.
import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
const { EmptyEdition } = await import(
  await moduleUrl("src/components/empty-edition.tsx", {
    "@tanstack/react-router": stubUrl(
      'import {createElement as h} from "' +
        import.meta.resolve("react") +
        '"; export const Link = ({children}) => h("a", null, children);',
    ),
  })
);
test("empty areas keep their message separate from the whole paper", () => {
  const paper = render(h(EmptyEdition));
  for (const area of ["colorado", "national"]) {
    const html = render(h(EmptyEdition, { area }));
    assert.notEqual(html, paper);
    assert.match(html, /No stories in this area/);
    assert.doesNotMatch(html, /No published stories/);
  }
});
