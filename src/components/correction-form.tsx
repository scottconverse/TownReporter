import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { usePaper } from "@/lib/paper-context";
import { correctionMailto, readerStorageKey, type CorrectionDraft } from "@/lib/reader";

const blank: CorrectionDraft = { article: "", details: "", evidence: "", name: "", email: "" };
export function CorrectionForm({ article = "" }: { article?: string }) {
  const paper = usePaper();
  const recipient =
    paper.name.toLowerCase() === "townreporter" ? "townreporter@gmail.com" : paper.editorEmail;
  const key = readerStorageKey(paper.name, paper.city) + ":correction";
  const [draft, setDraft] = useState({ ...blank, article });
  const [ready, setReady] = useState(false);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) || "{}");
      const restored = { ...blank };
      for (const field of Object.keys(blank) as (keyof CorrectionDraft)[])
        if (typeof value[field] === "string") restored[field] = value[field];
      setDraft({ ...restored, article: article || restored.article });
    } catch {
      setDraft({ ...blank, article });
    }
    setReady(true);
  }, [key, article]);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* The form still works when browser storage is unavailable. */
      }
  }, [draft, key, ready]);
  if (!recipient)
    return (
      <section className="correction-panel">
        <h2>Contact the editor</h2>
        <p>The publication has not configured an editor email address yet.</p>
      </section>
    );
  const update = (field: keyof CorrectionDraft, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setOpened(false);
  };
  const url = correctionMailto(recipient, paper.name, draft);
  return (
    <section className="correction-panel" id="file-correction">
      <span className="eyebrow">WRITE TO THE EDITOR</span>
      <h2>File a correction</h2>
      <p>
        Something wrong in a story? Tell us what needs changing and, if you can, point us to the
        source.
      </p>
      <form
        id="correctionform"
        onSubmit={(e) => {
          e.preventDefault();
          setOpened(true);
          window.location.href = url;
        }}
      >
        <label htmlFor="correction-article">
          Story headline or link <span>(optional)</span>
        </label>
        <input
          className="field"
          id="correction-article"
          value={draft.article}
          onChange={(e) => update("article", e.target.value)}
          maxLength={2000}
          placeholder="Paste the story link or enter its headline"
        />
        <label htmlFor="correction-details">
          What needs correcting? <span>(required)</span>
        </label>
        <textarea
          className="field"
          id="correction-details"
          required
          rows={5}
          value={draft.details}
          onChange={(e) => update("details", e.target.value)}
          placeholder="Tell us what is wrong and what the correct information should be."
        />
        <label htmlFor="correction-evidence">
          Supporting source or explanation <span>(optional)</span>
        </label>
        <textarea
          className="field"
          id="correction-evidence"
          rows={3}
          value={draft.evidence}
          onChange={(e) => update("evidence", e.target.value)}
          placeholder="A source link, document reference or a little more context."
        />
        <div className="correction-contact">
          <div>
            <label htmlFor="correction-name">
              Your name <span>(optional)</span>
            </label>
            <input
              className="field"
              id="correction-name"
              autoComplete="name"
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="correction-email">
              Reply email <span>(optional)</span>
            </label>
            <input
              className="field"
              type="email"
              id="correction-email"
              autoComplete="email"
              value={draft.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
        </div>
        <p className="form-help">
          To: <a href={`mailto:${recipient}`}>{recipient}</a>
          <br />
          This opens a prepared message in your email app. Review it and press Send there. If an
          email app is not configured, you can copy your text and email the editor directly.
        </p>
        <button type="submit" className="btn primary" disabled={!ready}>
          Open correction email <ArrowRight aria-hidden />
        </button>
        {opened && (
          <p className="form-help" role="status">
            Finish sending in your email app. This page has not sent your correction.{" "}
            <a href={url}>Open the prepared email again</a>. Your text remains in the form.
          </p>
        )}
      </form>
    </section>
  );
}
