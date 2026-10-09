// guards: duplicate draft buttons could stop the nightly proof before an editor's draft lands.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { storyDraftButton } from "./nightly-proof-actions.mjs";

test("selects only the story action bar's draft button", () => {
  const { document } = parseHTML(
    `<div class="work-bar astra-story-actions"><button id="primary">Draft with AI</button></div><section><button>Draft with AI</button></section>`,
  );
  const locator = (root) => ({
    locator: (selector) => locator(root.querySelector(selector)),
    getByRole: (role, { name }) =>
      [...root.querySelectorAll(role)].filter((el) => name.test(el.textContent)),
  });
  assert.deepEqual(
    storyDraftButton(locator(document)).map((el) => el.id),
    ["primary"],
  );
});
