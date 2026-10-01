/*
  FB6, item 2: the row moves at once, and moves BACK when the desk says no.

  README "Interactions & behavior": "the selected lead index and per-lead pending
  status (optimistic Held/Killed with Undo until the server confirms)". FB0-Report
  Table B measured both screens without it ("not optimistic (README:484)").

  WHY THIS FILE MOUNTS ANYTHING. The rule has three parts, and only one of them
  is arithmetic (`src/components/desk-lead-status.test.ts` covers that one):

    1. the cache is patched BEFORE the call leaves -- in the same commit as the
       press, not when the answer arrives;
    2. a refusal or a rejection puts it back, and says so in red;
    3. a success leaves it alone.

  Parts 1 and 2 are properties of the WIRING -- `useDeskMutation`'s `onMutate`
  handing its context to `onError` and to a refusal in `onSuccess` -- and a test
  of the pure helper would pass with the wiring deleted. So this mounts the real
  hook and the real optimistic helper in an in-process DOM (scripts/dom-harness.mjs)
  against a real React Query client, presses a real button, and reads the cache.

  THE MUTATION THAT MATTERS, named because the unit asks for it: delete the
  `rollback` call from `useDeskMutation`'s error path (and from its refusal path)
  and "a failed Hold puts the row back" fails -- the row stays Held with an error
  bar over it, which is the lie this unit exists to remove.

  STUBS, named: `@/components/desk-toast` is a recorder, because what is under
  test is whether a sentence is raised and in which tone, not what sonner does
  with it (FB5 owns that, and `scripts/fb5-desk-toast.test.mjs` walks it).
  Everything else is real: react, react-dom, @tanstack/react-query,
  `desk-action.ts` and `desk-lead-status.ts`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";

import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

/* The DOM has to exist before react-dom/client is imported. */
const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

/* ------------------------------------------------------------------ stubs */

/*
  The toast layer, recorded. `announceToDesk` is not imported by either module
  under test, so the recorder only has to carry the three names `desk-action.ts`
  actually reaches for.
*/
const toastStub = stubUrl(`
export const toasts = [];
export function deskToast(text, options = {}) {
  toasts.push({ text, tone: options.tone ?? "ok", hasUndo: Boolean(options.undo) });
}
export function deskErrorReason(error, what = "do that") {
  const raw = error && error.message ? String(error.message) : String(error ?? "");
  return raw || "the desk gave no reason for " + what;
}
export function deskToastHostMounted() { return true; }
`);
const toast = await import(toastStub);

const deskActionUrl = await moduleUrl("src/components/desk-action.ts", {
  "@/components/desk-toast": toastStub,
});
const leadStatusUrl = await moduleUrl("src/components/desk-lead-status.ts", {});
/*
  Loaded here on purpose, though nothing in THIS file calls it: the harness
  module below imports it by URL, and a module that failed to transpile should
  fail loudly here rather than as a stranger's import error further down.
*/
await import(leadStatusUrl);

/* ------------------------------------------------------- the harness screen */

/*
  A press, wired exactly as the screens wire it: the same hook, the same copy
  shape, the same optimistic helper spread in. Written with `createElement`
  rather than JSX because it is a `data:` module, and the two modules it imports
  are the REAL ones (their URLs are substituted in, not their source).
*/
const harness = stubUrl(`
import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
import { useDeskMutation } from ${JSON.stringify(deskActionUrl)};
import { leadStatusOptimistic } from ${JSON.stringify(leadStatusUrl)};
import { useQueryClient } from ${JSON.stringify(import.meta.resolve("@tanstack/react-query"))};

export function Harness({ press, answer }) {
  const qc = useQueryClient();
  const move = useDeskMutation({
    mutationFn: (input) => answer(input),
    ...leadStatusOptimistic(qc),
    pending: "Saving…",
    done: (_result, input) =>
      input.status === "new" ? "Undone: the lead is back." : "The lead moved, and its row keeps an Undo.",
    failedLead: "Could not change that lead. ",
    what: "change that lead",
  });
  return h("div", null,
    h("button", {
      id: "press",
      disabled: move.isPending,
      onClick: () => move.mutate(press),
    }, move.isPending ? "Saving…" : "Hold"),
    h("span", { id: "error" }, move.error ? String(move.error.message) : ""),
  );
}
`);
const { Harness } = await import(harness);

