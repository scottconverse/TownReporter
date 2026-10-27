import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import { createDeskQueryClient } from "./desk-query-client.ts";

/*
  G23-QA-6, as behavior: a server that holds one draft; the nav's count read and
  the Drafts page's list read are both on screen; a Publish succeeds and takes
  the draft out. Both reads must show it gone right away -- not whenever their
  own timers next fire.
*/
describe("after an action moves a draft out of Drafts, the nav count and the Drafts list agree", () => {
  it("both reads are asked again when any desk action succeeds", async () => {
    const server = { drafts: 1 };
    const qc = createDeskQueryClient();
    const nav = new QueryObserver(qc, {
      queryKey: ["drafts-desk", "count"],
      queryFn: async () => server.drafts,
    });
    const page = new QueryObserver(qc, {
      queryKey: ["drafts-desk", "all", 25],
      queryFn: async () => ({ counts: { all: server.drafts }, rows: Array(server.drafts).fill(1) }),
    });
    const stopNav = nav.subscribe(() => {});
    const stopPage = page.subscribe(() => {});
    await Promise.all([nav.refetch(), page.refetch()]);
    assert.equal(nav.getCurrentResult().data, 1);
    assert.equal(page.getCurrentResult().data?.counts.all, 1);

    const publish = new MutationObserver(qc, {
      mutationFn: async () => {
        server.drafts = 0;
        return { ok: true };
      },
    });
    await publish.mutate();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(nav.getCurrentResult().data, 0, "the nav still counts the published story");
    assert.equal(page.getCurrentResult().data?.counts.all, 0);
    stopNav();
    stopPage();
    qc.clear();
  });
});
