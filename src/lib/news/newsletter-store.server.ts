import { getSql, type Sql } from "../db.ts";
import { encryptApiKey, decryptApiKey } from "./custom-ai-connections.server.ts";

/**
 * Storage for the newsroom newsletter mailbox. One row per newsroom.
 *
 * The password is encrypted with the SAME `encryptApiKey`/`decryptApiKey` a
 * custom AI connection uses, and is never returned to any client: the public
 * shape carries only `hasPassword`. `decryptApiKey` is called in exactly one
 * place (the poller) and its result never touches a log.
 */
// Re-exported from the pure module so server callers keep a single import
// while a client bundle can take the constants without this server file.
export { NEWSLETTER_DEFAULT_HOST, NEWSLETTER_DEFAULT_PORT } from "./newsletter-defaults.ts";
// Kept for callers that reached for the validator through this module; the
// implementation is pure and lives in `newsletter-input.ts`.
export { cleanMailboxInput } from "./newsletter-input.ts";

export type NewsletterMailboxSettings = {
  newsroomId: number;
  address: string;
  host: string;
  port: number;
  ssl: boolean;
  hasPassword: boolean;
  lastPollAt: string | null;
  ignoredCount: number;
  lastError: string | null;
};

export type StoredMailbox = NewsletterMailboxSettings & { encryptedPassword: string | null };

/** The migration owns the schema; request paths only check readiness. */
export async function ensureNewsletterSchema(sqlInput?: Sql): Promise<void> {
  const sql = sqlInput ?? await getSql();
  await sql.query("select newsroom_id from newsletter_mailboxes limit 0");
}

/** The safe, client-facing shape. Never includes the ciphertext. */
export function publicMailbox(row: StoredMailbox): NewsletterMailboxSettings {
  const { encryptedPassword: _secret, ...safe } = row;
  return { ...safe, hasPassword: Boolean(_secret) };
}

export async function getMailbox(newsroomId: number, sqlInput?: Sql): Promise<StoredMailbox | null> {
  const sql = sqlInput ?? (await getSql());
  const [row] = await sql<{
    address: string; host: string; port: number; ssl: boolean;
    encrypted_password: string | null; last_poll_at: string | null;
    ignored_count: number; last_error: string | null;
  }>`select address, host, port, ssl, encrypted_password, last_poll_at::text as last_poll_at,
        ignored_count, last_error
      from newsletter_mailboxes where newsroom_id = ${newsroomId} limit 1`;
  if (!row) return null;
  return {
    newsroomId,
    address: row.address,
    host: row.host,
    port: row.port,
    ssl: row.ssl,
    encryptedPassword: row.encrypted_password,
    hasPassword: Boolean(row.encrypted_password),
    lastPollAt: row.last_poll_at,
    ignoredCount: row.ignored_count,
    lastError: row.last_error,
  };
}

/** The decrypted password, for the poller only. Never logged, never returned to a request. */
export function mailboxPassword(row: StoredMailbox): string | null {
  return row.encryptedPassword ? decryptApiKey(row.encryptedPassword) : null;
}

export type SaveMailboxInput = {
  userId: string;
  newsroomId: number;
  address: string;
  host: string;
  port: number;
  ssl: boolean;
  /** Blank/omitted preserves the stored password exactly. */
  password?: string;
};

/**
 * Save the mailbox.
 *
 * A blank/omitted password preserves the stored one byte for byte; a supplied
 * password is encrypted on the way in and never comes back.
 *
 * CHANGING THE ACCOUNT IDENTITY RESETS THE CURSOR. When the host, address,
 * port or SSL setting changes, the stored `cursor_uid`/`cursor_uidvalidity`
 * describe a DIFFERENT mailbox and must not carry over: the next poll would
 * resume past UIDs that belong to the old mailbox and silently skip every
 * message the new one already holds. On such a change the cursor is cleared so
 * the next poll reads from the beginning.
 *
 * The 30-minute cadence CLAIM (`poll_claim_at`) is deliberately PRESERVED
 * across an identity change. Clearing it would let a save be used to force an
 * immediate poll and bypass the cadence.
 */
export async function saveMailbox(input: SaveMailboxInput, sqlInput?: Sql): Promise<StoredMailbox> {
  await ensureNewsletterSchema(sqlInput);
  const sql = sqlInput ?? (await getSql());
  const encrypted = input.password !== undefined ? encryptApiKey(input.password) : null;
  await sql`
    insert into newsletter_mailboxes
      (newsroom_id, user_id, address, host, port, ssl, encrypted_password, updated_at)
    values (
      ${input.newsroomId}, ${input.userId}, ${input.address}, ${input.host}, ${input.port},
      ${input.ssl}, ${encrypted}, now()
    )
    on conflict (newsroom_id) do update set
      address = excluded.address,
      host = excluded.host,
      port = excluded.port,
      ssl = excluded.ssl,
      user_id = excluded.user_id,
      encrypted_password = case
        when ${encrypted}::text is not null then excluded.encrypted_password
        else newsletter_mailboxes.encrypted_password
      end,
      -- Identity change: clear the read position so no new-mailbox message is
      -- skipped. The poll claim is left alone.
      cursor_uid = case
        when newsletter_mailboxes.address <> excluded.address
          or newsletter_mailboxes.host <> excluded.host
          or newsletter_mailboxes.port <> excluded.port
          or newsletter_mailboxes.ssl <> excluded.ssl
        then null else newsletter_mailboxes.cursor_uid
      end,
      cursor_uidvalidity = case
        when newsletter_mailboxes.address <> excluded.address
          or newsletter_mailboxes.host <> excluded.host
          or newsletter_mailboxes.port <> excluded.port
          or newsletter_mailboxes.ssl <> excluded.ssl
        then null else newsletter_mailboxes.cursor_uidvalidity
      end,
      updated_at = now()
  `;
  const saved = await getMailbox(input.newsroomId, sql);
  if (!saved) throw new Error("The mailbox could not be saved.");
  return saved;
}

