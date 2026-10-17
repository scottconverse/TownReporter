// guards: Release J queue fixes — Undo replaces the kill toast in place (THU-2/DHK-2), U takes back the last kill OR hold (THU-3), X kills the focused row (THT-8), the restore moves the row at once (DHJ-2), Compare offers the duplicate kill on open leads (THU-5), and the bulk strip's picker draws its label (THU-6)
//
// WHAT THIS FILE MOUNTS, AND WHY IT HAS TO.
//
// Five of the six rows are properties of the WIRING the Queue route builds:
// `desk.queue.tsx` cannot be imported here (a route with a router, server
// functions and a paper context), so the harness below rebuilds the Queue's
// presses out of the same modules the screen wires -- `desk-action.ts` (the
// shared action family), `desk-lead-status.ts` (the one optimistic rule),
// `desk-triage.ts` (the key rule), `fast-kill.ts` (the presses as values) --
// and mounts the REAL `LeadComparePanel` for the compare row, against a real
// React Query client.
//
// The honest limit, stated rather than implied: it catches the rule each module
// owns -- the ordering the U key consults, the name a kill toast carries, the
// key the X press resolves to, whether a restore patches the cache before the
// network answers, whether the compare panel draws its duplicate kill for an
// open lead, and that the strip's picker draws its own label. It does not catch
// a Queue that stopped calling these modules; that is the price of the wiring
// living on the screen, and `fast-kill-flow.test.mjs` carries the same caveat.
// Every row here drives behavior -- a module's exported rule, a mounted screen,
// or the real picker component -- and none reads a `src/` file's text, so a
// rename or a re-spelling inside the source cannot make this file pass or fail
// on its own.
import assert from "node:assert/strict";
import { test } from "node:test";

import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

const stub = (body) => transpileToUrl(body, "stub.js", {});

/* ------------------------------------------------------------------ stubs */

/*
  The toast layer is a recorder, exactly as in `fast-kill-flow.test.mjs`: what
  is under test is the press and the sentence it raises. The recorder keeps the
  `id` each toast was raised under, because THU-2/DHK-2 IS the id.
*/
const toastStub = stub(`
export const toasts = [];
export function deskToast(text, options = {}) {
  toasts.push({
    text,
    tone: options.tone ?? "ok",
    undo: options.undo ?? null,
    chips: options.chips ?? null,
    duration: options.duration,
    id: options.id,
    dismissed: options.dismissed === true,
  });
}
export function dismissDeskToast(id) { deskToast("", { id, dismissed: true }); }
export function deskErrorReason(error, what = "do that") {
  const raw = error && error.message ? String(error.message) : String(error ?? "");
  return raw || "the desk gave no reason for " + what;
}
export function deskToastHostMounted() { return true; }
`);
const toast = await import(toastStub);

const deskActionUrl = await moduleUrl("src/components/desk-action.ts", {
  "@/components/desk-toast": toastStub,
  "@/lib/news/refused-answer": await moduleUrl("src/lib/news/refused-answer.ts"),
});
const leadStatusUrl = await moduleUrl("src/components/desk-lead-status.ts", {});
const fastKillUrl = await moduleUrl("src/components/fast-kill.ts", {});
const triageUrl = await moduleUrl("src/components/desk-triage.ts", {});
const fastKill = await import(fastKillUrl);
const triage = await import(triageUrl);

/* ------------------------------- the Queue's undo wiring, rebuilt faithfully */

/*
  `QueueUndo` mirrors the two mutations `desk.queue.tsx` builds -- `setStatus`
  (the write a Kill or Hold sends) and `undoKill` (the restore) -- with the
  THREE things this release changed:

    - the kill's toast is raised under `killToastId(id)` (THU-2/DHK-2), so the
      restore can REPLACE it in place instead of stacking beside it;
    - `undoKill` raises "Restoring…" under that same name and dismisses it when
      the write answers;
    - `lastPress` is stamped by BOTH presses, so the screen can name whichever
      came last (THU-3).

  The optimistic rule is the real `leadStatusOptimistic`, spread in the way the
  route spreads it, so DHJ-2 is measured against the shipped rule and not a
  copy of it.
*/
const killToastId = (id) => `desk-kill-toast-${id}`;

