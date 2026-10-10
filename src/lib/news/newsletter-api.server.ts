import { getSql } from "../db.ts";
import {
  NEWSLETTER_DEFAULT_HOST,
  NEWSLETTER_DEFAULT_PORT,
} from "./newsletter-defaults.ts";
import {
  ensureNewsletterSchema,
  getMailbox,
  publicMailbox,
  saveMailbox,
} from "./newsletter-store.server.ts";
import type { NewsletterLink } from "./newsletter-core.ts";

export type NewsletterWaitingItem = {
  id: number;
  subject: string;
  sender: string;
  date: string | null;
  links: NewsletterLink[];
};

export type NewsletterMailboxView = {
  configured: boolean;
  address: string;
  host: string;
  port: number;
  ssl: boolean;
  hasPassword: boolean;
  lastPollAt: string | null;
  ignoredCount: number;
  lastError: string | null;
  waiting: NewsletterWaitingItem[];
};

const EMPTY_MAILBOX: NewsletterMailboxView = {
  configured: false,
  address: "",
  host: NEWSLETTER_DEFAULT_HOST,
  port: NEWSLETTER_DEFAULT_PORT,
  ssl: true,
  hasPassword: false,
  lastPollAt: null,
  ignoredCount: 0,
  lastError: null,
  waiting: [],
};

/**
 * The safe status an EDITOR may read. `configured` means a password is saved:
 * a mailbox row with no password is not a mailbox the desk can read, so it
 * reads as "not set up" to the editor and to the poller alike.
 */
export async function readMailboxView(newsroomId: number): Promise<NewsletterMailboxView> {
  await ensureNewsletterSchema();
  const row = await getMailbox(newsroomId);
  const list = await (await import("./newsletter-poll.server.ts")).waitingMessages(newsroomId);
  if (!row || !row.hasPassword) return { ...EMPTY_MAILBOX, waiting: list };
  const safe = publicMailbox(row);
  return {
    configured: true,
    address: safe.address,
    host: safe.host,
    port: safe.port,
    ssl: safe.ssl,
    hasPassword: safe.hasPassword,
    lastPollAt: safe.lastPollAt,
    ignoredCount: safe.ignoredCount,
    lastError: safe.lastError,
    waiting: list,
  };
}

export type SaveNewsletterMailboxInput = {
  userId: string;
  newsroomId: number;
  address: string;
  host: string;
  port: number;
  ssl: boolean;
  password?: string;
};

/** Owner-only save. `password` blank/omitted preserves the stored one exactly. */
export async function saveNewsletterMailbox(input: SaveNewsletterMailboxInput) {
  const saved = await saveMailbox({
    userId: input.userId,
    newsroomId: input.newsroomId,
    address: input.address,
    host: input.host,
    port: input.port,
    ssl: input.ssl,
    password: input.password,
  });
  const safe = publicMailbox(saved);
  return {
    ok: true as const,
    mailbox: {
      configured: safe.hasPassword,
      address: safe.address,
      host: safe.host,
      port: safe.port,
      ssl: safe.ssl,
      hasPassword: safe.hasPassword,
      lastPollAt: safe.lastPollAt,
      ignoredCount: safe.ignoredCount,
      lastError: safe.lastError,
    },
  };
}

export async function testSavedMailbox(
  newsroomId: number,
  deps?: { imap?: import("./newsletter-imap.ts").NewsletterImapFactory },
): Promise<{ ok: boolean; message: string }> {
  const row = await getMailbox(newsroomId);
  if (!row || !row.hasPassword) {
    return { ok: false, message: "The mailbox is not set up yet." };
  }
  const { mailboxPassword, NEWSLETTER_SAFE_ERROR } = await import("./newsletter-store.server.ts");
  const { resolvePollCursor } = await import("./newsletter-imap.ts");

  let password: string | null = null;
  try {
    password = mailboxPassword(row);
  } catch {
    // A decrypt failure message can name the stored value format; swallow it.
    return { ok: false, message: NEWSLETTER_SAFE_ERROR };
  }
  if (!password) return { ok: false, message: NEWSLETTER_SAFE_ERROR };

  const imap: import("./newsletter-imap.ts").NewsletterImapFactory =
    deps?.imap ?? (await import("./newsletter-imapflow.ts")).imapflowSession;

  let session: ClosableNewsletterSession | null = null;
  try {
    session = (await imap({
      address: row.address,
      host: row.host,
      port: row.port,
      ssl: row.ssl,
      password,
    })) as ClosableNewsletterSession;
    await resolvePollCursor(session, { uid: null, uidValidity: null });
    return { ok: true, message: "The mailbox signed in and INBOX opened." };
  } catch {
    // The factory error (a driver error) can quote the LOGIN command, and a
    // selection error can too. Fixed plain words only.
    return { ok: false, message: NEWSLETTER_SAFE_ERROR };
  } finally {
    if (session?.close) {
      try {
        await session.close();
      } catch {
        /* a session that cannot close cleanly is not the test's failure */
      }
    }
  }
}

