import { NEWSLETTER_DEFAULT_HOST, NEWSLETTER_DEFAULT_PORT } from "./newsletter-defaults.ts";

export type CleanMailboxInput = {
  address: string;
  host: string;
  port: number;
  ssl: boolean;
  /** Blank/omitted preserves the stored password exactly. */
  password?: string;
};

/** The largest credential the desk will accept. Nothing echoes a rejected one. */
export const NEWSLETTER_MAX_PASSWORD_LENGTH = 4096;

export function cleanMailboxInput(raw: unknown): CleanMailboxInput {
  const input = (raw ?? {}) as Record<string, unknown>;

  const address = String(input.address ?? "").trim();
  if (!address || address.length > 320 || !address.includes("@") || /\s/.test(address)) {
    throw new Error("Enter the mailbox address, for example newsroom@example.org.");
  }

  const host = String(input.host ?? "").trim() || NEWSLETTER_DEFAULT_HOST;
  if (host.length > 255 || /[^a-z0-9.-]/i.test(host)) {
    throw new Error("The mail server name is not valid.");
  }

  const port =
    input.port == null || input.port === "" ? NEWSLETTER_DEFAULT_PORT : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The mail server port is not valid.");
  }

  const ssl = input.ssl == null ? true : input.ssl === true || input.ssl === "true";

  // A password present (even as whitespace) is kept byte for byte. An empty
  // string means "keep the stored password". A too-long one is refused with a
  // fixed sentence that never quotes the value.
  let password: string | undefined;
  if (typeof input.password === "string" && input.password.length > 0) {
    if (input.password.length > NEWSLETTER_MAX_PASSWORD_LENGTH) {
      throw new Error("That password is too long.");
    }
    password = input.password;
  }

  return { address, host, port, ssl, password };
}

export type CleanSourceNewsletterInput = {
  sourceId: number;
  newsletterSender: string;
  signupUrl: string;
};

export function cleanSourceNewsletterInput(raw: unknown): CleanSourceNewsletterInput {
  const input = (raw ?? {}) as Record<string, unknown>;

  const sourceId = Number(input.sourceId);
  if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error("Choose a source first.");

  const newsletterSender = String(input.newsletterSender ?? "").trim().toLowerCase();
  if (newsletterSender.length > 320 || (newsletterSender && !/^(?:[^\s@<>]+@)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(newsletterSender)))
    throw new Error("Enter a newsletter sender address or domain.");

  const rawUrl = String(input.signupUrl ?? "").trim();
  let signupUrl = "";
  if (rawUrl) {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      throw new Error("The sign-up link must be a valid HTTP or HTTPS address.");
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("The sign-up link must use HTTP or HTTPS.");
    }
    if (u.username || u.password) {
      throw new Error("The sign-up link must not include a username or password.");
    }
    signupUrl = u.toString();
  }

  return { sourceId, newsletterSender, signupUrl };
}