/* ----------------------------------------------------------------- helpers */

/** One page of the Queue's shape, under the same `["leads"]` prefix Today uses. */
const seed = (qc, rows) => {
  qc.setQueryData(["leads"], rows);
  qc.setQueryData(["leads", "open", "all", "best", "", 25], {
    rows,
    total: rows.length,
    counts: {
      open: rows.filter((r) => r.status !== "held" && r.status !== "killed").length,
      held: rows.filter((r) => r.status === "held").length,
      killed: rows.filter((r) => r.status === "killed").length,
      all: rows.length,
    },
  });
};

const statusOf = (qc, key, id) =>
  (qc.getQueryData(key)?.rows ?? qc.getQueryData(key))?.find?.((row) => row.id === id)?.status;

const pageOf = (qc) => qc.getQueryData(["leads", "open", "all", "best", "", 25]);

/** A promise whose settlement this test decides. */
function deferred() {
  let settle;
  const promise = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(element));
  return {
    container,
    button: () => container.querySelector("#press"),
    label: () => container.querySelector("#press").textContent,
    async click() {
      await React.act(async () => {
        container.querySelector("#press").dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

const wrap = (qc, node) =>
  React.createElement(QueryClientProvider, { client: qc }, node);

/*
  Every client this file makes, so the file can put them away.

  WHY THIS IS HERE AT ALL. A React Query client arms a garbage-collection timer
  per entry (five minutes by default), and a pending timer holds Node's event
  loop open. A file that mounts a `useMutation` and presses it therefore passes
  every case and then never exits -- measured here as a file-level
  `testTimeoutFailure` with all five cases green. `clear()` and `unmount()` are
  the tidy half; `mutations.gcTime: 0` below is the half that actually matters,
  because a settled mutation's timer is NOT released by `clear()`.

  THE QUERIES KEEP THE DEFAULT LIFETIME, deliberately: the seeded caches in this
  file have no mounted observer, and a zero lifetime would drop the data before
  the test could press anything. Queries' timers ARE released by `clear()`.
*/
const live = [];
test.afterEach(() => {
  for (const qc of live.splice(0)) {
    qc.clear();
    qc.unmount();
  }
});

const freshClient = () => {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  live.push(qc);
  return qc;
};

/* ------------------------------------------------------------------- tests */

test("a Hold moves the row before the desk has answered", async () => {
  const qc = freshClient();
  seed(qc, [{ id: 7, headline: "A", status: "new" }]);
  const gate = deferred();
  const page = await mount(
    wrap(qc, React.createElement(Harness, { press: { id: 7, status: "held" }, answer: () => gate.promise })),
  );
  try {
    assert.equal(statusOf(qc, ["leads"], 7), "new");
    await page.click();

    /*
      THE WHOLE POINT. The call has not answered -- `gate` is still open -- and
      the lead already reads held in BOTH caches, with the Queue's Open count
      down and its Held count up. A screen that only changed when the answer
      arrived would still read "new" here.
    */
    assert.equal(statusOf(qc, ["leads"], 7), "held", "Today's array moved at once");
    assert.equal(
      statusOf(qc, ["leads", "open", "all", "best", "", 25], 7),
      "held",
      "the Queue's page moved at once",
    );
    assert.equal(pageOf(qc).counts.open, 0, "and it left the Open count");
    assert.equal(pageOf(qc).counts.held, 1);

    // No double-press: the button is disabled and says what it is doing.
    assert.equal(page.button().disabled, true, "the press stands down while it is in flight");
    assert.equal(page.label(), "Saving…");

    await React.act(async () => gate.resolve({ ok: true }));
    assert.equal(statusOf(qc, ["leads"], 7), "held", "a confirmed write stays put");
    assert.deepEqual(
      toast.toasts.map((t) => t.tone),
      ["ok"],
      "one success bar, and no failure",
    );
  } finally {
    await page.close();
  }
});

test("a failed Hold puts the row back and says why in red", async () => {
  toast.toasts.length = 0;
  const qc = freshClient();
  seed(qc, [{ id: 7, headline: "A", status: "new" }]);
  const gate = deferred();
  const page = await mount(
    wrap(qc, React.createElement(Harness, { press: { id: 7, status: "held" }, answer: () => gate.promise })),
  );
  try {
    await page.click();
    assert.equal(statusOf(qc, ["leads"], 7), "held", "optimistic first, as above");

    await React.act(async () => gate.reject(new Error("the desk is down")));

    /*
      The rollback, and the sentence. Both halves matter: a row that stayed held
      over a red bar is the desk contradicting itself, and a row that came back
      with no sentence is the silent failure FB0 measured.
    */
    assert.equal(statusOf(qc, ["leads"], 7), "new", "the row is back where it was");
    assert.equal(pageOf(qc).counts.held, 0, "and the counts came back with it");
    assert.equal(pageOf(qc).counts.open, 1);
    const [bar] = toast.toasts;
    assert.equal(bar?.tone, "err", "a failure is never painted as a finished press");
    assert.match(bar?.text ?? "", /Could not change that lead\./);
    assert.match(bar?.text ?? "", /the desk is down/, "the real reason is carried through");
  } finally {
    await page.close();
  }
});

test("a refusal ({ok:false}) rolls back exactly like a thrown call", async () => {
  /*
    The desk's server functions answer `{ok:false, error}` far more often than
    they throw, so a rollback wired only to `onError` would leave a held row
    held on the commonest failure there is.
  */
  toast.toasts.length = 0;
  const qc = freshClient();
  seed(qc, [{ id: 7, headline: "A", status: "new" }]);
  const page = await mount(
    wrap(
      qc,
      React.createElement(Harness, {
        press: { id: 7, status: "killed" },
        answer: async () => ({ ok: false, error: "That lead is already on the paper." }),
      }),
    ),
  );
  try {
    await page.click();
    assert.equal(statusOf(qc, ["leads"], 7), "new", "the kill did not stick");
    assert.equal(toast.toasts[0]?.tone, "err");
    assert.match(toast.toasts[0]?.text ?? "", /That lead is already on the paper\./);
  } finally {
    await page.close();
  }
});

test("an Undo moves the row back the way it came", async () => {
  toast.toasts.length = 0;
  const qc = freshClient();
  seed(qc, [{ id: 7, headline: "A", status: "held" }]);
  const page = await mount(
    wrap(qc, React.createElement(Harness, { press: { id: 7, status: "new" }, answer: async () => ({ ok: true }) })),
  );
  try {
    await page.click();
    assert.equal(statusOf(qc, ["leads"], 7), "new");
    assert.equal(pageOf(qc).counts.held, 0, "out of Held");
    assert.equal(pageOf(qc).counts.open, 1, "and back into Open");
  } finally {
    await page.close();
  }
});

test("one failed press in a fan-out does not put back the ones that took", async () => {
  /*
    THE BULK CASE, and the reason the undo is a per-lead status rather than a
    snapshot of the whole cache: twelve `setStatus` calls run at once, and a
    snapshot-and-restore on any one of them would write the pre-press cache back
    over the eleven that had already landed.

    Two presses are mounted here, exactly as the bulk strip mounts them, and the
    first is made to fail.
  */
  toast.toasts.length = 0;
  const qc = freshClient();
  seed(qc, [
    { id: 1, headline: "A", status: "new" },
    { id: 2, headline: "B", status: "new" },
  ]);
  const first = deferred();
  const page = await mount(
    wrap(
      qc,
      React.createElement(
        "div",
        null,
        React.createElement(Harness, {
          press: { id: 1, status: "held" },
          answer: () => first.promise,
        }),
        React.createElement(Harness, {
          press: { id: 2, status: "held" },
          answer: async () => ({ ok: true }),
        }),
      ),
    ),
  );
  try {
    const buttons = page.container.querySelectorAll("#press");
    await React.act(async () => {
      buttons[0].dispatchEvent(new window.Event("click", { bubbles: true }));
      buttons[1].dispatchEvent(new window.Event("click", { bubbles: true }));
    });
    assert.equal(pageOf(qc).counts.held, 2, "both rows moved");

    // Lead 2 lands, then lead 1 fails.
    await React.act(async () => {});
    await React.act(async () => first.reject(new Error("the desk is busy")));

    assert.equal(statusOf(qc, ["leads"], 1), "new", "the failed row came back");
    assert.equal(statusOf(qc, ["leads"], 2), "held", "the row that took did NOT");
    assert.equal(pageOf(qc).counts.held, 1);
  } finally {
    await page.close();
  }
});


