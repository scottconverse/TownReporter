import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWriteStoryInput, WRITE_STORY_SCRATCH_LIMIT } from "./write-story.ts";

describe("parseWriteStoryInput", () => {
  it("a bare URL becomes the source and the headline names the page", () => {
    const res = parseWriteStoryInput("https://longmont.primegov.com/meeting/12345");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.deepEqual(res.value.urls, ["https://longmont.primegov.com/meeting/12345"]);
    assert.match(res.value.headline, /^Story from longmont\.primegov\.com/);
    assert.equal(res.value.why, "Filed from the Write a story box.");
    assert.equal(res.value.scratch, "https://longmont.primegov.com/meeting/12345");
  });

  it("a first line under 180 chars is used as the headline verbatim", () => {
    const res = parseWriteStoryInput(
      "The planning board moved the Kimbark hearing to Oct. 2\nThe packet posted this morning.",
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.headline, "The planning board moved the Kimbark hearing to Oct. 2");
    assert.equal(
      res.value.why,
      "Filed from the Write a story box. The packet posted this morning.",
    );
  });

  it("a long paragraph with no short first line falls back to the first sentence", () => {
    const long =
      "This is a very long opening line that goes on and on well past the one hundred and eighty character limit a headline is allowed to run before it gets truncated for the queue. It happened Tuesday.";
    const res = parseWriteStoryInput(long);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(res.value.headline.length <= 180);
    assert.ok(long.startsWith(res.value.headline.replace(/…$/, "").slice(0, 20)));
  });

  it("two URLs plus text: both URLs are captured and text supplies the headline", () => {
    const res = parseWriteStoryInput(
      "Council votes tonight on the rail tax\nhttps://example.org/agenda https://example.org/minutes.pdf",
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.headline, "Council votes tonight on the rail tax");
    assert.deepEqual(res.value.urls, [
      "https://example.org/agenda",
      "https://example.org/minutes.pdf",
    ]);
  });

  it("caps source URLs at 8", () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://example.org/doc-${i}`);
    const res = parseWriteStoryInput(`A packet with a lot of links\n${urls.join(" ")}`);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.urls.length, 8);
  });

  it("garbage or empty input is refused with a plain message", () => {
    const empty = parseWriteStoryInput("");
    assert.equal(empty.ok, false);
    if (empty.ok) return;
    assert.match(empty.error, /not enough here/);

    const tooShort = parseWriteStoryInput("hi");
    assert.equal(tooShort.ok, false);

    const whitespaceOnly = parseWriteStoryInput("   \n\n   ");
    assert.equal(whitespaceOnly.ok, false);
  });

  it("keeps the full pasted text as scratch, capped at 8000 chars", () => {
    const body = "word ".repeat(3000);
    const res = parseWriteStoryInput(`A headline that is short enough\n${body}`);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.ok(res.value.scratch.length <= WRITE_STORY_SCRATCH_LIMIT);
  });

  it("infers a topic from keywords when the text makes it obvious", () => {
    const res = parseWriteStoryInput(
      "The school board approved a new SVVSD budget line\nMinutes posted this morning.",
    );
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.topic, "schools");
  });

  it("defaults to council when nothing in the text points elsewhere", () => {
    const res = parseWriteStoryInput("Something happened downtown yesterday afternoon.");
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.value.topic, "council");
  });
});
