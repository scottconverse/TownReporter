import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  capSuppliedMaterial,
  suppliedMaterialCapFor,
  suppliedMaterialCutSentence,
  withThousands,
  SUPPLIED_MATERIAL_CAP,
} from "./supplied-material-cap.ts";

/** A paragraph that ends on a blank line, the way a real council packet does. */
const PARAGRAPH = `${"The council packet lists each agenda item and its staff report. ".repeat(8)}\n\n`;

/** Two megabytes of the stuff, the failing case in the B8P finding. */
function councilPacket(): string {
  return PARAGRAPH.repeat(Math.ceil(2_000_000 / PARAGRAPH.length));
}

describe("capSuppliedMaterial", () => {
  it("returns text at or under the cap byte for byte", () => {
    const short = "The editor's own notes on the levy.\nSecond line.";
    const out = capSuppliedMaterial(short);
    assert.equal(out.text, short);
    assert.equal(out.cut, false);
    assert.equal(out.keptChars, short.length);
    assert.equal(out.totalChars, short.length);
  });

  it("returns text of exactly the cap unchanged, and cuts one character more", () => {
    const exact = "a".repeat(SUPPLIED_MATERIAL_CAP);
    const atCap = capSuppliedMaterial(exact);
    assert.equal(atCap.text, exact);
    assert.equal(atCap.cut, false);
    assert.equal(atCap.keptChars, SUPPLIED_MATERIAL_CAP);

    const over = capSuppliedMaterial(`${exact}b`);
    assert.equal(over.cut, true);
    assert.equal(over.totalChars, SUPPLIED_MATERIAL_CAP + 1);
    assert.ok(over.text.length <= SUPPLIED_MATERIAL_CAP);
  });

  it("cuts a 2 MB packet under the cap, on a paragraph boundary", () => {
    const packet = councilPacket();
    assert.ok(packet.length >= 2_000_000, "the fixture is the size the finding describes");

    const out = capSuppliedMaterial(packet);
    assert.equal(out.cut, true);
    assert.equal(out.totalChars, packet.length);
    assert.ok(
      out.text.length <= SUPPLIED_MATERIAL_CAP,
      `kept ${out.text.length} must not exceed the cap`,
    );
    assert.equal(out.keptChars, out.text.length);
    // The head is the START of the material, never a middle slice.
    assert.ok(packet.startsWith(out.text));
    // A paragraph boundary: the kept head ends on the paragraph's own full stop.
    assert.match(out.text, /staff report\.$/);
    // It cut NEAR the limit, not somewhere far back.
    assert.ok(
      out.keptChars > SUPPLIED_MATERIAL_CAP - 8_000,
      `kept ${out.keptChars} should be within the boundary lookback of the cap`,
    );
  });

  it("cuts at a sentence end when the text has no blank lines", () => {
    const sentences = "The district owes the town a ledger of the old tax. ".repeat(40_000);
    const out = capSuppliedMaterial(sentences);
    assert.equal(out.cut, true);
    assert.ok(out.text.length <= SUPPLIED_MATERIAL_CAP);
    assert.match(out.text, /old tax\.$/);
  });

  it("never cuts mid-word when the text is plain words", () => {
    const words = "word ".repeat(300_000);
    const out = capSuppliedMaterial(words);
    assert.equal(out.cut, true);
    assert.ok(out.text.length <= SUPPLIED_MATERIAL_CAP);
    assert.ok(out.text.endsWith("word"), `cut mid-word: ...${out.text.slice(-12)}`);
    assert.equal(out.text, out.text.trimEnd());
  });

  it("keeps a text with no spaces at all under the cap", () => {
    const blob = "x".repeat(2_000_000);
    const out = capSuppliedMaterial(blob);
    assert.equal(out.cut, true);
    assert.equal(out.text.length, SUPPLIED_MATERIAL_CAP);
    assert.equal(out.keptChars, SUPPLIED_MATERIAL_CAP);
    assert.equal(out.totalChars, 2_000_000);
  });

  it("leaves empty and whitespace-only text alone", () => {
    for (const blank of ["", "   ", "\n\n\t \n", " \r\n "]) {
      const out = capSuppliedMaterial(blank);
      assert.equal(out.text, blank);
      assert.equal(out.cut, false);
      assert.equal(out.keptChars, blank.length);
      assert.equal(out.totalChars, blank.length);
    }
  });

  it("honours the counts it reports", () => {
    const out = capSuppliedMaterial(councilPacket());
    assert.equal(out.totalChars, out.keptChars + (out.totalChars - out.keptChars));
    assert.ok(out.keptChars < out.totalChars);
    assert.ok(out.keptChars >= 1);
  });

  it("takes a caller's smaller cap", () => {
    const out = capSuppliedMaterial("word ".repeat(2_000), 1_000);
    assert.equal(out.cut, true);
    assert.ok(out.text.length <= 1_000);
    assert.equal(out.totalChars, 10_000);
  });
});

