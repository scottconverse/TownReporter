import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "./desk-chrome";
import { inputClass } from "./desk-chrome-utils";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";
import {
  ADD_OUTLET_LABEL,
  ALIAS_HINT,
  APPLY_FAILED_NOTE,
  CHECK_NONE_LABEL,
  CUSTOMIZE_LABEL,
  DOMAIN_HINT,
  DOMAIN_ONLY_NOTE,
  EMPTY_PREVIEW_NOTE,
  NONE_LABEL,
  NONE_WARNING,
  NO_IMPACT_NOTE,
  OUTLETS_BAR_LABEL,
  OUTLETS_LEAVE_LABEL,
  OWN_LIST_NOTE,
  PANEL_INTRO,
  READ_ONLY_NOTE,
  REVIEW_FAILED_NOTE,
  SAVED_MESSAGE,
  SHIPPED_LIST_NOTE,
  UNSAVED_OUTLETS_BAR_MESSAGE,
  USE_BUILT_IN_LABEL,
  builtInLabel,
  impactSentence,
  moreStoriesLabel,
  ownListLabel,
} from "./named-outlets-copy";
import { applyNamedOutlets, editorNamedOutlets, namedOutletsPreview } from "@/lib/news/named-outlets";
import { outletProblems, type OutletProblemField } from "@/lib/news/named-outlet-rules";
import type { NamedOutlet } from "@/lib/news/outlet-credit";
import type { NamedOutletChange } from "@/lib/news/named-outlet-preview";

/*
  THE OWNER'S NAMED OUTLETS PANEL (0.6.63, Unit W), on Server.

  Built on the Sections panel (sections-setup.tsx) because the brief asks for
  it, and because the two settings have the same blast radius: both decide what
  the paper refuses to print. So the shape is the same -- a draft, rows you can
  add, edit and remove, Review changes, then Confirm and apply against the
  revision you loaded -- and the unsaved-changes bar and leave prompt are the
  same component (unsaved-changes-guard.tsx), not a copy of it.

  Two things differ, and they are the whole reason this screen needs care:

  * Three stored states, all visible. Nothing stored means the paper is using
    the list it shipped with, and the panel says so and offers Customize; an
    empty list is a decision ("this paper checks no outlet names") and gets a
    warning line, because it can only lose the paper a check; a list is the
    list.

  * Review changes reads the published stories. Removing an outlet, or dropping
    one of its aliases, unchecks every published story that credited it, so the
    preview names them -- headline and link, newest first, capped at 20 with a
    count -- through the gate's own matcher (named-outlets.server.ts), because a
    preview that disagreed with the gate would be worse than no preview.
*/

/** What the owner is editing, and whether they are asking for the shipped list. */
type Draft = { rows: NamedOutlet[]; builtIn: boolean };

/** A preview holds its own revision, so Apply uses what Review actually read. */
type Preview = {
  revision: number;
  usingShipped: boolean;
  changes: NamedOutletChange[];
};