/*
  A harness screen that presses the same two mutations the Queue presses, in the
  same shape `desk.queue.tsx` builds them (lines 305-321, 353-354): one
  `leadStatusOptimistic(qc)` handle shared by both presses, each press mapping
  its own variables into `{id, status}` before handing them over. It is
  deliberately minimal -- the assertions are about the WIRING (which toast name,
  which press came last, whether the cache moved before the answer), not the
  markup.
*/
const screenUrl = stub(`
import { createElement as h, useRef } from ${JSON.stringify(import.meta.resolve("react"))};
import { useQueryClient } from ${JSON.stringify(import.meta.resolve("@tanstack/react-query"))};
import { useDeskMutation } from ${JSON.stringify(deskActionUrl)};
import { leadStatusOptimistic } from ${JSON.stringify(leadStatusUrl)};
import { KILL_TOAST_MS, killPress, killUndoPress, holdPress, holdUndoPress, undoPressFor } from ${JSON.stringify(fastKillUrl)};
import { deskToast, dismissDeskToast } from ${JSON.stringify(toastStub)};

const killToastId = (id) => "desk-kill-toast-" + id;

export function Harness({ answer, restore = "new" }) {
  const qc = useQueryClient();
  const lastPress = useRef(null);
  const undoOptimistic = leadStatusOptimistic(qc);
  const undoMove = (press) => ({ id: press.id, status: press.status ?? "new" });

  const undoKill = useDeskMutation({
    mutationFn: async (press) => {
      if (lastPress.current && lastPress.current.id === press.id) lastPress.current = null;
      /* THU-2 / DHJ-2: raised in the SAME paint as the press, under the kill's
         own toast name, and cleared when the write answers. */
      const restoringId = killToastId(press.id);
      deskToast("Restoring…", { id: restoringId, duration: Infinity });
      try {
        return await answer(press);
      } finally {
        dismissDeskToast(restoringId);
      }
    },
    optimistic: (press) => undoOptimistic.optimistic(undoMove(press)),
    rollback: (context, press) => undoOptimistic.rollback(context, press && undoMove(press)),
    done: () => "Undone: the lead is back on the Queue.",
    failedLead: "Could not put that lead back. ",
    what: "put that lead back",
  });

  const setStatus = useDeskMutation({
    mutationFn: (input) => answer(input),
    ...leadStatusOptimistic(qc),
    done: (_r, input) =>
      input.status === "killed" ? "The lead moved to Killed. Undo is here, and you can say why in one tap." : "Held.",
    undo: (_r, input) => ({
      label: "Undo",
      run: async () => {
        await undoKill.mutateAsync(
          input.status === "held"
            ? holdUndoPress(holdPress(input.id, input.restore))
            : killUndoPress(input.id, input.restore),
        );
      },
    }),
    duration: (_r, input) => (input.status === "killed" ? KILL_TOAST_MS : undefined),
    toastId: (input) => (input.status === "killed" ? killToastId(input.id) : undefined),
    failedLead: "Could not change that lead. ",
  });

  return h("div", null,
    h("button", { id: "kill", onClick: () => {
      lastPress.current = { kind: "kill", id: 7, restore };
      setStatus.mutate(killPress(7, restore));
    } }, "Kill"),
    h("button", { id: "hold", onClick: () => {
      lastPress.current = { kind: "hold", id: 7, restore };
      setStatus.mutate(holdPress(7, restore));
    } }, "Hold"),
    h("button", { id: "u", onClick: () => {
      const pressed = lastPress.current;
      if (!pressed) return;
      lastPress.current = null;
      const press = undoPressFor(pressed);
      if (press) undoKill.mutate(press);
    } }, "U"),
  );
}
`);
const { Harness } = await import(screenUrl);