describe("capSuppliedMaterial and surrogate pairs", () => {
  it("never ends the kept text on half of an emoji", () => {
    // 119,999 characters with no whitespace, then an emoji (two code units
    // straddling the 120,000 limit), then more text.
    const text = "a".repeat(SUPPLIED_MATERIAL_CAP - 1) + "\u{1F600}" + "b".repeat(50);
    const cut = capSuppliedMaterial(text);
    assert.equal(cut.cut, true);
    const last = cut.text.charCodeAt(cut.text.length - 1);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), "no lone high surrogate at the end");
    assert.ok(cut.text.length <= SUPPLIED_MATERIAL_CAP);
    assert.equal(cut.keptChars, cut.text.length);
  });
});

describe("suppliedMaterialCapFor", () => {
  it("keeps the constant when the context is unknown", () => {
    assert.equal(suppliedMaterialCapFor(null), SUPPLIED_MATERIAL_CAP);
    assert.equal(suppliedMaterialCapFor(undefined), SUPPLIED_MATERIAL_CAP);
    assert.equal(suppliedMaterialCapFor(0), SUPPLIED_MATERIAL_CAP);
    assert.equal(suppliedMaterialCapFor(-1), SUPPLIED_MATERIAL_CAP);
    assert.equal(suppliedMaterialCapFor(Number.NaN), SUPPLIED_MATERIAL_CAP);
  });

  it("takes about 30% of a context that is known", () => {
    // The repo's own recorded failure: a 32k window.
    assert.equal(suppliedMaterialCapFor(32_000), 38_400);
  });

  it("never exceeds the constant, however large the window", () => {
    assert.equal(suppliedMaterialCapFor(128_000), SUPPLIED_MATERIAL_CAP);
    assert.equal(suppliedMaterialCapFor(1_048_576), SUPPLIED_MATERIAL_CAP);
  });
});

describe("suppliedMaterialCutSentence", () => {
  it("tells the editor the size, what was kept and the share", () => {
    const sentence = suppliedMaterialCutSentence({ keptChars: 118_400, totalChars: 2_000_000 });
    assert.match(sentence, /2,000,000 characters/);
    assert.match(sentence, /first 118,400/);
    assert.match(sentence, /about 6%/);
    assert.match(sentence, /cut for length/);
    assert.match(sentence, /paste it in separate pieces/);
  });

  it("never says 'about 0%'", () => {
    assert.match(suppliedMaterialCutSentence({ keptChars: 1, totalChars: 2_000_000 }), /about 1%/);
  });
});

describe("withThousands", () => {
  it("groups digits without a locale", () => {
    assert.equal(withThousands(0), "0");
    assert.equal(withThousands(999), "999");
    assert.equal(withThousands(1_000), "1,000");
    assert.equal(withThousands(2_000_000), "2,000,000");
  });
});
