/*
  The fast kill, pressed.

  Owner, 2026-10-03: killing a lead took "about half a dozen clicks" and, after
  twenty of them, "the reason" was the part that got skipped -- and the reason is
  the part the record needs. The fix has three behaviours, and this file holds
  each of them:

    1. the row's own Kill kills in ONE press, is reachable without opening
       anything, and carries a name a screen reader can read;
    2. the Undo raised with that press puts the lead back on the Queue in the
       status it held before the kill -- New, Held or Drafted -- back in the Open
       tab's rows and back in the Open count;
    3. one tap on a reason chip writes THAT chip's sentence to `kill_reason`,
       and the chips stop asking once one is taken.

  WHY IT MOUNTS ANYTHING. Each behaviour is a property of the WIRING, not of a
  value: `killPress(7)` is arithmetic, but "one press kills it" is the ROW
  handing its press to the screen and the SCREEN handing the write to the shared
  action family. `desk.queue.tsx` cannot be imported here -- it is a route with a
  router, server functions and a paper context -- so the harness below rebuilds
  the Queue's per-row wiring out of the same three modules the screen wires:

    - `desk-action.ts` (the shared action family: the mutation, the toast, the
      undo, the rollback),
    - `desk-lead-status.ts` (the one optimistic rule),
    - `fast-kill.ts` (the presses and the chips).

  and mounts the REAL `LeadRowView` -- with the REAL `InkButton` and
  `DeskMoreMenu` behind it -- in an in-process DOM (`scripts/dom-harness.mjs`),
  against a real React Query client.

  WHAT THIS CATCHES AND WHAT IT DOES NOT, stated plainly because it is the
  honest limit. It catches: the row's Kill being deleted or moved behind the More
  menu, `killPress`/`killUndoPress` changing the write they send, the chips being
  deleted or writing the wrong sentence. It does not catch a QUEUE that stopped
  passing `onKillNow`, or that stopped handing `leadStatusOptimistic` to
  `setStatus`, because those are single lines in a route file this harness cannot
  load. That is the price of the wiring living on the screen; it is written down
  here rather than implied.

  STUBS, named: the toast layer is a recorder -- what is under test is the press
  and the sentence it raises, not what sonner does with it, and
  `fb5-desk-toast.test.mjs` owns that half. Everything else is real: react,
  react-dom, @tanstack/react-query, and the three modules above.
*/
import assert from "node:assert/strict";
import { test } from "node:test";

import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

/* The DOM has to exist before react-dom/client is imported. */
const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

/** A stand-in module: transpiled, with its bare specifiers resolved by the harness. */
const stub = (body) => transpileToUrl(body, "stub.js", {});

/* ------------------------------------------------------------------ stubs */

