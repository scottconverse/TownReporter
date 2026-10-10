/*
  The paper's newsletter mailbox: the address the desk reads for newsletters,
  its password (never shown back), the waiting list, and Test connection.
*/

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Field, InkButton } from "@/components/desk-chrome";
import { FormError } from "@/components/form-error";
import { announceToDesk, inputClass } from "@/components/desk-chrome-utils";
import { editorActionError } from "@/lib/news/desk-copy";
import {
  getNewsletterMailboxFn,
  saveNewsletterMailboxFn,
  testNewsletterMailboxFn,
} from "@/lib/news/newsletters";
import {
  NEWSLETTER_IMAP_DEFAULTS,
  NEWSLETTER_MAILBOX_HEADING,
  NEWSLETTER_NOT_CONFIGURED_EXPLANATION,
  confirmationLinkProps,
  ignoredMessagesLine,
  isSafeConfirmationUrl,
  lastCheckLine,
  mailboxSaveResultText,
  passwordPreservesStored,
  testConnectionResultText,
} from "@/lib/news/newsletter-copy";

type WaitingLink = { text: string; url: string };
type WaitingMessage = {
  id: number | string;
  subject: string;
  sender: string;
  date: string | null;
  links: WaitingLink[];
};

/** Newsletters the desk read but no source has claimed; links open in a new tab. */
function WaitingList({ waiting }: { waiting: WaitingMessage[] }) {
  if (!waiting.length) {
    return (
      <p className="mt-2 text-sm text-ink-2" data-testid="newsletter-waiting-empty">
        Nothing is waiting for you. The desk has no unconfirmed newsletter at the moment.
      </p>
    );
  }
  return (
    <ul className="mt-3 grid list-none gap-3 p-0" data-testid="newsletter-waiting">
      {waiting.map((m) => (
        <li key={m.id} className="border border-rule p-3">
          <p className="font-medium">{m.subject}</p>
          <p className="astra-row-meta">
            {m.sender} · {m.date}
          </p>
          {m.links.length ? (
            <p className="astra-row-meta">
              {m.links.map((link) =>
                isSafeConfirmationUrl(link.url) ? (
                  <a
                    key={link.url}
                    href={link.url}
                    {...confirmationLinkProps()}
                    className="inline-link"
                  >
                    {link.text || "Open the confirmation page"} ↗
                  </a>
                ) : null,
              )}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function NewsletterMailbox() {
  const qc = useQueryClient();
  const mailbox = useQuery({
    queryKey: ["newsletter-mailbox"],
    queryFn: () => getNewsletterMailboxFn(),
  });

  const [address, setAddress] = useState("");
  const [host, setHost] = useState<string>(NEWSLETTER_IMAP_DEFAULTS.host);
  const [port, setPort] = useState<string>(String(NEWSLETTER_IMAP_DEFAULTS.port));
  const [ssl, setSsl] = useState(true);
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);

  const data = mailbox.data;

  // Fill from the saved mailbox until the owner starts typing.
  useEffect(() => {
    if (touched || !data) return;
    setAddress(data.address ?? "");
    setHost(data.host || NEWSLETTER_IMAP_DEFAULTS.host);
    setPort(data.port ? String(data.port) : String(NEWSLETTER_IMAP_DEFAULTS.port));
    setSsl(data.ssl ?? NEWSLETTER_IMAP_DEFAULTS.ssl);
  }, [data, touched]);

  const save = useMutation({
    mutationFn: () =>
      saveNewsletterMailboxFn({
        data: {
          address,
          host,
          port: Number(port) || NEWSLETTER_IMAP_DEFAULTS.port,
          ssl,
          // Omitted when blank: the server keeps the stored password.
          ...(password === "" ? {} : { password }),
        },
      }),
    onSuccess: () => {
      setSaveErr(null);
      setSaveNote(mailboxSaveResultText(password !== ""));
      setPassword("");
      setTouched(false);
      announceToDesk("Newsletter mailbox saved.");
      void qc.invalidateQueries({ queryKey: ["newsletter-mailbox"] });
    },
    onError: (e) => {
      const msg =
        editorActionError(e instanceof Error ? e.message : "", "save the mailbox") ??
        "The mailbox did not save.";
      setSaveNote(null);
      setSaveErr(msg);
      announceToDesk("The mailbox did not save.", "err");
    },
  });

  const test = useMutation({
    mutationFn: () => testNewsletterMailboxFn(),
    onSuccess: (res: { ok: boolean; message: string }) => {
      setTestNote(testConnectionResultText(res.ok, res.message));
    },
    onError: () => {
      setTestNote(testConnectionResultText(false, null));
    },
  });

  const configured = data?.configured === true;
  const hasPassword = data?.hasPassword === true;

  return (
    <section className="mt-16 border-t border-rule pt-8" data-testid="newsletter-mailbox">
      <h2 className="font-serif text-xl">{NEWSLETTER_MAILBOX_HEADING}</h2>

      {mailbox.isPending ? null : mailbox.isError || !data ? (
        <p role="alert" className="mt-2 max-w-2xl text-base text-ink-2">
          The desk could not read the newsletter mailbox settings. Reload the page to try again.
        </p>
      ) : !configured ? (
        <div className="mt-2 max-w-2xl" data-testid="newsletter-not-configured">
          {NEWSLETTER_NOT_CONFIGURED_EXPLANATION.map((sentence) => (
            <p key={sentence} className="text-sm text-ink-2">
              {sentence}
            </p>
          ))}
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-2" data-testid="newsletter-mailbox-status">
            {lastCheckLine(data.lastPollAt)}
            {ignoredMessagesLine(data.ignoredCount)
              ? ` · ${ignoredMessagesLine(data.ignoredCount)}`
              : ""}
          </p>
          {data.lastError ? (
            <p className="astra-row-meta text-rust" role="status">
              Last time, the desk could not read the mailbox: {data.lastError}
            </p>
          ) : null}
          <h3 className="mt-4 font-medium">Waiting for you</h3>
          <WaitingList waiting={data.waiting ?? []} />
        </>
      )}

      <div className="mt-6 grid max-w-md gap-4">
        <Field
          label="Mailbox address"
          hint="The email address of the mailbox the paper owns."
          htmlFor="newsletter-address"
        >
          <input
            id="newsletter-address"
            className={`${inputClass} mt-1 w-full`}
            type="email"
            autoComplete="off"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setTouched(true);
              setSaveNote(null);
            }}
            placeholder="paper@example.org"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="IMAP host" htmlFor="newsletter-host">
              <input
                id="newsletter-host"
                className={`${inputClass} mt-1 w-full`}
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setTouched(true);
                  setSaveNote(null);
                }}
              />
            </Field>
          </div>
          <Field label="Port" htmlFor="newsletter-port">
            <input
              id="newsletter-port"
              className={`${inputClass} mt-1 w-full`}
              type="number"
              inputMode="numeric"
              value={port}
              onChange={(e) => {
                setPort(e.target.value);
                setTouched(true);
                setSaveNote(null);
              }}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ssl}
            onChange={(e) => {
              setSsl(e.target.checked);
              setTouched(true);
              setSaveNote(null);
            }}
          />
          Use SSL
        </label>

        <Field
          label="Password"
          hint={
            hasPassword
              ? "A password is already stored. Leave this blank to keep it."
              : "Type the mailbox password. It is never shown again."
          }
          htmlFor="newsletter-password"
        >
          <input
            id="newsletter-password"
            className={`${inputClass} mt-1 w-full`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setTouched(true);
              setSaveNote(null);
            }}
          />
        </Field>

        {/* In words, because the box is blank after a reload and cannot be read back. */}
        <p className="text-sm text-ink-2" data-testid="newsletter-password-state" role="status">
          {hasPassword ? "A password is stored on the desk." : "No password is stored yet."}
          {passwordPreservesStored(password, hasPassword)
            ? " Leaving the box blank keeps the stored password."
            : ""}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <InkButton
            tone="quiet"
            disabled={save.isPending}
            onClick={() => {
              setSaveNote(null);
              setSaveErr(null);
              save.mutate();
            }}
          >
            {save.isPending ? "Saving…" : "Save"}
          </InkButton>
          <InkButton
            tone="quiet"
            disabled={test.isPending || save.isPending || touched}
            onClick={() => {
              setTestNote(null);
              test.mutate();
            }}
          >
            {test.isPending ? "Testing…" : "Test connection"}
          </InkButton>
          {saveNote ? (
            <span className="text-sm text-ink-2" role="status">
              {saveNote}
            </span>
          ) : null}
          {saveErr ? <FormError className="text-sm text-rust">{saveErr}</FormError> : null}
        </div>
        {/*
          Test checks the SAVED mailbox, so it is offered only when the boxes
          match what is saved: a press mid-edit would silently test the old
          credentials and read as though the new ones worked.
        */}
        {touched ? (
          <p className="text-sm text-ink-2" data-testid="newsletter-test-hint">
            Save your changes first. Test connection checks the saved mailbox.
          </p>
        ) : null}
        {testNote ? (
          <p className="text-sm text-ink-2" data-testid="newsletter-test-result" role="status">
            {testNote}
          </p>
        ) : null}
      </div>
    </section>
  );
}
