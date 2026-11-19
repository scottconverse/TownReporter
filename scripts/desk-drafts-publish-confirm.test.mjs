/*
  F20 (Nov 19 walk): "Publish all drafts" printed the whole batch on ONE press.
  The fix put a confirm in front of both publish presses (the whole list and
  the ticked selection): it lists every headline it will print, marks the
  stories that are "Not checked yet", and publishes nothing until the editor
  presses the primary.

  This mounts the real Drafts screen and presses it:

    - the confirm opens first, and NO publish call has been made;
    - the confirm names both headlines and warns on the unchecked one;
    - Cancel publishes nothing;
    - the primary publishes exactly the stories the confirm listed;
    - the selected press goes through the same confirm.

  The server module (`@/lib/news/desk`) opens a database at import, so
  `publishAllDrafts` is a stub that records the payload it was handed. What is
  pinned is the CALL the screen makes and when; the batch itself is the server's
  and is covered by its own tests. The Dialog is a small stand-in that draws its
  title, its children and its two footer presses -- real Radix cannot mount in
  this in-process DOM, and `scripts/bh2-dialogs.test.mjs` already covers it.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { installDom } from "./dom-harness.mjs";
import { screenModule } from "./screen-render-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");

/** React's props for a mounted node -- linkedom has no activation behavior. */
function propsOf(node) {
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
  assert.ok(key, "expected React to have attached props to this node");
  return node[key];
}

const readyRow = (leadId, headline, topic = "government") => ({
  id: leadId * 10,
  lead_id: leadId,
  headline,
  topic,
  has_body: true,
  headline_source: "model",
  model_headline: headline,
  job_status: null,
  job_stage: null,
  names_unresolved: 0,
  evidence_required: false,
  evidence_decision: null,
  imported_text: false,
  story_readiness: { version: 1, state: "ready", openCount: 0, totalCount: 0, reason: "" },
});

const uncheckedRow = (leadId, headline) => ({
  ...readyRow(leadId, headline),
  story_readiness: { version: 1, state: "not-checked", openCount: 1, totalCount: 1, reason: "" },
});

const screen = await screenModule(
  "src/routes/desk.drafts.tsx",
  {
    DeskShell: `({children}) => h("div", {}, children)`,
    Link: `({children}) => h("span", {}, children)`,
    // The list and the publish-all read are the same query key prefix; the
    // harness's default lookup by first element would hand the publish batch
    // the paged shape. Key on the whole key instead.
    useQuery: `({queryKey}) => ({ data: globalThis.draftScreenData[queryKey.join("/")], isPending: false, isError: false })`,
    editorTitle: `(headline) => headline`,
    PAGE_SIZE: `50`,
    showingLine: `() => ""`,
    publishAllDrafts: `async ({data}) => {
      globalThis.publishCalls.push(data);
      return { results: data.items.map((item) => ({ leadId: item.leadId, headline: "x", ok: true, slug: "s" })) };
    }`,
    publishLead: `async () => ({ ok: true, slug: "s" })`,
    Dialog: `({open, title, subtitle, children, primaryLabel, onPrimary, onClose, cancelLabel}) =>
      open
        ? h("div", { role: "dialog", "aria-label": title },
            h("h2", {}, title),
            subtitle ? h("p", {}, subtitle) : null,
            children,
            h("button", { type: "button", "data-primary": true, onClick: () => onPrimary() }, primaryLabel),
            h("button", { type: "button", "data-cancel": true, onClick: () => onClose() }, cancelLabel))
        : null`,
  },
  ["@/lib/news/desk-drafts", "@/lib/news/draft-item", "@/components/draft-item-boundary"],
);

const buttons = () => [...document.querySelectorAll("button")];
const press = async (node) => {
  assert.ok(node, "expected a control to press");
  await act(async () => {
    node.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
};
const confirmBox = () => document.querySelector('[role="dialog"]');

async function mount(t, rows) {
  globalThis.publishCalls = [];
  globalThis.draftScreenData = {
    "drafts-desk/all/50": { rows, total: rows.length, counts: { all: rows.length } },
    "drafts-desk/publish-all": rows,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  await act(async () => root.render(h(screen.Route.component)));
  return root;
}

const publishAllButton = () =>
  buttons().find((b) => /^Publish all drafts \(\d+\)$/.test(b.textContent.trim()));

test("Publish all drafts asks first, and publishes only on the confirm", async (t) => {
  await mount(t, [readyRow(1, "Council approves budget"), uncheckedRow(2, "Library hours cut")]);

  const opener = publishAllButton();
  assert.ok(opener, "the whole-list publish must be on the screen");
  assert.equal(opener.textContent.trim(), "Publish all drafts (2)");

  await press(opener);
  const box = confirmBox();
  assert.ok(box, "pressing Publish all drafts must open a confirm");
  assert.equal(globalThis.publishCalls.length, 0, "nothing may publish before the confirm");
  assert.match(box.textContent, /Publish these stories\?/);
  // Every headline it will print, in the box.
  assert.match(box.textContent, /Council approves budget/);
  assert.match(box.textContent, /Library hours cut/);
  // ... and the draft that is not checked yet is marked as such.
  assert.match(box.textContent, /Not checked yet/);
  // Two stories, two sections.
  assert.match(box.textContent, /government/);

  await t.test("Cancel publishes nothing", async () => {
    await press(box.querySelector("[data-cancel]"));
    assert.equal(confirmBox(), null, "Cancel must close the confirm");
    assert.equal(globalThis.publishCalls.length, 0, "Cancel must not publish");
  });

  await t.test("the primary publishes exactly the listed stories", async () => {
    await press(publishAllButton());
    const again = confirmBox();
    assert.ok(again, "the confirm must open again");
    const primary = again.querySelector("[data-primary]");
    assert.equal(primary.textContent.trim(), "Publish 2 stories");
    await press(primary);
    // One story per request (the batch counts up as each prints), so two
    // presses of the server for two stories -- and not one more.
    assert.equal(globalThis.publishCalls.length, 2, "the confirm's press must publish");
    assert.deepEqual(
      globalThis.publishCalls.flatMap((call) => call.items.map((item) => item.leadId)),
      [1, 2],
    );
  });
});

test("Publish N selected goes through the same confirm", async (t) => {
  await mount(t, [readyRow(1, "Council approves budget"), uncheckedRow(2, "Library hours cut")]);

  const checkbox = document.querySelector('input[aria-label="Select Council approves budget"]');
  assert.ok(checkbox, "each row must carry its tick box");
  await act(async () => {
    propsOf(checkbox).onChange({ target: { checked: true } });
  });

  const selectedButton = buttons().find((b) => /^Publish \d+ selected$/.test(b.textContent.trim()));
  assert.ok(selectedButton, "the selection strip must offer its publish");
  assert.equal(selectedButton.textContent.trim(), "Publish 1 selected");

  await press(selectedButton);
  const box = confirmBox();
  assert.ok(box, "the selected publish must open the confirm");
  assert.equal(globalThis.publishCalls.length, 0, "the selection must not publish on one press");
  assert.match(box.textContent, /Council approves budget/);
  assert.doesNotMatch(box.textContent, /Library hours cut/, "only the ticked story is confirmed");

  await press(box.querySelector("[data-cancel]"));
  assert.equal(globalThis.publishCalls.length, 0, "Cancel must not publish the selection");

  await press(selectedButton);
  await press(confirmBox().querySelector("[data-primary]"));
  assert.equal(globalThis.publishCalls.length, 1, "one story, one request");
  assert.deepEqual(
    globalThis.publishCalls.flatMap((call) => call.items.map((item) => item.leadId)),
    [1],
  );
});