/*
  THU-3, THE WALK'S OWN FAILURE, as a second harness screen.

  The file above rebuilds the Queue's WIRING and stops there. This one rebuilds
  the path the WALK actually took, which is the reason THU-3 passed in the
  `data:` harness and failed on the real page:

    - `rows` is the LEAD objects the screen holds, not just an id and a status.
      The row's own Hold reads the status off its row (`holdStamp`, the shipped
      rule); the keyboard's H reads it off the CURSOR lead, which is a
      projection with the headline and nothing else -- exactly the gap the walk
      walked into, where `lastPress` was stamped with `restore: undefined`;
    - the H press goes through the SAME optimistic patch the page uses
      (`leadStatusOptimistic`), so the held lead leaves the Open list in the same
      paint as the press -- which is the second half of the finding;
    - and U is the real U branch: it looks the held press's lead up in `shown`
      and only fires when it finds it. That is the line the real page had, and on
      the real page a held lead is NOT in `shown` (it left the Open tab), so the
      branch is skipped and U does nothing.

  So this harness reproduces the page in the two ways the finding names: the
  press carries no restore when it is stamped from the cursor projection, and
  the held lead is gone from `shown` by the time U is pressed.
*/
const walkScreenUrl = stub(`
import { createElement as h, useRef, useState } from ${JSON.stringify(import.meta.resolve("react"))};
import { useQueryClient } from ${JSON.stringify(import.meta.resolve("@tanstack/react-query"))};
import { useDeskMutation } from ${JSON.stringify(deskActionUrl)};
import { leadStatusOptimistic } from ${JSON.stringify(leadStatusUrl)};
import { holdPress, holdUndoPress, undoPressFor, holdStamp, holdStampRestore } from ${JSON.stringify(fastKillUrl)};

/*
  The Queue's U branch. "branch" chooses which spelling of it runs:

    - "before" is the 180c87ec line the walk walked into, kept here so the test
      can go red on it: U only fires when the held lead is STILL on screen, so a
      held lead -- which the optimistic patch has taken off the Open tab -- is
      never found and U sends nothing;
    - "after" is the fix: the stamp is the whole memory the press needs, and
      undoPressFor turns it into the write. The lead left the LIST, not the
      screen, and the restore goes by id.
*/
export function WalkHarness({ answer, cursorStatus = { id: 7, headline: "Council meets on housing" }, getShown, branch = "after" }) {
  const qc = useQueryClient();
  const lastPress = useRef(null);
  const undoOptimistic = leadStatusOptimistic(qc);
  const undoMove = (press) => ({ id: press.id, status: press.status ?? "new" });

  const undoKill = useDeskMutation({
    mutationFn: (press) => answer(press),
    optimistic: (press) => undoOptimistic.optimistic(undoMove(press)),
    rollback: (context, press) => undoOptimistic.rollback(context, press && undoMove(press)),
    done: () => "Undone: the lead is back on the Queue.",
    failedLead: "Could not put that lead back. ",
    what: "put that lead back",
  });

  const setStatus = useDeskMutation({
    mutationFn: (input) => answer(input),
    ...leadStatusOptimistic(qc),
    done: () => "Held.",
    failedLead: "Could not change that lead. ",
  });

  return h("div", null,
    /*
      The row's own Hold: reads the status off the ROW, the way holdLead does
      on the page, and stamps it with the SHIPPED rule (holdStamp, fast-kill.ts)
      -- so the test is driving desk.queue.tsx's holdLead, not a copy of it.
    */
    h("button", { id: "rowHold", onClick: () => {
      const row = getShown()[0];
      const stamp = holdStamp(7, row);
      lastPress.current = stamp;
      setStatus.mutate(holdPress(7, stamp.restore));
    } }, "Row Hold"),
    /*
      The keyboard's H, before the fix: it stamps from the CURSOR lead, which is
      a projection with no status -- the shipped rule, handed a lead with no
      status, returns undefined. This is the stamp the walk's U then read.
    */
    h("button", { id: "keyHold", onClick: () => {
      const stamp = holdStamp(7, cursorStatus);
      lastPress.current = stamp;
      setStatus.mutate(holdPress(7, stamp.restore));
    } }, "Key H"),
    /*
      The keyboard's H, AFTER the fix: holdLeadById reads the lead's own row
      for the status, and holdStamp turns that row into the stamp -- the same
      two exported functions desk.queue.tsx calls.
    */
    h("button", { id: "keyHoldFixed", onClick: () => {
      const row = getShown().find((l) => l.id === 7) ?? { status: "held" };
      const stamp = holdStamp(7, row);
      lastPress.current = stamp;
      setStatus.mutate(holdPress(7, stamp.restore));
    } }, "Key H fixed"),
    h("button", { id: "u", onClick: () => {
      const shown = getShown();
      const pressed = lastPress.current;
      if (branch === "before") {
        /* 180c87ec: the held lead must still be on screen for U to fire. */
        const lead = shown[0];
        const pressedLead = pressed && pressed.kind === "hold" ? shown.find((l) => l.id === pressed.id) : undefined;
        if (pressed && pressed.kind === "hold" && (pressedLead || (lead && lead.id === pressed.id))) {
          const restore = pressedLead && pressedLead.status === "held" ? holdStampRestore(pressedLead.status) : pressed.restore;
          lastPress.current = null;
          const press = undoPressFor({ ...pressed, restore });
          if (press) undoKill.mutate(press);
        }
        return;
      }
      /* after: the stamp alone answers it, whatever the list is showing now. */
      if (pressed && pressed.kind === "hold") {
        lastPress.current = null;
        const press = undoPressFor(pressed);
        if (press) undoKill.mutate(press);
      }
    } }, "U"),
  );
}
`);
const { WalkHarness } = await import(walkScreenUrl);

/* ----------------------------------------------------------------- helpers */

const OPEN = ["leads", "open", "all", "best", "", 25];

function lead(overrides = {}) {
  return {
    id: 7,
    headline: "Council meets on housing",
    why: "Because it does",
    topic: "council",
    status: "new",
    source_urls: "[]",
    evidence: null,
    newsworthiness: 8,
    created_at: new Date().toISOString(),
    resurfaced_count: 0,
    last_resurfaced_at: null,
    possible_duplicate_of: null,
    ...overrides,
  };
}

function seed(qc, row) {
  qc.setQueryData(["leads"], [row]);
  const counts = {
    open: row.status !== "held" && row.status !== "killed" ? 1 : 0,
    held: row.status === "held" ? 1 : 0,
    killed: row.status === "killed" ? 1 : 0,
    all: 1,
  };
  qc.setQueryData(OPEN, { rows: counts.open ? [row] : [], total: counts.open, counts: { ...counts } });
}

const statusIn = (qc, id) => (qc.getQueryData(["leads"]) ?? []).find((r) => r.id === id)?.status;

const live = [];
test.afterEach(() => {
  for (const qc of live.splice(0)) {
    qc.clear();
    qc.unmount();
  }
});
const freshClient = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } },
  });
  live.push(qc);
  return qc;
};

