import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell, InkButton, SecHead } from "@/components/desk-chrome";
import { ScreenError, ListSkeleton } from "@/components/states";
import { RegistryImportPanel } from "@/components/registry-import-panel";
import { RegistryExportPanel } from "@/components/registry-export-panel";
import { RegistryEntryEditor } from "@/components/registry-entry-editor";
import { RegistryChangeReviewList } from "@/components/registry-change-review";
import { RegistryNeedsChecking } from "@/components/registry-needs-checking";
import { RegistryEntryCard } from "@/components/registry-entry-card";
import { RegistryEntryPanel } from "@/components/registry-entry-panel";
import { listRegistryDesk } from "@/lib/news/registry/registry-desk";
import {
  addRegistryEntry,
  loadStarterList,
  publishRegistryEntry,
  takeDownRegistryEntry,
  updateRegistryEntry,
} from "@/lib/news/registry/registry-desk-write";
import {
  type RegistryEntryFields,
} from "@/lib/news/registry/registry-entry-fields";
import {
  STARTER_CHECKED_ON_BY_SERVICE_ID,
  STARTER_ENTRIES,
  checkedOnLabel,
} from "@/lib/news/registry/starter-list";
import { recheckResultWords } from "@/lib/news/registry/registry-recheck";
import { evidenceTierLabel, isWebAddress } from "@/lib/news/desk-copy";
import { PAGE_SIZE, showingLine } from "@/lib/news/list-window";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

/**
 * The desk's view of the community resource registry (spec 24, Phase 1).
 *
 * Scott, Nov 20 2026: "Make sure that the interface to that registry page is
 * made for a human. Right now it's unbelievably ugly. It doesn't have anywhere
 * near the information it's supposed to." So this page is laid out for a person
 * reading it:
 *
 *   - a short summary at the top: the robot's freshness numbers, each a link to
 *     the list behind it;
 *   - a search box and a category filter that narrow every entry list and the
 *     detected changes together;
 *   - every list is a collapsible block with its count in the heading;
 *   - every entry is a card that shows the whole entry (organization, service,
 *     category, description, every phone, address with a map link, hours,
 *     website, eligibility, fees, languages, and the source page with the date
 *     it was captured) -- never a name with blank lines;
 *   - every proposal says what kind of change it is, the old and new values
 *     side by side, the page's own sentence, the source link and capture date,
 *     and the entry it belongs to;
 *   - clicking an entry opens that entry's own page on the desk;
 *   - long lists are paged, 25 at a time.
 *
 * The page also keeps the writes Phase 1 and 2 approved: load the starter list,
 * publish one entry at a time, edit one entry, take one down, and accept or
 * reject the changes the scan could not settle.
 */

const REVIEW_STATES = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting for an editor" },
  { key: "needs-editor", label: "Needs the editor" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
] as const;

type ReviewStateFilter = (typeof REVIEW_STATES)[number]["key"];

const ENTITY_LABELS: Record<string, string> = {
  organization: "Organization",
  service: "Service",
  location: "Location",
  service_at_location: "Service at a location",
  schedule: "Schedule",
  contact: "Contact",
  eligibility: "Eligibility",
  required_document: "Required document",
  language: "Language",
  accessibility: "Accessibility",
  taxonomy: "Category",
};

const CHANGE_KIND_LABELS: Record<string, string> = {
  field_change: "Field change",
  eligibility_change: "Eligibility change",
  hours_change: "Hours change",
  closure: "Closure",
  move: "Move",
  contact_change: "Contact change",
  funding_change: "Funding change",
  non_informational: "Not a factual change",
};

const REVIEW_STATE_LABELS: Record<string, string> = {
  pending: "Waiting for an editor",
  "needs-editor": "Needs the editor",
  accepted: "Accepted",
  rejected: "Rejected",
};

const ROLE_LABELS: Record<string, string> = {
  organization: "Organization feed",
  service: "Service feed",
  location: "Location feed",
  directory: "Directory to import",
};

export const Route = createFileRoute("/desk/registry")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: ReviewStateFilter; entry?: number } => {
    const state = String(search.state ?? "");
    const entry = Number(search.entry);
    return {
      ...(REVIEW_STATES.some((option) => option.key === state)
        ? { state: state as ReviewStateFilter }
        : {}),
      ...(Number.isInteger(entry) && entry > 0 ? { entry } : {}),
    };
  },
  head: () => ({ meta: [{ title: "Registry — TownReporter" }] }),
  component: RegistryDeskPage,
});

const field = "w-full border border-rule bg-paper p-2 text-sm";

/** The page's own sentence: what this screen is a list of. */
const LEDE =
  "Every change the scan detected in a registry source, the imports that filled the directory, and the sources it watches.";

/** The id of the one datalist every entry form draws its categories from. */
const CATEGORY_LIST_ID = "registry-category-options";

