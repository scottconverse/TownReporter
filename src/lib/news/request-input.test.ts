import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanProviderTimeInput } from "./provider-settings-input.ts";
import { cleanSetupInput } from "./paper-settings.ts";
import {
  LIMITS,
  MAX_AUTH_BODY_BYTES,
  authBodyTooLarge,
  cleanConnectionEnabled,
  cleanConnectionId,
  cleanConnectionInput,
  cleanLoginId,
  cleanLocalModelInput,
  cleanModelScope,
  cleanPublishId,
  cleanWriteProvider,
} from "./request-input.ts";

/**
 * Bounded input for the server functions this unit was scoped to: publish,
 * sign-in/sign-up, paper settings, and provider/model connections.
 *
 * WHAT THIS FILE IS FOR. Every server function in that list takes a JSON body
 * from a signed-in editor's browser, and the body is whatever the client sent
 * -- the editor's own request is not trusted input, because the session that
 * carries it can be the owner's and the payload can still be 4 MB of "x".
 *
 * WHY NOT THE SERVER FUNCTIONS THEMSELVES. Most of them live in modules that
 * open a database at import time, and two cannot be loaded by
 * `node --experimental-strip-types` at all. The checks under test are the ones
 * their `.validator()` calls, so this file tests the decision rather than the
 * wire; `provider-settings-input.ts` set that pattern first, for the same
 * reason, and its comment says so.
 *
 * THE FAILURE THIS PREVENTS. `savePaperConfig` writes `patch[field]` straight
 * into a text column with no bound of its own (paper-settings.ts:359-399), and
 * the only thing in front of it on the setup path is `cleanSetupInput`. With
 * no ceiling there, a form post can put megabytes into the paper's own row --
 * and every later read of that row (the reader-facing config, the editor page,
 * the welcome article) carries it forward.
 *
 * WHAT THE FIRST RUN OF THIS FILE SAID, before anything was changed:
 *
 *   ✖ bounds every text field of the first-run form
 *     AssertionError: name kept 4000000 characters
 *   ✖ bounds the three lists as well as their members
 *     AssertionError: watchlist kept 200000 entries
 *   ✖ bounds the provider id on a time-budget save
 *     AssertionError: providerId kept 1000000 characters
 *   ℹ tests 4   ℹ pass 1   ℹ fail 3
 *
 * Every ceiling below is read from `LIMITS` rather than repeated, so a change
 * to the bound moves the test with it instead of leaving the two disagreeing.
 */

/** The shortest form the setup page can legitimately post. */
const realSetup = {
  name: "The Longmont Ledger",
  city: "Longmont",
  state: "CO",
  timezone: "America/Denver",
  tagline: "What the council did, and what it means.",
  councilVotesUrl: "https://longmontcitycouncil.org/",
  editorEmail: "editor@example.test",
};

describe("paper settings refuse a setup form larger than a paper", () => {
  it("bounds every text field of the first-run form", () => {
    const huge = "x".repeat(4_000_000);
    const cleaned = cleanSetupInput({
      ...realSetup,
      ...{
        name: huge,
        tagline: huge,
        councilVotesUrl: huge,
        editorEmail: huge,
        city: huge,
        state: huge,
        timezone: huge,
      },
    });
    assert.ok(cleaned.name.length <= LIMITS.paperName, `name kept ${cleaned.name.length} characters`);
    assert.ok(cleaned.city.length <= LIMITS.paperCity, `city kept ${cleaned.city.length} characters`);
    assert.ok(cleaned.state.length <= LIMITS.paperState, `state kept ${cleaned.state.length} characters`);
    assert.ok(cleaned.timezone.length <= LIMITS.timezone, `timezone kept ${cleaned.timezone.length} characters`);
    assert.ok(cleaned.tagline.length <= LIMITS.tagline, `tagline kept ${cleaned.tagline.length} characters`);
    // A URL and an address are not display text: half of either is worse than
    // none, so these two go blank rather than being cut to a broken value.
    assert.equal(cleaned.councilVotesUrl, "", `councilVotesUrl kept ${cleaned.councilVotesUrl.length} characters`);
    assert.equal(cleaned.editorEmail, "", `editorEmail kept ${cleaned.editorEmail.length} characters`);
  });

  it("bounds the three lists as well as their members", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => `entry-${i}`);
    const cleaned = cleanSetupInput({
      ...realSetup,
      watchlist: many.map((url) => ({ url: `https://example.test/${url}`, title: url })),
      youtubeChannels: many,
      meetingKeywords: many,
    });
    assert.ok(cleaned.watchlist.length <= LIMITS.watchlistEntries, `watchlist kept ${cleaned.watchlist.length} entries`);
    assert.ok(
      cleaned.youtubeChannels.length <= LIMITS.channelOrKeywordEntries,
      `youtubeChannels kept ${cleaned.youtubeChannels.length} entries`,
    );
    assert.ok(
      cleaned.meetingKeywords.length <= LIMITS.meetingKeywordEntries,
      `meetingKeywords kept ${cleaned.meetingKeywords.length} entries`,
    );
  });

  it("leaves a real setup form exactly as the editor typed it", () => {
    // The bound must not touch anything an operator would actually enter --
    // including the two blank fields, which are real answers.
    assert.deepEqual(cleanSetupInput({ ...realSetup, councilVotesUrl: "", editorEmail: "" }), {
      ...realSetup,
      councilVotesUrl: "",
      editorEmail: "",
      watchlist: [],
      youtubeChannels: [],
      meetingKeywords: [],
    });
  });
});