const toastStub = stub(`
export const toasts = [];
export function deskToast(text, options = {}) {
  toasts.push({
    text,
    tone: options.tone ?? "ok",
    undo: options.undo ?? null,
    chips: options.chips ?? null,
    duration: options.duration,
  });
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
  "@/lib/news/refused-answer": await moduleUrl("src/lib/news/refused-answer.ts"),
});
const leadStatusUrl = await moduleUrl("src/components/desk-lead-status.ts", {});
const fastKillUrl = await moduleUrl("src/components/fast-kill.ts", {});
const fastKill = await import(fastKillUrl);
const { KILL_REASON_CHIPS } = await import(await moduleUrl("src/lib/news/kill-reasons.ts", {}));

/* ------------------------------------------ the row and everything it draws */

/*
  `desk-leads.tsx`'s non-row imports, stood in for exactly as
  `lead-badge-render.test.mjs` stands them in -- a row test must not need a
  router, a paper, a model picker or a live server to render one row. The two
  exception are the controls this unit is about: `InkButton` (the Kill's own
  button) and `DeskMoreMenu` (the place the old kill hid behind) are the REAL
  ones, so the render assertions below describe the markup the desk ships rather
  than a stand-in's idea of it.
*/
const reactRouterStub = stub(`
  import { createElement } from "react";
  export function Link({ to, params, children, ...rest }) {
    return createElement("a", { href: String(to ?? "#"), "data-params": JSON.stringify(params ?? null), ...rest }, children);
  }
  export function useMatchRoute() { return () => false; }
  export function useNavigate() { return () => {}; }
  export function useRouterState() { return "/"; }
`);
const reactQueryStub = stub(`
  export function useQuery() { return { data: [] }; }
  export function useMutation() { return { mutate() {}, isPending: false, isError: false }; }
  export function useQueryClient() { return { invalidateQueries: async () => {} }; }
`);
const paperStub = stub(`
  export function formatAge() { return "2h ago"; }
  export function parseUrlList(raw) {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  export const TOPICS = [];
`);
const paperContextStub = stub(`
  export function usePaperDateFormatters() { return { formatShortDate: () => "Sep 3", formatDate: () => "Sep 3" }; }
  export function usePaper() { return { name: "The Paper", city: "Longmont" }; }
`);
const modelPickerStub = stub(`
  import { createElement } from "react";
  export function ModelPicker() { return createElement("div", { className: "model-picker-stub" }); }
`);
const firstRunPickerStub = stub(`export function useFirstRunPickerSeed() {}`);
const modelChoiceStub = stub(`export function modelChoiceLabel() { return "Automatic"; }`);
const providerRegistryStub = stub(`export function defaultModelEffort() { return null; }`);
const statesStub = stub(`
  import { createElement } from "react";
  export function Notice({ children }) { return createElement("div", { className: "notice" }, children); }
`);
const preflightStub = stub(`
  export function looksLikeProviderAuthFailure() { return false; }
  export function providerAuthTarget() { return ""; }
`);
const leadMatchStub = stub(`export function distinguishingOverlap() { return { subjects: 0, names: 0 }; }`);

/*
  The real desk-copy: both the row (killRecordLine, printedDuplicateLine, …) and
  the shell (chipLabel, openLeads, …) read their words from it, so a stub here
  would let the row and the shell explain the same lead differently -- the bug
  class those functions exist to prevent. Its three own imports are stubbed, the
  same three `lead-badge-render.test.mjs` stubs.
*/
const deskCopy = await moduleUrl("src/lib/news/desk-copy.ts", {
  "./preflight.ts": preflightStub,
  "./lead-match.ts": leadMatchStub,
  "../paper.ts": paperStub,
});
const deskNavUrl = await moduleUrl("src/lib/desk-nav.ts", {});
const deskJobsUrl = await moduleUrl("src/components/desk-jobs.ts", {});
const deskChromeUtils = await moduleUrl("src/components/desk-chrome-utils.ts", {
  "@/components/desk-toast": toastStub,
});
const actionButtonUrl = await moduleUrl("src/components/action-button.ts", {});

const deskChromeUrl = await moduleUrl("src/components/desk-chrome.tsx", {
  "@tanstack/react-router": reactRouterStub,
  "@tanstack/react-query": reactQueryStub,
  "@/lib/paper-context": paperContextStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/auth/gates": stub(`import { createElement } from "react"; export function UserButton() { return createElement("span"); }`),
  "@/lib/auth/client": stub(`export async function signOut() {}`),
  "@/lib/auth/use-current-user": stub(`export function useCurrentUserState() { return { user: null, isPending: false }; }`),
  "@/lib/news/claim": stub(`export async function leaveEditor() { return { ok: true }; }`),
  "@/lib/news/desk-copy": deskCopy,
  "@/lib/desk-nav": deskNavUrl,
  "@/components/desk-chrome-utils": deskChromeUtils,
  "@/components/desk-toaster": stub(`export function DeskToaster() { return null; }`),
  "@/components/desk-jobs": deskJobsUrl,
  "@/components/JobCard": stub(`export function DeskJobCard() { return null; } export function JobCard() { return null; }`),
  "@/components/job-card-state": stub(
    `export function useDeskJobs() { return { data: [], isPending: false, isError: false, refetch() {} }; } export function invalidateDeskJobs() {}`,
  ),
  "@/lib/appearance-context": stub(
    `export function useAppearance() { return { appearance: { desk: "light", size: "normal", reader: "light" }, surface: "light", setDesk() {}, refreshReader() {} }; } export function useHydrated() { return false; }`,
  ),
  "@/components/dialog": stub(`export function Dialog() { return null; } export function ChoiceCard() { return null; }`),
  "@/components/dialogs": stub(`export function NewStoryDialog() { return null; }`),
  "@/lib/news/desk": stub(`export async function listLeads() { return []; } export async function listDeskJobs() { return []; } export async function listFollowUps() { return []; }`),
  "@/lib/news/opinion": stub(`export async function listEditorials() { return []; }`),
  "@/lib/news/dark": stub(`export async function listInvestigations() { return []; }`),
  "@/lib/news/follow-up-copy": stub(`export function isAgentKind() { return false; } export function matchesFollowUpFilter() { return false; }`),
});

const deskLeadsUrl = await moduleUrl("src/components/desk-leads.tsx", {
  "@tanstack/react-router": reactRouterStub,
  "@/components/desk-chrome": deskChromeUrl,
  "@/components/action-button": actionButtonUrl,
  "@/lib/paper": paperStub,
  "@/lib/paper-context-state": paperContextStub,
  "@/lib/news/desk-copy": deskCopy,
  "@/components/model-picker": modelPickerStub,
  "@/components/first-run-picker-default": firstRunPickerStub,
  "@/lib/news/model-choice": modelChoiceStub,
  "@/lib/news/provider-registry": providerRegistryStub,
  "@/components/states": statesStub,
});
const { LeadRowView } = await import(deskLeadsUrl);

/* ------------------------------------------------------- the harness screen */

/*
  One Queue row, wired exactly as the Queue wires it: `useDeskMutation` for the
  status write with the real optimistic rule spread in, the row's Kill carrying
  the status it will be undone to (`killPress(lead.id, restoreStatus(lead.status))`),
  the Undo handing `killUndoPress` to the Queue's second write (`undoKill` --
  the one that may restore `drafted`), the chips drawing the REAL
  `KillReasonChips` with the screen's own save mutation, and the kill's longer
  life.
*/
const screenUrl = stub(`
import { createElement as h } from ${JSON.stringify(import.meta.resolve("react"))};
import { useQueryClient } from ${JSON.stringify(import.meta.resolve("@tanstack/react-query"))};
import { useDeskMutation } from ${JSON.stringify(deskActionUrl)};
import { leadStatusOptimistic } from ${JSON.stringify(leadStatusUrl)};
import { LeadRowView } from ${JSON.stringify(deskLeadsUrl)};
import {
  KILL_TOAST_MS,
  KillReasonChips,
  killPress,
  killUndoPress,
  restoreStatus,
} from ${JSON.stringify(fastKillUrl)};

export function Screen({ lead, answer }) {
  const qc = useQueryClient();
  const saveKillReason = useDeskMutation({
    mutationFn: (request) => answer(request),
    pending: "Keeping the reason…",
    done: () => "",
    failedLead: "Could not keep that reason. ",
    what: "keep that reason",
  });
  const undoKill = useDeskMutation({
    mutationFn: (press) => answer(press),
    ...leadStatusOptimistic(qc),
    pending: "Undoing…",
    done: () => "Undone: the lead is back on the Queue.",
    failedLead: "Could not put that lead back. ",
    what: "put that lead back",
  });
  const setStatus = useDeskMutation({
    mutationFn: (input) => answer(input),
    ...leadStatusOptimistic(qc),
    pending: "Saving…",
    done: (_result, input) =>
      input.status === "killed"
        ? "The lead moved to Killed. Undo is here, and you can say why in one tap."
        : "Undone: the lead is back on the Queue.",
    undo: (_result, input) =>
      input.status === "new"
        ? null
        : {
            label: "Undo",
            run: async () => {
              await undoKill.mutateAsync(killUndoPress(input.id, input.restore ?? "new"));
            },
          },
    chips: (_result, input) =>
      input.status === "killed"
        ? h(KillReasonChips, { leadId: input.id, save: (request) => saveKillReason.mutate(request) })
        : null,
    duration: (_result, input) => (input.status === "killed" ? KILL_TOAST_MS : undefined),
    failedLead: "Could not change that lead. ",
  });
  return h(LeadRowView, {
    lead,
    roomy: true,
    onKillNow: () => setStatus.mutate(killPress(lead.id, restoreStatus(lead.status))),
    killPending:
      setStatus.isPending && setStatus.variables?.id === lead.id && setStatus.variables?.status === "killed",
  });
}
`);
const { Screen } = await import(screenUrl);

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

/** Today's array and the Queue's Open page, as the desk holds them. */
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

const statusIn = (qc, id) =>
  (qc.getQueryData(["leads"]) ?? []).find((row) => row.id === id)?.status;
const openIds = (qc) => (qc.getQueryData(OPEN)?.rows ?? []).map((row) => row.id);
const openCount = (qc) => qc.getQueryData(OPEN)?.counts?.open;
const killedCount = (qc) => qc.getQueryData(OPEN)?.counts?.killed;

/*
  Every client this file makes, so the file lets them go. A settled mutation's
  GC timer is not released by `clear()` alone, which is why the mutation
  lifetime is zero -- the same reason, and the same shape, as
  `fb6-optimistic-rollback.test.mjs`.
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false, gcTime: 0 } },
  });
  live.push(qc);
  return qc;
};

async function mount(element) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(element));
  return {
    container,
    async click(node) {
      await React.act(async () => {
        node.dispatchEvent(new window.Event("click", { bubbles: true }));
      });
    },
    async close() {
      await React.act(async () => root.unmount());
      container.remove();
    },
  };
}

const wrap = (qc, node) => React.createElement(QueryClientProvider, { client: qc }, node);

/** The row's own Kill, found the way an editor finds it: by its name. */
async function mountScreen(qc, row) {
  const calls = [];
  const answer = (input) => {
    calls.push(input);
    return { ok: true };
  };
  const page = await mount(wrap(qc, React.createElement(Screen, { lead: row, answer })));
  return { ...page, calls };
}

/* ------------------------------------------------------------------- tests */

test("the Open row's own Kill kills in one press, and the Undo puts the lead back", async () => {
  toast.toasts.length = 0;
  const qc = freshClient();
  const row = lead();
  seed(qc, row);
  const page = await mountScreen(qc, row);
  try {
    /* The press exists on the row itself, named, and NOT behind the More menu. */
    const kill = page.container.querySelector('.queue-acts button[aria-label="Kill the lead: ' + row.headline + '"]');
    assert.ok(kill, "the Open row should offer a Kill press in its own action cell");
    assert.equal(kill.textContent, "Kill");
    assert.ok(
      !kill.closest("details.more"),
      "the Kill must not be inside More ▾ -- that is the half-dozen clicks this unit removes",
    );
    const more = page.container.querySelector("details.more");
    assert.ok(more, "the row still carries its More menu");
    const cell = kill.closest(".queue-acts");
    assert.ok(
      cell && [...cell.children].indexOf(kill) < [...cell.children].indexOf(more),
      "the Kill sits before the menu in the row",
    );
    /* One press kills it: there is no dialog between the press and the write. */
    assert.equal(page.container.querySelector("[role=dialog]"), null);
    assert.deepEqual(page.calls, [], "nothing is written before the press");

    await page.click(kill);
    assert.deepEqual(
      page.calls,
      [{ id: 7, status: "killed", restore: "new" }],
      "ONE press sends ONE write, and the write is the kill -- carrying where it goes back to",
    );
    assert.equal(statusIn(qc, 7), "killed", "and the row moves at once");
    assert.deepEqual(openIds(qc), [], "leaving the Open tab's rows");
    assert.equal(openCount(qc), 0, "and the Open count");
    assert.equal(killedCount(qc), 1);

    /* The toast carries the way back, the chips, and the longer life. */
    const [bar] = toast.toasts;
    assert.equal(bar?.tone, "ok");
    assert.match(bar?.text ?? "", /moved to Killed/);
    assert.equal(bar?.undo?.label, "Undo", "the kill's Undo is on the sentence that reports it");
    assert.ok(bar?.chips, "and the reason chips are drawn on the same toast");
    assert.equal(bar?.duration, fastKill.KILL_TOAST_MS, "which lives longer than an ordinary toast");

    /* The Undo, pressed: the same round trip backwards. */
    await React.act(async () => {
      await bar.undo.run();
    });
    assert.deepEqual(
      page.calls[1],
      { id: 7, status: "new" },
      "the Undo writes the lead's own status back -- one value, one write",
    );
    assert.equal(statusIn(qc, 7), "new", "the lead is New again");
    assert.deepEqual(openIds(qc), [7], "back in the Open tab's rows");
    assert.equal(openCount(qc), 1, "back in the Open count");
    assert.equal(killedCount(qc), 0, "and out of Killed's");
  } finally {
    await page.close();
  }
});

/*
  Owner, 2026-10-03, the follow-up: "Undo must restore the lead's exact previous
  status. Today a 'drafted' lead that is killed and undone comes back as 'new'."

  A lead the desk has drafted is still on the Queue's Open tab and carries the
  same Kill as any other. Its Undo has to put it back where it was -- `drafted`,
  with its draft still behind it -- and not into `new`, which orphans the story
  already written for it. The write that may do that is the Queue's second
  mutation (`undoKill` -> `restoreKilledLead`), because the ordinary status input
  has no `drafted` in it; the press carries the status the row held, read at the
  moment of the kill.
*/
test("the Undo of a drafted lead's kill puts the draft back, not a fresh New lead", async () => {
  toast.toasts.length = 0;
  const qc = freshClient();
  const row = lead({ status: "drafted" });
  seed(qc, row);
  const page = await mountScreen(qc, row);
  try {
    const kill = page.container.querySelector(".queue-acts button[aria-label^='Kill the lead:']");
    assert.ok(kill, "a drafted lead is on the Open tab and its row offers the same Kill");

    await page.click(kill);
    assert.deepEqual(
      page.calls[0],
      { id: 7, status: "killed", restore: "drafted" },
      "the kill carries where the lead goes back to, read off the row it was pressed on",
    );
    assert.equal(statusIn(qc, 7), "killed");
    assert.equal(openCount(qc), 0, "the drafted lead leaves the Open count with the kill");

    const bar = toast.toasts[0];
    assert.equal(bar?.undo?.label, "Undo", "the kill's Undo is on the sentence that reports it");
    await React.act(async () => {
      await bar.undo.run();
    });
    assert.deepEqual(
      page.calls[1],
      { id: 7, status: "drafted" },
      "the Undo restores DRAFTED, not New -- the exact bug this unit fixes",
    );
    assert.equal(statusIn(qc, 7), "drafted", "the lead is drafted again, its draft intact");
    assert.deepEqual(openIds(qc), [7], "back on the Open tab");
    assert.equal(openCount(qc), 1, "back in the Open count");
    assert.equal(killedCount(qc), 0, "and out of Killed's");
  } finally {
    await page.close();
  }
});

test("a killed or unkillable row offers no Kill, and a screen that hands over no press draws none", () => {
  const html = ({ lead: row, ...props }) =>
    renderToStaticMarkup(React.createElement(LeadRowView, { lead: row, roomy: true, ...props }));
  const open = lead();
  /* Without `onKillNow` -- Today's rows -- the cell is exactly what it was. */
  assert.match(html({ lead: open }), />Start story</);
  assert.doesNotMatch(html({ lead: open }), /Kill the lead:/, "no press, no change to Today");
  /* With it, the row offers the press; a killed lead is never offered it. */
  assert.match(html({ lead: open, onKillNow() {} }), />Kill</);
  assert.doesNotMatch(html({ lead: lead({ status: "killed" }), onKillNow() {} }), /Kill the lead:/);
});

test("one tap on a reason chip writes that chip's sentence to kill_reason, and the chips stop asking", async () => {
  toast.toasts.length = 0;
  const qc = freshClient();
  const row = lead();
  seed(qc, row);
  const page = await mountScreen(qc, row);
  let chipsPage = null;
  try {
    /* Kill first: the reason is offered on the toast the kill raises. */
    const kill = page.container.querySelector(".queue-acts button[aria-label^='Kill the lead:']");
    await page.click(kill);
    const bar = toast.toasts[0];
    assert.ok(bar?.chips, "the kill's toast should carry the chips");

    /*
      Mounted from the recorded element, because that IS the toast's body -- the
      same node the host would draw, so what is measured is what an editor taps.
    */
    chipsPage = await mount(React.createElement(QueryClientProvider, { client: qc }, bar.chips));
    const chips = [...chipsPage.container.querySelectorAll("button.desk-chip")];
    assert.equal(chips.length, KILL_REASON_CHIPS.length, "one chip per reason");
    const notLocal = chips.find((b) => b.getAttribute("aria-label") === "Reason: Not local");
    assert.ok(notLocal, "each chip names what its press is, for a screen reader");
    assert.ok(
      /Say why/.test(chipsPage.container.textContent),
      "the lead-in says the reason is optional",
    );

    await chipsPage.click(notLocal);
    const chip = KILL_REASON_CHIPS.find((c) => c.label === "Not local");
    assert.deepEqual(
      page.calls[1],
      { data: { id: 7, status: "killed", killReason: chip.reason } },
      "the chip writes ITS OWN sentence to kill_reason, on the lead that was killed",
    );
    assert.ok(page.calls[1].data.killReason.length > 0, "and never an empty reason");
    assert.ok(
      /Not local/.test(page.calls[1].data.killReason),
      "the sentence is the chip's, not another chip's",
    );
    /* One answer is the whole answer: the row of chips is replaced by the sentence. */
    assert.equal(chipsPage.container.querySelectorAll("button.desk-chip").length, 0);
    assert.match(chipsPage.container.textContent, /Reason kept: Not local\./);
  } finally {
    if (chipsPage) await chipsPage.close();
    await page.close();
  }
});

test("the presses are values with one meaning each, and an unknown chip writes nothing", () => {
  assert.deepEqual(fastKill.killPress(7), { id: 7, status: "killed", restore: "new" });
  assert.deepEqual(fastKill.killPress(7, "drafted"), { id: 7, status: "killed", restore: "drafted" });
  assert.deepEqual(fastKill.killUndoPress(7), { id: 7, status: "new" });
  assert.deepEqual(fastKill.killUndoPress(7, "held"), { id: 7, status: "held" });
  assert.deepEqual(fastKill.killUndoPress(7, "drafted"), { id: 7, status: "drafted" });

  /* Where a lead of each status goes when a kill of it is taken back. */
  assert.equal(fastKill.restoreStatus("drafted"), "drafted");
  assert.equal(fastKill.restoreStatus("held"), "held");
  assert.equal(fastKill.restoreStatus("new"), "new");
  assert.equal(fastKill.restoreStatus("published"), "new", "a status no kill can be pressed on goes to New");

  /* Every chip carries the sentence it writes; the write is the chip, not a copy. */
  for (const chip of KILL_REASON_CHIPS) {
    assert.deepEqual(fastKill.killReasonRequest(7, chip), {
      data: { id: 7, status: "killed", killReason: chip.reason },
    });
    const sentByPress = [];
    const returned = fastKill.killReasonPress(7, chip.key, (r) => sentByPress.push(r));
    assert.deepEqual(sentByPress, [fastKill.killReasonRequest(7, chip)], "the press hand over that request");
    assert.deepEqual(returned, fastKill.killReasonRequest(7, chip));
  }

  /*
    A chip key the desk no longer has must write NOTHING. The failure this
    guards is a kill with an empty reason on the record, which is
    indistinguishable from the editor saying nothing at all.
  */
  const sent = [];
  assert.equal(fastKill.killReasonPress(7, "gone", (r) => sent.push(r)), null);
  assert.deepEqual(sent, [], "an unknown chip must not become a reasonless kill");
});
