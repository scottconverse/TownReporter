import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bookmark, Check, ExternalLink, Sun, X } from "lucide-react";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import { ReaderContext, readerDefaults, useReader, type ReaderPrefs } from "@/components/reader-context";
import { usePublicSections } from "@/lib/use-sections";
import { readMinutes, readerStorageKey, type ReaderStory } from "@/lib/reader";

export function ReaderProvider({ children }: { children: ReactNode }) {
  const paper = usePaper();
  const key = readerStorageKey(paper.name, paper.city);
  const [prefs, setPrefs] = useState(readerDefaults);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      setPrefs({
        dark: value.dark === true,
        size: [18, 21, 25].includes(value.size) ? value.size : 21,
        saved: Array.isArray(value.saved)
          ? value.saved.filter((s: unknown) => typeof s === "string").slice(0, 500)
          : [],
      });
    } catch {
      setPrefs(readerDefaults);
    }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(""), 3500);
    return () => clearTimeout(id);
  }, [message]);
  function update(value: Partial<ReaderPrefs>) {
    setPrefs((prev) => {
      const next = { ...prev, ...value };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        setMessage("Your browser cannot keep these preferences after you leave.");
      }
      return next;
    });
  }
  return (
    <ReaderContext.Provider value={{ ...prefs, ready, update, notify: setMessage }}>
      <div
        className={`reader${prefs.dark ? " mode-dark" : ""}`}
        style={{ "--reading": `${prefs.size}px` } as CSSProperties}
      >
        {children}
        {message && (
          <div className="reader-toast" role="status">
            {message}
          </div>
        )}
      </div>
    </ReaderContext.Provider>
  );
}
export function ReaderDialog({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    const active = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      if (active?.isConnected) active.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="reader-dialog" onCancel={close}>
      <div className="dialoghead">
        <h2>{title}</h2>
        <button type="button" className="iconbtn" aria-label="Close dialog" onClick={close}>
          <X aria-hidden />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ReadingButton({ label = false }: { label?: boolean }) {
  const [open, setOpen] = useState(false);
  const r = useReader();
  return (
    <>
      <button
        className="btn subtle"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Reading preferences"
      >
        {label ? (
          <>
            Aa <span>Text size</span>
          </>
        ) : (
          <Sun aria-hidden />
        )}
      </button>
      {open && (
        <ReaderDialog title="Make yourself comfortable." close={() => setOpen(false)}>
          <p>Your reading preferences stay on this browser.</p>
          <div className="setting">
            <strong>Story text size</strong>
            <div className="segmented">
              {[
                [18, "Standard"],
                [21, "Comfortable"],
                [25, "Large"],
              ].map(([n, s]) => (
                <button
                  type="button"
                  key={n}
                  className={`btn ${r.size === n ? "selected" : ""}`}
                  aria-pressed={r.size === n}
                  onClick={() => r.update({ size: Number(n) })}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <strong>Page appearance</strong>
            <div className="segmented">
              {[false, true].map((d) => (
                <button
                  type="button"
                  className={`btn ${r.dark === d ? "selected" : ""}`}
                  key={String(d)}
                  aria-pressed={r.dark === d}
                  onClick={() => r.update({ dark: d })}
                >
                  {d ? "Dark" : "Light"}
                </button>
              ))}
            </div>
          </div>
          <div className="reading-sample">
            A clearer view of your community. Comfortable reading, at your own pace.
          </div>
          <button className="btn primary more" type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </ReaderDialog>
      )}
    </>
  );
}
export function SaveStory({
  story,
  label = false,
}: {
  story: Pick<ReaderStory, "slug" | "headline">;
  label?: boolean;
}) {
  const r = useReader();
  const saved = r.saved.includes(story.slug);
  return (
    <button
      type="button"
      className={label ? "btn small" : `iconbtn ${saved ? "saved" : ""}`}
      disabled={!r.ready}
      aria-pressed={saved}
      aria-label={`${saved ? "Remove saved story" : "Save story"}: ${story.headline}`}
      onClick={() => {
        if (!saved && r.saved.length >= 500) {
          r.notify("Your reading list has 500 stories. Remove one to save another.");
          return;
        }
        r.update({
          saved: saved ? r.saved.filter((s) => s !== story.slug) : [...r.saved, story.slug],
        });
        r.notify(saved ? "Removed from saved stories." : "Saved to your reading list.");
      }}
    >
      {saved ? <Check aria-hidden /> : <Bookmark aria-hidden />}
      {label && (saved ? "Saved" : "Save")}
    </button>
  );
}
export function ReaderRow({
  story,
  description = true,
}: {
  story: ReaderStory;
  description?: boolean;
}) {
  const { sections } = usePublicSections();
  const { formatShortDate } = usePaperDateFormatters();
  return (
    <article className="newsrow">
      <div className="datebox">{formatShortDate(story.published_at)}</div>
      <div>
        <Link className={`tag ${story.topic}`} to="/" search={{ topic: story.topic }}>
          {sections.find((s) => s.key === story.topic)?.name ?? story.topic}
        </Link>
        <Link to="/articles/$slug" params={{ slug: story.slug }}>
          <h3>{story.headline}</h3>
        </Link>
        {description && <p>{story.dek}</p>}
        <div className="meta">
          <span>{formatShortDate(story.published_at)}</span>
          <span className="dot" />
          <span>{readMinutes(story.body)} min read</span>
        </div>
      </div>
      <SaveStory story={story} />
    </article>
  );
}
export function CopyButton({
  text,
  children,
}: {
  text: string | (() => string);
  children: ReactNode;
}) {
  const r = useReader();
  const [fallback, setFallback] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          const value = typeof text === "function" ? text() : text;
          try {
            await navigator.clipboard.writeText(value);
            r.notify("Copied to clipboard.");
          } catch {
            setFallback(value);
          }
        }}
      >
        {children}
      </button>
      {fallback && (
        <ReaderDialog title="Copy this text" close={() => setFallback(null)}>
          <p>Select and copy the text below.</p>
          <textarea
            className="field"
            readOnly
            rows={4}
            value={fallback}
            aria-label="Text to copy"
          />
        </ReaderDialog>
      )}
    </>
  );
}
export function ShareStory({ slug, headline }: { slug: string; headline: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  return (
    <>
      <button
        className="btn small"
        type="button"
        onClick={() => {
          setUrl(new URL(`/articles/${slug}`, window.location.origin).href);
          setOpen(true);
        }}
      >
        Share <ExternalLink aria-hidden />
      </button>
      {open && (
        <ReaderDialog title="Share this story" close={() => setOpen(false)}>
          <p>{headline}</p>
          <CopyButton text={url}>
            Copy story link <ArrowRight aria-hidden />
          </CopyButton>
        </ReaderDialog>
      )}
    </>
  );
}
