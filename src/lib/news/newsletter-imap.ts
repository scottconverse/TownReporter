import { cursorStart, NEWSLETTER_MESSAGE_CAP_BYTES } from "./newsletter-core.ts";

export type NewsletterImapMessage = { uid: bigint; size: number | null; deleted?: boolean };
export type NewsletterImapBody = { raw: Uint8Array | null; refused?: "too-large" | "unavailable" };
export type NewsletterImapSession = {
  uidValidity(): Promise<bigint | null>;
  listUids(opts: { fromUid: bigint; limit: number }): Promise<NewsletterImapMessage[]>;
  fetchRaw(uid: bigint, size: number | null): Promise<NewsletterImapBody>;
  close?(): Promise<void>;
};
export type NewsletterMailboxCredentials = {
  address: string; host: string; port: number; ssl: boolean; password: string;
};
export type NewsletterImapFactory = (creds: NewsletterMailboxCredentials) => Promise<NewsletterImapSession>;

export async function closeSession(session: NewsletterImapSession): Promise<void> {
  try { await session.close?.(); } catch { /* Cleanup never exposes driver errors. */ }
}

export async function readNewMessages(session: NewsletterImapSession, opts: { fromUid: bigint; limit: number }) {
  return (await session.listUids(opts)).filter(m => m.uid > opts.fromUid)
    .sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0).slice(0, opts.limit);
}

export async function fetchMessage(session: NewsletterImapSession, message: NewsletterImapMessage) {
  if (message.size != null && message.size > NEWSLETTER_MESSAGE_CAP_BYTES)
    return { raw: null, refused: "too-large" as const };
  const body = await session.fetchRaw(message.uid, message.size);
  if (body.raw && body.raw.byteLength > NEWSLETTER_MESSAGE_CAP_BYTES)
    return { raw: null, refused: "too-large" as const };
  return body;
}

export async function resolvePollCursor(session: NewsletterImapSession,
  stored: { uid: bigint | null; uidValidity: bigint | null }) {
  const uidValidity = await session.uidValidity();
  return { ...cursorStart({ storedUid: stored.uid, storedUidValidity: stored.uidValidity,
    mailboxUidValidity: uidValidity }), uidValidity };
}

export { NEWSLETTER_MESSAGE_CAP_BYTES };
