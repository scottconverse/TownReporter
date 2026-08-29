import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DIALS,
  PRESETS,
  budgetFor,
  clampDials,
  describeDials,
  estimateMinutes,
  jurisdictionsFor,
  stanceFor,
} from "./dark-dials.ts";
import { EUPHEMISMS, SIGNAL_TYPES, signalTypesFor, taxonomyPrompt } from "./dark-taxonomy.ts";
import { DARK_SYSTEM, darkSystemFor } from "./dark-prompt.ts";

describe("clampDials", () => {
  it("keeps a stored typo from becoming an expensive night", () => {
    assert.deepEqual(clampDials({ dig: 40, nerve: -3, scope: "moon" as never }), {
      dig: 10,
      nerve: 1,
      scope: "city",
    });
  });

  it("falls back to the defaults for nothing at all", () => {
    assert.deepEqual(clampDials(null), DEFAULT_DIALS);
    assert.deepEqual(clampDials({}), DEFAULT_DIALS);
    assert.deepEqual(clampDials({ dig: NaN, nerve: "x" as never, scope: "city" }), DEFAULT_DIALS);
  });
});

describe("budgetFor", () => {
  it("turns the slider into real depth", () => {
    assert.equal(budgetFor({ dig: 1, nerve: 5, scope: "city" }).hops, 1);
    assert.ok(budgetFor({ dig: 10, nerve: 5, scope: "city" }).hops >= 25);
  });

  it("never goes backwards as the dial goes up", () => {
    let last = 0;
    for (let d = 1; d <= 10; d++) {
      const b = budgetFor({ dig: d, nerve: 5, scope: "city" });
      assert.ok(b.hops >= last, `hops fell at dig ${d}`);
      last = b.hops;
    }
  });

  it("keeps the desk on the watch list at the shallow end", () => {
    assert.equal(budgetFor({ dig: 1, nerve: 5, scope: "city" }).followOffWatchlist, false);
    assert.equal(budgetFor({ dig: 2, nerve: 5, scope: "city" }).followOffWatchlist, true);
    assert.equal(budgetFor({ dig: 3, nerve: 5, scope: "city" }).useArchives, true);
  });
});

describe("stanceFor", () => {
  /**
   * Three versions of this scale were wrong, all conservative, twice sold as an
   * improvement while making maximum nerve stricter than it had been. The test
   * is now the whole curve, not the ends.
   */
  it("gets looser at every single notch, and has no floor at the top", () => {
    let prev = Infinity;
    for (let n = 1; n <= 10; n++) {
      const f = stanceFor({ dig: 5, nerve: n, scope: "city" }).minConfidence;
      // Loosens every notch until it reaches zero, then stays there. Once the
      // floor is gone there is nothing left to loosen.
      assert.ok(f < prev || f === 0, `floor did not loosen at nerve ${n}`);
      prev = f;
    }
    assert.equal(stanceFor({ dig: 5, nerve: 8, scope: "city" }).minConfidence, 0);
    assert.equal(stanceFor({ dig: 5, nerve: 10, scope: "city" }).minConfidence, 0);
    assert.ok(stanceFor({ dig: 5, nerve: 1, scope: "city" }).minConfidence <= 0.5);
  });

  it("digs deeper at every notch too", () => {
    let prev = 0;
    for (let d = 1; d <= 10; d++) {
      const h = budgetFor({ dig: d, nerve: 5, scope: "city" }).hops;
      assert.ok(h > prev, `hops did not increase at dig ${d}`);
      prev = h;
    }
    assert.ok(budgetFor({ dig: 10, nerve: 5, scope: "city" }).hops >= 25);
  });

  it("lets one account open a file from the lower-middle of the dial", () => {
    assert.equal(stanceFor({ dig: 5, nerve: 1, scope: "city" }).singleSourceOpensFile, false);
    assert.equal(stanceFor({ dig: 5, nerve: 3, scope: "city" }).singleSourceOpensFile, true);
    assert.equal(stanceFor({ dig: 5, nerve: 2, scope: "city" }).rumorSeeds, true);
  });

  it("holds thin items rather than dropping them almost everywhere", () => {
    assert.equal(stanceFor({ dig: 5, nerve: 1, scope: "city" }).thinHandoff, "DISCARD");
    assert.equal(stanceFor({ dig: 5, nerve: 2, scope: "city" }).thinHandoff, "HOLD FOR PATTERN");
  });

  it("names every setting for the editor", () => {
    for (let n = 1; n <= 10; n++) {
      assert.ok(stanceFor({ dig: 5, nerve: n, scope: "city" }).label.length > 3);
    }
  });
});

describe("scope", () => {
  it("widens without losing the city", () => {
    const city = jurisdictionsFor("city");
    const adjacent = jurisdictionsFor("adjacent");
    assert.ok(adjacent.length > city.length);
    for (const p of city) assert.ok(adjacent.includes(p), `${p} dropped when widening`);
    assert.ok(adjacent.some((p) => /Firestone/.test(p)));
    assert.ok(jurisdictionsFor("region").some((p) => /Weld/.test(p)));
  });
});