export type StoredCursor = { uid: bigint | null; uidValidity: bigint | null };
export async function readCursor(newsroomId: number, sqlInput?: Sql): Promise<StoredCursor> {
  const sql = sqlInput ?? (await getSql());
  const [row] = await sql<{ cursor_uid: string | null; cursor_uidvalidity: string | null }>`
    select cursor_uid::text as cursor_uid, cursor_uidvalidity::text as cursor_uidvalidity
    from newsletter_mailboxes where newsroom_id = ${newsroomId} limit 1`;
  return {
    uid: row?.cursor_uid != null ? BigInt(row.cursor_uid) : null,
    uidValidity: row?.cursor_uidvalidity != null ? BigInt(row.cursor_uidvalidity) : null,
  };
}

export async function writeCursor(
  newsroomId: number,
  cursor: StoredCursor,
  sqlInput?: Sql,
): Promise<void> {
  const sql = sqlInput ?? (await getSql());
  await sql`
    update newsletter_mailboxes
    set cursor_uid = ${cursor.uid == null ? null : cursor.uid.toString()}::bigint,
        cursor_uidvalidity = ${cursor.uidValidity == null ? null : cursor.uidValidity.toString()}::bigint
    where newsroom_id = ${newsroomId}
  `;
}

/**
 * Durable atomic cadence claim. A poll may run at most once per 30 minutes per
 * newsroom. The UPDATE only flips `poll_claim_at` when the previous claim is
 * older than the window, so two processes cannot both read the mailbox.
 */
export const NEWSLETTER_POLL_INTERVAL_MS = 30 * 60 * 1000;

export async function claimPoll(newsroomId: number, sqlInput?: Sql): Promise<boolean> {
  const sql = sqlInput ?? (await getSql());
  const cutoff = new Date(Date.now() - NEWSLETTER_POLL_INTERVAL_MS).toISOString();
  const claimed = await sql<{ newsroom_id: number }>`
    update newsletter_mailboxes
    set poll_claim_at = now()
    where newsroom_id = ${newsroomId}
      and (poll_claim_at is null or poll_claim_at < ${cutoff}::timestamptz)
    returning newsroom_id
  `;
  return claimed.length > 0;
}

/** Fixed, credential-free text. Never a raw driver message. */
export const NEWSLETTER_SAFE_ERROR = "The mailbox could not be read. Check the address and password.";

export async function recordPollOutcome(
  newsroomId: number,
  opts: { ok: boolean; ignoredAdded?: number; message?: string },
  sqlInput?: Sql,
): Promise<void> {
  const sql = sqlInput ?? (await getSql());
  const error = opts.ok ? null : (opts.message ?? NEWSLETTER_SAFE_ERROR);
  await sql`
    update newsletter_mailboxes
    set last_poll_at = now(), last_error = ${error},
        ignored_count = ignored_count + ${opts.ignoredAdded ?? 0}
    where newsroom_id = ${newsroomId}
  `;
}

export type StoredAttachment = {
  id: number;
  versionId: number | null;
  captureEventId: number | null;
  filename: string;
  contentType: string;
};

export async function listAttachments(
  newsroomId: number,
  messageId: number,
  sqlInput?: Sql,
): Promise<StoredAttachment[]> {
  const sql = sqlInput ?? (await getSql());
  const rows = await sql<{
    id: number; version_id: number | null; capture_event_id: number | null;
    filename: string; content_type: string;
  }>`select id, version_id, capture_event_id, filename, content_type
      from newsletter_attachments
      where newsroom_id = ${newsroomId} and message_id = ${messageId}
      order by id`;
  return rows.map((r) => ({
    id: r.id,
    versionId: r.version_id,
    captureEventId: r.capture_event_id,
    filename: r.filename,
    contentType: r.content_type,
  }));
}

export async function messageAlreadySeen(
  newsroomId: number,
  messageId: string,
  sqlInput?: Sql,
): Promise<boolean> {
  const sql = sqlInput ?? (await getSql());
  const [row] = await sql<{ c: number }>`
    select count(*)::int as c from newsletter_messages
    where newsroom_id = ${newsroomId} and message_id = ${messageId}`;
  return (row?.c ?? 0) > 0;
}