const aliasText = (outlet: NamedOutlet) => outlet.aliases.join(", ");
const domainText = (outlet: NamedOutlet) => outlet.domains.join(", ");
/** Commas, because the field is one line and the hint says so. */
const splitOn = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export function NamedOutletsSetup() {
  const query = useQuery({
    queryKey: ["editor-named-outlets"],
    queryFn: () => editorNamedOutlets(),
  });
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reviewed, setReviewed] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (query.isPending) return <p className="mt-8 text-sm">Loading the outlet list…</p>;
  if (query.error)
    return (
      <p role="alert" className="mt-8 text-sm">
        The outlet list could not be loaded.{" "}
        <button onClick={() => void query.refetch()}>Retry</button>
      </p>
    );
  const saved = query.data;
  if (!saved) return null;
  // Same rule as the Sections panel: any editor may read the list, only the
  // owner may change it, and a non-owner gets the panel's absence rather than
  // a form that would be refused on apply.
  if (!saved.canEdit) return <p className="mt-8 text-sm">{READ_ONLY_NOTE}</p>;

  const stored = saved.stored;
  const rows = draft ? draft.rows : (stored ?? saved.shipped);
  // The built-in state is a statement about the paper, not an editable list, so
  // it is shown as a list of names with one button. Editing starts with
  // Customize, which seeds a draft from the shipped rows.
  const readOnlyBuiltIn = draft === null && stored === null;
  const state: "builtIn" | "none" | "list" =
    draft === null ? (stored === null ? "builtIn" : stored.length ? "list" : "none")
      : draft.builtIn ? "builtIn"
        : draft.rows.length ? "list" : "none";

  const problems = draft && !draft.builtIn ? outletProblems(draft.rows) : [];
  const problemFor = (row: number, field: OutletProblemField) =>
    problems.find((p) => p.row === row && p.field === field)?.text;
  const canApply = draft !== null && !draft.builtIn && problems.length === 0;

  const startDraft = (next: Draft) => {
    setDraft(next);
    setReviewed(null);
    setMessage("");
  };
  const edit = (index: number, patch: Partial<NamedOutlet>) => {
    if (!draft) return;
    startDraft({
      ...draft,
      rows: draft.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  };
  const cancel = () => {
    setDraft(null);
    setReviewed(null);
    setMessage("Unapplied changes discarded.");
  };

  const apply = async (previewed: Preview) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await applyNamedOutlets({
        data: {
          revision: previewed.revision,
          outlets: previewed.usingShipped ? null : (draft?.rows ?? rows),
        },
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setDraft(null);
      setReviewed(null);
      await cache.invalidateQueries({ queryKey: ["editor-named-outlets"] });
      setMessage(SAVED_MESSAGE);
    } catch {
      setMessage(APPLY_FAILED_NOTE);
    } finally {
      setBusy(false);
    }
  };

  const review = async () => {
    if (reviewed) {
      await apply(reviewed);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await namedOutletsPreview({
        data: { revision: saved.revision, outlets: draft?.builtIn ? null : rows },
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setReviewed({
        revision: result.preview.revision,
        usingShipped: result.preview.usingShipped,
        changes: result.preview.changes,
      });
    } catch {
      setMessage(REVIEW_FAILED_NOTE);
    } finally {
      setBusy(false);
    }
  };

  const impactTotal = (reviewed?.changes ?? []).reduce((n, c) => n + c.storyCount, 0);

  return (
    <>
      <section className="mt-8" aria-label="Named outlets">
        <h3 className="font-display text-2xl">Named outlets</h3>
        <p className="mt-2 text-sm">{PANEL_INTRO}</p>

        <p role="status" className="my-4 border border-rule p-3 text-sm">
          {state === "builtIn" ? builtInLabel(rows.length) : null}
          {state === "none" ? NONE_LABEL : null}
          {state === "list" ? ownListLabel(rows.length) : null}
          <span className="mt-1 block">
            {state === "builtIn" ? SHIPPED_LIST_NOTE : null}
            {state === "list" ? OWN_LIST_NOTE : null}
            {state === "none" ? NONE_WARNING : null}
          </span>
        </p>

        {message ? (
          <p role="status" className="my-4 border border-rule p-3 text-sm">
            {message}{" "}
            <a href="/" target="_blank" rel="noreferrer" className="underline">
              View newspaper
            </a>
          </p>
        ) : null}

        {readOnlyBuiltIn ? (
          <div className="mt-4 border border-rule p-4">
            <ul className="space-y-3">
              {rows.map((outlet) => (
                <li key={outlet.name}>
                  <p className="font-semibold">{outlet.name}</p>
                  <p className="text-sm">
                    {outlet.aliases.length ? `Also written: ${outlet.aliases.join(", ")}` : "No other names"}
                  </p>
                  <p className="text-sm">
                    {outlet.domains.length ? outlet.domains.join(", ") : "No website on file"}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <InkButton
                tone="solid"
                onClick={() => startDraft({ rows: saved.shipped, builtIn: false })}
              >
                {CUSTOMIZE_LABEL}
              </InkButton>
            </div>
          </div>
        ) : null}

        {readOnlyBuiltIn || draft?.builtIn ? null : (
          <div className="mt-4 space-y-5">
            {rows.map((outlet, index) => (
              /*
                Keyed by position: a row carries no identity of its own, and the
                inputs are controlled, so removing a row moves the values up
                rather than leaving a stale DOM node behind.
              */
              <fieldset key={index} className="min-w-0 border border-rule p-4" disabled={busy}>
                <legend className="px-2 font-semibold">{outlet.name || "New outlet"}</legend>
                <div className="grid gap-4 md:grid-cols-2">
                  <label>
                    Outlet name
                    <input
                      className={`${inputClass} mt-1 w-full`}
                      value={outlet.name}
                      maxLength={80}
                      aria-describedby={problemFor(index, "name") ? `outlet-${index}-name` : undefined}
                      onChange={(e) => edit(index, { name: e.target.value })}
                    />
                    {problemFor(index, "name") ? (
                      <span
                        id={`outlet-${index}-name`}
                        role="status"
                        className="mt-1 block text-sm"
                      >
                        {problemFor(index, "name")}
                      </span>
                    ) : null}
                  </label>
                  <label>
                    Aliases
                    <input
                      className={`${inputClass} mt-1 w-full`}
                      value={aliasText(outlet)}
                      maxLength={400}
                      aria-describedby={`outlet-${index}-aliases-hint`}
                      onChange={(e) => edit(index, { aliases: splitOn(e.target.value) })}
                    />
                    <span id={`outlet-${index}-aliases-hint`} className="mt-1 block text-sm">
                      {ALIAS_HINT}
                    </span>
                    {problemFor(index, "aliases") ? (
                      <span role="status" className="mt-1 block text-sm">
                        {problemFor(index, "aliases")}
                      </span>
                    ) : null}
                  </label>
                  <label>
                    Domain
                    <input
                      className={`${inputClass} mt-1 w-full`}
                      value={domainText(outlet)}
                      maxLength={400}
                      aria-describedby={`outlet-${index}-domains-hint`}
                      onChange={(e) => edit(index, { domains: splitOn(e.target.value) })}
                    />
                    <span id={`outlet-${index}-domains-hint`} className="mt-1 block text-sm">
                      {DOMAIN_HINT}
                    </span>
                    {problemFor(index, "domains") ? (
                      <span role="status" className="mt-1 block text-sm">
                        {problemFor(index, "domains")}
                      </span>
                    ) : null}
                  </label>
                  <div className="flex items-end">
                    <InkButton
                      tone="quiet-danger"
                      small
                      ariaLabel={`Remove outlet ${index + 1}, ${outlet.name || "unnamed"}`}
                      disabled={busy}
                      onClick={() =>
                        startDraft({ ...draft!, rows: draft!.rows.filter((_, i) => i !== index) })
                      }
                    >
                      Remove outlet
                    </InkButton>
                  </div>
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap gap-3">
              <InkButton
                tone="ghost"
                disabled={busy}
                onClick={() =>
                  startDraft({
                    rows: [...(draft?.rows ?? rows), { name: "", aliases: [], domains: [] }],
                    builtIn: false,
                  })
                }
              >
                {ADD_OUTLET_LABEL}
              </InkButton>
              {state === "list" ? (
                <InkButton
                  tone="ghost"
                  disabled={busy}
                  onClick={() => startDraft({ rows: [], builtIn: false })}
                >
                  {CHECK_NONE_LABEL}
                </InkButton>
              ) : null}
              <InkButton
                tone="ghost"
                disabled={busy}
                onClick={() => startDraft({ rows: saved.shipped, builtIn: true })}
              >
                {USE_BUILT_IN_LABEL}
              </InkButton>
            </div>
          </div>
        )}

        {reviewed ? (
          <div className="my-5 border-y-2 border-rule py-5">
            <h4 className="font-display text-xl">Review outlet changes · not saved</h4>
            {reviewed.changes.length === 0 ? (
              <p className="mt-3 text-sm">{EMPTY_PREVIEW_NOTE}</p>
            ) : (
              <>
                {impactTotal === 0 ? <p className="mt-3 text-sm">{NO_IMPACT_NOTE}</p> : null}
                <div className="mt-5 space-y-4" aria-label="Unsaved outlet changes">
                  {reviewed.changes.map((change) => (
                    <section className="border border-rule p-4" key={`${change.kind}-${change.name}`}>
                      <h5 className="font-semibold">
                        {change.name} ·{" "}
                        {change.kind === "added"
                          ? "added"
                          : change.kind === "removed"
                            ? "removed"
                            : "changed"}
                      </h5>
                      {change.kind === "changed" && change.droppedAliases.length ? (
                        <p className="mt-2 text-sm">
                          Stops checking the names: {change.droppedAliases.join(", ")}
                        </p>
                      ) : null}
                      {change.storyCount > 0 ? (
                        <>
                          <p className="mt-2 text-sm">{impactSentence(change.name, change.storyCount)}</p>
                          <ul className="mt-2 space-y-1 text-sm">
                            {change.stories.map((story) => (
                              <li key={story.id}>
                                <a href={story.url} className="underline" target="_blank" rel="noreferrer">
                                  {story.headline}
                                </a>
                              </li>
                            ))}
                          </ul>
                          {change.storyCount > change.stories.length ? (
                            <p className="mt-1 text-sm">
                              {moreStoriesLabel(change.storyCount - change.stories.length)}
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </section>
                  ))}
                </div>
                <p className="mt-4 text-sm">{DOMAIN_ONLY_NOTE}</p>
              </>
            )}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <InkButton
            tone="ghost"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setReviewed(null);
              void query.refetch();
              setMessage("Reloaded the saved outlet list. Unapplied edits discarded.");
            }}
          >
            Reload saved configuration
          </InkButton>
          <InkButton tone="ghost" disabled={busy || !draft} onClick={cancel}>
            Cancel changes
          </InkButton>
          <InkButton
            tone="solid"
            disabled={busy || !draft || (draft.builtIn ? false : !canApply)}
            onClick={() => void review()}
          >
            {busy ? "Working…" : reviewed ? "Confirm and apply" : "Review changes"}
          </InkButton>
        </div>
        {draft ? (
          // The bar is fixed, so the last fieldset needs room above it on a
          // 375px screen. Same spacer as the Sections panel.
          <div aria-hidden="true" className="h-28" />
        ) : null}
      </section>
      <UnsavedChangesGuard
        unsaved={draft !== null}
        barLabel={OUTLETS_BAR_LABEL}
        message={UNSAVED_OUTLETS_BAR_MESSAGE}
        leaveLabel={OUTLETS_LEAVE_LABEL}
        primary={{
          ariaLabel: reviewed
            ? "Confirm and apply, from the unsaved changes bar"
            : "Review changes, from the unsaved changes bar",
          label: busy ? "Working…" : reviewed ? "Confirm and apply" : "Review changes",
          onClick: () => void review(),
        }}
        cancelLabel="Cancel changes"
        cancelAriaLabel="Cancel changes, from the unsaved changes bar"
        onCancel={cancel}
        busy={busy}
      />
    </>
  );
}
