import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { InkButton } from "./desk-chrome";
import { inputClass } from "./desk-chrome-utils";
import {
  UNSAVED_SECTION_BAR_MESSAGE,
  sourceAddHint,
  sourceAddNotice,
  sourcesSummaryLabel,
} from "./sections-setup-copy";
import { editorSections, applySections } from "@/lib/news/sections";
import { addSource } from "@/lib/news/desk";
import { kindFromSourceUrl, tierFromKind } from "@/lib/news/desk-copy";
import {
  sectionPreviewChanges,
  type Section,
  type SectionConfig,
  type SectionSourceLabel,
} from "@/lib/news/section-types";

export function SectionsSetup() {
  const query = useQuery({ queryKey: ["editor-sections"], queryFn: () => editorSections() });
  const cache = useQueryClient();
  const [draft, setDraft] = useState<SectionConfig | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [addedSources, setAddedSources] = useState<SectionSourceLabel[]>([]);
  const [addUrl, setAddUrl] = useState<Record<string, string>>({});
  const [addLabel, setAddLabel] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState<Record<string, boolean>>({});
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addNotice, setAddNotice] = useState<{ key: string; kind: "ok" | "err"; text: string } | null>(
    null,
  );
  // The unsaved-draft flag read by the navigation blocker. It lives in a ref so
  // the blocker's shouldBlockFn keeps one identity for the life of the panel:
  // useBlocker re-registers its history hook whenever that function changes.
  const unsavedRef = useRef(false);
  unsavedRef.current = draft !== null;
  const hasUnsavedDraft = useCallback(() => unsavedRef.current, []);
  const blocker = useBlocker({
    shouldBlockFn: hasUnsavedDraft,
    // Also arm the browser's own unload prompt; the in-app route blocker
    // cannot see a reload, a closed tab or a typed URL.
    enableBeforeUnload: hasUnsavedDraft,
    withResolver: true,
  });
  const config = draft ?? query.data;
  if (query.isPending) return <p className="mt-8 text-sm">Loading newspaper sections…</p>;
  if (query.error)
    return (
      <p role="alert" className="mt-8 text-sm">
        Sections could not be loaded. <button onClick={() => void query.refetch()}>Retry</button>
      </p>
    );
  if (!config || !query.data?.canEdit) return null;
  const retiring = config.sections.some(
    (s) => s.replacementKey && !query.data!.sections.find((p) => p.key === s.key)?.replacementKey,
  );
  // Sources added from inside a section, ahead of the saved list, so a source
  // the owner just ticked is visible in the checkbox list and named in Review
  // changes instead of printing as "Source #N" until the next refetch.
  const knownSources: SectionSourceLabel[] = [
    ...addedSources.filter((row) => !query.data!.sources.some((s) => s.id === row.id)),
    ...query.data!.sources,
  ];
  const titlesById = new Map(knownSources.map((s) => [s.id, s.title]));
  const previewChanges = draft ? sectionPreviewChanges(query.data, draft, knownSources) : [];
  const edit = (key: string, patch: Partial<Section>) => {
    setDraft({
      ...config,
      sections: config.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    });
    setMessage("");
  };
  const move = (index: number, offset: number) => {
    const sections = [...config.sections];
    [sections[index], sections[index + offset]] = [sections[index + offset]!, sections[index]!];
    setDraft({ ...config, sections });
  };
  const cancel = () => {
    setDraft(null);
    setPreview(false);
    setMessage("Unapplied changes discarded.");
  };
  const apply = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await applySections({
        data: { revision: config.revision, sections: config.sections },
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setDraft(null);
      setPreview(false);
      await cache.invalidateQueries({ queryKey: ["editor-sections"] });
      await cache.invalidateQueries({ queryKey: ["public-sections"] });
      setMessage(
        "Sections saved. The newspaper navigation and editor selectors now use these sections.",
      );
    } catch {
      setMessage(
        "Could not save sections. Your input is preserved. Check the connection and retry.",
      );
    } finally {
      setBusy(false);
    }
  };
  /**
   * Add one source to one section, from inside that section.
   *
   * This is the Sources page's own write, deliberately not a second one: it
   * calls the same `addSource` server function, so the URL guard, the SSRF
   * check, the kind/tier inference and the upsert-on-URL duplicate detection
   * are the same code that runs on /desk/sources. Only the second half -- the
   * assignment -- is new, and that half rides the section draft until the
   * owner confirms it.
   */
  const addSourceToSection = async (s: Section) => {
    const url = (addUrl[s.key] ?? "").trim();
    if (!url || busy || addingKey) return;
    setAddingKey(s.key);
    setAddNotice(null);
    try {
      const wasOnWatch = new Set(knownSources.map((row) => row.id));
      const res = await addSource({
        data: {
          url,
          title: (addLabel[s.key] ?? "").trim(),
          kind: kindFromSourceUrl(url),
          tier: tierFromKind(kindFromSourceUrl(url)),
        },
      });
      if (!res.ok) {
        setAddNotice({ key: s.key, kind: "err", text: res.error });
        return;
      }
      setAddedSources((rows) => [res.source, ...rows.filter((row) => row.id !== res.source.id)]);
      edit(s.key, { sourceIds: [...new Set([...s.sourceIds, res.source.id])] });
      setAddOpen((open) => ({ ...open, [s.key]: true }));
      setAddUrl((values) => ({ ...values, [s.key]: "" }));
      setAddLabel((values) => ({ ...values, [s.key]: "" }));
      setAddNotice({
        key: s.key,
        kind: "ok",
        text: sourceAddNotice({
          sectionName: s.name,
          title: res.source.title,
          url: res.source.url,
          // The add path upserts on the newsroom's URL, so a URL already on
          // watch comes back as the same row id. That id being known before the
          // click is the duplicate signal -- not a string compare on the URL.
          alreadyOnWatch: wasOnWatch.has(res.source.id),
        }),
      });
      void cache.invalidateQueries({ queryKey: ["editor-sections"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add that source.";
      setAddNotice({
        key: s.key,
        kind: "err",
        text: msg === "Unauthorized" ? "Session expired. Sign in again, then retry." : msg,
      });
    } finally {
      setAddingKey(null);
    }
  };
  return (
    <>
    <section className="mt-10 border-t border-rule pt-6 text-sm" aria-label="Newspaper sections">
      <h3 className="font-display text-2xl">Newspaper sections</h3>
      <p className="mt-2 max-w-2xl">
        Names and order shape the newspaper. Reporting briefs guide section scans. A hidden section
        keeps its stories and links. Retiring moves its leads, drafts and articles into an active
        replacement; old section links still work.
      </p>
      <p className="mt-2">
        Review changes and Back to editing do not save. Confirm and apply updates the paper
        immediately; Cancel changes discards the draft.
      </p>
      {message ? (
        <p role="status" className="my-4 border border-rule p-3">
          {message}{" "}
          <a href="/" target="_blank" rel="noreferrer" className="underline">
            View newspaper
          </a>
        </p>
      ) : null}
      {preview ? (
        <div className="my-5 border-y-2 border-rule py-5">
          <h4 className="font-display text-xl">Review section changes · not saved</h4>
          <div className="mt-3 flex flex-wrap gap-4" aria-label="Preview section order">
            {config.sections
              .filter((s) => s.visible && !s.replacementKey && s.key !== "about")
              .map((s) => (
                <span className="border-b border-rule py-1" key={s.key}>
                  {s.name}
                </span>
              ))}
          </div>
          <div className="mt-5 space-y-4" aria-label="Unsaved section changes">
            {previewChanges.map((change) => (
              <section className="border border-rule p-4" key={change.key}>
                <h5 className="font-semibold">
                  {change.nameAfter} · {change.key}
                </h5>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold">Name</dt>
                    <dd>
                      {change.nameBefore ?? "New section"} → {change.nameAfter}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Section order</dt>
                    <dd>
                      {change.positionBefore ?? "New"} → {change.positionAfter}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Visible</dt>
                    <dd>
                      {change.visibleBefore == null ? "New" : change.visibleBefore ? "Yes" : "No"} →{" "}
                      {change.visibleAfter ? "Yes" : "No"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Replacement</dt>
                    <dd>
                      {change.replacementBefore ?? "None"} → {change.replacementAfter ?? "None"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-semibold">Reporting brief</dt>
                    <dd className="whitespace-pre-wrap">
                      {change.briefBefore || "Empty"} → {change.briefAfter || "Empty"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-semibold">Scan instructions</dt>
                    <dd className="whitespace-pre-wrap">
                      {change.instructionsBefore || "Empty"} → {change.instructionsAfter || "Empty"}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="font-semibold">Accepted sources</dt>
                    <dd>
                      <p className="break-all">
                        Before:{" "}
                        {change.sourcesBefore.length
                          ? change.sourcesBefore
                              .map((source) => `${source.title} · ${source.url}`)
                              .join("; ")
                          : "None"}
                      </p>
                      <p className="break-all">
                        After:{" "}
                        {change.sourcesAfter.length
                          ? change.sourcesAfter
                              .map((source) => `${source.title} · ${source.url}`)
                              .join("; ")
                          : "None"}
                      </p>
                    </dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
          {config.sections
            .filter(
              (s) =>
                s.replacementKey &&
                !query.data!.sections.find((p) => p.key === s.key)?.replacementKey,
            )
            .map((s) => (
              <p className="mt-3" key={s.key}>
                Retire {s.name}: move{" "}
                {query.data!.counts.find((c) => c.topic === s.key)?.count ?? 0} existing records to{" "}
                {config.sections.find((r) => r.key === s.replacementKey)?.name ??
                  "a replacement must be chosen"}
                . Old links are retained.
              </p>
            ))}
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {config.sections.map((s, index) => (
            <fieldset
              key={s.key}
              className="min-w-0 border border-rule p-4"
              disabled={
                busy ||
                Boolean(
                  s.replacementKey &&
                  query.data!.sections.find((p) => p.key === s.key)?.replacementKey,
                )
              }
            >
              <legend className="px-2 font-semibold">
                {s.name}
                {s.replacementKey ? " · retired" : ""}
              </legend>
              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  Display name
                  <input
                    className={`${inputClass} mt-1 w-full`}
                    value={s.name}
                    maxLength={80}
                    onChange={(e) => edit(s.key, { name: e.target.value })}
                  />
                </label>
                <div>
                  <p>
                    Permanent section key: <strong>{s.key}</strong>
                  </p>
                  <label className="mt-2 flex gap-2">
                    <input
                      type="checkbox"
                      checked={s.visible}
                      onChange={(e) => edit(s.key, { visible: e.target.checked })}
                    />
                    Show in newspaper section navigation
                  </label>
                </div>
                {!["opinion", "about"].includes(s.key) && (
                  <>
                    <label>
                      Reporting brief
                      <textarea
                        className={`${inputClass} mt-1 w-full`}
                        rows={3}
                        maxLength={3000}
                        value={s.brief}
                        onChange={(e) => edit(s.key, { brief: e.target.value })}
                      />
                    </label>
                    <label>
                      Section scan instructions
                      <textarea
                        className={`${inputClass} mt-1 w-full`}
                        rows={3}
                        maxLength={6000}
                        value={s.instructions}
                        onChange={(e) => edit(s.key, { instructions: e.target.value })}
                      />
                    </label>
                  </>
                )}
              </div>
              {["opinion", "about"].includes(s.key) ? (
                <p className="mt-4">
                  Reserved page: no section scans or retirement. These settings label and position
                  its section listing; the permanent Opinion and About page links remain available.
                </p>
              ) : (
                <details
                  className="mt-4"
                  // An empty section opens itself: a collapsed "0" is the line
                  // the owner read past and then found no way to act on. Once a
                  // source is ticked, the default is collapsed again, but the
                  // summary keeps the count and the first few names.
                  open={addOpen[s.key] ?? s.sourceIds.length === 0}
                  onToggle={(e) => {
                    // React writing `open` back also fires this event, so only
                    // record a real change of state.
                    const next = e.currentTarget.open;
                    setAddOpen((openMap) =>
                      openMap[s.key] === next ? openMap : { ...openMap, [s.key]: next },
                    );
                  }}
                >
                  <summary>
                    {sourcesSummaryLabel(
                      s.sourceIds.length,
                      s.sourceIds.map((id) => titlesById.get(id) ?? ""),
                    )}
                  </summary>
                  {/*
                    P0-6: make a zero-source section visible and explain why its
                    scan would refuse, before the editor clicks Run. No silent
                    auto-assignment — assignment stays manual.
                  */}
                  {s.sourceIds.length === 0 ? (
                    <p className="mt-2" role="status">
                      <b>No sources assigned.</b> A section scan for “{s.name}” would refuse to run
                      because it has no accepted assigned sources. Tick one below, or add a new one
                      without leaving this page.
                    </p>
                  ) : null}
                  <p className="mt-2">
                    Section scans use only checked sources. General Scan continues to use all
                    accepted sources.
                  </p>
                  {!knownSources.length ? (
                    <p className="mt-2">
                      No accepted sources yet. Add one below, or{" "}
                      <a href="/desk/sources" className="underline">
                        open Sources
                      </a>{" "}
                      to accept a whole registry.
                    </p>
                  ) : (
                    <>
                      {/* P0-6: bulk assignment stays manual — these buttons only
                          set the section's checked set to an explicit list. */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <InkButton
                          tone="ghost"
                          small
                          disabled={busy}
                          onClick={() =>
                            edit(s.key, {
                              sourceIds: [
                                ...new Set([...s.sourceIds, ...knownSources.map((x) => x.id)]),
                              ],
                            })
                          }
                        >
                          Assign all accepted
                        </InkButton>
                        <InkButton
                          tone="ghost"
                          small
                          disabled={busy || s.sourceIds.length === 0}
                          onClick={() => edit(s.key, { sourceIds: [] })}
                        >
                          Clear section
                        </InkButton>
                        <InkButton
                          tone="ghost"
                          small
                          disabled={busy}
                          onClick={() => {
                            const next = new Set(s.sourceIds);
                            for (const other of config.sections) {
                              if (["opinion", "about"].includes(other.key)) continue;
                              for (const id of other.sourceIds) next.add(id);
                            }
                            edit(s.key, { sourceIds: [...next] });
                          }}
                        >
                          Copy from other sections
                        </InkButton>
                      </div>
                      {knownSources.map((source) => (
                      <label className="mt-2 flex items-start gap-2" key={source.id}>
                        <input
                          type="checkbox"
                          checked={s.sourceIds.includes(source.id)}
                          onChange={(e) =>
                            edit(s.key, {
                              sourceIds: e.target.checked
                                ? [...s.sourceIds, source.id]
                                : s.sourceIds.filter((id) => id !== source.id),
                            })
                          }
                        />
                        <span className="break-all">
                          {source.title} · {source.url}
                        </span>
                      </label>
                      ))}
                    </>
                  )}
                  <div className="mt-4 border-t border-rule pt-3">
                    <h5 className="font-semibold">Add a new source to this section</h5>
                    <p className="mt-1 max-w-xl">{sourceAddHint(s.name)}</p>
                    <div className="mt-2 grid max-w-xl gap-3 sm:grid-cols-2">
                      <label>
                        New source URL
                        <input
                          className={`${inputClass} mt-1 w-full`}
                          type="text"
                          inputMode="url"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          value={addUrl[s.key] ?? ""}
                          onChange={(e) =>
                            setAddUrl((values) => ({ ...values, [s.key]: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        Label (optional)
                        <input
                          className={`${inputClass} mt-1 w-full`}
                          value={addLabel[s.key] ?? ""}
                          maxLength={120}
                          onChange={(e) =>
                            setAddLabel((values) => ({ ...values, [s.key]: e.target.value }))
                          }
                        />
                      </label>
                    </div>
                    <p className="mt-3">
                      <InkButton
                        tone="ghost"
                        disabled={busy || addingKey === s.key || !(addUrl[s.key] ?? "").trim()}
                        onClick={() => void addSourceToSection(s)}
                      >
                        {addingKey === s.key ? "Adding…" : "Add and tick for this section"}
                      </InkButton>
                    </p>
                    {addNotice?.key === s.key ? (
                      <p
                        role="status"
                        className={"note mt-2" + (addNotice.kind === "err" ? " err" : "")}
                      >
                        {addNotice.text}
                      </p>
                    ) : null}
                  </div>
                </details>
              )}
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <InkButton
                  tone="ghost"
                  disabled={index === 0 || busy}
                  onClick={() => move(index, -1)}
                  ariaLabel={`Move ${s.name} up`}
                >
                  Move up
                </InkButton>
                <InkButton
                  tone="ghost"
                  disabled={index === config.sections.length - 1 || busy}
                  onClick={() => move(index, 1)}
                  ariaLabel={`Move ${s.name} down`}
                >
                  Move down
                </InkButton>
                {!["opinion", "about"].includes(s.key) ? (
                  <label>
                    Retire into
                    <select
                      className={`${inputClass} ml-2 max-w-full`}
                      value={s.replacementKey ?? ""}
                      onChange={(e) => edit(s.key, { replacementKey: e.target.value || null })}
                    >
                      <option value="">Keep active</option>
                      {config.sections
                        .filter(
                          (r) =>
                            r.key !== s.key &&
                            !r.replacementKey &&
                            !["opinion", "about"].includes(r.key),
                        )
                        .map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  <span>Reserved section</span>
                )}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      {!preview ? (
        <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-2">
          <label>
            New section name
            <input
              className={`${inputClass} mt-1 w-full`}
              value={newName}
              maxLength={80}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewKey(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                    .slice(0, 40),
                );
              }}
            />
          </label>
          <label>
            New permanent section key
            <input
              className={`${inputClass} mt-1 w-full`}
              value={newKey}
              maxLength={40}
              onChange={(e) => setNewKey(e.target.value)}
            />
            <span>Used in section links. It cannot change after saving.</span>
          </label>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-3">
        {!preview ? (
          <InkButton
            tone="ghost"
            disabled={
              busy ||
              !newName.trim() ||
              !/^[a-z][a-z0-9-]{0,39}$/.test(newKey) ||
              config.sections.some((s) => s.key === newKey)
            }
            onClick={() => {
              setDraft({
                ...config,
                sections: [
                  ...config.sections,
                  {
                    key: newKey,
                    name: newName.trim(),
                    visible: true,
                    brief: "",
                    instructions: "",
                    replacementKey: null,
                    sourceIds: [],
                  },
                ],
              });
              setNewName("");
              setNewKey("");
            }}
          >
            Add section
          </InkButton>
        ) : null}
        <InkButton tone="ghost" disabled={busy} onClick={() => setPreview(!preview)}>
          {preview ? "Back to editing" : "Preview changes"}
        </InkButton>
        <InkButton tone="ghost" disabled={busy || !draft} onClick={cancel}>
          Cancel changes
        </InkButton>
        <InkButton
          tone={retiring && preview ? "danger" : "solid"}
          disabled={busy || !draft}
          onClick={() => {
            if (!preview) {
              setPreview(true);
              return;
            }
            void apply();
          }}
        >
          {busy
            ? "Applying…"
            : preview
              ? retiring
                ? "Confirm retirement and apply"
                : "Confirm and apply"
              : "Review changes"}
        </InkButton>
        <InkButton
          tone="ghost"
          disabled={busy}
          onClick={() => {
            setDraft(null);
            setPreview(false);
            void query.refetch();
            setMessage("Reloaded saved configuration. Unapplied edits discarded.");
          }}
        >
          Reload saved configuration
        </InkButton>
      </div>
      {draft ? (
        // Nothing else in this panel is fixed, so this spacer is what keeps the
        // last fieldset reachable above the bar on a 375px screen.
        <div aria-hidden="true" className="h-28" />
      ) : null}
    </section>
    {/*
      The unsaved bar and the leave-page prompt sit outside the
      `Newspaper sections` section: they are page-level states, and keeping
      them out of the panel keeps `panel.getByRole(...)` unambiguous for the
      walkers that drive this screen.

      The bar is mounted at all times so its `role="status"` message is a live
      region that already exists when the draft does -- text inserted into a
      live region is announced, a live region inserted with its text is not.
      With no draft it collapses to `sr-only` and holds no text, so it has no
      footprint and nothing to announce.
    */}
    <div
      aria-label={draft ? "Section changes not saved" : undefined}
      className={
        draft
          ? "fixed inset-x-0 bottom-0 z-30 border-t-2 border-rule bg-paper px-3 py-3"
          : "sr-only"
      }
    >
      <div
        className={
          draft
            ? "mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-2"
            : undefined
        }
      >
        <p role="status" className={draft ? "text-sm font-semibold" : undefined}>
          {draft ? UNSAVED_SECTION_BAR_MESSAGE : ""}
        </p>
        {draft ? (
          <>
            <InkButton
              tone={preview && retiring ? "danger" : "solid"}
              small
              ariaLabel={
                preview ? "Confirm and apply, from the unsaved changes bar" : "Review changes, from the unsaved changes bar"
              }
              disabled={busy}
              onClick={() => {
                if (!preview) {
                  setPreview(true);
                  return;
                }
                void apply();
              }}
            >
              {busy
                ? "Applying…"
                : preview
                  ? retiring
                    ? "Confirm retirement and apply"
                    : "Confirm and apply"
                  : "Review changes"}
            </InkButton>
            <InkButton
              tone="ghost"
              small
              ariaLabel="Cancel changes, from the unsaved changes bar"
              disabled={busy}
              onClick={cancel}
            >
              Cancel changes
            </InkButton>
          </>
        ) : null}
      </div>
    </div>
    {blocker.status === "blocked" ? (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Leave with unsaved section changes?"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      >
        <div className="max-w-md border-2 border-rule bg-paper p-5 text-sm">
          <h4 className="font-display text-xl">{UNSAVED_SECTION_BAR_MESSAGE}</h4>
          <p className="mt-2">
            Leaving now discards the draft. Review and confirm first if you want to keep it.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <InkButton tone="solid" onClick={() => blocker.proceed()}>
              Leave and discard changes
            </InkButton>
            <InkButton tone="ghost" onClick={() => blocker.reset()}>
              Stay on this page
            </InkButton>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}