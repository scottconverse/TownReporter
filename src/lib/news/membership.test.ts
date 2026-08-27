import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGrokPreviewHost, newsroomSetupToken, SetupRequiredError } from "./membership.ts";

describe("newsroom hosts", () => {
  it("treats grok.me as preview and localhost as self-host", () => {
    assert.equal(isGrokPreviewHost("townreporter-longmont.grok.me"), true);
    assert.equal(isGrokPreviewHost("grok.me"), true);
    assert.equal(isGrokPreviewHost("localhost"), false);
    assert.equal(isGrokPreviewHost("127.0.0.1"), false);
    assert.equal(isGrokPreviewHost("paper.example.org"), false);
  });
});

describe("setup token env", () => {
  it("reads NEWSROOM_SETUP_TOKEN", () => {
    const prev = process.env.NEWSROOM_SETUP_TOKEN;
    process.env.NEWSROOM_SETUP_TOKEN = "desk-secret";
    try {
      assert.equal(newsroomSetupToken(), "desk-secret");
    } finally {
      if (prev === undefined) delete process.env.NEWSROOM_SETUP_TOKEN;
      else process.env.NEWSROOM_SETUP_TOKEN = prev;
    }
  });

  it("SetupRequiredError is a 403", () => {
    const err = new SetupRequiredError();
    assert.equal(err.status, 403);
    assert.match(err.message, /NEWSROOM_SETUP_TOKEN/);
  });
});
