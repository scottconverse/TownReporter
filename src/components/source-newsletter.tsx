/*
  One accepted source's newsletter details: the sender the desk looks for in
  the paper's mailbox, and the public signup page where the editor subscribes
  the paper. A small collapsed section so a row stays a row.
*/

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Field } from "@/components/desk-chrome";
import { inkSolid, inputClass } from "@/components/desk-chrome-utils";
import { getSourceNewsletterFn, saveSourceNewsletterFn } from "@/lib/news/newsletters";
import {
  NEWSLETTER_MAILBOX_SETUP_PATH,
  NEWSLETTER_MAILBOX_SETUP_SENTENCE,
  canSubscribePaper,
  draftFromStored,
  sourceNewsletterDraftProblem,
  sourceNewsletterSaveResultText,
  subscribePaperBlurb,
} from "@/lib/news/newsletter-copy";

// The typed route is "/desk/ops/$card"; NEWSLETTER_MAILBOX_SETUP_PATH names the
// whole path, so the card slug is its last segment. Keeping them derived means
// the link and the constant cannot drift apart.
const MAILBOX_SETUP_CARD = NEWSLETTER_MAILBOX_SETUP_PATH.split("/").pop() ?? "";

export function SourceNewsletter({ sourceId }: { sourceId: number }) {
  const qc = useQueryClient();
  // One of these sits on every accepted source row. The read is deferred until
  // the editor opens this collapsed section, so a page of 25 sources no longer
  // fires 25 requests just to paint the rows.
  const [open, setOpen] = useState(false);
  const info = useQuery({
    queryKey: ["source-newsletter", sourceId],
    queryFn: () => getSourceNewsletterFn({ data: { sourceId } }),
    enabled: open,
  });

  const [sender, setSender] = useState("");
  const [signup, setSignup] = useState("");
  const [touched, setTouched] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (touched || !info.data) return;
    const draft = draftFromStored(info.data);
    setSender(draft.newsletterSender);
    setSignup(draft.signupUrl);
  }, [info.data, touched]);

  const draft = { newsletterSender: sender, signupUrl: signup };
  const problem = sourceNewsletterDraftProblem(draft);

  const save = useMutation({
    mutationFn: () => saveSourceNewsletterFn({ data: { sourceId, ...draft } }),
    onSuccess: () => {
      setFeedback({ ok: true, text: sourceNewsletterSaveResultText(draft) });
      setTouched(false);
      void qc.invalidateQueries({ queryKey: ["source-newsletter", sourceId] });
    },
    onError: () => {
      setFeedback({ ok: false, text: "The newsletter details did not save." });
    },
  });

  const paperAddress = info.data?.paperAddress ?? "";
  const mailboxMissing = info.data != null && !paperAddress.trim();
  const subscribe = canSubscribePaper(signup);

  return (
    <details
      className="mt-3 border border-rule p-3"
      data-testid={`source-newsletter-${sourceId}`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex min-h-11 cursor-pointer items-center font-medium focus-visible:outline focus-visible:outline-2">
        Newsletter sender and signup
      </summary>

      <form
        className="mt-3 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setFeedback(null);
          if (problem) {
            setFeedback({ ok: false, text: problem });
            return;
          }
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">
          The sender the desk looks for in the paper&rsquo;s mailbox, and the public page where the
          paper is subscribed to this source&rsquo;s newsletter.
        </p>

        <Field
          label="Newsletter sender"
          hint="An email address or a domain, such as news@planning.example or planning.example."
          htmlFor={`newsletter-sender-${sourceId}`}
        >
          <input
            id={`newsletter-sender-${sourceId}`}
            className={`${inputClass} mt-1 w-full`}
            value={sender}
            onChange={(event) => {
              setSender(event.target.value);
              setTouched(true);
            }}
            placeholder="news@example.org"
          />
        </Field>

        <Field
          label="Newsletter signup URL"
          hint="Paste the address of the signup page. The desk never fetches or submits it for you."
          htmlFor={`newsletter-signup-${sourceId}`}
        >
          <input
            id={`newsletter-signup-${sourceId}`}
            className={`${inputClass} mt-1 w-full`}
            value={signup}
            onChange={(event) => {
              setSignup(event.target.value);
              setTouched(true);
            }}
            placeholder="https://example.org/newsletter"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <button className={inkSolid} type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {feedback ? (
            <span
              className={feedback.ok ? "text-sm text-green-700" : "text-sm text-rust"}
              role={feedback.ok ? "status" : "alert"}
            >
              {feedback.text}
            </span>
          ) : null}
        </div>
      </form>

      {info.data == null ? null : mailboxMissing ? (
        <p className="mt-3 text-sm text-ink-2" data-testid={`newsletter-no-mailbox-${sourceId}`}>
          {NEWSLETTER_MAILBOX_SETUP_SENTENCE}{" "}
          <Link to="/desk/ops/$card" params={{ card: MAILBOX_SETUP_CARD }} className="inline-link">
            Open Paper setup
          </Link>
        </p>
      ) : subscribe ? (
        <div className="mt-3" data-testid={`newsletter-subscribe-${sourceId}`}>
          <a className="btn solid" href={signup.trim()} target="_blank" rel="noopener noreferrer">
            Subscribe the paper ↗
          </a>
          <p className="mt-2 text-sm text-ink-2">{subscribePaperBlurb(paperAddress)}</p>
        </div>
      ) : null}
    </details>
  );
}
