import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DIG_STOP_ACK, digStopControl } from "./desk-copy.ts";

/**
 * Unit DD1, item 3 — Stop said nothing for about a hundred seconds.
 *
 * The stand-in walkthrough of 2026-09-30 (`A2c-REPORT.md` §3.6, C2) pressed
 * "Stop this dig" once at 0:36 and polled every five seconds. From +7s to +97s
 * the button still read "Stop this dig" and the desk said nothing at all; at
 * +102s the run ended and "Cancelled by the editor" appeared. The copy written
 * for that moment -- "Stopped. The run ends at its next step and what it has
 * found is kept." -- was in the code and never reached the screen, because the
 * file only renders its notice when nothing is running, and the run is still
 * running at exactly the moment that notice matters.
 *
 * The control is derived here rather than in the route so the states can be
 * held to their own strings.
 */

describe("DD1 item 3 — the Stop control acknowledges the press at once", () => {
  it("offers the press only while a dig is in flight", () => {
    const idle = digStopControl({ running: false, requested: false, sending: false });
    assert.equal(idle.visible, false);
    assert.equal(idle.line, null);

    const live = digStopControl({ running: true, requested: false, sending: false });
    assert.equal(live.visible, true);
    assert.equal(live.label, "Stop this dig");
    assert.equal(live.disabled, false);
    assert.equal(live.line, null, "nothing to say before the editor presses it");
  });

  it("says Stopping… on the press itself, before the server has answered", () => {
    const sending = digStopControl({ running: true, requested: false, sending: true });
    assert.equal(sending.label, "Stopping…");
    assert.equal(sending.disabled, true, "a second press must not be possible");
    assert.equal(sending.line, DIG_STOP_ACK);
  });

  it("keeps saying Stopping… for as long as the run is still going", () => {
    /*
      This is the state the walkthrough measured: the request has landed, the
      worker has not reached its next step, and the run is still live. It used
      to render as "Stop this dig" again within a second of the press.
    */
    const requested = digStopControl({ running: true, requested: true, sending: false });
    assert.equal(requested.label, "Stopping…");
    assert.equal(requested.disabled, true);
    assert.equal(requested.line, DIG_STOP_ACK);
    assert.equal(
      DIG_STOP_ACK,
      "Stopped. The run ends at its next step and what it has found is kept.",
      "the sentence the handbook quotes",
    );
  });

  it("drops the control and the line once the run has actually ended", () => {
    const ended = digStopControl({ running: false, requested: true, sending: false });
    assert.equal(ended.visible, false);
    assert.equal(ended.line, null, "a stopped run must not keep saying Stopping…");
  });

  it("never shows the acknowledgement on a dig nobody asked to stop", () => {
    for (const sending of [false, true]) {
      const idle = digStopControl({ running: false, requested: false, sending });
      assert.equal(idle.line, null);
    }
  });
});
