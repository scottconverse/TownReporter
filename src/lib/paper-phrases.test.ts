/*
  Auditor finding F4/F5: a paper that has not named a town must not print a
  dangling "of", "in" or "for" on its public pages.

  Every case here is written TWICE: once with a town (and pinned byte-for-
  byte against the sentence the paper printed before this change, so a
  configured install's wording cannot drift), and once with the empty city an
  un-onboarded install serves (`UNCONFIGURED_PAPER_CONFIG`,
  src/lib/news/paper-settings.ts) -- which must read as a finished sentence.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aboutFollowSentence,
  civicReportingLine,
  civicSourcesPhrase,
  clearerViewSentence,
  datelineLine,
  newsInTownPlaceholder,
  topicReportingSentence,
} from "./paper-phrases.ts";

const TOWN = "Riverbend";
/** What an install that has not completed setup actually serves. */
const NO_TOWN = "";
/** Whitespace is not a town either. */
const BLANK_TOWN = "   ";

/** No sentence may leave a preposition stranded at a word boundary. */
function assertNoDanglingPreposition(text: string) {
  assert.doesNotMatch(text, /\b(of|in|for)\s*[.,·]/, `dangling preposition in: ${text}`);
  assert.doesNotMatch(text, /\s{2,}/, `double space in: ${text}`);
  assert.doesNotMatch(text, /^\s|\s$/, `leading/trailing space in: ${text}`);
}

describe("datelineLine", () => {
  it("is byte-identical to the old dateline when a town is set", () => {
    assert.equal(datelineLine(TOWN, "Sat, Sept. 26"), "Today in Riverbend · Sat, Sept. 26");
  });

  it("is the day alone, not 'Today in ' with nothing after it, with no town", () => {
    assert.equal(datelineLine(NO_TOWN, "Sat, Sept. 26"), "Sat, Sept. 26");
    assert.equal(datelineLine(BLANK_TOWN, "Sat, Sept. 26"), "Sat, Sept. 26");
    assertNoDanglingPreposition(datelineLine(NO_TOWN, "Sat, Sept. 26"));
  });
});

describe("clearerViewSentence", () => {
  it("is byte-identical when a town is set", () => {
    assert.equal(clearerViewSentence(TOWN), "A clearer view of Riverbend.");
  });

  it("drops 'of {town}', not the town, when there is none", () => {
    assert.equal(clearerViewSentence(NO_TOWN), "A clearer view of your community.");
    assertNoDanglingPreposition(clearerViewSentence(NO_TOWN));
  });
});

describe("civicReportingLine", () => {
  it("is byte-identical when a town is set", () => {
    assert.equal(civicReportingLine(TOWN), "Independent civic reporting for Riverbend");
  });

  it("drops 'for {town}' when there is none", () => {
    assert.equal(civicReportingLine(NO_TOWN), "Independent civic reporting");
    assertNoDanglingPreposition(civicReportingLine(NO_TOWN));
  });
});

describe("aboutFollowSentence", () => {
  it("is byte-identical when a town is set", () => {
    assert.equal(
      aboutFollowSentence(TOWN),
      "We follow Riverbend’s meetings, money, contracts and public records — " +
        "then keep digging when something changes, disappears or doesn’t add up.",
    );
  });

  it("reads as a sentence with no town, not \"We follow 's meetings\"", () => {
    assert.equal(
      aboutFollowSentence(NO_TOWN),
      "We follow the meetings, money, contracts and public records — " +
        "then keep digging when something changes, disappears or doesn’t add up.",
    );
    assert.doesNotMatch(aboutFollowSentence(NO_TOWN), /follow\s+’s/);
  });
});

describe("civicSourcesPhrase", () => {
  it("is byte-identical when a town is set", () => {
    assert.equal(civicSourcesPhrase(TOWN), "Riverbend civic sources");
  });

  it("drops the town word, keeping 'a list of civic sources' grammatical", () => {
    assert.equal(civicSourcesPhrase(NO_TOWN), "civic sources");
  });
});

describe("topicReportingSentence", () => {
  it("is byte-identical when a town is set", () => {
    assert.equal(topicReportingSentence("council", TOWN), "Reporting on council in Riverbend.");
  });

  it("drops 'in {town}' when there is none", () => {
    assert.equal(topicReportingSentence("council", NO_TOWN), "Reporting on council.");
    assertNoDanglingPreposition(topicReportingSentence("council", NO_TOWN));
  });
});

describe("newsInTownPlaceholder", () => {
  it("is byte-identical when a town is set", () => {
    assert.equal(newsInTownPlaceholder(TOWN), "Why this is news in Riverbend today");
  });

  it("drops 'in {town}' when there is none", () => {
    assert.equal(newsInTownPlaceholder(NO_TOWN), "Why this is news today");
    assertNoDanglingPreposition(newsInTownPlaceholder(NO_TOWN));
  });
});
