import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEditorCopy, deskTakenLoginCopy } from "./desk-copy.ts";
import {
  claimedLoginCopy,
  deskTakenPageCopy,
  firstRunCopy,
  queueFilterLabels,
  setupTokenPlaceholder,
  themeCopy,
  unclaimedLoginCopy,
} from "./desk-locked.ts";

describe("locked Design strings", () => {
  it("keeps unclaimed, claimed, taken, theme, and first-run copy exact", () => {
    const unclaimed = unclaimedLoginCopy();
    assert.equal(unclaimed.title, "Create editor");
    assert.equal(unclaimed.submit, "Create editor");
    assert.equal(unclaimed.ghost, "I already have an account");
    assert.equal(createEditorCopy().paper, "Create editor");
    const claimed = claimedLoginCopy();
    assert.equal(claimed.title, "Editor sign-in");
    assert.equal(claimed.submit, "Sign in with email");
    assert.equal(deskTakenLoginCopy().title, "Editor sign-in");
    const taken = deskTakenPageCopy();
    assert.equal(taken.title, "This desk is taken");
    assert.equal(taken.body, deskTakenLoginCopy().body);
    const theme = themeCopy();
    assert.equal(theme.day, "Day desk");
    assert.equal(theme.night, "Night desk");
    assert.equal(theme.aria, "Day desk or night desk");
    assert.doesNotMatch(theme.night, /^Dark$/);
    const first = firstRunCopy();
    assert.equal(first.band, "You own this desk. The Longmont watch list is already seeded.");
    assert.equal(first.primary, "Run the first scan");
    assert.equal(first.secondary, "File a lead");
    assert.equal(first.tertiary, "View paper");
    assert.equal(setupTokenPlaceholder(), "Paste the token the operator gave you");
    const q = queueFilterLabels();
    assert.equal(q.all, "All");
    assert.equal(q.new, "New");
    assert.equal(q.drafted, "Drafted");
    assert.equal(q.held, "Held");
    assert.equal(q.killed, "Killed");
  });
});
