import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Bookmark, Check, ExternalLink, Moon, Sun, X } from "lucide-react";
import { usePaper, usePaperDateFormatters } from "@/lib/paper-context-state";
import { sendTrustEvent } from "@/components/read-beacon-send";
import { ReaderContext, readerDefaults, useReader, type ReaderPrefs } from "@/components/reader-context";
import { usePublicSections } from "@/lib/use-sections";
import { isMiscTopic } from "@/lib/news/section-types";
import { dekOrFallback } from "@/lib/news/dek-fallback";
import {
  normalizeReaderSize,
  readMinutes,
  readerStorageKey,
  type ReaderStory,
} from "@/lib/reader";
import { readReaderMode } from "@/lib/appearance";
import { useAppearance, useHydrated } from "@/lib/appearance-context";

const READER_TEXT_SIZES = [
  { size: 21, label: "Normal" },
  { size: 25, label: "Large" },
] as const;

export function ReaderProvider({ children }: { children: ReactNode }) {
  const paper = usePaper();
  const key = readerStorageKey(paper.name, paper.city);
  const { refreshReader } = useAppearance();
  /*
    The dark bit is known BEFORE the first render of a client-side navigation.

    `prefs` still starts at the light default -- that is what the server
    renders, and the reader element is hydrated against it, so changing the
    initial value unconditionally would be a hydration mismatch. But a
    navigation from a dark desk to an article mounts this component fresh on
    the client, where there is no server HTML to match: there `hydrated` is
    already true, so the stored choice is read during the first render and the
    `.reader` element is dark on the frame it is created. `useHydrated()` is
    false on the server and during hydration, true after -- see
    appearance-context.ts.

    A hard load is covered earlier still: reader-astra.css paints
    `:root[data-appearance="reader-dark"] .reader`, which the head script in
    __root.tsx stamps before anything paints. This is the belt to that
    braces, and it is what keeps the reader's own toggle honest -- `update`
    below calls `refreshReader()` so the document attribute follows the class.
  */
  const hydrated = useHydrated();
  const [prefs, setPrefs] = useState<ReaderPrefs>(() =>
    hydrated ? { ...readerDefaults, dark: readReaderMode(key) === "dark" } : readerDefaults,
  );
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  /*
    The current preferences, readable synchronously. `update` writes storage
    BEFORE it queues any state change, and it cannot do that from inside a
    `setPrefs` updater -- see the note on `update`.
  */
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "{}");
      setPrefs({
        dark: value.dark === true,
        size: normalizeReaderSize(value.size),
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
    const next = { ...prefsRef.current, ...value };
    prefsRef.current = next;
    /*
      Storage first, and in the handler rather than in a `setPrefs` updater.

      `refreshReader()` below re-renders `AppearanceProvider`, which is this
      component's ANCESTOR, and that render reads the stored dark bit for
      itself (`appearance-provider.tsx`, "Read during render"). React renders
      the ancestor first, so an updater queued by `setPrefs` has not run yet at
      that point: the provider re-read the OLD value and stamped the old
      surface, and nothing re-rendered it afterwards. The paper stayed dark
      after pressing "Light mode" -- storage said `dark:false`, `.reader` had
      no `mode-dark`, the button offered "Dark mode", and `data-appearance`
      still said `reader-dark`. Writing here makes the value the provider reads
      the value it just published.
    */
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      setMessage("Your browser cannot keep these preferences after you leave.");
    }
    setPrefs(next);
    // The document's own surface has to follow. Without this the class flips
    // but `data-appearance` still says what it said at load, and the next
    // screen that renders from the attribute (a pending screen, say) comes
    // back on the old one.
    if (value.dark !== undefined) refreshReader();
    // Two of the Stats page's trust signals are pressed right here. Outside the
    // state updater on purpose: React calls an updater twice in development,
    // and these are counts of presses, so a press must count once. Fire only on
    // a real change -- re-pressing the button already selected is not a choice.
    if (value.dark === true && prefs.dark !== true) sendTrustEvent("dark-mode-chosen");
    if (typeof value.size === "number" && value.size > 21 && value.size !== prefs.size) {
      sendTrustEvent("larger-text-chosen");
    }
  }
  return (
    <ReaderContext.Provider value={{ ...prefs, ready, update, notify: setMessage }}>
      <div
        className={`reader${prefs.dark ? " mode-dark" : ""}`}
        style={{ "--reader-scale": prefs.size === 25 ? "1.2" : "1" } as CSSProperties}
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
              {READER_TEXT_SIZES.map(({ size, label }) => (
                <button
                  type="button"
                  key={size}
                  className={`btn ${r.size === size ? "selected" : ""}`}
                  aria-pressed={r.size === size}
                  onClick={() => r.update({ size })}
                >
                  {label}
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
            A clearer view of your community. Read at your own pace.
          </div>
          <button className="btn primary more" type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        </ReaderDialog>
      )}
    </>
  );
}
/**
 * The paper's dark-mode switch, in the dateline bar (unit BD5).
 *
 * It is a one-press toggle rather than a dialog, because that is what the
 * handoff draws in the bar's utility row and because it is the one appearance
 * choice a reader makes repeatedly -- at night, from a dark room. The label
 * names the mode the press will give you, so a dark paper offers "Light mode";
 * the icon is the same promise (`Moon` on a light paper, `Sun` on a dark one).
 *
 * It writes the reader's own preference, through the same `update` the reading
 * dialog's Light/Dark pair uses, so the choice follows the reader to the next
 * story and survives a reload via the head script. `update` calls
 * `refreshReader()` for `dark`, which moves `data-appearance` on <html> -- the
 * attribute every dark rule in reader-astra.css keys on -- so the paper is
 * dark on the press, not on the next navigation.
 *
 * `aria-pressed` says which state it is in, so a screen reader announces
 * "Dark mode, pressed" rather than leaving the reader to infer it from the
 * label they just heard the action of.
 */
