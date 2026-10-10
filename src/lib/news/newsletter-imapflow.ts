import { ImapFlow } from "imapflow";
import { NEWSLETTER_MESSAGE_CAP_BYTES, type NewsletterImapFactory } from "./newsletter-imap.ts";

/** All reads use EXAMINE and BODY.PEEK; logging and unattended IDLE are disabled. */
export const imapflowSession: NewsletterImapFactory = async (creds) => {
  const client = new ImapFlow({
    host: creds.host, port: creds.port, secure: creds.ssl,
    doSTARTTLS: creds.ssl ? undefined : true,
    auth: { user: creds.address, pass: creds.password },
    logger: false, logRaw: false, disableAutoIdle: true,
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 60_000,
  });
  client.on("error", () => {});
  let lock: { release(): void } | undefined;
  try {
    await client.connect();
    lock = await client.getMailboxLock("INBOX", { readOnly: true });
  } catch {
    client.close();
    throw new Error("Could not sign in and open INBOX. Check the address and password.");
  }
  const validity = client.mailbox ? client.mailbox.uidValidity : null;
  return {
    async uidValidity() { return validity; },
    async listUids({ fromUid, limit }) {
      const found = await client.search({ uid: `${fromUid + 1n}:*` }, { uid: true });
      const uids = (found || []).filter(uid => BigInt(uid) > fromUid).sort((a, b) => a - b).slice(0, limit);
      if (!uids.length) return [];
      const rows = [];
      for await (const message of client.fetch(uids, { uid: true, size: true, flags: true }, { uid: true })) {
        rows.push({ uid: BigInt(message.uid), size: message.size ?? null, deleted: message.flags?.has("\\Deleted") });
      }
      return rows;
    },
    async fetchRaw(uid, size) {
      if (size != null && size > NEWSLETTER_MESSAGE_CAP_BYTES)
        return { raw: null, refused: "too-large" };
      const message = await client.fetchOne(String(uid), {
        source: { maxLength: NEWSLETTER_MESSAGE_CAP_BYTES + 1 },
      }, { uid: true });
      if (!message || !message.source) return { raw: null, refused: "unavailable" };
      if (message.source.byteLength > NEWSLETTER_MESSAGE_CAP_BYTES)
        return { raw: null, refused: "too-large" };
      return { raw: new Uint8Array(message.source) };
    },
    async close() {
      lock?.release();
      try { await client.logout(); } finally { client.close(); }
    },
  };
};
