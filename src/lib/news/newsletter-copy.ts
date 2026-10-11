/*
  Pure copy + state folds for the newsletter mailbox UI. No JSX, so plain
  `node --test` can exercise it: the mailbox card and source row cannot be
  mounted by the test runner.
*/

/** The card heading, verbatim and exact. */
export const NEWSLETTER_MAILBOX_HEADING = "The paper's newsletter mailbox";

/** IMAP defaults for the paper's mailbox. */
export const NEWSLETTER_IMAP_DEFAULTS = {
  host: "imap.hostinger.com",
  port: 993,
  ssl: true,
} as const;

/* The unconfigured state: three short sentences, never the word "error". */
export const NEWSLETTER_NOT_CONFIGURED_EXPLANATION = [
  "Use a mailbox owned by the paper.",
  "Subscribe it to newsletters from your sources.",
  "The desk reads allowed senders every 30 minutes.",
] as const;

export function newsletterNotConfiguredSentence(): string {
  return NEWSLETTER_NOT_CONFIGURED_EXPLANATION.join(" ");
}

/** "12 other messages ignored"; zero and one stated in words. */
export function ignoredMessagesLine(count: number | null | undefined): string | null {
  if (count == null || !Number.isFinite(count) || count < 0) return null;
  if (count === 0) return "No other messages ignored";
  return `${count} other ${count === 1 ? "message" : "messages"} ignored`;
}

/** "Last check: 3:12 PM." Never claims a check that did not happen. */
export function lastCheckLine(lastPollAt: string | null | undefined): string {
  const stamp = lastPollAt?.trim();
  if (!stamp) return "Not checked yet";
  return `Last check: ${stamp}`;
}

/**
 * The Test connection result. The server's own plain message is shown as-is:
 * it is server text, and "Check the address and password." is a useful
 * instruction, so we do not censor the word for it.
 */
export function testConnectionResultText(ok: boolean, message: string | null | undefined): string {
  const clean = (message ?? "").replace(/\s+/g, " ").trim();
  if (clean) return clean;
  return ok
    ? "The desk reached the mailbox. Connection works."
    : "The desk could not reach the mailbox.";
}

/** What a save answers with; never reports the password. */
export function mailboxSaveResultText(hadNewPassword: boolean): string {
  return hadNewPassword
    ? "Mailbox saved. The password is stored on the desk and never shown again."
    : "Mailbox saved. The stored password was kept.";
}

/**
 * A blank password box means "keep the stored password". Blank is EXACTLY the
 * empty string: spaces may be part of a valid credential, so nothing is
 * trimmed here.
 */
export function passwordPreservesStored(typed: string, hasPassword: boolean): boolean {
  return typed === "" && hasPassword;
}

/** The props a confirmation link carries: new tab, and no reach back. */
export const CONFIRMATION_LINK_REL = "noopener noreferrer";

export function confirmationLinkProps(): { target: "_blank"; rel: string } {
  return { target: "_blank", rel: CONFIRMATION_LINK_REL };
}

/**
 * A link we open is only ever http(s), parsed with the URL constructor so a
 * trick like "https://user:pass@host" or "javascript:" cannot slip through.
 * Credential-bearing URLs (a username or password before the host) are refused.
 */
export function isSafeConfirmationUrl(url: string | null | undefined): boolean {
  const raw = url?.trim() ?? "";
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;
  return true;
}

/** "Subscribe the paper" appears only when there is a usable http(s) signup URL. */
export function canSubscribePaper(signupUrl: string | null | undefined): boolean {
  return isSafeConfirmationUrl(signupUrl);
}

/** Shows the paper's mailbox address; the editor completes the form themselves. */
export function subscribePaperBlurb(paperAddress: string | null | undefined): string {
  const address = paperAddress?.trim() || "the paper's newsletter mailbox";
  return `Subscribe the paper: use ${address} on the signup page. You fill in the form and confirm it yourself.`;
}

/** Where an editor with no mailbox is told to configure it: Server → Paper setup. */
export const NEWSLETTER_MAILBOX_SETUP_PATH = "/desk/ops/paper-setup";
export const NEWSLETTER_MAILBOX_SETUP_SENTENCE =
  "The paper has no newsletter mailbox yet. The owner sets one up on the Server screen, under Paper setup.";

export type SourceNewsletterDraft = {
  newsletterSender: string;
  signupUrl: string;
};

export function draftFromStored(
  stored: { newsletterSender?: string | null; signupUrl?: string | null } | null | undefined,
): SourceNewsletterDraft {
  return {
    newsletterSender: stored?.newsletterSender ?? "",
    signupUrl: stored?.signupUrl ?? "",
  };
}

export function sourceNewsletterSaveResultText(draft: SourceNewsletterDraft): string {
  if (!draft.newsletterSender.trim() && !draft.signupUrl.trim()) {
    return "Newsletter details cleared for this source.";
  }
  return "Newsletter details saved for this source.";
}

/** The one refusal the source editor can make on its own: a non-http(s) signup URL. */
export function sourceNewsletterDraftProblem(draft: SourceNewsletterDraft): string | null {
  const signup = draft.signupUrl.trim();
  if (signup && !isSafeConfirmationUrl(signup)) {
    return "The signup URL must start with http:// or https://.";
  }
  return null;
}