export function DarkModeButton({ label = false }: { label?: boolean }) {
  const r = useReader();
  const next = r.dark ? "Light mode" : "Dark mode";
  return (
    <button
      className="btn subtle"
      type="button"
      aria-pressed={r.dark}
      aria-label={next}
      onClick={() => r.update({ dark: !r.dark })}
    >
      {r.dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
      {label && <span>{next}</span>}
    </button>
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
/**
 * One story in a list.
 *
 * `datebox` is the archive's own left gutter -- the date, once, beside a row of
 * stories read in order. The front page's "Latest stories" passes `false`
 * (unit BX): its rows carried the date twice, once in that box and once in the
 * meta line under the headline, and the brief keeps the meta line. The box is
 * already hidden below 760px, so the two are the same row on a phone.
 *
 * A story in the "misc" catch-all prints no section tag (unit BX): the reader
 * side never shows that bucket. The desk's lists do not come through here.
 */
export function ReaderRow({
  story,
  description = true,
  datebox = true,
  title,
}: {
  story: ReaderStory;
  description?: boolean;
  /** The date gutter at the head of the row; false on the front page. */
  datebox?: boolean;
  /**
   * The headline to print, when the caller prints it in a display form of its
   * own. The front page's rows carry the story's section tag above the
   * headline, so they pass the headline without the "OPINION: " prefix the
   * stored one carries (`headlineWithTag`, unit BZ item 3). Left out, the row
   * prints the stored headline unchanged, which is what a listing screen wants.
   */
  title?: string;
}) {
  const { sections } = usePublicSections();
  const { formatShortDate } = usePaperDateFormatters();
  const label = sections.find((s) => s.key === story.topic)?.name ?? story.topic;
  return (
    <article className={`newsrow${datebox ? "" : " nodate"}`}>
      {datebox ? <div className="datebox">{formatShortDate(story.published_at)}</div> : null}
      <div>
        {isMiscTopic(story.topic) ? null : (
          <Link className={`tag ${story.topic}`} to="/" search={{ topic: story.topic }}>
            {label}
          </Link>
        )}
        <Link to="/articles/$slug" params={{ slug: story.slug }}>
          <h3>{title ?? story.headline}</h3>
        </Link>
        {description && <p>{dekOrFallback(story.dek, story.body)}</p>}
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
