import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton, inputClass } from "./desk-chrome";
import { editorSections, applySections } from "@/lib/news/sections";
import type { Section, SectionConfig } from "@/lib/news/section-types";

export function SectionsSetup() {
  const query = useQuery({ queryKey: ["editor-sections"], queryFn: () => editorSections() });
  const cache = useQueryClient();
  const [draft, setDraft] = useState<SectionConfig | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("");
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
  return (
    <section className="mt-10 border-t border-rule pt-6 text-sm" aria-label="Newspaper sections">
      <h3 className="font-display text-2xl">Newspaper sections</h3>
      <p className="mt-2 max-w-2xl">
        Names and order shape the newspaper. Reporting briefs guide section scans. A hidden section
        keeps its stories and links. Retiring moves its leads, drafts and articles into an active
        replacement; old section links still work.
      </p>
      <p className="mt-2">
        Preview and Cancel do not save. Apply changes updates the paper immediately.
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
          <h4 className="font-display text-xl">Newspaper navigation preview · not saved</h4>
          <div className="mt-3 flex flex-wrap gap-4" aria-label="Preview section order">
            {config.sections
              .filter((s) => s.visible && !s.replacementKey && s.key !== "about")
              .map((s) => (
                <span className="border-b border-rule py-1" key={s.key}>
                  {s.name}
                </span>
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
                <details className="mt-4">
                  <summary>Assigned accepted sources ({s.sourceIds.length})</summary>
                  <p className="mt-2">
                    Section scans use only checked sources. General Scan continues to use all
                    accepted sources.
                  </p>
                  {!query.data!.sources.length ? (
                    <p className="mt-2">
                      No accepted sources.{" "}
                      <a href="/desk/sources" className="underline">
                        Open Sources
                      </a>{" "}
                      to accept sources first.
                    </p>
                  ) : (
                    query.data!.sources.map((source) => (
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
                    ))
                  )}
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
            if (retiring && !preview) {
              setPreview(true);
              return;
            }
            void apply();
          }}
        >
          {busy
            ? "Applying…"
            : retiring
              ? preview
                ? "Confirm retirement and apply"
                : "Review retirement impact"
              : "Apply changes"}
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
    </section>
  );
}
