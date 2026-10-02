import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  captureStateSentence,
  captureSupportLine,
  groupDisplayCaptures,
  revealOpenedCapture,
} from "./finding-evidence-display.ts";

const capture = (overrides = {}) => ({
  versionId: 41,
  captureEventId: null,
  url: "https://records.example.test/agenda",
  title: "Agenda",
  capturedAt: "2026-09-08T10:00:00Z",
  available: true,
  readable: true,
  /* Unit U11b: an ordinary capture; a taken-down one is not readable. */
  takenDown: false,
  excerptState: "found" as const,
  newerCapture: null,
  viewHref: "/evidence/41",
  ...overrides,
});

describe("finding evidence display groups", () => {
  it("presents one available version once while retaining its artifact and capture-event references", () => {
    const groups = groupDisplayCaptures([capture(), capture({ captureEventId: 77 })]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].artifactVersionReference, true);
    assert.deepEqual(groups[0].captureEventIds, [77]);
  });

  it("does not merge conflicting states, missing references, different versions, or metadata", () => {
    const groups = groupDisplayCaptures([
      capture(),
      capture({ captureEventId: 77, readable: false, excerptState: "no-excerpt" }),
      capture({ versionId: null, captureEventId: 78, available: false, readable: false }),
      capture({ versionId: 42, captureEventId: 79 }),
      capture({ captureEventId: 80, capturedAt: "2026-09-08T11:00:00Z" }),
    ]);

    assert.equal(groups.length, 5);
  });
});

/**
 * UNIT PUB1, bug 2: "View exact captured version" showed nothing.
 *
 * The card read "No recorded excerpt to compare" above a capture time, a
 * version number and a capture-event number, with no explanation of what any
 * of it was -- and the text the link opened was drawn at the foot of a panel
 * far below the link, so the press looked like it did nothing.
 */
describe("what the captured-version card says", () => {
  it("explains the card when no excerpt was saved, instead of naming a comparison nobody made", () => {
    const sentence = captureStateSentence(capture({ excerptState: "no-excerpt" }));
    assert.doesNotMatch(sentence, /No recorded excerpt to compare/);
    assert.match(sentence, /No excerpt was saved with this claim/);
    assert.match(sentence, /nothing to put side by side/);
    assert.match(sentence, /This is the saved copy the draft was written from\./);
  });

  it("keeps the states an editor can act on in their own words", () => {
    assert.equal(
      captureStateSentence(capture({ takenDown: true, readable: false })),
      "Excerpt removed at the publisher's request",
      "the owner's decision, not a defect in the capture",
    );
    assert.match(captureStateSentence(capture({ readable: false })), /no readable captured text/);
    assert.match(captureStateSentence(capture({ available: false })), /unavailable/);
    assert.match(captureStateSentence(capture({ excerptState: "found" })), /Recorded excerpt found/);
    assert.match(
      captureStateSentence(capture({ excerptState: "not-found" })),
      /Recorded excerpt not found/,
    );
    assert.match(
      captureStateSentence(capture({ readable: false }), "Selected captured record"),
      /^Selected captured record/,
      "the manual stack names its own kind of record",
    );
  });

  it("keeps the ids, in words, on a line labelled for support", () => {
    const [versionOnly] = groupDisplayCaptures([capture({ versionId: 4645, captureEventId: null })]);
    assert.equal(captureSupportLine(versionOnly!), "Saved copy number 4645 of the page");
    assert.doesNotMatch(captureSupportLine(versionOnly!), /Artifact version/);

    const [group] = groupDisplayCaptures([capture({ versionId: 4645, captureEventId: 12 })]);
    assert.equal(captureSupportLine(group!), "capture event 12 (saved copy 4645)");
    const [eventOnly] = groupDisplayCaptures([
      capture({ versionId: null, captureEventId: 13, available: false }),
    ]);
    assert.equal(captureSupportLine(eventOnly!), "capture event 13");
  });
});

describe("opening the captured text brings it to the editor", () => {
  it("focuses the panel and scrolls it to the top of the screen", () => {
    const calls: string[] = [];
    const element = {
      focus: () => calls.push("focus"),
      scrollIntoView: (options?: { block?: string }) => calls.push(`scroll:${options?.block}`),
    };
    revealOpenedCapture(element);
    assert.deepEqual(calls, ["focus", "scroll:start"], "both, and the scroll decides where it lands");
  });

  it("does nothing when the panel is not in the document yet", () => {
    assert.doesNotThrow(() => revealOpenedCapture(null));
    assert.doesNotThrow(() => revealOpenedCapture(undefined));
    assert.doesNotThrow(() => revealOpenedCapture({}), "a node without the methods is not a crash");
  });

  it("is wired to the panel that renders, and to both answers from the read", () => {
    /*
      The helper is proven above; this is the other half -- that the panel
      which renders the captured text carries the ref, is focusable, and is
      revealed by an effect keyed on whatever the read produced. There is no
      DOM harness in this repository (no jsdom; the component tests here render
      to static markup or read the source), so the wiring is read from the
      source, the way `takedown-notice.test.ts` reads this same file.
    */
    const source = readFileSync(new URL("../../components/finding-evidence-review.tsx", import.meta.url), "utf8");
    assert.match(source, /const capturePanel = useRef<HTMLDivElement \| null>\(null\)/);
    assert.match(source, /revealOpenedCapture\(capturePanel\.current\)/);
    assert.match(source, /ref=\{capturePanel\}/, "the ref is on the panel that renders the text");
    assert.match(source, /tabIndex=\{-1\}/, "a region has to be focusable to take the cursor");
    assert.match(
      source,
      /useEffect\(\(\) => \{\s*if \(!openedCapture\) return;\s*revealOpenedCapture\(capturePanel\.current\);\s*\}, \[openedCapture\]\)/,
      "both a found capture and a refused read set `openedCapture`, and both are revealed",
    );
    assert.doesNotMatch(
      source,
      /captureRead\.isPending \? <BusyLine/,
      "the busy line is at the link now, not below the fold",
    );
    assert.match(source, /Opening the saved copy…/);
  });
});
