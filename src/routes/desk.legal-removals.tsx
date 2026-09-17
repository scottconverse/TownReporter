import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton } from "@/components/desk-chrome";
import {
  legalPreview,
  legalConfirm,
  legalCases,
  legalCase,
  legalRetainedCopy,
  legalBackupAction,
} from "@/lib/news/legal-removal";
import { listPublishedDesk } from "@/lib/news/desk";
import { myDesk } from "@/lib/news/claim";
import type { LegalSelection, LegalPreview } from "@/lib/news/legal-removal-types";

export const Route = createFileRoute("/desk/legal-removals")({
  validateSearch: (search: Record<string, unknown>) => ({
    article: Number(search.article) || undefined,
    case: typeof search.case === "string" ? search.case : undefined,
  }),
  component: LegalRemovalsPage,
});
const field = "w-full border border-rule bg-paper p-2 text-sm";
function LegalRemovalsPage() {
  const search = Route.useSearch();
  const qc = useQueryClient();
  const role = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const owner = role.data?.ok && role.data.role === "owner";
  const articles = useQuery({
    queryKey: ["published-desk"],
    queryFn: () => listPublishedDesk(),
    enabled: owner,
  });
  const cases = useQuery({
    queryKey: ["legal-cases"],
    queryFn: () => legalCases(),
    enabled: owner,
  });
  const [selection, setSelection] = useState<LegalSelection>({
    articleIds: search.article ? [search.article] : [],
    draftIds: [],
    memoryIds: [],
    auditIds: [],
    trashIds: [],
    reviewedLegacy: false,
    reviewedEvidence: false,
  });
  const [preview, setPreview] = useState<LegalPreview | null>(null);
  const [policy, setPolicy] = useState<"retain" | "destroy">("retain");
  const [caseRef, setCaseRef] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentPreview = preview && JSON.stringify(preview.selection) === JSON.stringify(selection);
  function change(next: LegalSelection) {
    setSelection(next);
    setConfirm("");
  }
  async function review() {
    setBusy(true);
    setError("");
    try {
      const result = await legalPreview({ data: selection });
      if (result.ok) {
        setPreview(result.value);
        setSelection(result.value.selection);
      } else setError(result.error);
    } catch {
      setError("Could not load the impact preview. Your selection is preserved.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await legalConfirm({
        data: { selection, fingerprint: preview.fingerprint, policy, caseRef },
      });
      if (result.ok) {
        await qc.invalidateQueries();
        window.location.assign(
          `/desk/legal-removals?case=${encodeURIComponent(result.value.caseId)}`,
        );
      } else setError(result.error);
    } catch {
      setError("No removal is confirmed. Reload the case list before retrying.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <DeskShell
      title="Legal removals"
      lede="A separate, owner-only process for removing a story and its connected application copies."
    >
      {role.isPending ? (
        <p>Checking owner access…</p>
      ) : !owner ? (
        <p role="alert">
          Only the owner can manage legal removals.{" "}
          <a className="underline" href="/desk/published">
            Back to Published
          </a>
        </p>
      ) : (
        <>
          {search.case ? (
            <CaseDetail key={search.case} caseId={search.case} />
          ) : (
            <section className="legal-removal-flow space-y-4" aria-label="Legal removal preview">
              <p>
                This is separate from ordinary 30-day trash. There is no Undo. Retained copies are
                protected by owner access, <strong>not encryption</strong>. Existing backups,
                provider records and reader caches cannot be recalled by this application.
              </p>
              <fieldset className="border border-rule p-4">
                <legend>Articles to remove</legend>
                {articles.isPending ? (
                  <p>Loading published articles…</p>
                ) : articles.isError ? (
                  <p role="alert">Could not load articles. Reload this page.</p>
                ) : !articles.data?.length ? (
                  <p>
                    No published stories to remove.{" "}
                    <a className="underline" href="/desk/published">
                      Back to Published
                    </a>
                    .
                  </p>
                ) : (
                  articles.data?.map((a) => (
                    <label className="my-2 flex gap-2" key={a.id}>
                      <input
                        type="checkbox"
                        checked={selection.articleIds.includes(a.id)}
                        onChange={(e) =>
                          change({
                            ...selection,
                            articleIds: e.target.checked
                              ? [...selection.articleIds, a.id]
                              : selection.articleIds.filter((id) => id !== a.id),
                          })
                        }
                      />
                      <span>{a.headline}</span>
                    </label>
                  ))
                )}
              </fieldset>
              <InkButton
                disabled={busy || !selection.articleIds.length}
                onClick={() => void review()}
              >
                Review connected copies
              </InkButton>
              {preview && (
                <>
                  <h2 className="font-display text-xl">Impact before removal</h2>
                  {!currentPreview && (
                    <p role="status">
                      Selection changed. Use Review connected copies again to refresh counts before
                      confirming.
                    </p>
                  )}
                  <ul>
                    {Object.entries(preview.counts).map(([kind, count]) => (
                      <li key={kind}>
                        {kind.replaceAll("_", " ")}: {count}
                      </li>
                    ))}
                  </ul>
                  {preview.blockers.map((message) => (
                    <p role="alert" key={message}>
                      {message}
                    </p>
                  ))}
                  <p>
                    Historical records do not always carry an article ID. Select only the drafts,
                    memory entries, audit labels and trash copies that belong to these stories.
                    Shared source documents remain independent evidence unless explicitly brought
                    into the removal scope.
                  </p>
                  {preview.selectedHistorical.length > 0 && (
                    <fieldset className="border border-rule p-3">
                      <legend>Selected historical records — uncheck to remove from scope</legend>
                      {preview.selectedHistorical.map((c) => (
                        <label className="my-2 flex gap-2" key={`${c.kind}-${c.id}`}>
                          <input
                            type="checkbox"
                            checked={selection[c.kind].includes(c.id)}
                            onChange={() =>
                              change({
                                ...selection,
                                [c.kind]: selection[c.kind].filter((id) => id !== c.id),
                              })
                            }
                          />
                          <span>
                            {c.kind.replace("Ids", "")} #{c.id}: {c.label}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <details>
                    <summary>Review historical candidates ({preview.candidates.length})</summary>
                    {preview.candidates.map((c) => (
                      <label className="my-2 flex gap-2 break-words" key={`${c.kind}-${c.id}`}>
                        <input
                          type="checkbox"
                          checked={selection[c.kind].includes(c.id)}
                          onChange={(e) =>
                            change({
                              ...selection,
                              [c.kind]: e.target.checked
                                ? [...selection[c.kind], c.id]
                                : selection[c.kind].filter((id) => id !== c.id),
                            })
                          }
                        />
                        <span>
                          {c.kind.replace("Ids", "")} #{c.id}: {c.label}
                        </span>
                      </label>
                    ))}
                  </details>
                  {preview.capturedCopies.length > 0 && (
                    <p role="alert">
                      Known captured copies require separate local-operator review:{" "}
                      {preview.capturedCopies.map((c) => `${c.table} #${c.id}`).join(", ")}.
                      Retained application removal may proceed with review pending. Court
                      destruction is blocked until these copies are resolved; the review checkbox
                      does not override this.
                    </p>
                  )}
                  {preview.sharedInvestigationIds.length > 0 && (
                    <p>
                      Related investigation files:{" "}
                      {preview.sharedInvestigationIds.map((id) => `#${id}`).join(", ")}.{" "}
                      <a className="underline" href="/desk/dark">
                        Open Dark Desk to review these files
                      </a>
                      . Review independently shared evidence before claiming destruction complete.
                    </p>
                  )}
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={selection.reviewedLegacy}
                      onChange={(e) => change({ ...selection, reviewedLegacy: e.target.checked })}
                    />
                    I reviewed the historical candidates and selected the copies in scope.
                    Unselected records are independent work.
                  </label>
                  <label className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={selection.reviewedEvidence}
                      onChange={(e) => change({ ...selection, reviewedEvidence: e.target.checked })}
                    />
                    I reviewed shared evidence; anything retained is independently held and outside
                    this removal scope.
                  </label>
                  <label className="block">
                    Retention policy
                    <select
                      className={field}
                      value={policy}
                      onChange={(e) => {
                        setPolicy(e.target.value as "retain" | "destroy");
                        setConfirm("");
                      }}
                    >
                      <option value="retain">Keep an owner-only copy for 12 calendar months</option>
                      <option value="destroy">
                        Explicit court destruction: keep no removed text
                      </option>
                    </select>
                  </label>
                  <p>
                    {policy === "retain"
                      ? "The retained copy expires automatically. Evidence review and external cleanup may remain pending."
                      : "No removed text will enter the retained-copy table. Resolve the historical and shared-evidence review first. External erasure still needs operator verification."}
                  </p>
                  <label className="block">
                    Case reference (identifier only; no story text)
                    <input
                      className={field}
                      value={caseRef}
                      onChange={(e) => setCaseRef(e.target.value)}
                      maxLength={120}
                    />
                  </label>
                  <label className="block">
                    Type REMOVE to confirm
                    <input
                      className={field}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="off"
                    />
                  </label>
                  <InkButton
                    tone="danger"
                    disabled={
                      busy ||
                      !currentPreview ||
                      confirm !== "REMOVE" ||
                      !caseRef ||
                      preview.blockers.length > 0 ||
                      (policy === "destroy" && preview.reviewPending)
                    }
                    onClick={() => void remove()}
                  >
                    Remove selected stories and connected copies
                  </InkButton>
                  <a className="ml-4 underline" href="/desk/published">
                    Cancel and return to Published
                  </a>
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </section>
          )}
          <section className="mt-8">
            <h2 className="font-display text-xl">Removal cases</h2>
            {cases.isPending ? (
              <p>Loading cases…</p>
            ) : cases.isError || cases.data?.ok === false ? (
              <p role="alert">Could not load removal cases. Reload to verify status.</p>
            ) : cases.data?.ok && cases.data.value.length ? (
              cases.data.value.map((c) => (
                <p key={c.id}>
                  <a className="underline" href={`/desk/legal-removals?case=${c.id}`}>
                    {c.case_ref}
                  </a>{" "}
                  · {c.policy === "retain" ? "retained policy" : "destruction"} · {c.created_at}
                </p>
              ))
            ) : (
              <p>No removal cases yet.</p>
            )}
          </section>
        </>
      )}
    </DeskShell>
  );
}
function CaseDetail({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["legal-case", caseId],
    queryFn: () => legalCase({ data: caseId }),
  });
  const [copy, setCopy] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function viewCopy() {
    setBusy(true);
    setMessage("");
    try {
      const result = await legalRetainedCopy({ data: caseId });
      if (result.ok) {
        setCopy(JSON.stringify(JSON.parse(result.value), null, 2));
        await qc.invalidateQueries({ queryKey: ["legal-case", caseId] });
      } else setMessage(result.error);
    } catch {
      setMessage("Retained text could not be opened.");
    } finally {
      setBusy(false);
    }
  }
  async function backup(confirmId?: number) {
    setBusy(true);
    setMessage("");
    try {
      const result = await legalBackupAction({ data: { caseId, identifier, confirmId } });
      if (result.ok) {
        setIdentifier("");
        setMessage(
          confirmId
            ? "Operator attestation recorded; this does not prove erasure."
            : "Backup cleanup remains pending.",
        );
        await qc.invalidateQueries({ queryKey: ["legal-case", caseId] });
      } else setMessage(result.error);
    } catch {
      setMessage("Backup status was not confirmed. Reload and retry.");
    } finally {
      setBusy(false);
    }
  }
  if (detail.isPending) return <p>Loading removal case…</p>;
  if (detail.isError || !detail.data?.ok)
    return (
      <p role="alert">
        {detail.data?.ok === false ? detail.data.error : "Could not load this case."}
      </p>
    );
  const data = detail.data.value;
  return (
    <section className="legal-removal-flow space-y-4" aria-label="Removal case">
      <h2 className="font-display text-2xl">Case {data.case_ref}</h2>
      <p role="status">
        Application removal recorded. The stories and selected connected copies are no longer in the
        paper or ordinary trash.
      </p>
      <p>
        {data.policy === "retain"
          ? `Owner-only retention until ${data.expires_at}. ${data.purged_at ? "Copy purged." : "Expired copies cannot be opened."}`
          : "Destruction policy: no removed text was saved in the retained-copy table."}
      </p>
      <p>
        Evidence review:{" "}
        {data.review_pending
          ? "pending; application removal does not establish complete evidence cleanup"
          : "owner reviewed the selected application scope"}
        . External cleanup:{" "}
        {data.externalStatus === "pending"
          ? "pending"
          : "operator attested; not independently verified"}
        .
      </p>
      <p>
        Backups restored later can reintroduce removed content. The operator must apply this case to
        restored data before serving it. This application cannot inspect or erase external backups,
        provider history, existing caches or readers’ downloaded copies.
      </p>
      {data.policy === "retain" && !data.purged_at && (
        <InkButton disabled={busy} onClick={() => void viewCopy()}>
          Open owner-only retained text (audited)
        </InkButton>
      )}
      {copy && (
        <div>
          <InkButton tone="ghost" onClick={() => setCopy(null)}>
            Close retained text
          </InkButton>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all border border-rule p-3 text-sm">
            {copy}
          </pre>
        </div>
      )}
      <p>
        Watches aimed at these article addresses are paused, and matching ordinary sources are
        excluded from scans. Their independent evidence remains pending review.
      </p>
      <h3 className="font-display text-xl">External backup cleanup</h3>
      <label className="block">
        Backup location or identifier (no story text)
        <input
          className={field}
          value={identifier}
          maxLength={200}
          onChange={(e) => setIdentifier(e.target.value)}
        />
      </label>
      <InkButton disabled={busy || !identifier.trim()} onClick={() => void backup()}>
        Add pending backup action
      </InkButton>
      {data.backups.map((b) => (
        <div className="border border-rule p-3" key={b.id}>
          <p>
            {b.identifier}: {b.confirmed_at ? `operator attested ${b.confirmed_at}` : "pending"}
          </p>
          {!b.confirmed_at && (
            <InkButton tone="ghost" disabled={busy} onClick={() => void backup(b.id)}>
              Record operator cleanup attestation
            </InkButton>
          )}
        </div>
      ))}
      <h3 className="font-display text-xl">Metadata audit</h3>
      <ul>
        {data.events.map((e, index) => (
          <li key={index}>
            {e.created_at} · {e.action}
          </li>
        ))}
      </ul>
      {message && <p role="status">{message}</p>}
      <a className="underline" href="/desk/published">
        Back to Published
      </a>
    </section>
  );
}
