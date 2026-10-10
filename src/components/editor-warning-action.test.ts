import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createWarningConsentChannel,
  withEditorWarningAction,
  type WarningConsentRequest,
} from "./editor-warning-consent.ts";

  describe("consent cleanup and wording", () => {
    it("leaving the desk cancels every pending consent without approving work", async () => {
      const channel=createWarningConsentChannel();
      const request={key:"fixture",sentence:"Review this issue.",action:"Draft"};
      const decisions=[channel.request(request),channel.request(request)];
      channel.cancelAll();
      assert.deepEqual(await Promise.all(decisions),[false,false]);assert.equal(channel.get(),null);
    });
    it("hourly warnings say Run anyway and a model change names the restart model", async () => {
      for(const [key,sentence,kind,model] of [["rate-draft","It may cost more.","run",undefined],["model-change-running","This run uses Sol. Stop and restart with Sonnet.","restart","Sonnet"]] as const) {
        const requests:WarningConsentRequest[]=[];
        await withEditorWarningAction(async()=>({ok:false,warning:{key,sentence}}),{action:"Draft"},async request=>{requests.push(request);return false;});
        assert.equal(requests[0].kind,kind);assert.equal(requests[0].model,model);
      }
    });
  });

/*
  The scoped-callsite consent wrapper (Scott's rule, outside Publish).

  Routes keep calling their server handles exactly as before; the wrapper is the
  ONE place a structured `{ok:false, warning}` becomes an explicit second press.
  These tests drive it with a fake consent channel, which is the only way to
  prove the two rules it exists for:

    - NOTHING happens after a warning until the editor presses "…anyway";
    - a cancel runs the SAME captured request zero extra times.
*/

const warning = (key: string, sentence: string) => ({
  ok: false,
  warning: { key, sentence },
  error: sentence,
});

describe("withEditorWarningAction: one call, then an explicit consent", () => {
  it("returns a non-warning answer untouched, calling once", async () => {
    let calls = 0;
    const answer = await withEditorWarningAction(
      async () => {
        calls += 1;
        return { ok: true, id: 1 };
      },
      { action: "Run scan" },
      async () => assert.fail("no warning, so no consent"),
    );
    assert.equal(calls, 1);
    assert.deepEqual(answer, { ok: true, id: 1 });
  });

  it("shows the warning and does NOT retry until consent", async () => {
    const seen: Array<string[] | undefined> = [];
    const requests: WarningConsentRequest[] = [];
    const answers = [
      warning("paper-not-set-up", "This paper is not fully set up: finish Paper setup."),
      { ok: true },
    ];
    let i = 0;
    const result = await withEditorWarningAction(
      async (override?: string[]) => {
        seen.push(override);
        return answers[i++];
      },
      { action: "Run scan", kind: "run" },
      async (request) => {
        requests.push(request);
        return true; // the editor pressed "Run anyway"
      },
    );

    assert.deepEqual(seen, [undefined, ["paper-not-set-up"]], "the second call carries the key");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].sentence, "This paper is not fully set up: finish Paper setup.");
    assert.equal(requests[0].action, "Run scan");
    assert.equal(requests[0].kind, "run");
    assert.deepEqual(result, { ok: true });
  });

  it("a cancel runs the same request zero extra times and returns the refusal", async () => {
    let calls = 0;
    const result = await withEditorWarningAction(
      async () => {
        calls += 1;
        return warning("k", "A warning.");
      },
      { action: "Draft this story" },
      async () => false, // the editor cancelled
    );
    assert.equal(calls, 1, "cancel is not a retry");
    assert.equal((result as { ok: false }).ok, false);
    assert.equal(((result as { warning: { key: string } }).warning).key, "k");
  });

  it("retains prior approvals across sequential warnings", async () => {
    const seen: Array<string[] | undefined> = [];
    const script = [
      warning("a", "First."),
      warning("b", "Second."),
      { ok: true },
    ];
    let i = 0;
    await withEditorWarningAction(
      async (override?: string[]) => {
        seen.push(override);
        return script[i++];
      },
      { action: "Pull the thread" },
      async () => true,
    );
    assert.deepEqual(seen, [undefined, ["a"], ["a", "b"]]);
  });

  it("never loops forever if the server warns the same key it already approved", async () => {
    let calls = 0;
    await withEditorWarningAction(
      async () => {
        calls += 1;
        return warning("stuck", "Still stuck.");
      },
      { action: "Run scan" },
      async () => true,
    );
    assert.equal(calls, 2, "the same key is approved once, then the press stops");
  });
});

describe("createWarningConsentChannel: the pending consent, one at a time", () => {
  it("hands the request to the host and resolves on the editor's choice", async () => {
    const channel = createWarningConsentChannel();
    const pending: Array<string | null> = [];
    const stop = channel.subscribe(() => pending.push(channel.get()?.request.key ?? null));

    const decision = channel.request({ action: "Run scan", sentence: "Not set up.", key: "k" });
    assert.equal(channel.get()?.request.key, "k");
    channel.resolve(true);
    assert.equal(await decision, true);
    assert.equal(channel.get(), null, "resolving clears the pending consent");
    stop();
  });

  it("queues a second request behind the first, so two presses do not collide", async () => {
    const channel = createWarningConsentChannel();
    const first = channel.request({ action: "Run scan", sentence: "A.", key: "a" });
    const second = channel.request({ action: "Draft", sentence: "B.", key: "b" });
    assert.equal(channel.get()?.request.key, "a");
    channel.resolve(true);
    assert.equal(await first, true);
    assert.equal(channel.get()?.request.key, "b", "the queued request takes its place");
    channel.resolve(false);
    assert.equal(await second, false);
    assert.equal(channel.get(), null);
  });

  it("resolving with nothing pending is a no-op", () => {
    const channel = createWarningConsentChannel();
    assert.doesNotThrow(() => channel.resolve(true));
    assert.equal(channel.get(), null);
  });
});