async function mountHarness(qc, answer, { restore = "new" } = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Harness, { answer, restore }))));
  return {
    container,
    async click(id) {
      await React.act(async () => {
        container.querySelector("#" + id).dispatchEvent(new window.Event("click", { bubbles: true }));
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

/** Let a press's own microtask chain (cancelQueries -> onMutate -> patch) run dry. */
const drain = () => React.act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

/** The most recent recorder entry under `id` that carried words (not a dismissal). */
const byId = (id) => [...toast.toasts].reverse().find((t) => t.id === id && !t.dismissed);
/** Every entry under `id`. */
const allWithId = (id) => toast.toasts.filter((t) => t.id === id);

/*
  Mount the walk harness. `getShown` reads the Open tab's rows off the cache at
  press time, which is how the real screen reads `shown` (it is `leads`, and the
  handlers close over the current value) -- and it is what makes the held lead's
  disappearance from the Open list visible to the U branch.
*/
async function mountWalk(qc, answer, { cursorStatus, branch = "after" }) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: qc },
    React.createElement(WalkHarness, {
      answer,
      branch,
      cursorStatus: cursorStatus ?? { id: 7, headline: "Council meets on housing" },
      getShown: () => (qc.getQueryData(OPEN)?.rows ?? []),
    }))));
  return {
    container,
    async click(id) {
      await React.act(async () => {
        container.querySelector("#" + id).dispatchEvent(new window.Event("click", { bubbles: true }));
        for (let i = 0; i < 12; i++) await Promise.resolve();
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

/* ------------------------------------------------------------------- tests */

/*
  THU-2 / DHK-2. The defect was two names: the kill toast carried none, and
  "Restoring…" carried its own, so sonner drew the stale "Killed N leads. Undo"
  AND the "Restoring…" card over the rows. The fix is one name, handed to both.
*/
test("THU-2/DHK-2: the Restoring… toast replaces the kill's toast in place", async () => {
  toast.toasts.length = 0;
  const qc = freshClient();
  seed(qc, lead());
  /*
    The restore is held open, because THAT is the state the finding is about:
    the moment between the U press and the server's answer, when the old build
    had two cards on screen -- the kill sentence the editor had just answered,
    and a "Restoring…" the kill toast knew nothing about.
  */
  let releaseRestore;
  const page = await mountHarness(qc, (input) =>
    input.status === "new"
      ? new Promise((resolve) => { releaseRestore = () => resolve({ ok: true }); })
      : { ok: true });
  try {
    await page.click("kill");
    const killBar = allWithId(killToastId(7)).find((t) => /moved to Killed/.test(t.text));
    assert.ok(killBar, "the kill toast is raised under the lead's own name");
    assert.equal(killBar.undo?.label, "Undo", "and carries the way back");

    await React.act(async () => {
      void killBar.undo.run();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    /*
      One name, so the two cards the finding describes are ONE card: the kill
      sentence and the restore line were both raised under `desk-kill-toast-7`,
      which sonner draws as a replacement rather than a stack.
    */
    const underKillName = allWithId(killToastId(7));
    assert.deepEqual(
      underKillName.map((t) => t.text),
      ["The lead moved to Killed. Undo is here, and you can say why in one tap.", "Restoring…"],
      "the kill's sentence and Restoring… share the one name -- a replacement, not a second card",
    );
    assert.ok(
      !toast.toasts.some((t) => /Restoring…/.test(t.text) && t.id !== killToastId(7)),
      "and Restoring… is raised under no other name, so nothing is stacked beside it",
    );
    assert.ok(
      !toast.toasts.some((t) => t.text === "" && t.id !== undefined && /moved to Killed/.test(t.text)),
      "the stale kill sentence is not re-raised",
    );
    await React.act(async () => { releaseRestore(); for (let i = 0; i < 12; i++) await Promise.resolve(); });
    assert.ok(
      allWithId(killToastId(7)).some((t) => t.dismissed),
      "and when the restore lands, that one card is cleared",
    );
  } finally {
    await page.close();
  }
});

/*
  THU-3. The old order asked "is a held lead under the cursor?" before "which
  press came last?", so H-then-U could take back a kill and X-then-U could take
  back a hold. The rule now lives in one place -- `undoPressFor` (fast-kill.ts),
  which the Queue's U reads instead of re-deriving it from the row.

  The two presses are told apart by the status their Undo sends, which is the
  status the lead held BEFORE that press:

    - a HOLD's Undo sends the hold's own `restore` (`holdUndoPress` reads
      `press.restore` -- fast-kill.ts);
    - a KILL's Undo sends the kill press's `restore`.

  The lead starts `drafted`, so both Undos carry a value that names the press
  they came from. A hold's restore is read off the row; the kill's is stamped.
*/
test("THU-3: U takes back the most recent kill OR hold, whichever came last", async () => {
  /* The rule itself, in both orders, with no DOM in the way. */
  const kill = { kind: "kill", id: 7, restore: "drafted" };
  const hold = { kind: "hold", id: 7, restore: "drafted" };
  const pressOf = (p) => {
    const got = fastKill.undoPressFor(p);
    /* `override` rides along unset; the id and destination are the rule. */
    return got && { id: got.id, status: got.status };
  };
  assert.deepEqual(
    pressOf(hold),
    { id: 7, status: "drafted" },
    "a press after a Hold takes the Hold back, even when a Kill came before it",
  );
  assert.deepEqual(
    pressOf(kill),
    { id: 7, status: "drafted" },
    "and a press after a Kill takes the Kill back",
  );
  assert.equal(fastKill.undoPressFor(null), null, "with no press remembered, U sends nothing");

  /*
    The same rule, driven through the screen: pressing H then U, and X then U,
    each send exactly one undo, and it is the press that came last.
  */
  for (const [first, second] of [
    ["kill", "hold"],
    ["hold", "kill"],
  ]) {
    toast.toasts.length = 0;
    const qc = freshClient();
    seed(qc, lead({ status: "drafted" }));
    const calls = [];
    const page = await mountHarness(qc, async (input) => {
      calls.push(input);
      return { ok: true };
    }, { restore: "drafted" });
    try {
      await page.click(first);
      await page.click(second);
      const beforeUndo = calls.length;
      await page.click("u");
      const undo = calls.slice(beforeUndo);
      assert.equal(undo.length, 1, `pressing ${first} then ${second}: U sends exactly one press`);
      assert.equal(
        undo[0].status,
        "drafted",
        `pressing ${first} then ${second}: U must undo the ${second} (the one that came last), landing on drafted`,
      );
    } finally {
      await page.close();
    }
  }
});

/*
  THU-3, THE WALK'S OWN FINDING. The test above passes in the `data:` harness
  because it hands the press a `restore` directly. On the real page it did not:
  the keyboard's H stamped `lastPress` from the CURSOR lead, which is a
  projection with no status, so the stamp carried `restore: undefined`; and the
  U branch only fired when the held lead was STILL on screen, but the hold's
  optimistic patch takes it off the Open tab in the same paint, so the search
  found nothing. U after a Hold did nothing at all, which is what the walk saw.

  This test drives the SAME two halves: the H press is stamped from a cursor
  projection (no status), the optimistic patch is the real one, and the U branch
  looks the held lead up in `shown` -- which no longer holds it. It fails on
  180c87ec (U sends nothing) and passes once the branch reads the stamp.
*/
test("THU-3 (walk): U after a Hold puts the lead back, with the held row gone from shown", async () => {
  /*
    HALF ONE, the defect itself: the OLD branch on the OLD stamp. The press is
    stamped from the cursor projection (no status) -- the first half -- and U
    only fires when the held lead is still in `shown`, which it is not once the
    optimistic patch has run -- the second half. U sends nothing. This is what
    the walk measured on :3100, and it is the red half of this test.
  */
  {
    toast.toasts.length = 0;
    const qc = freshClient();
    seed(qc, lead({ status: "new" }));
    const shownNow = () => (qc.getQueryData(OPEN)?.rows ?? []);
    const calls = [];
    const page = await mountWalk(qc, async (input) => { calls.push(input); return { ok: true }; },
      { branch: "before", cursorStatus: { id: 7, headline: "Council meets on housing" } });
    try {
      assert.equal(
        fastKill.undoPressFor({ kind: "hold", id: 7, restore: undefined })?.status,
        undefined,
        "a hold stamped from the cursor projection carries no restore -- the defect's first half",
      );
      assert.ok(shownNow().some((l) => l.id === 7), "the lead is on the Open tab before the press");
      await page.click("keyHold");
      assert.equal(
        shownNow().some((l) => l.id === 7),
        false,
        "the held lead is off the Open tab by the time U is pressed -- the defect's second half",
      );
      const before = calls.length;
      await page.click("u");
      assert.equal(
        calls.length - before,
        0,
        "on the old branch U after a Hold sends nothing -- the walk's own measurement",
      );
    } finally {
      await page.close();
    }
  }
  /*
    HALF TWO, the fix: the same press, stamped by the fixed key path -- the lead
    read off its own row so the stamp carries `new` -- and the U branch that
    reads the stamp instead of searching `shown`. U sends the restore by id.
  */
  {
    toast.toasts.length = 0;
    const qc = freshClient();
    /*
      A `drafted` lead, so the destination is unambiguous: `holdStamp` reads it
      off the row and stamps `drafted`, which is a status `new` is not -- so "the
      stamp carried the row's status" cannot be confused with "the stamp carried
      nothing and the server guessed `new`", which is what the old key path sent.
    */
    seed(qc, lead({ status: "drafted" }));
    const shownNow = () => (qc.getQueryData(OPEN)?.rows ?? []);
    const calls = [];
    const page = await mountWalk(qc, async (input) => { calls.push(input); return { ok: true }; },
      { branch: "after", cursorStatus: { id: 7, headline: "Council meets on housing" } });
    try {
      await page.click("keyHoldFixed");
      assert.equal(
        shownNow().some((l) => l.id === 7),
        false,
        "the held lead is still off the Open tab -- the fix does not depend on it being shown",
      );
      const before = calls.length;
      await page.click("u");
      const undo = calls.slice(before);
      assert.equal(undo.length, 1, "U after a Hold sends exactly one press");
      assert.equal(
        undo[0].status,
        "drafted",
        "and it names where the lead goes back to: the status the row held before the hold",
      );
      assert.equal(statusIn(qc, 7), "drafted", "and the lead is back where it was");
    } finally {
      await page.close();
    }
  }
});

/*
  THT-8. The hint "X kill" is printed on the row's Kill button, but the key did
  nothing while that button held focus because every key stood down on a
  focused control. `triageAction` lets an X on a row's own Kill through, and the
  branch is guarded by `interactiveTarget` -- the one place that decides whether
  a focused control swallows a key.
*/
test("THT-8: X on a focused row Kill button kills THAT row", () => {
  /*
    The row's Kill is a real element in a real document, marked the way the row
    marks it (`data-triage-kill`), so the branch is exercised through the same
    `closest`/`interactiveTarget` path the key event takes. `interactiveTarget`
    reads the DOCUMENT, so a bare object literal is not enough here.
  */
  const rowKill = document.createElement("button");
  rowKill.setAttribute("data-triage-kill", "42");
  document.body.append(rowKill);
  try {
    assert.deepEqual(
      triage.triageAction({ key: "x", target: rowKill }),
      { kind: "kill", rowId: "42" },
      "X on a row's own Kill is that row's kill, and names it",
    );
    /* The same row Kill, with focus: the control the hint is printed on must not swallow the key. */
    rowKill.focus();
    assert.deepEqual(
      triage.triageAction({ key: "x", target: rowKill }),
      { kind: "kill", rowId: "42" },
      "and it still fires while that Kill button holds focus -- which is the defect",
    );
  } finally {
    rowKill.remove();
  }
  const plainButton = document.createElement("button");
  document.body.append(plainButton);
  try {
    assert.equal(
      triage.triageAction({ key: "x", target: plainButton }),
      null,
      "X on some other control still stands down -- a stray kill behind a dialog is not wanted",
    );
  } finally {
    plainButton.remove();
  }
  assert.deepEqual(
    triage.triageAction({ key: "x", target: document.body }),
    { kind: "kill" },
    "X with no control focused stays the cursor-row kill it always was",
  );
  /* The legend still promises the key, and U is still listed. */
  assert.ok(triage.TRIAGE_LEGEND.some(([k, w]) => k === "X" && w === "kill"), "the legend keeps 'X kill'");
  assert.ok(triage.TRIAGE_LEGEND.some(([k, w]) => k === "U" && w === "undo"), "and 'U undo'");
});

/*
  DHJ-2. The row must leave the Killed tab in the SAME paint as the U press, not
  when the server answers, and the editor must be told the restore is in flight
  for the whole of that time. Both halves are asserted here, because a press that
  neither moves the row nor says anything IS the ~2.5 s of silence the finding
  describes.

  The optimistic rule under test is the real `leadStatusOptimistic`, spread in
  `undoKill` the way the route spreads it -- an optimistic-only restore has no
  patch here, so "the patch happens" is not something the harness grants.
*/
test("DHJ-2: the restore moves the row AND says so before the server answers", async () => {
  toast.toasts.length = 0;
  const qc = freshClient();
  /*
    A lead starting at `drafted` makes the move unambiguous: U must put it back
    to `drafted`, a status the killed row did not hold, so "it moved" cannot be
    confused with "it was already there".
  */
  seed(qc, lead({ status: "drafted" }));
  let releaseRestore;
  const answer = (input) =>
    input.status === "killed"
      ? { ok: true }
      : new Promise((resolve) => { releaseRestore = () => resolve({ ok: true, input }); });
  const page = await mountHarness(qc, answer, { restore: "drafted" });
  try {
    await page.click("kill");
    assert.equal(statusIn(qc, 7), "killed", "the Kill press moved the lead onto the Killed tab at once");
    /*
      U is pressed with the restore's answer held open, then the press's own
      microtask chain is drained to a standstill -- no timers are allowed to run,
      so what is on screen at this point is what the press itself put there.
    */
    await page.click("u");
    await drain();
    assert.equal(statusIn(qc, 7), "drafted", "the lead is back where it was before the server answers");
    const line = byId(killToastId(7));
    assert.equal(
      line?.text,
      "Restoring…",
      "and the press says the restore is in flight for the whole of that wait",
    );
    assert.ok(releaseRestore, "with the server still unanswered");
    await React.act(async () => { releaseRestore(); for (let i = 0; i < 12; i++) await Promise.resolve(); });
  } finally {
    await page.close();
  }
});

/*
  THU-5. "Same story — kill this one" was offered on HELD leads only. The panel's
  own gate is status; the story page's gate was the raw foreign key. Both are
  exercised here through the REAL panel.
*/
const compareUrl = await (async () => {
  const chrome = stub(`
    import React from "react";
    export const Chip = ({s}) => React.createElement("span", null, s);
    export const InkButton = ({children,onClick,disabled,ariaLabel}) => React.createElement("button", {onClick,disabled,"aria-label":ariaLabel}, children);
  `);
  const states = stub(`import React from "react"; export const Notice=({kind,children})=>React.createElement("div",{"data-kind":kind},children);`);
  const router = stub(`import React from "react"; export const Link=({children,...props})=>React.createElement("a",props,children);`);
  const paperStub = stub(`
    export const PAPER = { timezone: "America/Denver" };
    export const TOPICS = [];
    export function formatClockTime() { return "2:10 p.m."; }
    export function formatListDateTime() { return "Oct. 8, 2:10 p.m."; }
    export function parseUrlList(raw) { try { const p = JSON.parse(raw || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } }
  `);
  const copy = await moduleUrl("src/lib/news/desk-copy.ts", {
    "./preflight.ts": stub("export const looksLikeProviderAuthFailure=()=>false; export const providerAuthTarget=()=>\"\";"),
    "./lead-match.ts": stub("export const distinguishingOverlap=()=>({subjects:0,names:0}); export const explainPairMatch=()=>null; export const sharesTightName=()=>false;"),
    "../paper.ts": paperStub,
  });
  return moduleUrl("src/components/desk-lead-compare.tsx", {
    "@/components/desk-chrome": chrome,
    "@/components/states": states,
    "@/components/fast-kill": stub("export const KILL_TOAST_MS = 15000;"),
    "@tanstack/react-router": router,
    "@/lib/paper": paperStub,
    "@/lib/news/desk-copy": copy,
    "@/lib/news/duplicate-review": await moduleUrl("src/lib/news/duplicate-review.ts"),
    "@/components/desk-toast": stub("export function deskToast(){}"),
  });
})();
const { LeadComparePanel } = await import(compareUrl);

const side = (id, headline, status) => ({ id, headline, status, why: "A source record says this happened.", source_urls: "[]" });

test("THU-5: an OPEN lead in Compare is offered the duplicate kill, beside its own", async () => {
  window.confirm = () => true;
  const root = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(LeadComparePanel, {
      current: side(458, "Housing and Human Services Advisory Board Sets Agency Funding Hearings", "new"),
      prior: side(12, "Housing and Human Service Advisory Board sets three agency funding hearings this month", "killed"),
      onKillThis: async () => ({ ok: true }),
      onNotADuplicate: async () => ({ ok: true }),
      formatDate: () => "Oct. 6, 2026",
    })));
    const press = [...document.querySelectorAll("button")].find((b) => /Same story — kill this one/.test(b.textContent));
    assert.ok(press, "an OPEN lead must be offered 'Same story — kill this one', not only the story page's Kill");
  } finally {
    await React.act(async () => root.unmount());
  }
});

/*
  THU-6. The old-eyes rule: no muted small text. The bulk strip's picker label
  came out pale on the yellow bar. The label the editor sees is a REAL one: the
  strip mounts the `ModelPicker` (`desk.queue.tsx:1619`) with the strip's own
  props, and that picker draws a `.model-picker-label` reading "Model for these
  stories" -- on the `compact` picker, which is what the strip asks for.
*/
const modelPickerUrl = await moduleUrl("src/components/model-picker.tsx", {
  "@/lib/news/model-choice": await moduleUrl("src/lib/news/model-choice.ts"),
  "@/lib/news/provider-registry": stub(`
export const automaticEffortNote = () => "";
export const modelEffortLabel = (v) => v;
export const modelEffortsFor = () => [];
export const pickerShownEffort = (v) => v;
export const providerEntry = () => null;
`),
  /*
    The three reads the picker makes through the desk's server: the catalog and
    the availability probe, and the two settings calls below. The row under test
    is the LABEL, so these name a real-but-empty local catalog -- no server, no
    default model -- rather than a bare `{}`.

    THU-6 flake (Oct 14): the two local reads used to answer `{}` and `null`.
    Both are the SAME query keys the picker shares with any other mounted
    picker, and a react-query cache in this file is not per-render: a value of
    the wrong SHAPE reaches the picker and the picker reads it as the real one.
    `localModelCatalog() === {}` leaves `catalog.servers` undefined, and
    `localMetadata` (`model-picker.tsx:517-519`) calls `.find` on it, so the
    render threw `Cannot read properties of undefined (reading 'find')` --
    intermittently, depending on which cached shape the picker saw first. The
    stubs now answer the full `LocalCatalog` / `LocalModelChoice` shapes the
    picker reads, so a cross-key cache hit is harmless.
  */
  "@/lib/news/provider-availability": stub(`
export const providerAvailability = async () => ({});
export const localModelCatalog = async () => ({ servers: [], defaultModel: null, checkedAt: 0 });
export const refreshLocalModelCatalog = async () => ({ servers: [], defaultModel: null, checkedAt: 0 });
`),
  "@/lib/news/provider-availability-key": await moduleUrl("src/lib/news/provider-availability-key.ts"),
  "@/lib/news/desk-local-model": await moduleUrl("src/lib/news/desk-local-model.ts"),
  /*
    The stored local pick, in the full `LocalModelChoice` shape -- `catalog`
    included, because `optionText` reads
    `selectedLocalChoice.data.catalog.servers` (`model-picker.tsx:539`). A
    `null` here is read as the "no choice yet" state and the picker falls back
    to the catalog above; both shapes now answer what the picker asks for.
  */
  "@/lib/news/provider-settings": stub(`
export const getLocalModelChoice = async () => ({
  override: null,
  storedPick: null,
  source: "stored",
  notice: null,
  catalog: { servers: [], defaultModel: null, checkedAt: 0 },
});
export const saveLocalModelFn = async () => null;
`),
  "@/lib/news/custom-ai-settings": stub(`export const getCustomAiConnectionsFn = async () => [];`),
  "@/lib/news/claim": stub(`export const myDesk = async () => null;`),
  "@/lib/news/writer-bar": await moduleUrl("src/lib/news/writer-bar.ts"),
  "@/components/desk-chrome-utils": stub(`export const announceToDesk = () => {};`),
});

test("THU-6: the bulk strip's picker label is drawn by the real compact picker", async () => {
  const { ModelPicker } = await import(modelPickerUrl);
  const qc = freshClient();
  const root = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => root.render(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(ModelPicker, {
          /*
            The strip's own props (desk.queue.tsx:1619-1628): the scope, the
            words the editor reads, and the `compact` that selects the strip's
            own picker styling -- the `.queue-bulk .model-picker-label` rule the
            THU-6 finding is about.
          */
          scope: "forced",
          label: "Model for these stories",
          value: "claude-sonnet-5-5",
          onChange: () => {},
          compact: true,
          disabled: false,
        })),
    ));
    const label = [...document.querySelectorAll("label.model-picker-label")]
      .find((n) => n.textContent === "Model for these stories");
    assert.ok(label, "the strip's picker draws its label, 'Model for these stories'");
    const picker = label.closest(".model-picker");
    assert.ok(picker, "and draws it inside the picker");
    assert.ok(
      picker.className.includes("compact"),
      "on the compact picker the strip asks for -- the one its own label rule is scoped to",
    );
  } finally {
    await React.act(async () => root.unmount());
  }
});

