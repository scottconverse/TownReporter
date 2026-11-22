/*
  PR 430 follow-up (Nov 20 2026): an open watch must be reachable.

  WHAT WENT WRONG. `PageWatchPanel` drew the open-watch article (Check now,
  Capture with Firecrawl Local, Pause, Stop watching and the capture history)
  inside the `{formOpen ? … : null}` block, and the watch-row click handler sets
  `formOpen(false)`. So clicking a row fetched the detail and drew nothing: the
  controls and their messages could not be reached.

  WHAT IS REAL. `PageWatchPanel` from src/components/page-watch-panel.tsx and
  the real `ActionButton` (its words and phases are the thing seen). Only the
  data hooks and the server calls are stubbed, so the row click is a real click
  in the in-process DOM.

  THE MUTATION THAT MATTERS: drawing the article behind `formOpen` again leaves
  the clicked row with no "Check now" and no "Capture with Firecrawl Local".
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";
import { screenModuleUrl } from "./screen-render-harness.mjs";

installDom();
const { createRoot } = await import("react-dom/client");
const { act } = React;

const actionButtonUrl = await moduleUrl("src/components/action-button.ts");

const { PageWatchPanel } = await import(
  await screenModuleUrl(
    "src/components/page-watch-panel.tsx",
    {
      /* The list is always there; the detail answers only once a row is open,
         exactly as the `enabled: selected != null` query does on the desk. */
      useQuery: `({ queryKey, enabled }) => {
        const key = queryKey[0];
        if (key === "page-watches")
          return { data: globalThis.__watchFixtures.watches, isPending: false, isError: false };
        if (key === "page-watch")
          return {
            data: enabled ? globalThis.__watchFixtures.detail : undefined,
            isPending: false,
            isError: false,
          };
        return { data: undefined, isPending: false, isError: false };
      }`,
      useMutation: `() => ({ mutate(){}, isPending: false })`,
      useQueryClient: `() => ({ invalidateQueries(){} })`,
    },
    [],
    {
      imports: {
        "./action-button": actionButtonUrl,
        "./desk-chrome": stubUrl(
          `import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
export const InkButton = ({ children, onClick, disabled, type = "button", small = false }) =>
  h("button", { type, onClick, disabled, className: "btn quiet" + (small ? " small" : "") }, children);`,
        ),
      },
    },
  ),
);

const NOW = "2026-11-20T16:12:00.000Z";
const WATCH = {
  id: 1,
  title: "County clerk meeting portal",
  watch_reason: "Watch for posted meeting dates and packets.",
  url: "https://clerk.bouldercounty.gov/portal/meetings",
  watch_state: "active",
  last_check_at: NOW,
  next_check_at: "2026-11-20T18:12:00.000Z",
  watch_check_started_at: null,
  watch_last_error: null,
  watch_failover_note: null,
  watch_model_choice: "auto",
};
const WATCH_ROW = {
  id: 1,
  url: WATCH.url,
  last_check_at: NOW,
  last_outcome: "unchanged",
  watch_state: "active",
  investigation_id: null,
};

test("PR 430: clicking a watch row shows Check now and Capture with Firecrawl Local", async (t) => {
  globalThis.__watchFixtures = {
    watches: [WATCH_ROW],
    detail: { watch: WATCH, history: [] },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(PageWatchPanel, { files: [], onOpenFile() {} })));
  t.after(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete globalThis.__watchFixtures;
  });

  /* The form is closed on mount and the row is drawn. */
  const rowButton = container.querySelector(".astra-watch-open");
  assert.ok(rowButton, "the watch row was not drawn");
  assert.equal(rowButton.getAttribute("aria-expanded"), "false");

  await act(async () => rowButton.click());
  assert.equal(rowButton.getAttribute("aria-expanded"), "true", "the row click did not open the watch");

  const words = container.textContent;
  assert.match(words, /Check now/, "the open watch shows no Check now");
  assert.match(words, /Capture with Firecrawl Local/, "the open watch shows no Capture with Firecrawl Local");

  /* The form and the open watch still do not show at the same time. */
  assert.equal(container.querySelector("form"), null, "the watch form was drawn with the open watch");
});
