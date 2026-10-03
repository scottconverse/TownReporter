import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton } from "@/components/desk-chrome";
import { LegalRemovalDialog } from "@/components/dialogs/LegalRemovalDialog";
import { usePaperDateFormatters } from "@/lib/paper-context-state";
import {
  legalCases,
  legalCase,
  legalRetainedCopy,
  legalBackupAction,
} from "@/lib/news/legal-removal";
import { listPublishedDesk } from "@/lib/news/desk";
import { myDesk } from "@/lib/news/claim";

export const Route = createFileRoute("/desk/legal-removals")({
  validateSearch: (search: Record<string, unknown>) => ({
    article: Number(search.article) || undefined,
    case: typeof search.case === "string" ? search.case : undefined,
  }),
  component: LegalRemovalsPage,
});
const field = "w-full border border-rule bg-paper p-2 text-sm";
/** Case history comes first; a story search opens the existing removal dialog. */
function LegalRemovalsPage() {
  const search = Route.useSearch();
  const qc = useQueryClient();
  const { formatListDateTime } = usePaperDateFormatters();
  const [query, setQuery] = useState("");
  const [showAllCases, setShowAllCases] = useState(false);
  const [showAllStories, setShowAllStories] = useState(false);
  const [articleId, setArticleId] = useState<number | null>(search.article ?? null);
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
  const matchingStories = query.trim()
    ? (articles.data ?? []).filter((a) => a.headline.toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  const caseRows = cases.data?.ok ? cases.data.value : [];
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
          <section className="astra-panel" aria-label="Removal cases">
            <h2 className="font-display text-xl">Removal cases</h2>
            {cases.isPending ? (
              <p>Loading cases…</p>
            ) : cases.isError || cases.data?.ok === false ? (
              <p role="alert">Could not load removal cases. Reload to verify status.</p>
            ) : cases.data?.ok && cases.data.value.length ? (
              <>
              {caseRows.slice(0, showAllCases ? undefined : 5).map((c) => (
                <div className="r2-case-row" key={c.id}>
                  <a className="underline" href={`/desk/legal-removals?case=${c.id}`}>
                    {c.case_ref}
                  </a>{" "}
                  <span className="astra-chip">{c.policy === "retain" ? "Retention policy" : "Destruction"}</span>
                  <time dateTime={c.created_at}>{formatListDateTime(c.created_at)}</time>
                </div>
              ))}
              {caseRows.length > 5 && !showAllCases ? (
                <InkButton tone="quiet" onClick={() => setShowAllCases(true)}>Show all {caseRows.length}</InkButton>
              ) : null}
              </>
            ) : (
              <p>No removal cases yet.</p>
            )}
          </section>
          {search.case ? <CaseDetail key={search.case} caseId={search.case} /> : null}
          <section className="astra-panel mt-6" aria-label="Start a removal case">
            <h2 className="font-display text-xl">Start a case</h2>
            <p>Find a published story, or use More → Legal removal on <a className="underline" href="/desk/published">Published</a>.</p>
            <label className="astra-field">
              <span className="astra-field-label">Search published stories</span>
              <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setShowAllStories(false); }} />
            </label>
            {query.trim() ? articles.isPending ? <p>Loading published stories…</p> : articles.isError ? (
              <p role="alert">Could not load stories. Reload this page.</p>
            ) : matchingStories.length ? (
              <>
                {matchingStories.slice(0, showAllStories ? undefined : 5).map((a) => (
                  <div className="r2-case-row" key={a.id}>
                    <span>{a.headline}</span>
                    <InkButton tone="quiet" onClick={() => setArticleId(a.id)}>Start case</InkButton>
                  </div>
                ))}
                {matchingStories.length > 5 && !showAllStories ? (
                  <InkButton tone="quiet" onClick={() => setShowAllStories(true)}>Show all {matchingStories.length}</InkButton>
                ) : null}
              </>
            ) : <p>No published stories match this search.</p> : null}
          </section>
          <LegalRemovalDialog
            open={articleId !== null}
            onOpenChange={(open) => { if (!open) setArticleId(null); }}
            articleId={articleId ?? undefined}
            articles={articles.data ?? null}
            articlesPending={articles.isPending}
            articlesError={articles.isError}
            onConfirmed={async (caseId) => {
              await qc.invalidateQueries();
              window.location.assign(`/desk/legal-removals?case=${encodeURIComponent(caseId)}`);
            }}
          />
        </>
      )}
    </DeskShell>
  );
}
function CaseDetail({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const { formatListDateTime } = usePaperDateFormatters();
  const [showAllBackups, setShowAllBackups] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
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
          ? `Owner-only retention until ${formatListDateTime(data.expires_at)}. ${data.purged_at ? "Copy purged." : "Expired copies cannot be opened."}`
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
      <details>
        <summary className="btn quiet">About external cleanup</summary>
      <p>
        Backups restored later can reintroduce removed content. The operator must apply this case to
        restored data before serving it. This application cannot inspect or erase external backups,
        provider history, existing caches or readers’ downloaded copies.
      </p>
      </details>
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
      {data.backups.slice(0, showAllBackups ? undefined : 5).map((b) => (
        <div className="border border-rule p-3" key={b.id}>
          <p>
            {b.identifier}: {b.confirmed_at ? `operator attested ${formatListDateTime(b.confirmed_at)}` : "pending"}
          </p>
          {!b.confirmed_at && (
            <InkButton tone="ghost" disabled={busy} onClick={() => void backup(b.id)}>
              Record operator cleanup attestation
            </InkButton>
          )}
        </div>
      ))}
      {data.backups.length > 5 && !showAllBackups ? <InkButton tone="quiet" onClick={() => setShowAllBackups(true)}>Show all {data.backups.length}</InkButton> : null}
      <h3 className="font-display text-xl">Metadata audit</h3>
      <ul>
        {data.events.slice(0, showAllEvents ? undefined : 5).map((e, index) => (
          <li key={index}>
            {formatListDateTime(e.created_at)} · {e.action}
          </li>
        ))}
      </ul>
      {data.events.length > 5 && !showAllEvents ? <InkButton tone="quiet" onClick={() => setShowAllEvents(true)}>Show all {data.events.length}</InkButton> : null}
      {message && <p role="status">{message}</p>}
      <a className="underline" href="/desk/published">
        Back to Published
      </a>
    </section>
  );
}
