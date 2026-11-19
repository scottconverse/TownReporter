/*
  F21 (Nov 19 walk): "Run scan now" on Today started a full AI scan on one
  press. The fix puts a confirm in front of it: the page already knows how many
  accepted sources the scan will read and which model choice it will use, so
  the dialog says both.

  This mounts the real Today screen and presses it:

    - the confirm opens first, and nothing has been started;
    - it names the number of sources and the model;
    - Cancel starts nothing;
    - the dialog's own press starts exactly one scan.

  `runScan` lives in `@/components/scoped-actions`, which reaches the server and
  a database at import, so it is a stub that records its payload -- the CALL is
  what this pins, and the scan itself has its own tests. The Dialog is a small
  stand-in drawing title, subtitle, children and the two footer presses; real
  Radix is covered by `scripts/bh2-dialogs.test.mjs`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { installDom } from "./dom-harness.mjs";
import { screenModule } from "./screen-render-harness.mjs";

const window = installDom();
const { createRoot } = await import("react-dom/client");

const accepted = (id, title) => ({
  id,
  title,
  url: `https://example.test/${id}`,
  status: "accepted",
  kind: "page",
  tier: "A",
  last_error: null,
});

const screen = await screenModule("src/routes/desk.index.tsx", {
  DeskShell: `({children}) => h("div", {}, children)`,
  Link: `({children}) => h("span", {}, children)`,
  InkButton: `({children, onClick, disabled, pending, pendingLabel, tone, ...rest}) =>
    h("button", { type: "button", onClick, disabled, ...rest }, children)`,
  runScan: `(args) => { globalThis.scanStarts.push(args); return Promise.resolve({ id: 1 }); }`,
  // The real hook wraps a mutation; this one runs the screen's own mutationFn
  // on press so the button's wiring is what is exercised.
  useDeskMutation: `(options) => ({
    mutate: (variables) => { globalThis.scanPresses.push(variables); return options.mutationFn(variables); },
    isPending: false,
  })`,
  modelChoiceLabel: `(choice) => (choice === "auto" ? "Automatic" : choice)`,
  Dialog: `({open, title, subtitle, children, primaryLabel, onPrimary, onClose, cancelLabel}) =>
    open
      ? h("div", { role: "dialog", "aria-label": title },
          h("h2", {}, title),
          subtitle ? h("p", {}, subtitle) : null,
          children,
          h("button", { type: "button", "data-primary": true, onClick: () => onPrimary() }, primaryLabel),
          h("button", { type: "button", "data-cancel": true, onClick: () => onClose() }, cancelLabel))
      : null`,
}, [
  // The pure derivations Today reads (lead order, tonight's edition). The
  // harness stubs a module's exports by default; a null-returning `openLeads`
  // would crash the page rather than test it.
  "@/lib/news/desk-copy",
  "@/lib/news/desk-drafts",
  "@/lib/news/story-readiness",
  "@/lib/news/draft-item",
  "@/components/draft-item-boundary",
  "@/lib/news/publish-blockers",
]);

const buttons = () => [...document.querySelectorAll("button")];
const press = async (node) => {
  assert.ok(node, "expected a control to press");
  await act(async () => {
    node.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
};

async function mount(t) {
  globalThis.scanStarts = [];
  globalThis.scanPresses = [];
  globalThis.screenData = {
    "first-run-setup": { needsSetup: false },
    sources: [accepted(1, "City Council agenda"), accepted(2, "School board minutes")],
    leads: [],
    "drafts-desk": [],
    scans: { rows: [] },
    investigations: [],
    "worth-a-look": [],
    "published-desk": [],
    memory: [],
    "follow-ups": [],
    "follow-up-findings": [],
    "desk-jobs": [],
    "my-desk": { role: "owner" },
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

const runButton = () => buttons().find((b) => b.textContent.trim() === "Run scan now");
const confirmBox = () => document.querySelector('[role="dialog"]');

test("Run scan now asks first, and starts only on the confirm", async (t) => {
  await mount(t);

  const opener = runButton();
  assert.ok(opener, "Today must offer Run scan now");

  await press(opener);
  const box = confirmBox();
  assert.ok(box, "pressing Run scan now must open a confirm");
  assert.equal(globalThis.scanStarts.length, 0, "no scan may start before the confirm");
  assert.equal(globalThis.scanPresses.length, 0);
  assert.match(box.textContent, /Run a full scan\?/);
  assert.match(box.textContent, /It will read 2 sources\./);
  assert.match(box.textContent, /Automatic/, "the confirm must name the model it will use");

  await t.test("Cancel starts nothing", async () => {
    await press(box.querySelector("[data-cancel]"));
    assert.equal(confirmBox(), null, "Cancel must close the confirm");
    assert.equal(globalThis.scanStarts.length, 0, "Cancel must not start a scan");
    assert.equal(globalThis.scanPresses.length, 0);
  });

  await t.test("the dialog's press starts one scan", async () => {
    await press(runButton());
    const again = confirmBox();
    assert.ok(again, "the confirm must open again");
    await press(again.querySelector("[data-primary]"));
    assert.equal(globalThis.scanPresses.length, 1, "the confirm's press must start the scan");
    assert.equal(globalThis.scanStarts.length, 1, "exactly one scan start");
    assert.equal(globalThis.scanStarts[0].data.modelChoice, "auto");
  });
});