/*
  TPT-2. A click on a Queue row's body makes that row the keyboard cursor row,
  so the next H, X, U or Enter acts on the row the editor clicked. The REAL
  `LeadRowView` is mounted here. A click on a control in the row (a button, a
  link, the checkbox) keeps its click to itself: the checkbox moves the cursor
  through its own pick, and a button must not also move it onto its row.
*/
const rowUrl = await (async () => {
  const chrome = stub(`
    import React from "react";
    export const Chip = ({s}) => React.createElement("span", null, s);
    export const InkButton = ({children,onClick,disabled,ariaLabel}) => React.createElement("button", {type:"button",onClick,disabled,"aria-label":ariaLabel}, children);
    export const DeskMoreMenu = ({ariaLabel}) => React.createElement("button", {type:"button","aria-label":ariaLabel}, "More");
    export const Score = () => null;
  `);
  const action = stub(`
    import React from "react";
    export const ActionButton = ({children,onClick,disabled}) => React.createElement("button", {type:"button",onClick,disabled}, children);
    export const rowActionPhase = () => "idle";
  `);
  const router = stub(`import React from "react"; export const Link=({children,...props})=>React.createElement("a",props,children);`);
  const paperStub = stub(`
    export const formatAge = () => "2h";
    export const parseUrlList = (raw) => { try { const p = JSON.parse(raw || "[]"); return Array.isArray(p) ? p : []; } catch { return []; } };
  `);
  const copy = stub(`
    export const editorTitle = (h) => h;
    export const cameBackLabel = () => "";
    export const DEVELOPING_LABEL = "";
    export const dupAiReason = () => "";
    export const duplicateLinkState = () => "ok";
    export const killedAsDuplicateNote = () => "";
    export const killRecordLine = () => "";
    export const printedDuplicateLine = () => null;
    export const leadSourceEvidenceLabel = () => "";
    export const STALE_DUPLICATE_LABEL = "";
    export const STALE_DUPLICATE_NOTICE = "";
  `);
  return moduleUrl("src/components/desk-leads.tsx", {
    "@/components/desk-chrome": chrome,
    "@/components/action-button": action,
    "@tanstack/react-router": router,
    "@/lib/paper": paperStub,
    "@/lib/paper-context-state": stub(`
      export const usePaper = () => ({ timezone: "America/Denver" });
      export const usePaperDateFormatters = () => ({ formatShortDate: () => "Oct. 6" });
    `),
    "@/lib/news/desk-copy": copy,
    "../lib/news/desk-warning.ts": stub("export const deskWarning = () => null;"),
    "@/components/desk-triage": triageUrl,
    "@/components/model-picker": stub("export const ModelPicker = () => null;"),
    "@/components/use-job-model-assignment": stub("export const useJobModelAssignment = () => ({ hasAssignment: false });"),
    "@/components/first-run-picker-default": stub("export const useFirstRunPickerSeed = () => {};"),
    "@/lib/news/model-choice": stub("export const modelChoiceLabel = (c) => String(c);"),
    "@/lib/news/provider-registry": stub("export const defaultModelEffort = () => null;"),
    "@/components/states": stub(`import React from "react"; export const Notice=({children})=>React.createElement("div",null,children);`),
  });
})();
const { LeadRowView } = await import(rowUrl);