describe("a provider id is looked up, so an unbounded one is refused first", () => {
  it("bounds the provider id on a time-budget save", () => {
    const cleaned = cleanProviderTimeInput({ providerId: "p".repeat(1_000_000), callSeconds: 90 });
    assert.ok(cleaned.providerId.length <= LIMITS.providerId, `providerId kept ${cleaned.providerId.length} characters`);
    // A real id -- `claude`, or a local provider key -- is untouched.
    assert.equal(cleanProviderTimeInput({ providerId: "claude", callSeconds: 90 }).providerId, "claude");
  });
});

describe("a local model choice cannot carry an unbounded address", () => {
  it("refuses rather than truncates, because half an address is a different server", () => {
    const over = cleanLocalModelInput({
      baseUrl: `http://127.0.0.1:1234/${"x".repeat(1_000_000)}`,
      id: "y".repeat(1_000_000),
      scope: "story",
    });
    assert.deepEqual(over, {
      choice: null,
      scope: "story",
      invalidScope: false,
      invalidInput: true,
    });
  });

  it("leaves a real pick alone", () => {
    assert.deepEqual(
      cleanLocalModelInput({ baseUrl: "http://127.0.0.1:1234/v1", id: "qwen3-coder-30b", scope: "dark" }),
      {
        choice: { baseUrl: "http://127.0.0.1:1234/v1", id: "qwen3-coder-30b" },
        scope: "dark",
        invalidScope: false,
        invalidInput: false,
      },
    );
  });

  it("keeps the existing degradations: a bad scope is named, a missing half is a reset", () => {
    assert.equal(cleanLocalModelInput({ scope: "../../etc" }).invalidScope, true);
    assert.equal(cleanLocalModelInput({ baseUrl: "http://a.test/v1", scope: 7 }).invalidScope, true);
    // A scope that IS one of the five is not reported as invalid.
    assert.equal(cleanLocalModelInput({ scope: "scan" }).invalidScope, false);
    // Only one half, or a non-text half: the pre-existing "reset to default".
    assert.deepEqual(cleanLocalModelInput({ baseUrl: "http://a.test/v1" }), {
      choice: null,
      scope: undefined,
      invalidScope: false,
      invalidInput: false,
    });
  });

  it("the model-use scope is still an allow-list, not a length check", () => {
    assert.equal(cleanModelScope("story"), "story");
    assert.equal(cleanModelScope("dark"), "dark");
    assert.equal(cleanModelScope("../../etc/passwd"), undefined);
    assert.equal(cleanModelScope({}), undefined);
    assert.equal(cleanModelScope("x".repeat(1_000_000)), undefined);
  });
});