type ClosableNewsletterSession = import("./newsletter-imap.ts").NewsletterImapSession & {
  close?: () => Promise<void>;
};

/**
 * A source may only be edited by the newsroom that owns it. Returns the row or
 * throws; a foreign source reads the same as a missing one.
 */
export async function requireOwnedSource(newsroomId: number, sourceId: number) {
  const sql = await getSql();
  const [row] = await sql<{
    id: number;
    url: string;
    newsletter_sender: string | null;
    newsletter_signup_url: string | null;
  }>`
    select id, url, newsletter_sender, newsletter_signup_url
    from sources where id = ${sourceId} and newsroom_id = ${newsroomId} limit 1`;
  if (!row) throw new Error("That source is not in this newsroom.");
  return row;
}

const SIGNUP_WORDS = /newsletter|subscribe|sign[ -]?up/i;
const UNSUBSCRIBE_WORDS = /unsub|opt[ -]?out|manage.{0,3}(prefs|preferences)|stop receiving/i;

export function detectSignupUrlFromCapturedText(text: string): string {
  const body = text ?? "";
  // Anchors are retained as `label (https://...)`. Walk them in order.
  const anchor = /([^\n()]{0,120}?)\s*\((https?:\/\/[^\s)<>"']+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(body))) {
    const label = m[1]!.trim();
    const url = m[2]!.replace(/[.,;]+$/, "");
    if (!SIGNUP_WORDS.test(label)) continue;
    if (UNSUBSCRIBE_WORDS.test(label)) continue;
    if (!isSafeHttpUrl(url)) continue;
    return url;
  }
  return "";
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return !u.username && !u.password;
  } catch {
    return false;
  }
}

export async function readSourceNewsletter(newsroomId: number, sourceId: number) {
  const row = await requireOwnedSource(newsroomId, sourceId);
  const mailbox = await getMailbox(newsroomId);
  const paperAddress = mailbox && mailbox.hasPassword ? mailbox.address : "";
  let signupUrl = row.newsletter_signup_url ?? "";
  if (!signupUrl) {
    const detected = await detectSignupUrlForSource(newsroomId, sourceId);
    if (detected) signupUrl = detected;
  }
  return {
    newsletterSender: row.newsletter_sender ?? "",
    signupUrl,
    paperAddress,
  };
}

/** The first sign-up anchor across the source's retained webpage captures. */
async function detectSignupUrlForSource(newsroomId: number, sourceId: number): Promise<string> {
  const sql = await getSql();
  await ensureNewsletterSchema();
  const rows = await sql<{ full_text: string }>`
    select av.full_text
    from artifact_versions av
    where av.newsroom_id = ${newsroomId}
      and av.url in (select url from sources where id = ${sourceId} and newsroom_id = ${newsroomId})
      and length(trim(av.full_text)) > 0
    order by av.captured_at desc
    limit 8`;
  for (const r of rows) {
    const found = detectSignupUrlFromCapturedText(r.full_text);
    if (found) return found;
  }
  return "";
}

export async function writeSourceNewsletter(
  newsroomId: number,
  input: { sourceId: number; newsletterSender: string; signupUrl: string },
) {
  await requireOwnedSource(newsroomId, input.sourceId);
  const sql = await getSql();
  await ensureNewsletterSchema();
  await sql`
    update sources
    set newsletter_sender = ${input.newsletterSender || null},
        newsletter_signup_url = ${input.signupUrl || null}
    where id = ${input.sourceId} and newsroom_id = ${newsroomId}`;
  return { ok: true as const };
}
