import assert from "node:assert/strict";
import { it } from "node:test";
import { ImapFlow } from "imapflow";
import { imapflowSession } from "../src/lib/news/newsletter-imapflow.ts";
import { NEWSLETTER_MESSAGE_CAP_BYTES as cap } from "../src/lib/news/newsletter-imap.ts";

it("the production IMAP adapter opens read-only, disables logs, and bounds body reads without a server", async (t) => {
  let options, bodyReads = 0, released = false, closed = false;
  t.mock.method(ImapFlow.prototype, "connect", async function () { options = this.options; });
  t.mock.method(ImapFlow.prototype, "getMailboxLock", async function (folder, flags) {
    assert.equal(folder, "INBOX");
    assert.deepEqual(flags, { readOnly: true });
    this.mailbox = { uidValidity: 9n };
    return { release() { released = true; } };
  });
  t.mock.method(ImapFlow.prototype, "search", async () => [4, 2, 3, 1]);
  t.mock.method(ImapFlow.prototype, "fetch", async function* (uids, query, flags) {
    assert.deepEqual(uids, [3, 4]);
    assert.deepEqual(query, { uid: true, size: true, flags: true });
    assert.deepEqual(flags, { uid: true });
    for (const uid of uids) yield { uid, size: 10, flags: new Set() };
  });
  t.mock.method(ImapFlow.prototype, "fetchOne", async (uid, query, flags) => {
    bodyReads++;
    assert.deepEqual(query, { source: { maxLength: cap + 1 } });
    assert.deepEqual(flags, { uid: true });
    return { source: uid === "4" ? Buffer.alloc(cap + 1) : Buffer.from("message") };
  });
  t.mock.method(ImapFlow.prototype, "logout", async () => {});
  t.mock.method(ImapFlow.prototype, "close", () => { closed = true; });
  const session = await imapflowSession({ address: "paper@example.org", password: "fixture-only",
    host: "imap.example.org", port: 993, ssl: true });
  assert.equal(options.logger, false);
  assert.equal(options.logRaw, false);
  assert.equal(options.secure, true);
  assert.equal(options.disableAutoIdle, true);
  assert.equal(await session.uidValidity(), 9n);
  assert.equal((await session.listUids({ fromUid: 2n, limit: 2 })).length, 2);
  assert.equal((await session.fetchRaw(3n, cap + 1)).refused, "too-large");
  assert.equal(bodyReads, 0, "oversized messages are refused before fetching their body");
  assert.equal((await session.fetchRaw(3n, 10)).raw.byteLength, 7);
  assert.equal((await session.fetchRaw(4n, null)).refused, "too-large");
  await session.close();
  assert.ok(released && closed);
});