describe("a connection body is the six keys its type names", () => {
  it("keeps every refusal it already had", () => {
    for (const notAnObject of [null, undefined, [], "name=n", 7, true]) {
      assert.throws(() => cleanConnectionInput(notAnObject), /Invalid connection request/, `${String(notAnObject)} was accepted`);
    }
    assert.throws(() => cleanConnectionInput({ baseUrl: "https://a.test/v1" }), /name is required/);
    assert.throws(() => cleanConnectionInput({ name: "Home box" }), /baseUrl is required/);
    assert.throws(() => cleanConnectionInput({ name: 7, baseUrl: "https://a.test/v1" }), /name is required/);
    assert.throws(() => cleanConnectionInput({ name: "n", baseUrl: "https://a.test/v1", apiKey: 7 }), /apiKey must be text/);
    assert.throws(() => cleanConnectionInput({ name: "n", baseUrl: "https://a.test/v1", removeApiKey: "yes" }), /removeApiKey must be true or false/);
  });

  it("bounds the text at the boundary, before anything is parsed", () => {
    // Pinned to the boundary's own wording, not just "something refused": the
    // store's `normalizeConnectionInput` refuses an over-long name too, so a
    // looser match would pass even with the ceiling removed from this file.
    const huge = "x".repeat(4_000_000);
    assert.throws(
      () => cleanConnectionInput({ name: huge, baseUrl: "https://a.test/v1" }),
      /name must be 120 characters or fewer/,
    );
    assert.throws(
      () => cleanConnectionInput({ name: "n", baseUrl: `https://a.test/${huge}` }),
      /base URL must be 500 characters or fewer/,
    );
    assert.throws(
      () => cleanConnectionInput({ name: "n", baseUrl: "https://a.test/v1", apiKey: huge }),
      /apiKey must be 5000 characters or fewer/,
    );
    assert.throws(
      () => cleanConnectionInput({ name: "n", baseUrl: "https://a.test/v1", modelId: huge }),
      /modelId must be 300 characters or fewer/,
    );
  });

  it("returns the named keys, so an unknown one cannot ride along", () => {
    assert.deepEqual(
      cleanConnectionInput({
        name: "Home box",
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "sk-local",
        modelId: "qwen3-coder-30b",
        removeApiKey: false,
        // Nothing in the type says this may exist; before this change the raw
        // object was cast to the type and every extra key went with it.
        role: "owner",
        newsroomId: 1,
      }),
      {
        name: "Home box",
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "sk-local",
        modelId: "qwen3-coder-30b",
        removeApiKey: false,
      },
    );
  });

  it("bounds the id on the three id-only calls, and the enabled flag beside it", () => {
    assert.deepEqual(cleanConnectionId({ id: "  abc  " }), { id: "abc" });
    assert.throws(() => cleanConnectionId({ id: "   " }), /Connection id is required/);
    assert.throws(() => cleanConnectionId({ id: 7 }), /Connection id is required/);
    assert.throws(() => cleanConnectionId(null), /Invalid connection request/);
    assert.throws(() => cleanConnectionId({ id: "x".repeat(1_000_000) }), /id must be 300 characters or fewer/);
    assert.deepEqual(cleanConnectionEnabled({ id: "abc", enabled: true }), { id: "abc", enabled: true });
    assert.throws(() => cleanConnectionEnabled({ id: "abc", enabled: "yes" }), /Enabled must be true or false/);
  });
});

describe("a publish id that is not an integer never reaches the query", () => {
  it("answers null for everything that is not a positive 32-bit integer", () => {
    const rejected: unknown[] = [
      "1",
      "1; drop table articles",
      "1 or 1=1",
      1.5,
      -1,
      0,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1e30,
      {},
      [],
      true,
      null,
      undefined,
    ];
    for (const bad of rejected) {
      assert.equal(cleanPublishId(bad), null, `${JSON.stringify(bad)} was accepted`);
    }
    assert.equal(cleanPublishId(42), 42);
    assert.equal(cleanPublishId(2_147_483_647), 2_147_483_647);
  });
});

describe("a provider login names one of two providers, or says nothing", () => {
  it("returns an empty name rather than throwing, so the friendly error still runs", () => {
    assert.equal(cleanWriteProvider("claude"), "claude");
    assert.equal(cleanWriteProvider("codex"), "codex");
    for (const bad of ["grok", "", "Claude", 7, {}, null, undefined, "c".repeat(1_000_000)]) {
      assert.equal(cleanWriteProvider(bad), "", `${JSON.stringify(bad)} was accepted`);
    }
  });

  it("answers null for an id that is not a non-negative integer", () => {
    assert.equal(cleanLoginId(0), 0);
    assert.equal(cleanLoginId(3), 3);
    for (const bad of ["3", 3.5, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e30, {}, [], null, undefined]) {
      assert.equal(cleanLoginId(bad), null, `${JSON.stringify(bad)} was accepted`);
    }
  });
});

describe("an auth request is capped before its body is read", () => {
  it("refuses a declared body over the cap, and only over the cap", () => {
    assert.equal(authBodyTooLarge(null), false);
    assert.equal(authBodyTooLarge(""), false);
    assert.equal(authBodyTooLarge("0"), false);
    assert.equal(authBodyTooLarge("512"), false);
    assert.equal(authBodyTooLarge(String(MAX_AUTH_BODY_BYTES)), false);
    assert.equal(authBodyTooLarge(String(MAX_AUTH_BODY_BYTES + 1)), true);
    assert.equal(authBodyTooLarge(String(512 * 1024 * 1024)), true);
    // An unmeasurable or unparseable header is not treated as large: refusing
    // on it would break a chunked sign-in for no gain, and better-auth applies
    // its own limit downstream.
    assert.equal(authBodyTooLarge("not-a-number"), false);
    assert.equal(authBodyTooLarge("-1"), false);
  });

  it("the cap is far above any real auth body", () => {
    const signUp = JSON.stringify({
      name: "The Editor",
      email: "editor@example.test",
      password: "an-operator-password-1234",
    });
    assert.ok(signUp.length < MAX_AUTH_BODY_BYTES / 100, `cap is only ${MAX_AUTH_BODY_BYTES / signUp.length}x a sign-up`);
  });
});