const EMPTY_ENTRY_FIELDS: RegistryEntryFields = {
  organizationName: "",
  serviceName: "",
  categoryName: "",
  phone: "",
  description: "",
  sourceTitle: "",
  sourceUrl: "",
};

/**
 * One collapsible block of the page: the heading (title and count) is the
 * control that opens and closes the list. `defaultOpen` only sets the first
 * state; after that the browser owns it.
 */
function Section({
  id,
  title,
  count,
  sub,
  defaultOpen = true,
  children,
}: {
  id?: string;
  title: string;
  count?: number | string | null;
  sub?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="src-sec registry-sec" id={id} open={defaultOpen || undefined}>
      <summary className="registry-sec-summary">
        <SecHead title={title} count={count} sub={sub} />
      </summary>
      {children}
    </details>
  );
}

/** The words a list footer uses: "Showing 25 of 60 entries." plus the button. */
function ListFoot({
  shown,
  total,
  noun,
  onMore,
}: {
  shown: number;
  total: number;
  noun: string;
  onMore: () => void;
}) {
  if (total === 0) return null;
  return (
    <div className="astra-list-foot">
      <span>{showingLine(shown, total, noun)}</span>
      {shown < total ? (
        <button type="button" className="astra-list-more" onClick={onMore}>
          Show {PAGE_SIZE} more
        </button>
      ) : null}
    </div>
  );
}

/**
 * The seven fields of one entry, in place: used to edit a row and to add a new
 * one. The values start from the row the editor pressed Edit on, or from
 * nothing for a new entry. The category box offers the newsroom's existing
 * names but accepts a new one.
 */
function RegistryEntryForm({
  initial,
  submitLabel,
  pending,
  pendingLabel,
  onSubmit,
  onCancel,
}: {
  initial: RegistryEntryFields;
  submitLabel: string;
  pending: boolean;
  pendingLabel: string;
  onSubmit: (fields: RegistryEntryFields) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<RegistryEntryFields>(initial);
  const change =
    (key: keyof RegistryEntryFields) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className="mt-3 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(fields);
      }}
    >
      <label className="block text-sm">
        Organization name
        <input
          className={field}
          value={fields.organizationName}
          maxLength={200}
          onChange={change("organizationName")}
        />
      </label>
      <label className="block text-sm">
        Service name
        <input
          className={field}
          value={fields.serviceName}
          maxLength={200}
          onChange={change("serviceName")}
        />
      </label>
      <label className="block text-sm">
        Category
        <input
          className={field}
          value={fields.categoryName}
          maxLength={200}
          list={CATEGORY_LIST_ID}
          onChange={change("categoryName")}
        />
      </label>
      <label className="block text-sm">
        Phone
        <input
          className={field}
          value={fields.phone}
          maxLength={60}
          onChange={change("phone")}
        />
      </label>
      <label className="block text-sm">
        Description
        <textarea
          className={field}
          value={fields.description}
          rows={3}
          maxLength={2000}
          onChange={change("description")}
        />
      </label>
      <label className="block text-sm">
        Source title
        <input
          className={field}
          value={fields.sourceTitle}
          maxLength={300}
          onChange={change("sourceTitle")}
        />
      </label>
      <label className="block text-sm">
        Source URL
        <input
          className={field}
          value={fields.sourceUrl}
          maxLength={2000}
          onChange={change("sourceUrl")}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <InkButton type="submit" tone="solid" pending={pending} pendingLabel={pendingLabel}>
          {submitLabel}
        </InkButton>
        <InkButton tone="ghost" onClick={onCancel}>
          Cancel
        </InkButton>
      </div>
    </form>
  );
}

/** The form values an existing row starts from. */
function entryFieldsOf(row: {
  organizationName: string;
  serviceName: string;
  categoryName: string | null;
  phone: string | null;
  description: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
}): RegistryEntryFields {
  return {
    organizationName: row.organizationName,
    serviceName: row.serviceName,
    categoryName: row.categoryName ?? "",
    phone: row.phone ?? "",
    description: row.description ?? "",
    sourceTitle: row.sourceTitle ?? "",
    sourceUrl: row.sourceUrl ?? "",
  };
}

