import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canSubscribePaper,
  draftFromStored,
  ignoredMessagesLine,
  isSafeConfirmationUrl,
  lastCheckLine,
  mailboxSaveResultText,
  newsletterNotConfiguredSentence,
  passwordPreservesStored,
  sourceNewsletterDraftProblem,
  sourceNewsletterSaveResultText,
  subscribePaperBlurb,
  testConnectionResultText,
} from "../lib/news/newsletter-copy.ts";

/*
  The pure folds the mailbox card and source row render with. What the
  COMPONENTS do with them -- the three unconfigured sentences, an escaped
  hostile sender, an unsafe link drawn as no link, the password box, the
  Subscribe control -- is proven against the real components in
  scripts/newsletter-panel-render.test.mjs, so this file stays to the branch
  logic that render cannot exercise (ftp/null/blank inputs, singular/zero
  counts). No mailbox, network or database is touched.
*/

describe("the unconfigured mailbox explains itself, not as an error", () => {
  it("says what it is: a mailbox the paper owns, subscribed, read every 30 minutes", () => {
    const joined = newsletterNotConfiguredSentence();
    assert.match(joined, /mailbox owned by the paper/i);
    assert.match(joined, /subscribe/i);
    assert.match(joined, /every 30 minutes/i);
  });

  it("never calls the unconfigured state broken or an error", () => {
    assert.doesNotMatch(newsletterNotConfiguredSentence(), /broken|error|failed|invalid/i);
  });
});

describe("the password never comes back", () => {
  it("blank means EXACTLY the empty string, and preserves the stored password", () => {
    assert.equal(passwordPreservesStored("", true), true);
    // A space may be part of a valid credential: it is NOT blank.
    assert.equal(passwordPreservesStored(" ", true), false);
    assert.equal(passwordPreservesStored("hunter2", true), false);
    assert.equal(passwordPreservesStored("", false), false);
  });

  it("the save result reports a change without the typed password", () => {
    const withNew = mailboxSaveResultText(true);
    assert.match(withNew, /never shown again/i);
    assert.doesNotMatch(withNew, /hunter2/);
    assert.match(mailboxSaveResultText(false), /stored password was kept/i);
  });

  it("a test-connection result is the server's own plain message, shown as-is", () => {
    assert.equal(
      testConnectionResultText(false, "Check the address and password."),
      "Check the address and password.",
    );
    assert.equal(testConnectionResultText(true, ""), "The desk reached the mailbox. Connection works.");
    assert.match(testConnectionResultText(false, ""), /could not reach the mailbox/i);
  });
});

describe("status wording", () => {
  it("counts ignored messages in words, with singular and zero", () => {
    assert.equal(ignoredMessagesLine(12), "12 other messages ignored");
    assert.equal(ignoredMessagesLine(1), "1 other message ignored");
    assert.equal(ignoredMessagesLine(0), "No other messages ignored");
    assert.equal(ignoredMessagesLine(null), null);
  });

  it("states the last check without inventing one", () => {
    assert.equal(lastCheckLine("3:12 PM"), "Last check: 3:12 PM");
    assert.equal(lastCheckLine(null), "Not checked yet");
  });
});

describe("confirmation links are safe to open, and never opened here", () => {
  it("only http(s) URLs are usable, and credential-bearing ones are refused", () => {
    assert.equal(isSafeConfirmationUrl("https://example.org/confirm"), true);
    assert.equal(isSafeConfirmationUrl("http://example.org/confirm"), true);
    assert.equal(isSafeConfirmationUrl("https://user:pass@example.org/confirm"), false);
    assert.equal(isSafeConfirmationUrl("javascript:alert(1)"), false);
    assert.equal(isSafeConfirmationUrl("not a url"), false);
    assert.equal(isSafeConfirmationUrl(""), false);
  });

});

describe("Sources screen: Subscribe the paper", () => {
  it("appears only with a usable http(s) signup URL", () => {
    assert.equal(canSubscribePaper("https://example.org/signup"), true);
    assert.equal(canSubscribePaper("ftp://example.org/signup"), false);
    assert.equal(canSubscribePaper(null), false);
  });

  it("shows the paper address and says the editor completes the form", () => {
    const blurb = subscribePaperBlurb("paper@example.org");
    assert.match(blurb, /paper@example\.org/);
    assert.match(blurb, /you fill in the form/i);
  });
});

describe("Sources screen: the per-source draft", () => {
  it("starts from the stored (manually detected) sender and signup URL", () => {
    assert.deepEqual(
      draftFromStored({
        newsletterSender: "news@planning.example",
        signupUrl: "https://planning.example/news",
      }),
      {
        newsletterSender: "news@planning.example",
        signupUrl: "https://planning.example/news",
      },
    );
  });

  it("a blank stored value becomes an empty box, not the word undefined", () => {
    assert.deepEqual(draftFromStored({ newsletterSender: null, signupUrl: null }), {
      newsletterSender: "",
      signupUrl: "",
    });
  });

  it("refuses a signup URL that is not http(s), in a plain sentence", () => {
    assert.equal(
      sourceNewsletterDraftProblem({ newsletterSender: "", signupUrl: "not a url" }),
      "The signup URL must start with http:// or https://.",
    );
    assert.equal(
      sourceNewsletterDraftProblem({ newsletterSender: "", signupUrl: "https://ok.example" }),
      null,
    );
  });

  it("reports clearing a source's newsletter details differently from saving", () => {
    assert.match(sourceNewsletterSaveResultText({ newsletterSender: "", signupUrl: "" }), /cleared/i);
    assert.match(
      sourceNewsletterSaveResultText({ newsletterSender: "news@x.example", signupUrl: "" }),
      /saved/i,
    );
  });
});
