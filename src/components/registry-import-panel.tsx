import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import {
  previewHsdsImport,
  runHsdsImport,
} from "@/lib/news/registry/registry-desk-write";

// Types come from the server functions themselves: a client file may not
// import a `*.server.*` file, even for a type.
type HsdsImportPreviewResult = Awaited<ReturnType<typeof previewHsdsImport>>;
type HsdsImportRunResult = Awaited<ReturnType<typeof runHsdsImport>>;
type HsdsImportSummary = Extract<HsdsImportRunResult, { ok: true }>["summary"];

/**
 * Import a directory file into the registry (spec 24, Phase 2).
 *
 * The editor picks an HSDS JSON file and names the directory it came from,
 * presses Preview to see what an import would do, and only then can press
 * Import. Preview writes nothing. Import never publishes anything: new rows
 * wait unpublished, and a row that differs from one already stored becomes a
 * proposal for later review, not an overwrite.
 *
 * The Import button follows the last good preview of exactly this file and
 * this name. Change either and the preview is cleared, so the editor never
 * imports something other than what they were shown.
 */

/** Same ceiling the TownRecord import uses. */
export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

const DIRECTORY_LIST_ID = "registry-import-directory-names";

const TABLE_LABELS: Record<string, string> = {
  taxonomies: "Categories",
  organizations: "Organizations",
  services: "Services",
  locations: "Locations",
  schedules: "Schedules",
  contacts: "Contacts",
  service_at_locations: "Service locations",
  eligibilities: "Eligibility rules",
  required_documents: "Required documents",
  languages: "Languages",
  accessibilities: "Accessibility notes",
};

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

/** How many conflicts are written out before the rest are only counted. */
const CONFLICTS_SHOWN = 100;

const field = "w-full border border-rule bg-paper p-2";

interface PickedFile {
  name: string;
  text: string;
}

function Problems({ problems, closing }: { problems: string[]; closing: string }) {
  return (
    <div role="alert" className="text-rust">
      <p>The file could not be used:</p>
      <ul className="list-disc pl-6">
        {problems.map((problem, index) => (
          <li key={index}>{problem}</li>
        ))}
      </ul>
      <p>{closing}</p>
    </div>
  );
}

