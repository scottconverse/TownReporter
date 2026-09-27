import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, InkButton } from "@/components/desk-chrome";
import { LegalRemovalFlow } from "@/components/dialogs/LegalRemovalDialog";
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
/**
 * The flow itself -- preview, fingerprint, retain/destroy, REMOVE to confirm, the
 * danger press -- moved to `@/components/dialogs/LegalRemovalDialog` in unit BH2
 * (decision 3), so the drawn `dialog-15-legal.png` and this page run one
 * implementation instead of two that can drift. What stays here is the page: the
 * owner gate, the `?case=` detail, the case list, and the one thing a dialog
 * cannot do -- navigate away on success.
 */
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
              {/*
                The same component the dialog renders. Without `onPressChange` it
                draws the danger press and the return link itself, exactly as this
                page always has; the only new thing here is where the press goes
                when it wins.
              */}
              <LegalRemovalFlow
                articles={articles.data ?? null}
                articlesPending={articles.isPending}
                articlesError={articles.isError}
                initialArticleIds={search.article ? [search.article] : []}
                onConfirmed={async (caseId) => {
                  await qc.invalidateQueries();
                  window.location.assign(
                    `/desk/legal-removals?case=${encodeURIComponent(caseId)}`,
                  );
                }}
              />
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
