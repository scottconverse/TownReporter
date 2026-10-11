import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSql, type Sql } from "../db.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import {
  NEWSLETTER_POLL_INTERVAL_MS,
  NEWSLETTER_SAFE_ERROR,
  claimPoll,
  ensureNewsletterSchema,
  getMailbox,
  listAttachments,
  mailboxPassword,
  readCursor,
  saveMailbox,
  writeCursor,
} from "./newsletter-store.server.ts";
import { pollNewsletterMailbox, syntheticMessageUrl } from "./newsletter-poll.server.ts";
import {
  detectSignupUrlFromCapturedText,
  readMailboxView,
  readSourceNewsletter,
  saveNewsletterMailbox,
  testSavedMailbox,
  writeSourceNewsletter,
} from "./newsletter-api.server.ts";
import type {
  NewsletterImapBody,
  NewsletterImapFactory,
  NewsletterImapMessage,
  NewsletterImapSession,
} from "./newsletter-imap.ts";
import { cleanMailboxInput } from "./newsletter-input.ts";
import { newsletterScanDocs, retainedNewsletterDocument } from "./newsletter-scan.server.ts";
import type { DeskJob } from "./jobs.ts";
import { detectedNewsletterSignup } from "./newsletter-signup.ts";

await applyMigrationsToTestPglite();

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKET_PDF = readFileSync(join(HERE, "fixtures", "story-documents", "packet.pdf"));
const SECRET = "sup3r-secret-mail-password";
const MAILBOX_ADDRESS = "paper@town.example";
const priorAuthSecret = process.env.BETTER_AUTH_SECRET;
before(() => { process.env.BETTER_AUTH_SECRET = "newsletter-test-encryption-secret-only"; });
after(() => {
  if (priorAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = priorAuthSecret;
});

let roomCounter = 900_000;

function nextNewsroom(): number {
  roomCounter += 1;
  return roomCounter;
}

let userCounter = 0;
function nextUser(): string {
  userCounter += 1;
  return `newsletter-test-user-${Date.now()}-${userCounter}`;
}

async function makeSource(sql: Sql, newsroomId: number, userId: string, url: string, sender?: string) {
  const [row] = await sql<{ id: number }>`
    insert into sources (user_id, newsroom_id, url, title, status, newsletter_sender)
    values (${userId}, ${newsroomId}, ${url}, ${url}, ${"accepted"}, ${sender ?? null})
    returning id`;
  return Number(row!.id);
}

/* ------------------------------------------------------------------ */
/* A real in-memory IMAP source: raw RFC822 bytes, no server.          */
/* ------------------------------------------------------------------ */

type FakeMail = { uid: bigint; raw: Buffer; deleted?: boolean; size?: number | null };

function mimeMessage(opts: {
  from: string;
  subject: string;
  messageId: string | null;
  html: string;
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}): Buffer {
  const boundary = "b0undary-newsletter-test";
  const headers = [
    `From: ${opts.from}`,
    `To: ${MAILBOX_ADDRESS}`,
    opts.messageId ? `Message-ID: ${opts.messageId}` : "",
    `Subject: ${opts.subject}`,
    `Date: Mon, 04 Mar 2024 12:00:00 -0500`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join("\r\n");

  const parts: string[] = [];
  parts.push(
    `--${boundary}\r\nContent-Type: text/html; charset="utf-8"\r\n\r\n${opts.html}\r\n`,
  );
  for (const a of opts.attachments ?? []) {
    parts.push(
      `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${a.filename}"\r\n\r\n` +
        `${a.content.toString("base64")}\r\n`,
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return Buffer.from(`${headers}\r\n\r\n${parts.join("")}`, "utf8");
}

class FakeImapSession implements NewsletterImapSession {
  private readonly mails: FakeMail[];
  private readonly uidValidityValue: bigint | null;
  constructor(mails: FakeMail[], uidValidityValue: bigint | null) {
    this.mails = mails;
    this.uidValidityValue = uidValidityValue;
  }
  async uidValidity(): Promise<bigint | null> {
    return this.uidValidityValue;
  }
  async listUids(opts: { fromUid: bigint; limit: number }): Promise<NewsletterImapMessage[]> {
    return this.mails
      .filter((m) => m.uid > opts.fromUid)
      .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
      .slice(0, opts.limit)
      .map((m) => ({ uid: m.uid, size: m.size ?? m.raw.byteLength, deleted: m.deleted }));
  }
  async fetchRaw(uid: bigint, size: number | null): Promise<NewsletterImapBody> {
    const mail = this.mails.find((m) => m.uid === uid);
    if (!mail) return { raw: null, refused: "unavailable" };
    if (size != null && size > 5 * 1024 * 1024) return { raw: null, refused: "too-large" };
    return { raw: new Uint8Array(mail.raw) };
  }
}

function fakeImapFactory(mails: FakeMail[], uidValidity: bigint | null = 1n): NewsletterImapFactory {
  return async () => new FakeImapSession(mails, uidValidity);
}

/* ------------------------------------------------------------------ */

describe("newsletter API: mailbox settings contract", () => {
  it("reports not-configured until a password is saved, never echoing the secret", async () => {
    const newsroomId = nextNewsroom();
    const view = await readMailboxView(newsroomId);
    assert.equal(view.configured, false);
    assert.equal(view.hasPassword, false);
    assert.equal(view.address, "");
  });

  it("saves owner settings, keeps password whitespace, and never returns the password", async () => {
    const newsroomId = nextNewsroom();
    const result = await saveNewsletterMailbox({
      userId: nextUser(),
      newsroomId,
      address: cleanMailboxInput({ address: " paper@town.example " }).address,
      host: "imap.town.example",
      port: 993,
      ssl: true,
      password: `  ${SECRET}  `,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mailbox.configured, true);
    assert.equal(result.mailbox.hasPassword, true);
    assert.equal(result.mailbox.address, "paper@town.example");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(SECRET), "the password must not appear in the response");

    const row = await getMailbox(newsroomId);
    assert.ok(row);
    assert.equal(mailboxPassword(row!), `  ${SECRET}  `, "whitespace is significant");

    const view = await readMailboxView(newsroomId);
    assert.equal(view.configured, true);
    assert.equal(view.address, "paper@town.example");
    assert.ok(!JSON.stringify(view).includes(SECRET));
  });

  it("preserves the stored password when a save omits it", async () => {
    const newsroomId = nextNewsroom();
    await saveNewsletterMailbox({
      userId: nextUser(), newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    await saveNewsletterMailbox({
      userId: nextUser(), newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true,
    });
    const row = await getMailbox(newsroomId);
    assert.equal(mailboxPassword(row!), SECRET);
  });

  it("resets the cursor but preserves the cadence claim when the account identity changes", async () => {
    const newsroomId = nextNewsroom();
    await saveNewsletterMailbox({
      userId: nextUser(), newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    const sql = await getSql();
    await writeCursor(newsroomId, { uid: 42n, uidValidity: 9n }, sql);
    await claimPoll(newsroomId, sql);

    // Same identity keeps the cursor.
    await saveMailbox({
      userId: nextUser(), newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true,
    });
    assert.deepEqual((await readCursor(newsroomId, sql)).uid, 42n, "same identity keeps the cursor");

    // New host: the cursor resets so no new-mailbox message is skipped.
    await saveMailbox({
      userId: nextUser(), newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.other.example", port: 993, ssl: true,
    });
    const after = await readCursor(newsroomId, sql);
    assert.equal(after.uid, null, "an identity change resets the cursor");
    assert.equal(after.uidValidity, null);

    // The claim survives so a save cannot bypass the 30-minute cadence.
    assert.equal(await claimPoll(newsroomId, sql), false, "the cadence claim survives an identity change");
  });

  it("rejects an over-long password without echoing it", () => {
    const huge = "x".repeat(5000);
    assert.throws(
      () => cleanMailboxInput({ address: "a@b.c", password: huge }),
      (err: Error) => !err.message.includes(huge),
    );
  });
});

describe("newsletter mailbox poll (integration)", () => {
  it("feeds retained mail into the actual scan and preserves its lead citation when the website fails", async () => {
    const newsroomId = nextNewsroom(), userId = nextUser(), sql = await getSql();
    await saveNewsletterMailbox({ userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET });
    const sourceId = await makeSource(sql, newsroomId, userId, "https://planning.example/", "planning.example");
    const messageId = "<scan-handoff@planning.example>", url = syntheticMessageUrl(newsroomId, messageId);
    await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw: mimeMessage({
      from: "news@planning.example", subject: "Council funds the neighborhood garden", messageId,
      html: "<p>The council approved $20,000 for a neighborhood garden on Tuesday.</p>" }) }]) });
    assert.equal((await newsletterScanDocs(newsroomId, sourceId)).length, 1);
    assert.equal(await retainedNewsletterDocument(url, newsroomId + 1), null);
    const [run] = await sql`insert into scan_runs(user_id,newsroom_id) values(${userId},${newsroomId}) returning id`;
    const [job] = await sql`insert into desk_jobs(newsroom_id,user_id,kind,subject_id,model_choice,model_choice_source,status,claim_token)
      values(${newsroomId},${userId},'scan',${run.id},'grok','editor','running','newsletter-fixture') returning *`;
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) specifier = new URL("../../" + specifier.slice(2), import.meta.url).href;
      try { return nextResolve(specifier, context); } catch (error) {
        if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw error;
        const resolved = new URL(specifier, context.parentURL);
        for (const suffix of [".ts", ".tsx"])
          if (existsSync(fileURLToPath(resolved) + suffix)) return nextResolve(resolved.href + suffix, context);
        throw error;
      }
    } });
    let modelInput = "";
    try {
      const { performScanWork } = await import("./desk.ts");
      await performScanWork(job as DeskJob, {
        ingestUrl: async () => { throw new Error("Fixture website unavailable"); },
        grokChat: async (_system, input) => {
          modelInput = input;
          return { ok: true, text: JSON.stringify({ leads: [{ headline: "Council funds the neighborhood garden",
            why: "Public funds support a neighborhood garden.", evidence: "The council approved $20,000 on Tuesday.",
            topic: "council", newsworthiness: 10, source_urls: [url] }], proposed_sources: [], editor_summary: "Read the newsletter." }) };
        }, setJobStage: async () => {}, setJobModelChoice: async () => {},
      });
      const { defaultIngest } = await import("./report.ts");
      const reported = await defaultIngest(url, { newsroomId: String(newsroomId) });
      assert.match(reported.text, /\$20,000/, "reporting resolves the archived citation without HTTP");
    } finally { hooks.deregister(); }
    assert.match(modelInput, /\$20,000/);
    assert.ok(modelInput.includes(url));
    const [lead] = await sql`select source_urls from leads where newsroom_id=${newsroomId}`;
    assert.ok(lead, "the scan files a lead from the newsletter");
    assert.ok(JSON.stringify(lead.source_urls).includes(url), "the retained capture remains the citation");
    assert.equal((await newsletterScanDocs(newsroomId, sourceId)).length, 0, "successful analysis settles the queue");
    assert.match((await retainedNewsletterDocument(url, newsroomId))!.text, /\$20,000/);
  });
  it("captures an allowed message into the archive and records provenance", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    await ensureNewsletterSchema(sql);
    const sourceId = await makeSource(sql, newsroomId, userId, "https://planning.example/", "news@planning.example");

    const raw = mimeMessage({
      from: "Planning Newsletter <news@planning.example>",
      subject: "Your planning newsletter",
      messageId: "<allowed-1@planning.example>",
      html: `<p>Hello</p><a href="https://planning.example/story">Read the story</a>`,
    });
    const result = await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) });
    assert.equal(result.status, "polled", result.message);
    assert.equal(result.captured, 1);

    const msgs = await sql<{ version_id: number | null; source_id: number | null }>`
      select version_id, source_id from newsletter_messages where newsroom_id = ${newsroomId}`;
    assert.equal(msgs.length, 1);
    assert.equal(Number(msgs[0]!.source_id), sourceId);
    assert.ok(msgs[0]!.version_id);

    const versions = await sql<{ full_text: string; url: string }>`
      select full_text, url from artifact_versions
      where newsroom_id = ${newsroomId} and url = ${syntheticMessageUrl(newsroomId, "<allowed-1@planning.example>")}`;
    assert.equal(versions.length, 1);
    assert.match(versions[0]!.full_text, /Read the story/);
    assert.match(versions[0]!.full_text, /https:\/\/planning\.example\/story/);

    const events = await sql<{ id: number }>`
      select id from capture_events where newsroom_id = ${newsroomId} limit 5`;
    assert.ok(events.length >= 1, "a capture event is recorded");
  });

  it("shows allowed confirmation links for the editor without following them", async () => {
    const newsroomId = nextNewsroom(), userId = nextUser(), sql = await getSql();
    await saveNewsletterMailbox({ userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET });
    await makeSource(sql, newsroomId, userId, "https://planning.example/", "planning.example");
    await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw: mimeMessage({
      from: "news@planning.example", subject: "Welcome to our newsletter", messageId: "<confirm@planning.example>",
      html: '<a href="https://planning.example/confirm?token=fixture">Confirm subscription</a><a href="https://planning.example/unsubscribe">Unsubscribe</a>' }) }]) });
    const view = await readMailboxView(newsroomId);
    assert.equal(view.waiting.length, 1);
    assert.deepEqual(view.waiting[0].links, [{ text: "Confirm subscription", url: "https://planning.example/confirm?token=fixture" }]);
  });

  it("ignores a message from a non-allowlisted sender and leaves the mailbox alone", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    await makeSource(sql, newsroomId, userId, "https://planning.example/", "news@planning.example");

    const raw = mimeMessage({
      from: "Spam <spam@evil.example>",
      subject: "Buy now",
      messageId: "<ignored-1@evil.example>",
      html: "<p>spam</p>",
    });
    const result = await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) });
    assert.equal(result.status, "polled");
    assert.equal(result.captured, 0);
    assert.equal(result.ignored, 1);

    const msgs = await sql<{ c: number }>`
      select count(*)::int as c from newsletter_messages where newsroom_id = ${newsroomId}`;
    assert.equal(msgs[0]!.c, 0, "no provenance row for an ignored message");
    // Nothing marked read/deleted: the poller is read-only, and the message is
    // only "left alone" if a later poll still sees it.
    const again = await pollNewsletterMailbox(newsroomId, {
      imap: fakeImapFactory([{ uid: 1n, raw }]),
    });
    assert.equal(again.status, "skipped-cadence");
  });

  it("skips a duplicate Message-ID", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    await makeSource(sql, newsroomId, userId, "https://planning.example/", "news@planning.example");
    const raw = mimeMessage({
      from: "news@planning.example",
      subject: "First",
      messageId: "<dup@planning.example>",
      html: "<p>first</p>",
    });
    const first = await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) });
    assert.equal(first.captured, 1);

    // Clear the claim to force a second run against the same message.
    await sql`update newsletter_mailboxes set poll_claim_at = null where newsroom_id = ${newsroomId}`;
    await writeCursor(newsroomId, { uid: 0n, uidValidity: 1n }, sql);
    const second = await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) });
    assert.equal(second.captured, 0);
    assert.equal(second.ignored, 1);
    const msgs = await sql<{ c: number }>`
      select count(*)::int as c from newsletter_messages where newsroom_id = ${newsroomId}`;
    assert.equal(msgs[0]!.c, 1);
  });

  it("keeps links through sanitisation and never runs a script", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    await makeSource(sql, newsroomId, userId, "https://planning.example/", "news@planning.example");
    const raw = mimeMessage({
      from: "news@planning.example",
      subject: "Links",
      messageId: "<links@planning.example>",
      html:
        `<p>Read <a href="https://planning.example/a">the agenda</a></p>` +
        `<script>alert('x')</script>` +
        `<img src="https://tracker.example/pixel.png">`,
    });
    await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) });
    const [row] = await sql<{ full_text: string }>`
      select full_text from artifact_versions
      where newsroom_id = ${newsroomId} and url = ${syntheticMessageUrl(newsroomId, "<links@planning.example>")}`;
    assert.match(row!.full_text, /the agenda/);
    assert.match(row!.full_text, /https:\/\/planning\.example\/a/);
    assert.doesNotMatch(row!.full_text, /tracker\.example/);
    assert.doesNotMatch(row!.full_text, /alert\(/);
  });

  it("routes a PDF attachment through the existing extractor into the archive", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    const sourceId = await makeSource(sql, newsroomId, userId, "https://planning.example/", "news@planning.example");
    const raw = mimeMessage({
      from: "news@planning.example",
      subject: "Packet attached",
      messageId: "<pdf@planning.example>",
      html: "<p>See the packet</p>",
      attachments: [
        { filename: "packet.pdf", contentType: "application/pdf", content: PACKET_PDF },
        { filename: "notes.txt", contentType: "text/plain", content: Buffer.from("ignore me") },
      ],
    });
    const result = await pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) });
    assert.equal(result.captured, 1);

    // Read the message row, then the attachment mapping the poller recorded.
    const [msg] = await sql<{ id: number }>`
      select id from newsletter_messages
      where newsroom_id = ${newsroomId} and message_id = ${"<pdf@planning.example>"}`;
    assert.ok(msg, "the accepted message has a row");
    const attachments = await listAttachments(newsroomId, Number(msg!.id), sql);
    assert.equal(attachments.length, 1, "only the PDF attachment is mapped, not the .txt");
    assert.equal(attachments[0]!.filename, "packet.pdf");
    assert.equal(attachments[0]!.contentType, "application/pdf");

    const [pdf] = await sql<{ full_text: string; content_type: string }>`
      select full_text, content_type from artifact_versions
      where newsroom_id = ${newsroomId} and id = ${attachments[0]!.versionId}`;
    assert.ok(pdf, "the PDF attachment is archived through the existing extractor");
    assert.equal(pdf!.content_type, "application/pdf");
    assert.ok(pdf!.full_text.trim().length >= 40);
    const docs = await newsletterScanDocs(newsroomId, sourceId);
    assert.equal(docs[0].extras.length, 1);
    assert.equal(docs[0].extras[0].text, pdf!.full_text);
  });

  it("does not poll when the mailbox is not set up", async () => {
    const newsroomId = nextNewsroom();
    let called = 0;
    const factory: NewsletterImapFactory = async () => {
      called += 1;
      return new FakeImapSession([], 1n);
    };
    const result = await pollNewsletterMailbox(newsroomId, { imap: factory });
    assert.equal(result.status, "not-configured");
    assert.equal(called, 0, "no IMAP call when the mailbox is not set up");
  });

  it("runs at most one poll per cadence window under concurrent claims", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    await makeSource(sql, newsroomId, userId, "https://planning.example/", "news@planning.example");
    const raw = mimeMessage({
      from: "news@planning.example",
      subject: "One",
      messageId: "<cadence@planning.example>",
      html: "<p>once</p>",
    });
    // Two concurrent claims: exactly one wins.
    const [a, b] = await Promise.all([claimPoll(newsroomId, sql), claimPoll(newsroomId, sql)]);
    assert.equal([a, b].filter(Boolean).length, 1);

    await sql`update newsletter_mailboxes set poll_claim_at = null where newsroom_id = ${newsroomId}`;
    const [first, second] = await Promise.all([
      pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) }),
      pollNewsletterMailbox(newsroomId, { imap: fakeImapFactory([{ uid: 1n, raw }]) }),
    ]);
    const polled = [first, second].filter((r) => r.status === "polled");
    assert.equal(polled.length, 1, "only one concurrent poll runs");
    assert.equal([first, second].filter((r) => r.status === "skipped-cadence").length, 1);

    // After the window, a poll runs again.
    await sql`
      update newsletter_mailboxes
      set poll_claim_at = now() - ${`${NEWSLETTER_POLL_INTERVAL_MS + 1000}`}::int * interval '1 millisecond'
      where newsroom_id = ${newsroomId}`;
    assert.equal(await claimPoll(newsroomId, sql), true, "the window reopens after the interval");
  });

  it("retries on a failing fetch and leaves the cursor ready to retry", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    await makeSource(sql, newsroomId, userId, "https://planning.example/", "news@planning.example");
    const raw = mimeMessage({
      from: "news@planning.example",
      subject: "Retry",
      messageId: "<retry@planning.example>",
      html: "<p>hello</p>",
    });
    // A factory whose session refuses the first fetch with a transient error.
    let attempts = 0;
    const flaky: NewsletterImapFactory = async () => {
      const inner = new FakeImapSession([{ uid: 1n, raw }], 1n);
      return {
        uidValidity: () => inner.uidValidity(),
        listUids: (o) => inner.listUids(o),
        fetchRaw: async (uid, size) => {
          attempts += 1;
          if (attempts === 1) throw new Error("transient");
          return inner.fetchRaw(uid, size);
        },
      };
    };
    const failed = await pollNewsletterMailbox(newsroomId, { imap: flaky });
    assert.equal(failed.status, "error");
    assert.equal(failed.message, NEWSLETTER_SAFE_ERROR);

    // The cursor did not advance past the unfetched message; a later poll gets it.
    const cursor = await readCursor(newsroomId, sql);
    assert.equal(cursor.uid, null);
    await sql`update newsletter_mailboxes set poll_claim_at = null where newsroom_id = ${newsroomId}`;
    const retried = await pollNewsletterMailbox(newsroomId, { imap: flaky });
    assert.equal(retried.status, "polled");
    assert.equal(retried.captured, 1);
  });

  it("stores no raw credential in the mailbox row's error and exposes none in responses", async () => {
    const newsroomId = nextNewsroom();
    await saveNewsletterMailbox({
      userId: nextUser(), newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    // A failing factory error that quotes the password must not leak into
    // the stored error or any returned value.
    const leaking: NewsletterImapFactory = async () => {
      throw new Error(`login failed for ${MAILBOX_ADDRESS} with ${SECRET}`);
    };
    const test = await testSavedMailbox(newsroomId, { imap: leaking });
    assert.equal(test.ok, false);
    assert.ok(!test.message.includes(SECRET));
    assert.ok(!test.message.includes("login failed"));
    assert.equal(test.message, NEWSLETTER_SAFE_ERROR);

    const view = await readMailboxView(newsroomId);
    assert.ok(!JSON.stringify(view).includes(SECRET));
    const row = await getMailbox(newsroomId);
    assert.ok(row);
    assert.ok(!(row!.lastError ?? "").includes(SECRET));
  });

  it("does not record a lastPollAt when a connection test signs in", async () => {
    const newsroomId = nextNewsroom();
    await saveNewsletterMailbox({
      userId: nextUser(), newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    const before = (await getMailbox(newsroomId))!;
    assert.equal(before.lastPollAt, null);
    const result = await testSavedMailbox(newsroomId, { imap: fakeImapFactory([], 1n) });
    assert.equal(result.ok, true);
    const after = (await getMailbox(newsroomId))!;
    assert.equal(after.lastPollAt, null, "a connection test is not a mail poll");
  });
});

describe("newsletter source identity", () => {
  it("detects a relative public signup link in already-fetched HTML", () => {
    assert.equal(detectedNewsletterSignup('<a href="/newsletters">Subscribe to our newsletter</a>', "https://planning.example/news"),
      "https://planning.example/newsletters");
    assert.equal(detectedNewsletterSignup('<a href="javascript:alert(1)">Newsletter</a><a href="/unsubscribe">Unsubscribe</a>',
      "https://planning.example/news"), undefined);
  });
  it("requires a source in the newsroom and reports the configured mailbox address", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    const sourceId = await makeSource(sql, newsroomId, userId, "https://planning.example/");

    const beforeMailbox = await readSourceNewsletter(newsroomId, sourceId);
    assert.equal(beforeMailbox.paperAddress, "");

    await saveNewsletterMailbox({
      userId, newsroomId, address: MAILBOX_ADDRESS,
      host: "imap.town.example", port: 993, ssl: true, password: SECRET,
    });
    const after = await readSourceNewsletter(newsroomId, sourceId);
    assert.equal(after.paperAddress, MAILBOX_ADDRESS, "the configured mailbox address is reported");

    // A foreign source reads the same as a missing one.
    await assert.rejects(
      () => readSourceNewsletter(newsroomId + 777, sourceId),
      /not in this newsroom/,
    );
  });

  it("detects a sign-up anchor from retained capture text, excluding unsubscribe", () => {
    const text =
      "Sign up for our newsletter (https://planning.example/subscribe) " +
      "Unsubscribe here (https://planning.example/unsubscribe)";
    assert.equal(detectSignupUrlFromCapturedText(text), "https://planning.example/subscribe");

    assert.equal(detectSignupUrlFromCapturedText("Unsubscribe (https://x.example/unsub)"), "");
    assert.equal(
      detectSignupUrlFromCapturedText("Daily briefing (https://x.example/news)"),
      "",
      "a plain link with no signup wording is not a signup",
    );
  });

  it("prefers a pasted signup URL over a detected one, and saves it", async () => {
    const newsroomId = nextNewsroom();
    const userId = nextUser();
    const sql = await getSql();
    const sourceId = await makeSource(sql, newsroomId, userId, "https://planning.example/");
    // A capture exists with an anchor.
    const sourceUrl = "https://planning.example/";
    await sql`
      insert into artifact_versions (user_id, newsroom_id, url, content_hash, title, full_text, fetch_status, fetch_outcome)
      values (${userId}, ${newsroomId}, ${sourceUrl}, ${"h1"}, ${"Home"}, ${"Newsletter (https://detected.example/signup)"}, ${200}, ${"fetched"})`;

    const detected = await readSourceNewsletter(newsroomId, sourceId);
    assert.equal(detected.signupUrl, "https://detected.example/signup");

    await writeSourceNewsletter(newsroomId, {
      sourceId,
      newsletterSender: "news@planning.example",
      signupUrl: "https://pasted.example/join",
    });
    const stored = await readSourceNewsletter(newsroomId, sourceId);
    assert.equal(stored.signupUrl, "https://pasted.example/join", "the pasted URL wins");
    assert.equal(stored.newsletterSender, "news@planning.example");
  });
});