describe("describeDials", () => {
  it("says what will happen in words, not numbers", () => {
    const text = describeDials({ dig: 10, nerve: 10, scope: "adjacent" });
    assert.doesNotMatch(text, /\b10\/10\b/);
    assert.match(text, /hops/i);
    assert.match(text, /Firestone|neighbourhood/i);
  });

  it("is honest about the shallow end too", () => {
    const text = describeDials({ dig: 1, nerve: 1, scope: "city" });
    assert.match(text, /One hop, then it stops/i);
    assert.match(text, /files nothing it cannot document/i);
  });

  it("gives a time an editor can plan around", () => {
    assert.ok(estimateMinutes({ dig: 1, nerve: 1, scope: "city" }) >= 1);
    assert.ok(
      estimateMinutes({ dig: 10, nerve: 10, scope: "adjacent" }) >
        estimateMinutes({ dig: 1, nerve: 1, scope: "city" }),
    );
  });
});

describe("presets", () => {
  it("offers a real spread, not four of the same thing", () => {
    const digs = PRESETS.map((p) => p.dials.dig);
    assert.equal(new Set(digs).size, PRESETS.length);
    assert.ok(Math.max(...digs) - Math.min(...digs) >= 6);
    for (const p of PRESETS) {
      assert.deepEqual(clampDials(p.dials), p.dials, `${p.id} is out of range`);
      assert.ok(p.blurb.length > 20, `${p.id} needs a real description`);
    }
  });
});

describe("taxonomy", () => {
  it("opens up more kinds of signal as nerve rises", () => {
    assert.ok(signalTypesFor(10).length > signalTypesFor(1).length);
    assert.equal(signalTypesFor(10).length, SIGNAL_TYPES.length);
  });

  /** The ones a careful desk should still be watching for. */
  it("hunts retrenchment and missing records even at the bottom", () => {
    const ids = signalTypesFor(1).map((t) => t.id);
    assert.ok(ids.includes("administrative-retrenchment"));
    assert.ok(ids.includes("delayed-record"));
    assert.ok(ids.includes("governance-drift"));
  });

  /**
   * A lens is not an accusation. An earlier version locked manufactured chorus
   * and pre-agenda lock-in behind nerve 6, which meant a desk set to 5 was not
   * even looking for the two things the operator most wanted found. RULE 1 and
   * RULE 3 are what stop it asserting them, and those never move.
   */
  it("lets the desk look for astroturf without waiting for the top of the dial", () => {
    const mid = signalTypesFor(3).map((t) => t.id);
    assert.ok(mid.includes("astroturf"));
    assert.ok(mid.includes("pre-agenda-lock-in"));
    assert.ok(signalTypesFor(1).length >= 13, "most lenses should be on from the start");
  });

  it("tells the desk to check the effect behind routine words", () => {
    const p = taxonomyPrompt(5);
    assert.match(p, /ROUTINE IS A CLOAK/);
    assert.match(p, /"pilot"/);
    assert.match(p, /SILENCE MUST BE ANCHORED/);
    for (const e of EUPHEMISMS) assert.ok(e.check.length > 10, `${e.phrase} needs a real check`);
  });
});

describe("darkSystemFor", () => {
  /**
   * The floors are the whole reason nerve is allowed to reach 10. If any of
   * these can be dialled away, the top of the slider is not a research setting,
   * it is a liability.
   */
  it("keeps every floor at maximum nerve", () => {
    const wild = darkSystemFor({ dig: 10, nerve: 10, scope: "adjacent" });
    assert.match(wild, /RULE 1 — COORDINATION IS NOT WRONGDOING BY ITSELF/);
    assert.match(wild, /RULE 2 — PRIVATE CITIZENS: NO DRIVE-BY DOSSIERS/);
    assert.match(wild, /RULE 3 — ALLEGING PAID DECEPTION IS DEFAMATION-GRADE/);
    assert.match(wild, /NON-GATING RULE/);
    assert.match(wild, /nothing here publishes/i);
  });

  it("still contains the whole constitution at minimum nerve", () => {
    const careful = darkSystemFor({ dig: 1, nerve: 1, scope: "city" });
    assert.ok(careful.startsWith(DARK_SYSTEM.slice(0, 60)));
    assert.match(careful, /RULE 3/);
  });

  it("tells the model which run it is on", () => {
    const wild = darkSystemFor({ dig: 10, nerve: 10, scope: "adjacent" });
    const careful = darkSystemFor({ dig: 1, nerve: 1, scope: "city" });
    assert.match(wild, /DEPTH THIS RUN — dig 10\/10/);
    assert.match(careful, /DEPTH THIS RUN — dig 1\/10/);
    assert.notEqual(wild, careful);
  });

  it("permits a provisional narrative from the lower-middle up", () => {
    assert.match(darkSystemFor({ dig: 5, nerve: 4, scope: "city" }), /You MAY write a provisional narrative/);
    assert.match(darkSystemFor({ dig: 5, nerve: 1, scope: "city" }), /Do not propose a narrative/);
  });

  it("widens the map without ever dropping Longmont", () => {
    for (const scope of ["city", "county", "region", "adjacent"] as const) {
      assert.match(darkSystemFor({ dig: 5, nerve: 5, scope }), /City of Longmont/);
    }
    assert.match(darkSystemFor({ dig: 5, nerve: 5, scope: "region" }), /Weld County/);
  });

  it("says running out of hops is a pause, not an answer", () => {
    assert.match(darkSystemFor(DEFAULT_DIALS), /PAUSE, never a conclusion/);
  });
});