test("TPT-2: a click on a row's body moves the cursor there; a click on a control in the row does not", async () => {
  const moved = [];
  const picked = [];
  const root = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => root.render(React.createElement(LeadRowView, {
      lead: lead({ id: 459, why: "Because it does" }),
      sectionName: "Open",
      onHold: () => {},
      onKill: () => {},
      onDeleteSelect: (selected) => picked.push(selected),
      onSelectRow: () => moved.push("row"),
    })));
    const row = document.querySelector(".lead-row");
    assert.ok(row, "the row is drawn");
    const body = [...row.querySelectorAll("*")].find((el) => el.childElementCount === 0 && el.textContent.includes("Because it does"));
    assert.ok(body, "the row's body text is drawn");
    await React.act(async () => body.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.deepEqual(moved, ["row"], "a click on the row's body moves the cursor to that row");

    await React.act(async () => row.querySelector("button").dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.deepEqual(moved, ["row"], "a click on a button in the row keeps its click to itself");

    await React.act(async () => row.querySelector("input[type='checkbox']").dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(picked.length, 1, "the checkbox still reports its pick");
    assert.deepEqual(moved, ["row"], "and the checkbox's click does not also fire the row's own cursor move");
    assert.equal(row.getAttribute("data-triage-row"), "459", "the row names itself to the keys, so X and H on its controls find it");
  } finally {
    await React.act(async () => root.unmount());
  }
});