/** Counts per table, and the conflicts in plain words. */
function SummaryView({ summary }: { summary: HsdsImportSummary }) {
  const rows = Object.entries(summary.tables).filter(
    ([, counts]) =>
      counts.inserted + counts.unchanged + counts.changed + counts.alreadyPending > 0,
  );
  const shown = summary.conflicts.slice(0, CONFLICTS_SHOWN);
  return (
    <>
      {rows.length === 0 ? (
        <p className="wire-sum">The file has no rows.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">New</th>
              <th scope="col">Unchanged</th>
              <th scope="col">Changed, for review</th>
              <th scope="col">Already waiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([table, counts]) => (
              <tr key={table}>
                <th scope="row">{TABLE_LABELS[table] ?? table}</th>
                <td>{counts.inserted}</td>
                <td>{counts.unchanged}</td>
                <td>{counts.changed}</td>
                <td>{counts.alreadyPending}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="astra-row-meta">
        &ldquo;Changed, for review&rdquo; means a row is already stored and the file says something
        different. The stored row is not changed. The difference waits as a proposal.
        &ldquo;Already waiting&rdquo; means that proposal is already in the list.
      </p>
      {summary.conflicts.length === 0 ? (
        <p className="astra-row-meta">No stored row differs from the file.</p>
      ) : (
        <>
          <p className="astra-row-t">
            {summary.conflicts.length} difference{summary.conflicts.length === 1 ? "" : "s"} from
            what is stored
          </p>
          <ul className="astra-plain">
            {shown.map((conflict, index) => (
              <li key={index}>
                <p className="astra-row-meta">
                  {ENTITY_LABELS[conflict.entity_type] ?? conflict.entity_type}{" "}
                  {conflict.hsds_id}, {conflict.field_name}: stored{" "}
                  {conflict.before_value ?? "nothing"}, the file says{" "}
                  {conflict.after_value ?? "nothing"}.
                </p>
              </li>
            ))}
          </ul>
          {summary.conflicts.length > shown.length ? (
            <p className="astra-row-meta">
              And {summary.conflicts.length - shown.length} more.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

export function RegistryImportPanel({ directoryNames }: { directoryNames: string[] }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [directoryName, setDirectoryName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  // What the last preview was run on, so the Import button can tell whether
  // the file and name on screen are still the ones the editor was shown.
  const [preview, setPreview] = useState<{
    key: string;
    result: HsdsImportPreviewResult;
  } | null>(null);
  const [imported, setImported] = useState<Extract<HsdsImportRunResult, { ok: true }> | null>(
    null,
  );
  const [importProblems, setImportProblems] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // A preview or import that comes back after the editor changed the file or
  // name belongs to something no longer on screen; this counter drops it.
  const generation = useRef(0);
  // Set while an import is in flight, so a second press before React has
  // re-rendered the pending button cannot send the same import again.
  const importing = useRef(false);
  // Counts file picks only. Typing a name does not discard a file still being
  // read; a newer pick does, so an older read cannot overwrite it.
  const pickGeneration = useRef(0);

  const name = directoryName.trim();
  const currentKey = picked ? JSON.stringify([picked.name, picked.text, name]) : null;

  const clearResults = () => {
    generation.current += 1;
    setPreview(null);
    setImported(null);
    setImportProblems(null);
    setFailure(null);
  };

  const failed = (error: unknown) => {
    setFailure(
      error instanceof Error && error.message
        ? `${error.message} Nothing was imported.`
        : "That did not work. Nothing was imported.",
    );
  };

  // A thrown error during Import is not a refusal: the server may have
  // committed the rows before the connection failed, so the panel cannot say
  // that nothing was imported.
  const importFailed = (error: unknown) => {
    const detail =
      error instanceof Error && error.message ? error.message : "That did not work.";
    setFailure(
      `${detail} The import may or may not have finished. Check the Imports list below before trying again.`,
    );
  };

  const previewMutation = useMutation({
    mutationFn: (input: { json: string; directoryName: string }) =>
      previewHsdsImport({ data: input }),
  });
  const importMutation = useMutation({
    mutationFn: (input: { json: string; directoryName: string }) =>
      runHsdsImport({ data: input }),
  });

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    const mine = ++pickGeneration.current;
    clearResults();
    setFileError(null);
    setPicked(null);
    if (!file) return;
    if (!/\.json$/i.test(file.name)) {
      setFileError("That is not a JSON file. Choose a file that ends in .json. Nothing was read.");
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setFileError("That file is larger than 8 MB. Choose a smaller file. Nothing was read.");
      return;
    }
    try {
      const text = await file.text();
      if (mine === pickGeneration.current) setPicked({ name: file.name, text });
    } catch {
      if (mine === pickGeneration.current) {
        setFileError("That file could not be read. Nothing was imported.");
      }
    }
  };

  const onPreview = () => {
    if (!picked || !currentKey) return;
    clearResults();
    const mine = generation.current;
    const key = currentKey;
    previewMutation.mutate(
      { json: picked.text, directoryName: name },
      {
        onSuccess: (result) => {
          if (mine === generation.current) setPreview({ key, result });
        },
        onError: (error) => {
          if (mine === generation.current) failed(error);
        },
      },
    );
  };

  const onImport = () => {
    if (importing.current || !picked || !preview?.result.ok || preview.key !== currentKey) return;
    importing.current = true;
    const mine = generation.current;
    importMutation.mutate(
      { json: picked.text, directoryName: name },
      {
        onSuccess: (result) => {
          importing.current = false;
          // Refresh the desk lists whatever happened: a refusal may still
          // leave a row behind, and a dropped response must not leave them stale.
          void qc.invalidateQueries({ queryKey: ["registry-desk"] });
          if (mine !== generation.current) return;
          setPreview(null);
          if (result.ok) {
            setImported(result);
          } else {
            setImportProblems(result.problems);
          }
        },
        onError: (error) => {
          importing.current = false;
          void qc.invalidateQueries({ queryKey: ["registry-desk"] });
          if (mine !== generation.current) return;
          setPreview(null);
          importFailed(error);
        },
      },
    );
  };

  const previewIsCurrent = preview !== null && preview.key === currentKey;
  const canImport = previewIsCurrent && preview.result.ok;

  return (
    <div className="mb-6">
      <h3 className="font-display text-xl">Import a directory file</h3>
      <p className="wire-sum">
        A JSON file in the HSDS bundle shape. Other formats are not read. Preview shows what an
        import would do and saves nothing.
      </p>
      <datalist id={DIRECTORY_LIST_ID}>
        {directoryNames.map((directory) => (
          <option key={directory} value={directory} />
        ))}
      </datalist>
      <div className="grid gap-2">
        <label className="block">
          JSON file
          <input
            type="file"
            accept=".json,application/json"
            className={field}
            disabled={importMutation.isPending}
            onChange={(event) => void onPick(event)}
          />
        </label>
        {fileError ? (
          <p className="text-rust" role="alert">
            {fileError}
          </p>
        ) : null}
        <label className="block">
          Directory name
          <input
            className={field}
            value={directoryName}
            maxLength={200}
            disabled={importMutation.isPending}
            list={DIRECTORY_LIST_ID}
            onChange={(event) => {
              clearResults();
              setDirectoryName(event.target.value);
            }}
          />
        </label>
        <p className="astra-row-meta">
          The name is how a repeat import finds the same rows. Use the same name every time you
          import this directory.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <InkButton
            tone="ghost"
            disabled={!picked || !name || importMutation.isPending}
            pending={previewMutation.isPending}
            pendingLabel="Checking…"
            onClick={onPreview}
          >
            Preview
          </InkButton>
          <InkButton
            tone="solid"
            disabled={!canImport || previewMutation.isPending}
            pending={importMutation.isPending}
            pendingLabel="Importing…"
            onClick={onImport}
          >
            Import
          </InkButton>
        </div>
        <p className="astra-row-meta">Importing does not publish anything.</p>
      </div>

      {failure ? (
        <p className="mt-3 text-rust" role="alert">
          {failure}
        </p>
      ) : null}

      {previewIsCurrent && preview.result.ok === false ? (
        <div className="mt-3">
          <Problems
            problems={preview.result.problems}
            closing="Nothing was imported. Fix the file or the name and press Preview again."
          />
        </div>
      ) : null}

      {previewIsCurrent && preview.result.ok ? (
        <section className="mt-3" aria-label="Preview">
          <p className="astra-row-t">Preview of {preview.result.directoryName}</p>
          <p role="status" aria-live="polite" className="astra-row-meta">
            {preview.result.looksLikeNewDirectory
              ? "This looks like a new directory. No earlier import used this name. If you meant an earlier one, check the spelling."
              : `${preview.result.existingRows} row${preview.result.existingRows === 1 ? "" : "s"} match earlier imports of this directory.`}
          </p>
          <SummaryView summary={preview.result.summary} />
          <p className="astra-row-meta">
            Nothing has been saved yet. Press Import to add these rows. Importing does not publish
            anything.
          </p>
        </section>
      ) : null}

      {importProblems ? (
        <div className="mt-3">
          <Problems problems={importProblems} closing="Nothing was imported." />
        </div>
      ) : null}

      {imported ? (
        <section className="mt-3" aria-label="Import results">
          <p className="astra-row-t" role="status" aria-live="polite">
            Imported {imported.directoryName}. Nothing was published.
          </p>
          <SummaryView summary={imported.summary} />
        </section>
      ) : null}
    </div>
  );
}