/** The text a search box and the category filter look through, per entry. */
function entryHaystack(entry: {
  organizationName: string;
  serviceName: string;
  categoryName: string | null;
  description: string | null;
  phones: string[];
  address: string | null;
  website: string | null;
  eligibility: string | null;
  fees: string | null;
  languages: string[];
}): string {
  return [
    entry.organizationName,
    entry.serviceName,
    entry.categoryName,
    entry.description,
    entry.phones.join(" "),
    entry.address,
    entry.website,
    entry.eligibility,
    entry.fees,
    entry.languages.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function RegistryDeskPage() {
  const search = Route.useSearch();
  const state: ReviewStateFilter = search.state ?? "all";
  const { formatShortDate, formatListDateTime } = usePaperDateFormatters();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["registry-desk"], queryFn: () => listRegistryDesk() });
  const changes = useMemo(() => query.data?.changes ?? [], [query.data]);
  const waiting = query.data?.waiting ?? [];
  const published = query.data?.published ?? [];
  const autoPublished = query.data?.autoPublished ?? [];
  const categories = query.data?.categories ?? [];
  const freshness = query.data?.freshness;

  // The page-wide search and category filter. They narrow the entry lists and
  // the detected changes together, so one question asked at the top is
  // answered everywhere below it.
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const needle = text.trim().toLowerCase();
  const keepEntry = (entry: Parameters<typeof entryHaystack>[0]) =>
    (category === "" || (entry.categoryName ?? "") === category) &&
    (needle === "" || entryHaystack(entry).includes(needle));
  const visibleWaiting = waiting.filter(keepEntry);
  const visiblePublished = published.filter(keepEntry);
  const visibleAuto = autoPublished.filter(keepEntry);
  // The freshness lists are entry lists too, so the same search narrows them.
  const keepFresh = (row: { organizationName: string; serviceName: string }) =>
    needle === "" ||
    `${row.organizationName} ${row.serviceName}`.toLowerCase().includes(needle);
  const shownRechecked = (freshness?.rechecked ?? []).filter(keepFresh);
  const shownChanged = (freshness?.changedEntries ?? []).filter(keepFresh);
  const visibleGone = (freshness?.sourceGoneEntries ?? []).filter(keepFresh);

  const changeHaystack = (change: (typeof changes)[number]) =>
    [
      change.entityName,
      change.fieldName,
      change.beforeValue,
      change.afterValue,
      change.summary,
      change.quote,
      change.sourceTitle,
      change.sourceUrl,
      CHANGE_KIND_LABELS[change.changeKind] ?? change.changeKind,
      ENTITY_LABELS[change.entityType] ?? change.entityType,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  const matchingChanges = needle === "" ? changes : changes.filter((c) => changeHaystack(c).includes(needle));
  const visible = state === "all" ? matchingChanges : matchingChanges.filter((c) => c.reviewState === state);

  // 25 rows at a time, the desk's usual window (list-window.ts).
  const [shown, setShown] = useState({
    waiting: PAGE_SIZE,
    published: PAGE_SIZE,
    auto: PAGE_SIZE,
    changes: PAGE_SIZE,
    gone: PAGE_SIZE,
    needsChecking: PAGE_SIZE,
  });
  const more = (key: keyof typeof shown) =>
    setShown((current) => ({ ...current, [key]: current[key] + PAGE_SIZE }));

  // Every category any list already uses, offered by the one filter.
  const categoryOptions = (() => {
    const names = new Set(categories);
    for (const entry of [...waiting, ...published, ...autoPublished]) {
      if (entry.categoryName) names.add(entry.categoryName);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  })();

  // Which row's form is open. One at a time, so the desk never shows two
  // half-edited entries and an editor cannot lose track of which Save is which.
  const [editingId, setEditingId] = useState<number | null>(null);
  // Which row's full details editor (organization, service and contacts) is open.
  const [detailId, setDetailId] = useState<number | null>(null);
  // The one entry's own page (?entry=<id>, or a card's heading).
  const [panelId, setPanelId] = useState<number | null>(search.entry ?? null);
  // Set by Needs checking's "Open in the editor": the row to bring into view.
  const [openedFromList, setOpenedFromList] = useState<number | null>(null);
  useEffect(() => {
    if (openedFromList === null) return;
    const row = document.getElementById(`registry-entry-${openedFromList}`);
    row?.scrollIntoView?.({ block: "start" });
    row?.focus();
  }, [openedFromList, published.length]);
  // Bumped after an add so the add form remounts empty.
  const [addVersion, setAddVersion] = useState(0);
  // The add form is closed until an editor asks for it.
  const [addOpen, setAddOpen] = useState(false);
  // The last write's word to the editor. Held here rather than read off a
  // mutation so a later action replaces it instead of leaving the older
  // mutation's "Saved." sitting under the newer one.
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const writeFailed = (error: unknown) => {
    setActionMessage(null);
    setActionError(
      error instanceof Error ? error.message : "That change was not saved. Nothing was changed.",
    );
  };

  const load = useMutation({
    mutationFn: () => loadStarterList(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registry-desk"] }),
  });

  const publish = useMutation({
    mutationFn: (serviceId: number) => publishRegistryEntry({ data: { serviceId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["registry-desk"] }),
  });

  const edit = useMutation({
    mutationFn: ({ serviceId, fields }: { serviceId: number; fields: RegistryEntryFields }) =>
      updateRegistryEntry({ data: { serviceId, fields } }),
    onSuccess: () => {
      setEditingId(null);
      setActionError(null);
      setActionMessage("Saved.");
      return qc.invalidateQueries({ queryKey: ["registry-desk"] });
    },
    onError: writeFailed,
  });

  const add = useMutation({
    mutationFn: (fields: RegistryEntryFields) => addRegistryEntry({ data: { fields } }),
    onSuccess: () => {
      setAddVersion((version) => version + 1);
      setAddOpen(false);
      setActionError(null);
      setActionMessage("Added. It is in the waiting list.");
      return qc.invalidateQueries({ queryKey: ["registry-desk"] });
    },
    onError: writeFailed,
  });

  const takeDown = useMutation({
    mutationFn: (serviceId: number) => takeDownRegistryEntry({ data: { serviceId } }),
    onSuccess: () => {
      setActionError(null);
      setActionMessage("Taken down. It is back in the waiting list.");
      return qc.invalidateQueries({ queryKey: ["registry-desk"] });
    },
    onError: writeFailed,
  });

  const loadMessage = load.data
    ? `Loaded ${load.data.entries} entries. ${load.data.waiting} are waiting to be published.`
    : load.error
      ? load.error instanceof Error
        ? load.error.message
        : "The starter list could not be loaded."
      : "Loading puts the entries here. Nothing shows to readers until you press Publish on each one.";

  /** The buttons every entry card carries, so the three lists behave alike. */
  const cardActions = (row: (typeof waiting)[number], publishedRow: boolean) => (
    <>
      {!publishedRow ? (
        <InkButton
          tone="solid"
          ariaLabel={`Publish: ${row.serviceName}`}
          disabled={publish.isPending}
          pending={publish.isPending && publish.variables === row.serviceId}
          pendingLabel="Publishing…"
          onClick={() => publish.mutate(row.serviceId)}
        >
          Publish
        </InkButton>
      ) : null}
      <InkButton
        tone="ghost"
        ariaLabel={`Edit: ${row.serviceName}`}
        onClick={() => setEditingId(editingId === row.serviceId ? null : row.serviceId)}
      >
        Edit
      </InkButton>
      <InkButton
        tone="ghost"
        ariaLabel={`All details: ${row.serviceName}`}
        onClick={() => setDetailId(detailId === row.serviceId ? null : row.serviceId)}
      >
        All details
      </InkButton>
      {publishedRow ? (
        <InkButton
          tone="ghost"
          ariaLabel={`Take down: ${row.serviceName}`}
          disabled={takeDown.isPending}
          pending={takeDown.isPending && takeDown.variables === row.serviceId}
          pendingLabel="Taking down…"
          onClick={() => takeDown.mutate(row.serviceId)}
        >
          Take down
        </InkButton>
      ) : null}
    </>
  );

  /** A card, the form underneath it when Edit is open, and the full editor. */
  const entryCard = (row: (typeof waiting)[number], publishedRow: boolean) => (
    <RegistryEntryCard
      key={row.serviceId}
      entry={row}
      formatDate={formatListDateTime}
      onOpen={() => setPanelId(row.serviceId)}
    >
      {cardActions(row, publishedRow)}
      {editingId === row.serviceId ? (
        <RegistryEntryForm
          initial={entryFieldsOf(row)}
          submitLabel="Save"
          pending={edit.isPending}
          pendingLabel="Saving…"
          onSubmit={(fields) => edit.mutate({ serviceId: row.serviceId, fields })}
          onCancel={() => setEditingId(null)}
        />
      ) : null}
      {detailId === row.serviceId ? (
        <RegistryEntryEditor serviceId={row.serviceId} onClose={() => setDetailId(null)} />
      ) : null}
    </RegistryEntryCard>
  );

  return (
    <DeskShell
      title="Registry"
      kicker="What the scan found in the community resource directory"
      lede={`${LEDE} Every entry, every change, with the facts, the source page and the date for each one.`}
    >
      <p className="note">
        The scan applies and publishes what it finds in a registry source by itself, and lists those
        entries under Auto-published so you can take one down. Each change it could not settle by
        itself waits in Detected changes, where it can be accepted or rejected. Accept and apply puts
        the proposed value on the entry; Accept without applying only records your decision; Reject
        leaves the entry as it is.
      </p>

      {query.isError ? (
        <ScreenError
          message={
            query.error instanceof Error ? query.error.message : "Could not load the registry."
          }
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : query.isPending ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {/*
            The search box and category filter narrow everything below them:
            the three entry lists and the detected changes.
          */}
          <div className="astra-toolbar registry-toolbar">
            <input
              type="search"
              className="astra-search"
              aria-label="Search the registry"
              placeholder="Search names, phones, addresses, categories…"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <label className="registry-filter">
              Category
              <select
                className="registry-filter-select"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">All categories</option>
                {categoryOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {text || category ? (
              <button
                type="button"
                className="astra-list-more"
                onClick={() => {
                  setText("");
                  setCategory("");
                }}
              >
                Clear
              </button>
            ) : null}
          </div>

          {panelId !== null ? (
            <RegistryEntryPanel
              serviceId={panelId}
              onClose={() => setPanelId(null)}
              onEdit={(serviceId) => {
                setPanelId(null);
                setDetailId(serviceId);
              }}
            />
          ) : null}
          {detailId !== null && panelId === null && !published.concat(waiting).some((row) => row.serviceId === detailId) ? (
            <RegistryEntryEditor serviceId={detailId} onClose={() => setDetailId(null)} />
          ) : null}

          {/*
            The Freshness panel is the first thing under the page title: how
            much of the registry the robot has opened again, and the entries
            behind each number. Every number links to its own list.
          */}
          <section
            className="src-sec registry-sec"
            id="registry-freshness"
            aria-labelledby="registry-freshness-title"
          >
            <div className="sechead">
              <div className="sechead-l">
                <h2 id="registry-freshness-title" className="sec-title">
                  Freshness
                </h2>
              </div>
            </div>
            <p className="wire-sum">
              The scan reopens every published entry&rsquo;s source page on a schedule, so the
              registry does not go stale. A robot recheck is not an editor&rsquo;s check; those stay
              under Needs checking.
            </p>
            <p className="registry-freshness">
              <a className="inline-link" href="#registry-published">
                <b>{freshness?.published ?? 0}</b> published
              </a>
              <a className="inline-link" href="#registry-fresh-rechecked">
                <b>{freshness?.recheckedLast30Days ?? 0}</b> rechecked in the last 30 days
              </a>
              <a className="inline-link" href="#registry-fresh-changed">
                <b>{freshness?.changed ?? 0}</b> changed
              </a>
              <a className="inline-link" href="#registry-fresh-gone">
                <b>{freshness?.sourceGone ?? 0}</b> source gone
              </a>
            </p>
            <p className="astra-row-meta">
              {freshness?.oldestUnchecked ? (
                <>
                  Oldest unchecked entry:{" "}
                  <a
                    className="inline-link"
                    href={`#registry-entry-${freshness.oldestUnchecked.serviceId}`}
                  >
                    {freshness.oldestUnchecked.organizationName} —{" "}
                    {freshness.oldestUnchecked.serviceName}
                  </a>
                </>
              ) : (
                "Every published entry has a robot recheck on record."
              )}
            </p>

            <details className="src-sec registry-fresh-list" id="registry-fresh-rechecked" open>
              <summary className="registry-sec-summary">
                <SecHead
                  title="Rechecked in the last 30 days"
                  count={shownRechecked.length}
                />
              </summary>
              {!shownRechecked.length ? (
                <p className="wire-sum">No entry has been rechecked in the last 30 days yet.</p>
              ) : (
                <ul className="astra-plain">
                  {shownRechecked.map((row) => (
                    <li key={`rechecked-${row.serviceId}`}>
                      <span className="astra-row-t">
                        {row.organizationName} — {row.serviceName}
                      </span>
                      <span className="astra-row-meta">
                        {row.robotCheckedAt ? formatShortDate(row.robotCheckedAt) : ""}
                        {row.robotCheckResult
                          ? `${row.robotCheckedAt ? " · " : ""}${recheckResultWords(row.robotCheckResult)}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>

            <details className="src-sec registry-fresh-list" id="registry-fresh-changed" open>
              <summary className="registry-sec-summary">
                <SecHead title="Changed by the robot" count={shownChanged.length} />
              </summary>
              {!shownChanged.length ? (
                <p className="wire-sum">The robot has not found a change yet.</p>
              ) : (
                <ul className="astra-plain">
                  {shownChanged.map((row) => (
                    <li key={`changed-${row.serviceId}`}>
                      <span className="astra-row-t">
                        {row.organizationName} — {row.serviceName}
                      </span>
                      <span className="astra-row-meta">
                        {row.robotCheckedAt
                          ? `changed ${formatShortDate(row.robotCheckedAt)}`
                          : "changed at an unrecorded time"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </section>

          <Section
            title="Entries waiting to be published"
            count={visibleWaiting.length}
            sub="Loaded from the starter list or an import. Nothing here shows to readers until you publish it."
          >
            <p className="wire-sum">
              There are three ways to add entries: load the starter list (once), add one by hand
              below, or import a directory file under Imports.
            </p>
            {!query.data?.starterLoaded || load.data ? (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                {!query.data?.starterLoaded ? (
                  <InkButton
                    tone="solid"
                    onClick={() => load.mutate()}
                    pending={load.isPending}
                    pendingLabel="Loading…"
                  >
                    Load the starter list ({STARTER_ENTRIES.length} entries)
                  </InkButton>
                ) : null}
                <span role="status" aria-live="polite" className="text-sm text-ink-2">
                  {loadMessage}
                </span>
              </div>
            ) : null}
            {publish.isError ? (
              <p className="mb-3 text-sm text-rust" role="alert">
                {publish.error instanceof Error
                  ? publish.error.message
                  : "That entry was not published. Nothing was changed."}
              </p>
            ) : null}
            {actionError ? (
              <p className="mb-3 text-sm text-rust" role="alert">
                {actionError}
              </p>
            ) : null}
            {actionMessage ? (
              <p className="mb-3 text-sm text-ink-2" role="status" aria-live="polite">
                {actionMessage}
              </p>
            ) : null}
            <datalist id={CATEGORY_LIST_ID}>
              {categories.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {waiting.length === 0 ? (
              <p className="wire-sum">No entries are waiting.</p>
            ) : visibleWaiting.length === 0 ? (
              <p className="wire-sum">No waiting entry matches your search.</p>
            ) : (
              <>
                <ul className="astra-plain registry-cards">
                  {visibleWaiting.slice(0, shown.waiting).map((row) => (
                    <li key={row.serviceId} id={`registry-entry-${row.serviceId}`} tabIndex={-1} className="registry-card-anchor">
                      {entryCard(row, false)}
                      {STARTER_CHECKED_ON_BY_SERVICE_ID[row.serviceHsdsId] ? (
                        <p className="astra-row-meta">
                          {checkedOnLabel(STARTER_CHECKED_ON_BY_SERVICE_ID[row.serviceHsdsId]!)}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <ListFoot
                  shown={Math.min(shown.waiting, visibleWaiting.length)}
                  total={visibleWaiting.length}
                  noun="waiting entries"
                  onMore={() => more("waiting")}
                />
              </>
            )}
            <div className="mt-6">
              {/*
                Closed behind one button: an always-open seven-field form sat
                in the middle of the waiting list and pushed the entries an
                editor came to read off the screen.
              */}
              <InkButton
                tone="ghost"
                onClick={() => setAddOpen((open) => !open)}
              >
                Add an entry
              </InkButton>
              {addOpen ? (
                <div className="mt-3">
                  <h3 className="font-display text-xl">Add an entry</h3>
                  <p className="wire-sum">
                    It goes into the waiting list. Readers see it only after you press Publish.
                  </p>
                  <RegistryEntryForm
                    key={addVersion}
                    initial={EMPTY_ENTRY_FIELDS}
                    submitLabel="Add entry"
                    pending={add.isPending}
                    pendingLabel="Adding…"
                    onSubmit={(fields) => add.mutate(fields)}
                    onCancel={() => {
                      setAddVersion((version) => version + 1);
                      setAddOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </Section>

          <Section
            id="registry-published"
            title="Published entries"
            count={query.data?.publishedCount ?? 0}
            sub="Every published entry appears on the public page."
          >
            <Link to="/registry" className="btn quiet small">
              See the public page
            </Link>
            {published.length === 0 ? (
              <p className="wire-sum">No entries are published yet.</p>
            ) : visiblePublished.length === 0 ? (
              <p className="wire-sum">No published entry matches your search.</p>
            ) : (
              <>
                <ul className="astra-plain registry-cards">
                  {visiblePublished.slice(0, shown.published).map((row) => (
                    <li key={row.serviceId} id={`registry-entry-${row.serviceId}`} tabIndex={-1} className="registry-card-anchor">
                      {entryCard(row, true)}
                    </li>
                  ))}
                </ul>
                <ListFoot
                  shown={Math.min(shown.published, visiblePublished.length)}
                  total={visiblePublished.length}
                  noun="published entries"
                  onMore={() => more("published")}
                />
              </>
            )}
          </Section>

          <Section
            title="Auto-published"
            count={visibleAuto.length}
            sub="Entries the scan published by itself from a registry source page. Crisis entries are listed first; an editor can take any of them down."
          >
            {autoPublished.length === 0 ? (
              <p className="wire-sum">The scan has not auto-published an entry yet.</p>
            ) : visibleAuto.length === 0 ? (
              <p className="wire-sum">No auto-published entry matches your search.</p>
            ) : (
              <>
                <ul className="astra-plain registry-cards">
                  {visibleAuto.slice(0, shown.auto).map((row) => (
                    <li key={row.auditId} className="registry-card-anchor">
                      <RegistryEntryCard
                        entry={row}
                        formatDate={formatListDateTime}
                        onOpen={() => setPanelId(row.serviceId)}
                      >
                        <p className="astra-row-meta">
                          {row.crisis ? "Crisis resource · " : ""}
                          Auto-published{" "}
                          {row.publishedAt
                            ? formatListDateTime(row.publishedAt)
                            : "at an unrecorded time"}
                        </p>
                        <InkButton
                          tone="ghost"
                          ariaLabel={`Unpublish: ${row.serviceName}`}
                          disabled={takeDown.isPending || !row.published}
                          pending={takeDown.isPending && takeDown.variables === row.serviceId}
                          pendingLabel="Taking down…"
                          onClick={() => takeDown.mutate(row.serviceId)}
                        >
                          Unpublish
                        </InkButton>
                      </RegistryEntryCard>
                    </li>
                  ))}
                </ul>
                <ListFoot
                  shown={Math.min(shown.auto, visibleAuto.length)}
                  total={visibleAuto.length}
                  noun="auto-published entries"
                  onMore={() => more("auto")}
                />
              </>
            )}
          </Section>

          {/*
            An entry whose source page is gone is taken off the public page and
            listed here, so an editor can decide whether to find a new source,
            correct it or leave it down.
          */}
          <Section
            id="registry-fresh-gone"
            title="Source gone"
            count={visibleGone.length}
            sub="Entries the robot took down because their own source page answered 404, 410 or no longer resolved, on two rechecks at least three days apart."
          >
            {visibleGone.length === 0 ? (
              <p className="wire-sum">No entry has lost its source page.</p>
            ) : (
              <>
                <ul className="astra-plain">
                  {visibleGone.slice(0, shown.gone).map((row) => (
                    <li key={`gone-${row.serviceId}`}>
                      <div className="astra-row-t">
                        {row.organizationName} — {row.serviceName}
                      </div>
                      <p className="astra-row-meta">
                        Taken down after the source page was found gone
                        {row.robotCheckedAt ? ` on ${formatShortDate(row.robotCheckedAt)}` : ""}.
                      </p>
                      <button
                        type="button"
                        className="astra-list-more"
                        onClick={() => setPanelId(row.serviceId)}
                      >
                        Open this entry
                      </button>
                    </li>
                  ))}
                </ul>
                <ListFoot
                  shown={Math.min(shown.gone, visibleGone.length)}
                  total={visibleGone.length}
                  noun="entries with a gone source"
                  onMore={() => more("gone")}
                />
              </>
            )}
          </Section>

          <Section
            title="Needs checking"
            sub="Published entries with no verification, an old one, or facts that changed since the last one."
          >
            <RegistryNeedsChecking
              limit={shown.needsChecking}
              renderFoot={(total) => (
                <ListFoot
                  shown={Math.min(shown.needsChecking, total)}
                  total={total}
                  noun="entries that need checking"
                  onMore={() => more("needsChecking")}
                />
              )}
              onOpen={(serviceId) => {
                setDetailId(serviceId);
                setOpenedFromList(serviceId);
              }}
            />
          </Section>

          <Section
            title="Detected changes"
            count={matchingChanges.length}
            sub="One row per change the scan proposed. A change waiting for an editor has not been applied to the directory."
          >
            <div className="astra-toolbar">
              <div className="astra-seg" role="group" aria-label="Filter changes by review state">
                {REVIEW_STATES.map((option) => {
                  const count =
                    option.key === "all"
                      ? matchingChanges.length
                      : matchingChanges.filter((c) => c.reviewState === option.key).length;
                  return (
                    <a
                      key={option.key}
                      className={"astra-seg-opt" + (state === option.key ? " on" : "")}
                      aria-current={state === option.key ? "page" : undefined}
                      href={option.key === "all" ? "/desk/registry" : `/desk/registry?state=${option.key}`}
                    >
                      {option.label} · {count}
                    </a>
                  );
                })}
              </div>
            </div>
            {/* Always mounted, so the review status line survives the last row leaving the filter. */}
            <RegistryChangeReviewList
              changes={visible.slice(0, shown.changes)}
              emptyText={
                changes.length === 0
                  ? "The scan has not found a change in a registry source yet."
                  : `No change is ${REVIEW_STATE_LABELS[state]?.toLowerCase() ?? "in this group"}.`
              }
              formatTime={formatListDateTime}
              onEdit={(change) => {
                if (change.serviceId != null) setPanelId(change.serviceId);
              }}
              renderSummary={(change) => {
                const entityLabel = ENTITY_LABELS[change.entityType] ?? change.entityType;
                const entity =
                  change.entityId === null
                    ? "New entry proposal"
                    : `${entityLabel}${change.entityName ? `: ${change.entityName}` : ""} · #${change.entityId}`;
                const newEntity = change.entityId === null
                  ? `A new ${entityLabel.toLowerCase()}${change.entityName ? `: ${change.entityName}` : ""}`
                  : null;
                return (
                  <>
                    <div className="astra-row-t">
                      {CHANGE_KIND_LABELS[change.changeKind] ?? change.changeKind} — {entity}
                    </div>
                    {newEntity ? <p className="astra-row-meta">{newEntity}</p> : null}
                    <p className="astra-row-meta">
                      {REVIEW_STATE_LABELS[change.reviewState] ?? change.reviewState}
                      {" · field "}
                      <b>{change.fieldName}</b>
                      {" · "}
                      {evidenceTierLabel(change.evidenceTier)}
                    </p>
                    <dl className="registry-change-values">
                      <div>
                        <dt>The entry says now</dt>
                        <dd>{change.beforeValue ?? "nothing recorded"}</dd>
                      </div>
                      <div>
                        <dt>The page now says</dt>
                        <dd>{change.afterValue ?? "nothing recorded"}</dd>
                      </div>
                    </dl>
                    {change.quote ? (
                      <blockquote className="registry-quote">
                        “{change.quote}”
                      </blockquote>
                    ) : (
                      <p className="astra-row-meta">
                        The exact sentence was not recorded for this proposal.
                      </p>
                    )}
                    {change.summary ? (
                      <p className="astra-row-meta">The scan&rsquo;s note: {change.summary}</p>
                    ) : null}
                    <p className="astra-row-meta">
                      Source:{" "}
                      {change.sourceUrl ? (
                        <a
                          className="inline-link"
                          href={change.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {change.sourceTitle || change.sourceUrl} ↗
                        </a>
                      ) : (
                        (change.sourceTitle ?? "not recorded")
                      )}
                      {change.captureDate
                        ? ` · captured ${formatListDateTime(change.captureDate)}`
                        : " · capture date not recorded"}
                    </p>
                    <p className="astra-row-meta">
                      Entry:{" "}
                      {change.serviceId == null ? (
                        "not tied to one entry yet"
                      ) : change.servicePublished === true ? (
                        <a
                          className="inline-link"
                          href={`/registry/${change.serviceId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          open the public page ↗
                        </a>
                      ) : (
                        `registry entry #${change.serviceId} (not published)`
                      )}
                      {" · "}
                      Scan run {change.scanRunId ?? "not recorded"} ·{" "}
                      {change.createdAt
                        ? formatListDateTime(change.createdAt)
                        : "date not recorded"}
                    </p>
                  </>
                );
              }}
            />
            <ListFoot
              shown={Math.min(shown.changes, visible.length)}
              total={visible.length}
              noun="detected changes"
              onMore={() => more("changes")}
            />
          </Section>

          <Section
            title="Imports"
            count={query.data?.imports.length ?? 0}
            sub="Directories the desk read into the registry. Every imported row starts unpublished."
          >
            <RegistryImportPanel directoryNames={query.data?.directoryNames ?? []} />
            <RegistryExportPanel directoryNames={query.data?.directoryNames ?? []} />
            {!query.data?.imports.length ? (
              <p className="wire-sum">No directory has been imported yet.</p>
            ) : (
              <ul className="astra-plain">
                {query.data.imports.map((row) => (
                  <li key={row.id}>
                    <div className="astra-row-t">{row.directoryName}</div>
                    <p className="astra-row-meta">
                      {row.importedAt ? formatShortDate(row.importedAt) : "Date not recorded"}
                      {" · "}
                      {row.format.toUpperCase()}
                      {" · "}
                      {row.outcomes ? (
                        <>
                          {row.outcomes.inserted} new
                          {" · "}
                          {row.outcomes.unchanged} unchanged
                          {" · "}
                          {row.outcomes.changed} changed for review
                        </>
                      ) : (
                        <>
                          {row.recordCount} new row{row.recordCount === 1 ? "" : "s"} added
                          {" · "}
                          {row.conflictCount} difference{row.conflictCount === 1 ? "" : "s"} proposed
                          for review
                        </>
                      )}
                    </p>
                    {row.sourceUrl ? (
                      <p className="astra-row-meta">
                        {isWebAddress(row.sourceUrl) ? (
                          <a
                            className="inline-link"
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {row.sourceUrl} ↗
                          </a>
                        ) : (
                          /* A scheme no browser opens (`hsds://…`) is shown as
                             the address it is, not as a dead link. */
                          row.sourceUrl
                        )}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Registry sources"
            count={query.data?.sources.length ?? 0}
            sub="Sources the scan may read for the registry, and what they are to it."
          >
            {!query.data?.sources.length ? (
              <p className="wire-sum">No source carries a registry role yet.</p>
            ) : (
              <ul className="astra-plain">
                {query.data.sources.map((row) => (
                  <li key={row.id}>
                    <div className="astra-row-t">{row.title || row.url}</div>
                    <p className="astra-row-meta">
                      {ROLE_LABELS[row.registryRole] ?? row.registryRole}
                      {row.directoryName ? ` · ${row.directoryName}` : ""}
                      {" · "}
                      <a className="inline-link" href={row.url} target="_blank" rel="noreferrer">
                        {row.url} ↗
                      </a>
                    </p>
                    <p className="astra-row-meta">
                      {row.lastFetchedAt
                        ? `Last fetched ${formatListDateTime(row.lastFetchedAt)}`
                        : "Not fetched yet"}
                      {row.lastError ? ` · Last error: ${row.lastError}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </DeskShell>
  );
}
